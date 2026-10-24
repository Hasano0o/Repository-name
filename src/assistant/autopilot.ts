/**
 * «اضبط لي كل شي» — المساعد يدير الراوتر بنفسه خطوة خطوة، بمحركات Bandly الموجودة:
 *   ١) فحص «قبل»  ٢) أفضل تردد 4G  ٣) أفضل برج  ٤) أفضل قناة واي فاي  ٥) فحص «بعد» + تقرير
 *
 * قواعد الأمان (ما تنكسر):
 *  • كل الشغل داخل قفل الراوتر (withRouterLock) — ما يتداخل مع أي أداة ثانية.
 *  • قبل أي تغيير ناخذ لقطة الإعداد (readLockState) ونرجّعها بعد التجارب — وبعدها التثبيت النهائي
 *    عبر safeApply: يقيس قبل وبعد، ولو صار أسوأ يرجّع لحاله.
 *  • الأبراج: نحترم cellLockRisk (ZTE) — نتخطاها ونقول ليش.
 *  • ما فيه ضبط مصنع ولا تغيير كلمات مرور. الإلغاء يوقف ويرجّع.
 */
import { SavedRouter } from '../store/routers';
import { withSession, withRouterLock, RouterOp } from '../store/sessions';
import { driverById } from '../drivers/registry';
import type { CellTower, CellLockState, BandConfig, Signal, WifiRadio } from '../drivers/types';
import type { LockSnapshot } from '../drivers/lockSnapshot';
import { readSnapOrStop, safeApply, waitOnline } from '../utils/safeLock';
import { measureUrl, regionUrls, selectedRegion, gameScore, LatencyResult } from '../utils/latency';
import { totalScore } from '../utils/optimize';
import { runTowerTrials, TrialTarget } from '../utils/towerTrial';
import { groupTowers, loadConfirmed, bandName } from '../utils/towers';
import { bandLabel } from '../utils/bands';

export type StepKey = 'check' | 'band' | 'tower' | 'wifi' | 'final';
export type StepStatus = 'wait' | 'run' | 'ok' | 'same' | 'skip' | 'fail';
export interface PilotStep { key: StepKey; title: string; status: StepStatus; note?: string }

export interface Measure {
  rsrp?: number; sinr?: number; nrRsrp?: number; nrSinr?: number;
  band?: string; nrBand?: string;
  ping?: number; jitter?: number; game?: number;
}
export interface PilotReport { before?: Measure; after?: Measure; steps: PilotStep[]; changed: string[] }

