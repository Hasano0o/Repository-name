import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { listRouters } from '../store/routers';
import { withSession } from '../store/sessions';
import {
  getMonitorSettings, loadMonStates, saveMonStates, RouterMonState,
} from '../store/monitor';
import { overallLevel, LEVEL_LABEL, parseNrBands, Level } from '../utils/signal';
import { notify } from '../utils/notify';
import { Signal, NetworkInfo, Usage, DataPlan } from '../drivers/types';

export const MONITOR_TASK = 'bandly-monitor-v1';

const GOOD: Level[] = ['excellent', 'good'];
const BAD: Level[] = ['fair', 'poor'];

/**
 * فحص كل الرواترات المحفوظة ومقارنة حالتها بآخر حالة معروفة، وإرسال تنبيه عند التغيّر.
 * لا يقرأ ولا يخزّن أي كلمات مرور أو بيانات حساسة — فقط الإشارة والاستهلاك.
 * يرجع true لو أرسل أي تنبيه (عشان يبلّغ نظام الخلفية إن فيه بيانات جديدة).
 */
export async function runMonitorCheck(): Promise<boolean> {
  const settings = await getMonitorSettings();
  if (!settings.enabled) return false;

  const routers = await listRouters();
  if (!routers.length) return false;

  const states = await loadMonStates();
  const a = settings.alerts;
  let fired = false;

  const AUTH_FAIL_PATTERN = /(كلمة المرور|جلسة عالقة|جلسة أخرى|محاولات كثيرة|تعذّر تسجيل الدخول|108006|108007|108001|108002)/;
  const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 ساعات
  for (const r of routers) {
    // ═══ تخطى الراوتر لو فشل الدخول آخر 6 ساعات — يمنع قفل الحساب ═══
    const prev0 = states[r.id] ?? {};
    if (prev0.authFailedAt && Date.now() - prev0.authFailedAt < AUTH_COOLDOWN_MS) {
      continue;
    }
    try {
      const [sig, net, usage, plan] = (await withSession(r, async d => Promise.all([
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
        d.getUsage ? d.getUsage().catch(() => null) : Promise.resolve(null),
        d.getDataPlan ? d.getDataPlan().catch(() => null) : Promise.resolve(null),
      ]))) as [Signal | null, NetworkInfo | null, Usage | null, DataPlan | null];

      const prev: RouterMonState = states[r.id] ?? {};

      // ما قدرنا نوصل الراوتر (الجوال بعيد عن الشبكة مثلاً) — نتجاهل، ما نرسل انقطاع
      const reachable = sig !== null || net !== null;
      if (!reachable) {
        states[r.id] = { ...prev, at: Date.now() };
        continue;
      }

      const next: RouterMonState = { ...prev, at: Date.now() };
      const online = net?.connected ?? true;
      next.online = online;

      // انقطاع الاتصال
      if (a.disconnect && prev.online === true && !online) {
        notify('انقطع الاتصال', `راوتر ${r.name} فقد الاتصال بالشبكة.`, r.id);
        fired = true;
      }

      if (online && sig) {
        const level = overallLevel(sig);
        next.level = level;
        const hasNr = sig.nrRsrp !== undefined || parseNrBands(sig.nrBand).length > 0;
        next.hadNr = hasNr;

        if (a.signalDrop && prev.level && GOOD.includes(prev.level) && BAD.includes(level)) {
          notify('إشارتك ضعفت 📉', `${r.name}: صارت ${LEVEL_LABEL[level]}. جرّب توجيه الأنتنا أو أفضل تردد.`, r.id);
          fired = true;
        }
        if (a.signalRecover && prev.level && BAD.includes(prev.level) && GOOD.includes(level)) {
          notify('إشارتك تحسّنت 📈', `${r.name}: صارت ${LEVEL_LABEL[level]}.`, r.id);
          fired = true;
        }
        if (a.nr5g && prev.hadNr === false && hasNr) {
          notify('رجعت شبكة 5G ⚡', `${r.name}: تم الاتصال بشبكة 5G.`, r.id);
          fired = true;
        }
      }

      // استهلاك الباقة
      if (a.dataPlan && plan && plan.limitBytes > 0 && usage) {
        const used = (usage.downloadBytes ?? 0) + (usage.uploadBytes ?? 0);
        const pct = Math.floor((used / plan.limitBytes) * 100);
        const prevBucket = prev.usageBucket ?? 0;
        let bucket = prevBucket;
        for (const th of [70, 90, 100]) {
          if (pct >= th && prevBucket < th) {
            notify(
              th === 100 ? 'انتهت الباقة 🚨' : 'تنبيه استهلاك 📊',
              th === 100 ? `خلصت باقة ${r.name} (${pct}%).` : `استهلكت ${th}% من باقة ${r.name}.`,
              r.id,
            );
            fired = true;
            bucket = th;
          }
        }
        if (pct < 70) bucket = 0; // دورة جديدة — نصفّر
        next.usageBucket = bucket;
      }

      states[r.id] = next;
    } catch {
      // نتجاهل هذا الراوتر ونكمل الباقي
    }
  }

  await saveMonStates(states);
  return fired;
}

TaskManager.defineTask(MONITOR_TASK, async () => {
  try {
    const changed = await runMonitorCheck();
    return changed
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function isMonitorRegistered(): Promise<boolean> {
  try { return await TaskManager.isTaskRegisteredAsync(MONITOR_TASK); } catch { return false; }
}

export async function startMonitor(intervalMin: number): Promise<void> {
  await BackgroundFetch.registerTaskAsync(MONITOR_TASK, {
    minimumInterval: Math.max(15, intervalMin) * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function stopMonitor(): Promise<void> {
  try {
    if (await isMonitorRegistered()) await BackgroundFetch.unregisterTaskAsync(MONITOR_TASK);
  } catch {}
}
