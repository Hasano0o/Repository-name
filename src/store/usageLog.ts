import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Usage } from '../drivers/types';
import { UsageLog, emptyLog, addReading } from '../utils/usageDays';

/* ═══ سجل الاستهلاك اليومي — لكل راوتر ═══
 * كل قراءة لعدّاد الشهر (صفحة الراوتر، صفحة الجهاز، المراقبة بالخلفية) تنضاف هنا،
 * ومنها نحسب «اليوم» و«الأسبوع» (src/utils/usageDays.ts).
 */

const KEY = (id: string) => `bandly.usageDays.${id}`;
const chain = new Map<string, Promise<unknown>>();

export async function getUsageLog(routerId: string): Promise<UsageLog> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && j.days && typeof j.days === 'object') return j as UsageLog;
    }
  } catch {}
  return emptyLog();
}

/** يسجّل قراءة — الكتابات لنفس الراوتر ورا بعض (المراقبة والشاشة ممكن يقرون بنفس اللحظة) */
export function recordUsage(routerId: string, u: Usage | null | undefined, at = Date.now()): Promise<UsageLog | null> {
  if (!u) return Promise.resolve(null);
  const total = (u.downloadBytes ?? 0) + (u.uploadBytes ?? 0);
  if (!Number.isFinite(total) || total <= 0) return Promise.resolve(null);
  const prev = chain.get(routerId) ?? Promise.resolve();
  const p = prev.catch(() => {}).then(async () => {
    const next = addReading(await getUsageLog(routerId), total, at);
    try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify(next)); } catch {}
    return next;
  });
  chain.set(routerId, p);
  return p.catch(() => null);
}
