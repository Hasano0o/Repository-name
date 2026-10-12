/**
 * تقرير أخطاء تلقائي: لما ميزة تفشل عند مستخدم، يوصل للمالك في البوت سطر فيه
 * الميزة + نوع الراوتر + نص الخطأ. بدون اسم ولا رقم ولا آي بي ولا كلمات سر.
 * نفس الخطأ من نفس الجهاز ينرسل مرة باليوم بس.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { LIVE_BASE } from './live';

const SENT_KEY = 'bandly.errSent';

/** أخطاء عادية ما تحتاج تنبيه (المستخدم ألغى، النت طافي عنده، …) */
const IGNORE = /(إلغاء|ألغي|cancel|Network request failed|انتهت المهلة|aborted|AbortError|مو متصل|ما قدرنا نوصل للراوتر من جوالك)/i;

export async function reportError(feature: string, err: unknown, router?: { driverName?: string } | null, model?: string) {
  try {
    const msg = String((err as any)?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!msg || IGNORE.test(msg)) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `${feature}|${msg.slice(0, 60)}`;
    let sent: Record<string, string> = {};
    try { sent = JSON.parse((await AsyncStorage.getItem(SENT_KEY)) || '{}'); } catch {}
    if (sent[key] === day) return;
    sent = Object.fromEntries(Object.entries(sent).filter(([, d]) => d === day));
    sent[key] = day;
    AsyncStorage.setItem(SENT_KEY, JSON.stringify(sent)).catch(() => {});
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    await fetch(`${LIVE_BASE}/live-api/app/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        feature, msg, router: router?.driverName ?? '', model: model ?? phoneModel(),
        os: Platform.OS, ver: verText(),
      }),
    }).catch(() => {});
    clearTimeout(t);
  } catch {}
}

/** موديل الجوال (بدون أي معرّف شخصي) — يساعدنا نفرّق بين العملاء */
function phoneModel(): string {
  try {
    const pc: any = (Platform as any).constants ?? {};
    return Platform.OS === 'ios' ? 'iPhone' : `${pc.Brand ?? pc.Manufacturer ?? ''} ${pc.Model ?? ''}`.trim();
  } catch { return ''; }
}

/** النسخة + تاريخ التحديث (عشان نعرف هل العميل على آخر تحديث) */
function verText(): string {
  const v = Constants.expoConfig?.version ?? '';
  try {
    const u = Updates.isEmbeddedLaunch ? 'apk' : (Updates.createdAt?.toISOString().slice(5, 16).replace('T', ' ') ?? '');
    return u ? `${v} · ${u}` : v;
  } catch { return v; }
}

export const DEV_TELEGRAM = 'https://t.me/hasa_n20';

/** «أرسل التفاصيل للدعم»: التقرير يوصل للمطوّر في البوت كملف — بدون مشاركة يدوية */
export async function sendSupportReport(feature: string, text: string, router?: { driverName?: string } | null): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/app/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ feature, text, router: router?.driverName ?? '', os: Platform.OS, ver: Constants.expoConfig?.version ?? '' }),
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
