/**
 * Asiatelco «/schd/» — سلام HomeFi Max الخارجي (JW515، 192.168.100.1). منطق صافي بدون شبكة عشان ينختبر.
 * من ملفات «مو مدعوم؟» لعضو (٢٠ نوفمبر ٢٠٢٦، جدة): index.html + /schd/html/login-admin.html + script.js.
 */
import type { Signal } from '../types';

/** «/» يحوّل لـ /schd/html/login-admin.html بعد ما يسأل /rest/1.0/WebHeader/ */
export function isSchdPage(html: string): boolean {
  return /\/rest\/1\.0\/WebHeader/i.test(html) && /\/schd\/html\//i.test(html);
}

/** رد /rest/1.0/WebHeader/ — فيه Login + SignalLevel (نتعرّف بيه لو «/» تغيّرت) */
export function isWebHeader(j: any): boolean {
  return !!j && typeof j === 'object' && 'Login' in j && ('SignalLevel' in j || 'UsimStatus' in j || 'RSRP' in j);
}

/** صفحة الدخول: SHA1(الكلمة + SecureToken) بحروف hex صغيرة (sha.min.js حق Chris Veness) */
export function schdLoginBody(user: string, shaPassword: string): string {
  return JSON.stringify({ Action: 'Invoke', Username: user, Password: shaPassword });
}

/** «UnKnown» / "" / null ← undefined · الرقم صفر مع «idle» = ما فيه قراءة */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s || /unknown|n\/a|^-+$/i.test(s)) return undefined;
  const n = Number(s.replace(/\s*(dbm|db)\s*$/i, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function str(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return !s || /^unknown$/i.test(s) || s === 'N/A' ? undefined : s;
}

/** التقنية بلغة التطبيق: «5G» / «4G» — من Technology (LTE · LTE+ · 5G · NR…) */
export function techOf(h: any): '5G' | '4G' | undefined {
  const t = String(h?.Technology ?? h?.NetworkType ?? '').toUpperCase();
  if (/5G|NR/.test(t)) return '5G';
  if (/LTE|4G/.test(t)) return '4G';
  return undefined;
}

/**
 * الإشارة من WebHeader: رقم واحد لكل قيمة (RSRP/RSRQ/SINR/RSSI) بدون ما يقول هي 4G ولا 5G.
 * • الصفحة نفسها ما تعرض الأرقام إذا كلها صفر (RSSI و RSRP = 0) — نفس القاعدة: صفر = ما فيه قراءة.
 * • قراءة وحدة ← بطاقة وحدة (أول تجربة ٢١ نوفمبر: كنا نعبّي 4G و5G بنفس الأرقام فطلعت بطاقتين متطابقة).
 *   تنحط في الخانات الأساسية (كل الشاشات تقراها)، و Technology «5G» ← nrActiveFromStatus بس.
 * • SINR = 0 بالضبط مع RSRP قوي = الراوتر ما يعبّيه (أول تجربة: RSRP -61 و SINR 0 ← «اتصالك ضعيف» غلط) — نخليه فاضي.
 */
export function signalFrom(h: any): Signal {
  const rsrp = num(h?.RSRP), rssi = num(h?.RSSI);
  const empty = (rsrp === undefined || rsrp === 0) && (rssi === undefined || rssi === 0);
  const tech = techOf(h);
  const s: Signal = { network: tech };
  if (tech === '5G') s.nrActiveFromStatus = true;
  if (empty) return s;
  const rsrq = num(h?.RSRQ), sinr = num(h?.SINR);
  if (rsrp !== undefined && rsrp !== 0) s.rsrp = rsrp;
  if (rsrq !== undefined && rsrq !== 0) s.rsrq = rsrq;
  if (sinr !== undefined && !(sinr === 0 && rsrp !== undefined && rsrp > -100)) s.sinr = sinr;
  if (rssi !== undefined && rssi !== 0) s.rssi = rssi;
  return s;
}

/** متصل؟ — ConnectStatus «CONNECTED» (الصفحة تقارن بالحروف الكبيرة) */
export function connectedOf(h: any): boolean | undefined {
  const c = String(h?.ConnectStatus ?? '').toUpperCase();
  if (!c) return undefined;
  return c === 'CONNECTED';
}
