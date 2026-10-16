/**
 * تجربة الأبراج بالدور: نثبّت على كل برج، ننتظر الاتصال، نتأكد إن الراوتر فعلاً عليه،
 * نقيس الإشارة (كم عينة) والبنق، وبعدها نرجّع التثبيت اللي كان — حتى لو انلغى أو صار خطأ.
 *
 * كانت داخل صفحة الأبراج («قيس بنق الأبراج»)، وطلّعناها هنا عشان المستشار الذكي يستخدم
 * نفس المحرك بدل نسخة ثانية. الفرق عن قبل:
 * - نسجّل عينات الإشارة (القوة/الجودة/النقاء) وقت التثبيت — قياس فعلي للمستشار.
 * - لو التثبيت فشل بعد ما أرسلنا أمر (مو noChange) نعتبر التقنية «اتلمست» ونرجّعها.
 * - الانتظار يستخدم waitOnline حق القفل الآمن (يكشف «خدمة محدودة» بعد).
 */
import { SavedRouter } from '../store/routers';
import { withSession, withRouterLock } from '../store/sessions';
import { CellLockState, Signal } from '../drivers/types';
import { isNoChange } from '../drivers/noChange';
import { waitOnline, freeRelease } from './safeLock';
import { measureUrl, regionUrls, selectedRegion, gameScore } from './latency';
import { TowerPing, saveTowerPing, towerPingKey } from '../store/towerPing';
import { diag } from '../services/diag';

export interface TrialTarget {
  tech: 'LTE' | 'NR';
  band?: number;
  arfcn: string;
  pci: string;
  /** اسم للعرض */
  name: string;
}

export type TrialOutcome = 'measured' | 'rejected' | 'noconn' | 'moved' | 'nointernet' | 'skipped';

export interface TrialRow {
  t: TrialTarget;
  outcome: TrialOutcome;
  ping?: TowerPing;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  samples: number;
  movedTo?: string;
  note: string;
}

