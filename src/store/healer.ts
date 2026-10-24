/**
 * «الحارس» — يراقب بالخلفية ويصلّح لحاله (مع مهمة المراقبة). إعداده وسجله لكل راوتر، على الجهاز بس.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMonitorSettings, saveMonitorSettings } from './monitor';

export interface HealLog { at: number; text: string; ok?: boolean }

export interface HealerState {
  on: boolean;
  /** كم فحص متتالي المشكلة موجودة */
  bad?: number;
  /** وش المشكلة الحالية (عشان نعرف لو تغيّرت) */
  issue?: 'noservice' | 'poor' | 'nr' | null;
  /** آخر درجة علاج جرّبناها لهالمشكلة (١ = تصحية، ٢ = إعادة اتصال، ٣ = رجوع للتلقائي، ٤ = إعادة تشغيل) */
  step?: number;
  lastActionAt?: number;
  /** حدود يومية */
  day?: string;
  actionsToday?: number;
  lastRebootAt?: number;
  /** آخر مرة شفنا 5G — عشان نعرف إنه «طاح» مو إن المنطقة ما فيها 5G */
  nrSeenAt?: number;
  log?: HealLog[];
}

const KEY = (id: string) => `bandly.healer.${id}`;

export async function getHealer(routerId: string): Promise<HealerState> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    if (raw) return { on: false, ...JSON.parse(raw) };
  } catch {}
  return { on: false };
}

export async function saveHealer(routerId: string, h: HealerState): Promise<void> {
  try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify({ ...h, log: (h.log ?? []).slice(-30) })); } catch {}
}

export function addLog(h: HealerState, text: string, ok?: boolean): HealerState {
  return { ...h, log: [...(h.log ?? []), { at: Date.now(), text, ok }].slice(-30) };
}

/**
 * تشغيل/إيقاف الحارس لراوتر. التشغيل يشغّل المراقبة بالخلفية لو كانت طافية (الحارس يشتغل معها).
 * start: دالة تسجيل المهمة الخلفية (نمررها من الشاشة عشان ما نستورد TaskManager هنا).
 */
export async function setHealerOn(routerId: string, on: boolean, start?: (intervalMin: number) => Promise<void>): Promise<void> {
  const h = await getHealer(routerId);
  await saveHealer(routerId, addLog({ ...h, on, bad: 0, step: 0, issue: null }, on ? 'شغّلت الحارس' : 'وقّفت الحارس'));
  if (on) {
    const m = await getMonitorSettings();
    if (!m.enabled) await saveMonitorSettings({ ...m, enabled: true });
    try { await start?.(m.intervalMin || 15); } catch {}
  }
}
