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
import { diag, diagDump } from './diag';

const SENT_KEY = 'bandly.errSent';

/** أخطاء عادية ما تحتاج تنبيه (المستخدم ألغى، النت طافي عنده، …) */
const IGNORE = /(إلغاء|ألغي|cancel|Network request failed|انتهت المهلة|aborted|AbortError|مو متصل|ما قدرنا نوصل للراوتر من جوالك)/i;

const QUEUE_KEY = 'bandly.errQueue';
const DIAG_PENDING = 'bandly.diagPending';
const DIAG_SENT = 'bandly.diagSent';

/** نص التشخيص كامل مع معلومات الجهاز والنسخة */
export function diagText(title: string, router?: { driverName?: string } | null): string {
  return diagDump([
    `Bandly — ${title}`,
    `الوقت: ${new Date().toISOString()}`,
    `الجهاز: ${Platform.OS} · ${phoneModel()}`,
    `النسخة: ${verText()}`,
    `الراوتر: ${router?.driverName ?? '—'}`,
  ].join('\n'));
}

/** مع الأخطاء: نرسل سجل التشخيص للمطوّر تلقائي — مرة باليوم لكل ميزة */
async function sendDiagAuto(feature: string, msg: string, router?: { driverName?: string } | null) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const base = feature.split(':')[0];
    let sent: Record<string, string> = {};
    try { sent = JSON.parse((await AsyncStorage.getItem(DIAG_SENT)) || '{}'); } catch {}
    if (sent[base] === day) return;
    sent[base] = day;
    await AsyncStorage.setItem(DIAG_SENT, JSON.stringify(sent));
    // ننتظر شوي عشان يدخل في السجل اللي صار بعد الخطأ (الإرجاع مثلاً)
    await new Promise(r => setTimeout(r, 4000));
    const text = diagText(`${feature}: ${msg}`, router);
    if (!(await sendSupportReport(base, text, router))) {
      await AsyncStorage.setItem(DIAG_PENDING, JSON.stringify({ feature: base, text, router: router?.driverName ?? '' }));
    }
  } catch {}
}

async function post(body: object): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/app/error`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * التقارير اللي ما وصلت (غالباً لأن النت نفسه طاح بسبب المشكلة) — نحفظها ونرسلها
 * أول ما يرجع النت. بدونها ما يوصلنا أهم خطأ: اللي قطع النت عن العميل.
 */
let flushing = false;
export async function flushErrors() {
  if (flushing) return;
  flushing = true;
  try {
    let q: any[] = [];
    try { q = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]'); } catch {}
    // سجل تشخيص ما وصل (النت كان طايح)
    try {
      const pend = await AsyncStorage.getItem(DIAG_PENDING);
      if (pend) {
        const d = JSON.parse(pend);
        if (await sendSupportReport(d.feature, d.text, { driverName: d.router })) await AsyncStorage.removeItem(DIAG_PENDING);
      }
    } catch {}
    if (!q.length) return;
    const left: any[] = [];
    for (const it of q) if (!(await post(it))) left.push(it);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(left.slice(-20)));
  } catch {} finally {
    flushing = false;
  }
}

export async function reportError(feature: string, err: unknown, router?: { driverName?: string } | null, model?: string) {
  try {
    const msg = String((err as any)?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!msg || IGNORE.test(msg)) return;
    const day = new Date().toISOString().slice(0, 10);
    // المفتاح = الرسالة كاملة (فيها تسلسل الأكواد) — عشان تقرير جديد بتفاصيل مختلفة ما ينحجب
    const key = `${feature}|${msg}`;
    let sent: Record<string, string> = {};
    try { sent = JSON.parse((await AsyncStorage.getItem(SENT_KEY)) || '{}'); } catch {}
    if (sent[key] === day) return;
    sent = Object.fromEntries(Object.entries(sent).filter(([, d]) => d === day));
    sent[key] = day;
    AsyncStorage.setItem(SENT_KEY, JSON.stringify(sent)).catch(() => {});
    const body = {
      feature, msg, router: router?.driverName ?? '', model: model ?? phoneModel(),
      os: Platform.OS, ver: verText(), at: new Date().toISOString(),
    };
    diag(`[error] ${feature}: ${msg.slice(0, 120)}`);
    sendDiagAuto(feature, msg, router);
    if (await post(body)) { flushErrors(); return; }
    let q: any[] = [];
    try { q = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]'); } catch {}
    q.push(body);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20)));
    // نعيد المحاولة كل دقيقة لين يرجع النت (لمدة ١٠ دقايق)
    let n = 0;
    const iv = setInterval(() => { if (++n > 10) clearInterval(iv); flushErrors(); }, 60_000);
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