export interface TrialRun {
  rows: TrialRow[];
  /** رجّعنا التثبيت السابق والراوتر متصل */
  restored: boolean;
  /** اضطرينا نفك كل التثبيتات عشان يلقط أقوى برج */
  freed: boolean;
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export async function runTowerTrials(r: SavedRouter, targets: TrialTarget[], prev: CellLockState[], o: {
  onStep?: (s: { i: number; n: number; name: string; step: string }) => void;
  onRow?: (row: TrialRow) => void;
  isCancelled?: () => boolean;
  /** عينات إشارة لكل برج (افتراضي ٣) */
  samples?: number;
} = {}): Promise<TrialRun> {
  const cancelled = o.isCancelled ?? (() => false);
  const step = o.onStep ?? (() => {});
  const rows: TrialRow[] = [];
  const touched = new Set<'LTE' | 'NR'>();
  const region = await selectedRegion();
  let freed = false;
  let restored = true;
  const n = targets.length;
  const push = (row: TrialRow) => { rows.push(row); o.onRow?.(row); diag(`[trial] ${row.t.name}: ${row.outcome} ${row.note}`); };
  const restoreTech = async (tech: 'LTE' | 'NR') => {
    const was = prev.find(l => (l.tech ?? 'LTE') === tech && l.pci);
    await withSession(r, d => (was
      ? d.lockCell!({ tech, band: was.band, arfcn: was.arfcn, pci: was.pci! })
      : d.unlockCell!(tech)), false);
  };

  await withRouterLock(r.id, async () => {
    try {
      for (let i = 0; i < n; i++) {
        if (cancelled()) break;
        const t = targets[i];
        step({ i: i + 1, n, name: t.name, step: 'نثبّت عليه...' });
        try {
          await withSession(r, d => d.lockCell!({ tech: t.tech, band: t.band, arfcn: t.arfcn, pci: t.pci }), false);
          touched.add(t.tech);
        } catch (e) {
          // رفض قبل أي أمر = ما تغيّر شي. غير كذا ممكن الراوتر تغيّر ← نرجّعه في الآخر
          if (!isNoChange(e)) touched.add(t.tech);
          push({ t, outcome: 'rejected', samples: 0, note: 'ما قبل التثبيت' });
          continue;
        }
        step({ i: i + 1, n, name: t.name, step: 'ننتظر الاتصال...' });
        if (!(await waitOnline(r, 120000, cancelled))) {
          push({ t, outcome: 'noconn', samples: 0, note: 'ما اتصل — فكّينا التثبيت' });
          step({ i: i + 1, n, name: t.name, step: 'ما اتصل — نرجّع الخدمة...' });
          try { await restoreTech(t.tech); } catch {}
          if (!(await waitOnline(r, 120000, () => false))) {
            // ولا رجع — نفك كل شي ويلقط أقوى برج، ونوقف التجربة
            freed = true;
            restored = await freeRelease(r, st => step({ i: i + 1, n, name: t.name, step: st })).catch(() => false);
            touched.clear();
            break;
          }
          continue;
        }
        await sleep(3000);
        // عينات الإشارة — ونتأكد إن الراوتر فعلاً على البرج المطلوب
        const want = o.samples ?? 3;
        const rs: number[] = [], qs: number[] = [], ss: number[] = [];
        let movedTo: string | undefined;
        for (let k = 0; k < want && !cancelled(); k++) {
          step({ i: i + 1, n, name: t.name, step: `نقيس الإشارة (${k + 1} من ${want})...` });
          const s: Signal | null = await withSession(r, async d => (d.getSignal ? d.getSignal() : null), false).catch(() => null);
          const pci = t.tech === 'NR' ? s?.nrPci : s?.pci;
          if (s && pci && String(pci) !== String(t.pci)) { movedTo = String(pci); break; }
          const rsrp = t.tech === 'NR' ? s?.nrRsrp : s?.rsrp;
          const rsrq = t.tech === 'NR' ? s?.nrRsrq : s?.rsrq;
          const sinr = t.tech === 'NR' ? s?.nrSinr : s?.sinr;
          if (rsrp !== undefined) rs.push(rsrp);
          if (rsrq !== undefined) qs.push(rsrq);
          if (sinr !== undefined) ss.push(sinr);
          if (k < want - 1) await sleep(2500);
        }
        if (movedTo) {
          push({ t, outcome: 'moved', samples: 0, movedTo, note: `الراوتر راح لبرج ${movedTo} بداله` });
          continue;
        }
        step({ i: i + 1, n, name: t.name, step: `نقيس البنق لـ${region.name}...` });
        const res = await measureUrl(regionUrls(region), 12);
        const base = { rsrp: avg(rs), rsrq: avg(qs), sinr: avg(ss), samples: rs.length };
        if (!res.samples) {
          push({ t, outcome: 'nointernet', ...base, note: 'ما وصل للإنترنت' });
          continue;
        }
        const ping: TowerPing = { ping: res.median, jitter: res.jitter, loss: res.lossPct, score: gameScore(res), region: region.id, at: Date.now() };
        await saveTowerPing(r.id, towerPingKey(t.tech, t.pci), ping);
        push({ t, outcome: 'measured', ping, ...base, note: `${res.median}ms` });
      }
    } finally {
      // نرجّع التثبيت اللي كان — حتى لو انلغى أو صار خطأ في النص
      if (!freed && touched.size) {
        step({ i: n, n, name: '', step: 'نرجّع إعدادك السابق...' });
        for (const tech of touched) { try { await restoreTech(tech); } catch {} }
        if (!(await waitOnline(r, 120000, () => false))) {
          // الإرجاع ما رجّع الخدمة — نفك كل شي ويلقط أقوى برج بدل ما يعلق بدون خدمة
          freed = true;
          restored = await freeRelease(r, st => step({ i: n, n, name: '', step: st })).catch(() => false);
        }
      }
    }
  });
  return { rows, restored, freed, cancelled: cancelled() };
}
