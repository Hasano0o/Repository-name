import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { listProfiles } from '../store/profiles';
import { listGameLog, periodOf, PERIODS } from '../store/gameLog';
import { getAuto, getAutoState, saveAutoState } from '../store/automation';
import { applyProfile } from '../utils/applyProfile';
import { measureUrl, regionById, regionUrls } from '../utils/latency';
import { overallLevel } from '../utils/signal';
import { notify } from '../utils/notify';
import { Signal, Traffic } from '../drivers/types';

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const clock = (t: number) => {
  const d = new Date(t);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const pingNow = async () => {
  const r = await measureUrl(regionUrls(regionById('ae')), 8).catch(() => null);
  return r && r.samples ? r.median : undefined;
};

/** ليش نحتاج إعادة تشغيل الليلة؟ (للوضع «بس إذا يحتاج») — نرجع السبب أو null */
async function needsReboot(r: SavedRouter, sig: Signal | null, traffic: Traffic | null): Promise<string | null> {
  if (traffic && traffic.connectedSecs > 2 * 86400) return `الراوتر شغال ${Math.floor(traffic.connectedSecs / 86400)} أيام بدون إعادة تشغيل`;
  if (sig && overallLevel({ rsrp: sig.rsrp, sinr: sig.sinr }) === 'poor') return 'الإشارة ضعيفة الحين';
  const log = (await listGameLog(r.id)).filter(e => e.score > 0);
  const now = Date.now();
  const day = log.filter(e => e.at >= now - 86400000).map(e => e.score);
  const week = log.filter(e => e.at >= now - 7 * 86400000 && e.at < now - 86400000).map(e => e.score);
  if (day.length >= 2 && week.length >= 3) {
    const a = day.reduce((x, y) => x + y, 0) / day.length;
    const b = week.reduce((x, y) => x + y, 0) / week.length;
    if (b - a >= 12) return `درجة اللعب نزلت اليوم (${Math.round(a)} بدل ${Math.round(b)})`;
  }
  return null;
}

/**
 * يشتغل مع مهمة المراقبة بالخلفية لكل راوتر:
 * ١) الوضع الذكي بالوقت — يطبّق الملف المحدد لفترة اليوم الحالية
 * ٢) الصيانة الليلية — يعيد تشغيل الراوتر بين ٣:٣٠ و٥ الفجر، ويرسل تقرير الصبح
 * يرجع true لو أرسل إشعار.
 */
export async function runAutomation(r: SavedRouter, sig: Signal | null): Promise<boolean> {
  const auto = await getAuto(r.id);
  const st = await getAutoState(r.id);
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  let fired = false;

  /* ── تقرير الصيانة الليلية (الصبح) ── */
  if (st.pending && Date.now() - st.pending.at > 10 * 60000) {
    const after = await pingNow();
    st.report = { at: st.pending.at, beforePing: st.pending.beforePing, afterPing: after, reason: st.pending.reason };
    st.pending = undefined;
  }
  if (st.report && !st.report.notified && h >= 7 && h < 23) {
    const rp = st.report;
    const diff = rp.beforePing !== undefined && rp.afterPing !== undefined
      ? ` — البنق ${rp.beforePing}ms قبل و ${rp.afterPing}ms بعد${rp.afterPing < rp.beforePing - 5 ? ' 📈' : ''}`
      : '';
    notify('🔄 الصيانة الليلية', `${r.name}: أعدت تشغيل الراوتر الساعة ${clock(rp.at)} (${rp.reason})${diff}`, r.id);
    rp.notified = true;
    fired = true;
  }

  /* ── الصيانة الليلية ── */
  const inWindow = (h === 3 && m >= 30) || h === 4;
  if (auto.nightly !== 'off' && inWindow && st.nightlyDay !== dayKey(now) && !st.pending) {
    const traffic = await withSession(r, async d => (d.getTraffic ? d.getTraffic() : null)).catch(() => null);
    const busyNet = traffic && traffic.downBytesPerSec > 512 * 1024; // أحد يحمّل الحين؟ ما نقطع عليه
    const reason = auto.nightly === 'daily' ? 'الصيانة اليومية' : await needsReboot(r, sig, traffic);
    st.nightlyDay = dayKey(now);
    if (reason && !busyNet) {
      const before = await pingNow();
      const ok = await withSession(r, async d => {
        if (!d.reboot) return false;
        await d.reboot();
        return true;
      }, false).catch(() => false);
      if (ok) st.pending = { at: Date.now(), beforePing: before, reason };
    }
  }

  /* ── الوضع الذكي بالوقت ── */
  if (auto.smart.enabled) {
    const period = periodOf(h);
    const target = auto.smart.map[period];
    const periodChanged = st.lastPeriod !== period;
    st.lastPeriod = period;
    // نطبّق أول ما تبدأ الفترة، أو لو المستخدم غيّر الملف المختار للفترة الحالية
    {
      if (target && (periodChanged || target !== st.lastProfileId) && !st.pending) {
        const p = (await listProfiles(r.id)).find(x => x.id === target);
        if (p) {
          const ok = await applyProfile(r, p).catch(() => false);
          if (ok) {
            st.lastProfileId = target;
            st.lastSwitchAt = Date.now();
            const pn = PERIODS.find(x => x.id === period)?.name ?? '';
            notify('🌙 الوضع الذكي', `${r.name}: بدّلت لـ «${p.name}» — مناسب لوقت ${pn}`, r.id);
            fired = true;
          }
        }
      }
    }
  }

  await saveAutoState(r.id, st);
  return fired;
}
