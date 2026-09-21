import AsyncStorage from '@react-native-async-storage/async-storage';
import { Level } from '../utils/signal';

export interface MonitorAlerts {
  signalDrop: boolean;    // الإشارة ضعفت
  signalRecover: boolean; // الإشارة تحسّنت
  nr5g: boolean;          // رجعت 5G
  disconnect: boolean;    // انقطع الاتصال
  dataPlan: boolean;      // استهلاك الباقة
}

export interface MonitorSettings {
  enabled: boolean;
  intervalMin: number;
  alerts: MonitorAlerts;
}

const KEY = 'monitor:settings:v1';
const STATE_KEY = 'monitor:state:v1';

export const DEFAULT_ALERTS: MonitorAlerts = {
  signalDrop: true,
  signalRecover: true,
  nr5g: true,
  disconnect: true,
  dataPlan: true,
};

export const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: false,
  intervalMin: 15,
  alerts: { ...DEFAULT_ALERTS },
};

export async function getMonitorSettings(): Promise<MonitorSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...p,
      alerts: { ...DEFAULT_ALERTS, ...(p.alerts ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveMonitorSettings(s: MonitorSettings): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/** آخر حالة معروفة لكل راوتر — عشان نكتشف التغيّر ونرسل تنبيه مرة وحدة */
export interface RouterMonState {
  level?: Level;
  hadNr?: boolean;
  online?: boolean;
  usageBucket?: number; // أعلى عتبة استهلاك تم التنبيه عنها (0/70/90/100)
  at?: number;
}
type StateMap = Record<string, RouterMonState>;

export async function loadMonStates(): Promise<StateMap> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as StateMap) : {};
  } catch {
    return {};
  }
}

export async function saveMonStates(m: StateMap): Promise<void> {
  try { await AsyncStorage.setItem(STATE_KEY, JSON.stringify(m)); } catch {}
}
