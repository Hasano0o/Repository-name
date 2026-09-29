import AsyncStorage from '@react-native-async-storage/async-storage';

/* ═══ الوضع الذكي — إعدادات لكل راوتر ═══ */

export type NightlyMode = 'off' | 'smart' | 'daily';

export interface AutoSettings {
  /** تبديل الملف حسب فترة اليوم */
  smart: { enabled: boolean; map: Record<string, string | null> };
  /** الصيانة الليلية */
  nightly: NightlyMode;
}

export interface NightlyReport {
  at: number;
  beforePing?: number;
  afterPing?: number;
  reason: string;
  notified?: boolean;
}

export interface AutoState {
  lastPeriod?: string;
  lastProfileId?: string | null;
  lastSwitchAt?: number;
  nightlyDay?: string;
  pending?: { at: number; beforePing?: number; reason: string };
  report?: NightlyReport;
}

const SKEY = (id: string) => `bandly.auto.settings.${id}`;
const TKEY = (id: string) => `bandly.auto.state.${id}`;

export const DEFAULT_AUTO: AutoSettings = { smart: { enabled: false, map: {} }, nightly: 'off' };

export async function getAuto(routerId: string): Promise<AutoSettings> {
  try {
    const raw = await AsyncStorage.getItem(SKEY(routerId));
    if (!raw) return { ...DEFAULT_AUTO, smart: { ...DEFAULT_AUTO.smart, map: {} } };
    const p = JSON.parse(raw);
    return {
      smart: { enabled: !!p?.smart?.enabled, map: p?.smart?.map ?? {} },
      nightly: p?.nightly === 'smart' || p?.nightly === 'daily' ? p.nightly : 'off',
    };
  } catch {
    return { ...DEFAULT_AUTO, smart: { enabled: false, map: {} } };
  }
}

export async function saveAuto(routerId: string, s: AutoSettings): Promise<void> {
  try { await AsyncStorage.setItem(SKEY(routerId), JSON.stringify(s)); } catch {}
}

export async function getAutoState(routerId: string): Promise<AutoState> {
  try {
    const raw = await AsyncStorage.getItem(TKEY(routerId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveAutoState(routerId: string, s: AutoState): Promise<void> {
  try { await AsyncStorage.setItem(TKEY(routerId), JSON.stringify(s)); } catch {}
}

/** أي شي مفعّل يحتاج المراقبة بالخلفية */
export const autoActive = (s: AutoSettings) => s.nightly !== 'off' || (s.smart.enabled && Object.values(s.smart.map).some(Boolean));
