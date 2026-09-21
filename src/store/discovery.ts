// ذاكرة استكشاف: تحفظ بصمة كل راوتر اكتُشف (أسماء فقط — لا قيم حساسة).
// تُستشار قبل أي فحص عميق مرة ثانية، فلا نكرر الحصاد كل مرة.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hostOnly } from '../utils/host';

export type ApiStyle =
  | 'zte-goform'
  | 'huawei-hilink'
  | 'luci'
  | 'ubus'
  | 'rest'
  | 'webfig'
  | 'unknown';

export interface DiscoveryEntry {
  /** العنوان المحلي فقط (بدون scheme/مسار) — المفتاح. */
  host: string;
  /** بصمة قصيرة مشتقة من المسارات والأوامر (أسماء فقط، لا قيم). */
  fingerprint: string;
  /** نمط الـ API المرجّح. */
  apiStyle: ApiStyle;
  /** معرّف استراتيجية الدخول الناجحة (من authStrategy). */
  loginStrategy?: string;
  /** أسماء حقول الإشارة المكتشفة (أسماء فقط). */
  signalFields: string[];
  /** أسماء أوامر goform/الأوامر المكتشفة (أسماء فقط). */
  commands: string[];
  /** آخر مرة شُوهد فيها. */
  lastSeen: number;
  /** عدد المرات التي نجح فيها الاتصال بهذا الراوتر. */
  successCount: number;
}

const KEY = 'discovery:v1';

/** يستخرج بصمة غير حساسة من أسماء المسارات والأوامر. */
export function fingerprintFrom(parts: {
  paths?: string[];
  commands?: string[];
  goforms?: string[];
}): string {
  const pool = [
    ...(parts.paths ?? []),
    ...(parts.commands ?? []),
    ...(parts.goforms ?? []),
  ]
    .filter(s => typeof s === 'string' && s.length > 0 && s.length <= 200)
    .sort()
    .slice(0, 120)
    .join('|');
  // بصمة بسيطة بدون اعتماد على crypto — كافية لتفريق الراوترات محلياً.
  let h = 5381;
  for (let i = 0; i < pool.length; i++) {
    h = ((h << 5) + h + pool.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function cleanHost(raw: string): string {
  return hostOnly(raw).toLowerCase();
}

async function readAll(): Promise<DiscoveryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is DiscoveryEntry =>
        !!x && typeof x === 'object' && typeof x.host === 'string',
    );
  } catch {
    return [];
  }
}

async function writeAll(list: DiscoveryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // لا شيء — نتجاهل فشل التخزين حتى لا نكسر التطبيق.
  }
}

/** يرجع كل السجلات المحفوظة. */
export async function listDiscoveries(): Promise<DiscoveryEntry[]> {
  return readAll();
}

/** يرجع سجل راوتر واحد، أو null. */
export async function getDiscovery(host: string): Promise<DiscoveryEntry | null> {
  const key = cleanHost(host);
  if (!key) return null;
  return (await readAll()).find(e => e.host === key) ?? null;
}

/** يحفظ/يحدّث سجل راوتر — دمج مع الموجود بدون فقدان بيانات. */
export async function saveDiscovery(
  partial: Partial<DiscoveryEntry> & { host: string },
): Promise<DiscoveryEntry> {
  const key = cleanHost(partial.host);
  const now = Date.now();
  const all = await readAll();
  const idx = all.findIndex(e => e.host === key);
  const prev: DiscoveryEntry = idx >= 0
    ? all[idx]
    : {
        host: key,
        fingerprint: '',
        apiStyle: 'unknown',
        signalFields: [],
        commands: [],
        lastSeen: now,
        successCount: 0,
      };
  const merged: DiscoveryEntry = {
    host: key,
    fingerprint: partial.fingerprint ?? prev.fingerprint,
    apiStyle: partial.apiStyle ?? prev.apiStyle,
    loginStrategy: partial.loginStrategy ?? prev.loginStrategy,
    signalFields: partial.signalFields ?? prev.signalFields,
    commands: partial.commands ?? prev.commands,
    lastSeen: partial.lastSeen ?? now,
    successCount:
      partial.successCount !== undefined
        ? partial.successCount
        : prev.successCount,
  };
  if (idx >= 0) all[idx] = merged;
  else all.push(merged);
  await writeAll(all);
  return merged;
}

/** يسجّل نجاح اتصال — يزيد العدّاد ويحدّث lastSeen. */
export async function markSuccess(
  host: string,
  patch: Partial<DiscoveryEntry> = {},
): Promise<DiscoveryEntry> {
  const existing = await getDiscovery(host);
  const prevCount = existing?.successCount ?? 0;
  return saveDiscovery({
    host,
    ...patch,
    lastSeen: Date.now(),
    successCount: prevCount + 1,
  });
}

/** يحذف سجل راوتر واحد. */
export async function deleteDiscovery(host: string): Promise<void> {
  const key = cleanHost(host);
  const all = await readAll();
  await writeAll(all.filter(e => e.host !== key));
}

/** يمسح كل السجلات. */
export async function clearDiscoveries(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

/** يخمّن نمط الـ API من أسماء المسارات/الأوامر — أسماء فقط، لا قيم. */
export function guessApiStyle(parts: {
  paths?: string[];
  commands?: string[];
  goforms?: string[];
}): ApiStyle {
  const hay = [
    ...(parts.paths ?? []),
    ...(parts.commands ?? []),
    ...(parts.goforms ?? []),
  ].join('|').toLowerCase();
  if (!hay) return 'unknown';
  if (/goform|goformid|isTest=false/i.test(hay)) return 'zte-goform';
  if (/\/api\/webserver\/|\/api\/device\/|\/api\/monitoring\/|hilink/i.test(hay)) return 'huawei-hilink';
  if (/ubus|jsonrpc/i.test(hay)) return 'ubus';
  if (/\/cgi-bin\/luci/i.test(hay)) return 'luci';
  if (/\/rest\//i.test(hay)) return 'rest';
  if (/webfig/i.test(hay)) return 'webfig';
  return 'unknown';
}