export const STEP_TITLES: Record<StepKey, string> = {
  check: 'نفحص اتصالك الحين',
  band: 'أفضل تردد',
  tower: 'أفضل برج',
  wifi: 'أفضل قناة واي فاي',
  final: 'نفحص مرة ثانية ونقارن',
};
export const freshSteps = (): PilotStep[] =>
  (Object.keys(STEP_TITLES) as StepKey[]).map(key => ({ key, title: STEP_TITLES[key], status: 'wait' }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errText = (e: unknown) => String((e as any)?.message ?? e ?? '').slice(0, 140);

async function readSig(r: SavedRouter): Promise<Signal | null> {
  return withSession(r, async d => (d.getSignal ? d.getSignal() : null), false).catch(() => null);
}
async function latency(n = 8): Promise<LatencyResult | null> {
  const reg = await selectedRegion();
  return measureUrl(regionUrls(reg), n).catch(() => null);
}
export async function measureNow(r: SavedRouter): Promise<Measure> {
  const [s, l] = await Promise.all([readSig(r), latency(10)]);
  return {
    rsrp: s?.rsrp, sinr: s?.sinr, nrRsrp: s?.nrRsrp, nrSinr: s?.nrSinr, band: s?.band, nrBand: s?.nrBand,
    ping: l?.samples ? Math.round(l.median) : undefined,
    jitter: l?.samples ? Math.round(l.jitter) : undefined,
    game: l?.samples ? gameScore(l) : undefined,
  };
}

// ═══ قناة الواي فاي (نفس منطق شاشة «قناة الواي فاي») ═══
function wifiCandidates(r: WifiRadio): string[] {
  if (r.band === '2.4') {
    const ok = r.allowed?.length ? r.allowed.filter(c => c !== '0') : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    return ['1', '6', '11'].filter(c => ok.includes(c));
  }
  if (r.allowed?.length) {
    const ok = r.allowed.filter(c => c !== '0');
    const pref = ['36', '44', '149', '157'].filter(c => ok.includes(c));
    return (pref.length >= 2 ? pref : ok.filter(c => Number(c) < 52 || Number(c) > 144)).slice(0, 3);
  }
  return ['36', '44', '149'];
}
async function lanPing(host: string): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  const t0 = Date.now();
  try { await fetch(`http://${host}/favicon.ico?_=${t0}`, { signal: ctrl.signal, cache: 'no-store' } as any); return Date.now() - t0; }
  catch { return null; } finally { clearTimeout(t); }
}
async function lanQuality(host: string, n = 20): Promise<number | null> {
  const xs: number[] = []; let lost = 0;
  for (let i = 0; i < n; i++) { const v = await lanPing(host); if (v === null) lost++; else xs.push(v); await sleep(120); }
  if (xs.length < n / 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  let j = 0; for (let i = 1; i < xs.length; i++) j += Math.abs(xs[i] - xs[i - 1]);
  return s[Math.floor(s.length / 2)] + (xs.length > 1 ? j / (xs.length - 1) : 0) * 1.5 + (lost / n) * 100 * 4;
}
/** بعد تغيير القناة: هل الجوال انقطع؟ (يعني هو على هالشبكة) + ننتظر يرجع */
async function afterChannelChange(host: string, cancelled: () => boolean): Promise<{ wasOn: boolean; back: boolean }> {
  let dropped = false;
  const watchEnd = Date.now() + 9000;
  while (Date.now() < watchEnd && !cancelled()) { if ((await lanPing(host)) === null) { dropped = true; break; } await sleep(400); }
  if (!dropped) return { wasOn: false, back: true };
  const deadline = Date.now() + 120000; let ok = 0;
  while (Date.now() < deadline && !cancelled()) {
    ok = (await lanPing(host)) !== null ? ok + 1 : 0;
    if (ok >= 3) { await sleep(3000); return { wasOn: true, back: true }; }
    await sleep(1000);
  }
  return { wasOn: true, back: false };
}

export interface PilotOpts {
  onSteps: (s: PilotStep[]) => void;
  onStatus: (s: string) => void;
  onMeasure?: (which: 'before' | 'after', m: Measure) => void;
  isCancelled: () => boolean;
}

export async function runAutopilot(r: SavedRouter, o: PilotOpts): Promise<PilotReport> {
  const steps = freshSteps();
  const changed: string[] = [];
  const set = (k: StepKey, status: StepStatus, note?: string) => {
    const i = steps.findIndex(x => x.key === k);
    steps[i] = { ...steps[i], status, note };
    o.onSteps([...steps]);
  };
  const cancelled = o.isCancelled;
  const proto = driverById(r.driverId);
  const report: PilotReport = { steps, changed };

  // ═══ ١) قبل ═══
  set('check', 'run');
  o.onStatus('أقرأ الإشارة وأقيس البنق…');
  const before = await measureNow(r);
  report.before = before;
  o.onMeasure?.('before', before);
  if (before.rsrp === undefined && before.nrRsrp === undefined) {
    set('check', 'fail', 'ما قدرت أقرأ من الراوتر — تأكد إنك على شبكته');
    for (const k of ['band', 'tower', 'wifi', 'final'] as StepKey[]) set(k, 'skip');
    return report;
  }
  set('check', 'ok', `${before.rsrp !== undefined ? `4G ${Math.round(before.rsrp)}` : ''}${before.nrRsrp !== undefined ? ` · 5G ${Math.round(before.nrRsrp)}` : ''}${before.ping !== undefined ? ` · بنق ${before.ping}ms` : ''}`);

  await withRouterLock(r, async (op: RouterOp) => {
    // ═══ ٢) أفضل تردد 4G ═══
    if (cancelled()) return;
    if (!proto?.setBand || !proto.readLockState || !proto.restoreLockState) set('band', 'skip', 'راوترك ما يدعم تثبيت الترددات من التطبيق');
    else {
      set('band', 'run');
      try {
        o.onStatus('أحفظ إعدادك الحالي…');
        const snap = await readSnapOrStop(r) as LockSnapshot;
        const [cfg, cells] = await withSession(r, async d => Promise.all([
          d.getBandConfig ? d.getBandConfig() : Promise.resolve(null as BandConfig | null),
          d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
        ]), false);
        // المرشحين: ترددات 4G اللي لها أبراج حولك فعلاً (الأقوى أول)
        const seen = new Map<number, number>();
        for (const c of cells) if (c.tech === 'LTE' && c.band && cfg?.supported.includes(c.band)) seen.set(c.band, Math.max(c.rsrp ?? -999, seen.get(c.band) ?? -999));
        const cands = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 4);
        if (cands.length < 2) set('band', 'same', 'ما فيه ترددات ثانية حولك تستاهل التجربة');
        else {
          const lat0 = await latency(6);
          const base = totalScore(before.rsrp, before.sinr, lat0 ?? undefined);
          let best: { b: number; score: number } | null = null;
          for (const [i, b] of cands.entries()) {
            if (cancelled()) break;
            o.onStatus(`أجرّب ${bandLabel('LTE', b)} (${i + 1}/${cands.length}) — النت بينقطع شوي`);
            try {
              await withSession(r, d => d.setBand!([b], undefined), false);
              if (!(await waitOnline(r, 120_000, cancelled))) continue;
              const [s, l] = await Promise.all([readSig(r), latency(6)]);
              const score = totalScore(s?.rsrp, s?.sinr, l ?? undefined);
              if (!best || score > best.score) best = { b, score };
            } catch {}
          }
          o.onStatus('أرجّع إعدادك قبل ما أقرر…');
          await withSession(r, d => d.restoreLockState!(snap), false).catch(() => {});
          await waitOnline(r, 150_000, () => false);
          if (cancelled()) { set('band', 'skip', 'وقّفته — رجّعت إعدادك'); return; }
          if (best && best.score >= base + 0.08) {
            const name = bandLabel('LTE', best.b);
            o.onStatus(`${name} أحسن — أثبّته بأمان وأتأكد…`);
            const res = await safeApply({
              r, key: `pilot:band:${best.b}`, label: `تثبيت ${name}`, op,
              apply: d => d.setBand!([best!.b], undefined),
              revert: d => d.restoreLockState!(snap),
              onStatus: o.onStatus, isCancelled: cancelled,
            });
            if (res.kept) { set('band', 'ok', `ثبّتت ${name}`); changed.push(`التردد ${name}`); }
            else set('band', 'same', 'جرّبت الأفضل وما فرق — رجّعت إعدادك');
          } else set('band', 'same', 'إعدادك الحالي هو الأفضل');
        }
      } catch (e) { set('band', 'fail', errText(e)); }
    }

    // ═══ ٣) أفضل برج ═══
    if (cancelled()) return;
    if (proto?.cellLockRisk) set('tower', 'skip', 'نوع راوترك يطيح لو ثبّتناه على برج — تخطيناها لسلامتك');
    else if (!proto?.lockCell || !proto.readLockState) set('tower', 'skip', 'راوترك ما يدعم التثبيت على برج');
    else {
      set('tower', 'run');
      try {
        o.onStatus('أشوف الأبراج حولك…');
        const [cells, prev] = await withSession(r, async d => Promise.all([
          d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
          d.getCellLocks ? d.getCellLocks().catch(() => [] as CellLockState[]) : Promise.resolve([] as CellLockState[]),
        ]), false);
        const groups = groupTowers(cells, await loadConfirmed(r.id));
        const targets: TrialTarget[] = [];
        for (const g of groups.filter(g => !g.inUse && g.pci && g.cells.some(c => c.arfcn)).slice(0, 3)) {
          const cell = g.cells.find(c => c === g.best && c.arfcn) ?? g.cells.find(c => c.arfcn)!;
          targets.push({ tech: cell.tech, band: cell.band, arfcn: cell.arfcn!, pci: g.pci!, name: `برج ${g.pci} · ${bandName(cell)}` });
        }
        if (!targets.length) set('tower', 'same', 'ما فيه أبراج ثانية حولك — برجك الحالي هو المتاح');
        else {
          const snap = await readSnapOrStop(r) as LockSnapshot;
          const cur = await latency(8);
          const curScore = cur?.samples ? gameScore(cur) : 0;
          const run = await runTowerTrials(r, targets, prev, {
            op, isCancelled: cancelled, samples: 1,
            onStep: st => o.onStatus(`${st.n ? `${st.i}/${st.n} — ` : ''}${st.name}: ${st.step}`),
          });
          if (cancelled()) { set('tower', 'skip', 'وقّفته — رجّعت إعدادك'); return; }
          const ok = run.rows.filter(x => x.ping && x.ping.score > 0).sort((a, b) => b.ping!.score - a.ping!.score);
          const top = ok[0];
          if (top && top.ping!.score >= curScore + 8) {
            o.onStatus(`${top.t.name} أقل بنق — أثبّته بأمان وأتأكد…`);
            const t = top.t;
            const res = await safeApply({
              r, key: `pilot:cell:${t.tech}:${t.pci}`, label: `التثبيت على ${t.name}`, op, withNr: t.tech === 'NR',
              apply: d => d.lockCell!({ tech: t.tech, band: t.band, arfcn: t.arfcn, pci: t.pci }),
              revert: d => d.restoreLockState!(snap),
              onStatus: o.onStatus, isCancelled: cancelled,
            });
            if (res.kept) { set('tower', 'ok', `ثبّتت ${t.name} (بنق ${top.ping!.ping}ms)`); changed.push(t.name); }
            else set('tower', 'same', 'جرّبت الأفضل وما فرق — رجّعت إعدادك');
          } else set('tower', 'same', ok.length ? 'برجك الحالي هو الأفضل' : 'الأبراج الثانية ما اشتغلت كويس — خليت برجك');
        }
      } catch (e) { set('tower', 'fail', errText(e)); }
    }

    // ═══ ٤) أفضل قناة واي فاي ═══
    if (cancelled()) return;
    if (!proto?.getWifiRadios || !proto.setWifiChannel || r.host === 'demo' || r.host === 'device') set('wifi', 'skip', 'راوترك ما يسمح بتغيير القناة من التطبيق');
    else {
      set('wifi', 'run');
      try {
        const radios = (await withSession(r, d => d.getWifiRadios!(), false)).filter(x => x.writable);
        if (!radios.length) { set('wifi', 'skip', 'راوترك ما يسمح بتغيير القناة من التطبيق'); }
        else {
          // نبدأ بـ 5 (أغلب الجوالات عليه) — لو الجوال مو عليه نعرف لما ما ينقطع، ونرجّع ونجرب 2.4
          const order = [...radios].sort((a, b) => (a.band === '5' ? -1 : 1) - (b.band === '5' ? -1 : 1));
          let done = false;
          for (const rad of order) {
            if (done || cancelled()) break;
            const orig = rad.channel;
            const list = wifiCandidates(rad).filter(c => c !== orig);
            if (!list.length) continue;
            o.onStatus(`أقيس الواي فاي (${rad.band})…`);
            const base = await lanQuality(r.host);
            if (base === null) { set('wifi', 'skip', 'جوالك مو متصل بواي فاي الراوتر'); done = true; break; }
            const tried: { ch: string; q: number }[] = [{ ch: orig, q: base }];
            let current = orig;
            let onThis = true;
            for (const [i, ch] of list.entries()) {
              if (cancelled()) break;
              o.onStatus(`أجرّب قناة ${ch} (${rad.band}) — الواي فاي بينقطع ثواني`);
              await withSession(r, d => d.setWifiChannel!(rad.band, ch), false).catch(e => {
                if (!/network|abort|timeout|مهلة|ما رد/i.test(errText(e))) throw e;
              });
              current = ch;
              const w = await afterChannelChange(r.host, cancelled);
              if (i === 0 && !w.wasOn) { onThis = false; break; } // الجوال مو على هالشبكة
              if (!w.back) throw new Error('الواي فاي ما رجع خلال دقيقتين — اتصل بشبكة الراوتر من إعدادات الجوال');
              const q = await lanQuality(r.host);
              if (q !== null) tried.push({ ch, q });
            }
            const bestCh = tried.reduce((a, x) => (x.q < a.q ? x : a), tried[0]);
            const keep = onThis && bestCh.ch !== orig && (1 - bestCh.q / base) >= 0.15;
            const target = keep ? bestCh.ch : orig;
            if (current !== target) {
              o.onStatus(keep ? `أثبّت قناة ${target}` : 'أرجّع قناتك الأصلية');
              await withSession(r, d => d.setWifiChannel!(rad.band, target), false).catch(() => {});
              if (onThis) await afterChannelChange(r.host, () => false);
              else await sleep(4000);
            }
            if (!onThis) continue;
            done = true;
            if (keep) { set('wifi', 'ok', `ثبّتت قناة ${target} (${rad.band}) — أنظف بحوالي ${Math.round((1 - bestCh.q / base) * 100)}٪`); changed.push(`قناة الواي فاي ${target}`); }
            else set('wifi', 'same', `قناتك (${orig === '0' ? 'تلقائي' : orig}) هي الأفضل`);
          }
          if (!done && !cancelled()) set('wifi', 'same', 'ما لقيت قناة أنظف من الحالية');
        }
      } catch (e) { set('wifi', 'fail', errText(e)); }
    }
  }, { label: 'اضبط لي كل شي' }).catch(e => {
    for (const st of steps) if (st.status === 'wait' || st.status === 'run') set(st.key, 'fail', errText(e));
  });

  for (const st of steps) if (st.status === 'wait' && st.key !== 'final') set(st.key, 'skip', cancelled() ? 'وقّفته' : undefined);

  // ═══ ٥) بعد ═══
  set('final', 'run');
  o.onStatus('أقيس مرة ثانية…');
  await sleep(3000);
  const after = await measureNow(r);
  report.after = after;
  o.onMeasure?.('after', after);
  set('final', 'ok', changed.length ? `غيّرت: ${changed.join('، ')}` : 'ما احتاج أغيّر شي — إعدادك الحالي هو الأفضل');
  o.onStatus('');
  return report;
}
