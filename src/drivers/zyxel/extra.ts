/**
 * زيكسل — دوال صافية لميزات الصفحة (ملفات FULL لـ NR5103E و FWA505، ٣١ أكتوبر). عليها اختبارات.
 * كل الأسماء والقيم منقولة من app.js في صفحة الراوتر.
 */
import type { SmsMessage, ConnectedDevice } from '../types';

/** الصفحة تفك رموز HTML في ردود GET (&amp; &lt; &gt; &quot; &#39;) — نفس الشي هنا */
export function unesc<T>(x: T): T {
  if (typeof x === 'string') return x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") as any;
  if (Array.isArray(x)) return x.map(unesc) as any;
  if (x && typeof x === 'object') { const o: any = {}; for (const [k, v] of Object.entries(x)) o[k] = unesc(v); return o; }
  return x;
}

// ═══ الواي فاي (oid=wlan) — Object[0]=SSID 1 (2.4 الأساسية) · [1]=2 · [4]=5 (5G الأساسية) · [5]=6 ═══
/** submit في صفحة «Wifisetting»: SecurityMode ← securityLevel/wpaMode/encryp */
export function zxSec(mode: string): { securityLevel: string; wpaMode?: string; encryp?: string } {
  switch (mode) {
    case 'WPA2-Personal': return { securityLevel: 'MoreSecure', wpaMode: 'wpa2psk', encryp: 'aes' };
    case 'WPA-WPA2-Personal': return { securityLevel: 'MoreSecure', wpaMode: 'wpawpa2psk', encryp: 'tkipaes' };
    case 'WPA3-Personal': return { securityLevel: 'MoreSecure', wpaMode: 'wpa3psk', encryp: 'aes' };
    case 'WPA2-WPA3-Personal': return { securityLevel: 'MoreSecure', wpaMode: 'wpa2wpa3psk', encryp: 'aes' };
    default: return { securityLevel: 'NoSecurity' };
  }
}
export const zxSecured = (o: any) => zxSec(String(o?.SecurityMode ?? '')).securityLevel !== 'NoSecurity';

function entry(o: any, index: number, oneSsid: boolean, name?: string, pass?: string) {
  const sec = zxSec(String(o.SecurityMode ?? ''));
  const e: Record<string, unknown> = {
    Index: index, wlEnable: !!o.wlEnable, oneSsidEnable: oneSsid, SSID: name ?? String(o.SSID ?? ''), wlHide: o.wlHide,
    securityLevel: sec.securityLevel, wpaMode: sec.wpaMode, encryp: sec.encryp,
    AutoGenPSK: pass ? false : !!o.AutoGenPSK, psk_value: pass ?? String(o.PskDisplay ?? ''), RekeyingInterval: o.RekeyingInterval,
  };
  return e;
}

/** نفس مصفوفة PUT اللي تبنيها الصفحة (مع/بدون 5G، شبكة وحدة للنطاقين أو لا) */
export function zxWlanPayload(list: any[], support5G: boolean, names: { index: string; name: string }[], password?: string): unknown {
  const w2 = list[0], g2 = list[1] ?? {}, w5 = list[4], g5 = list[5] ?? {};
  const nm = (i: string) => names.find(n => n.index === i)?.name;
  if (!w2) throw new Error('wlan: رد غير متوقع');
  if (!support5G || !w5) {
    const { oneSsidEnable: _x, ...one } = entry(w2, 1, false, nm('1'), password);
    return one;
  }
  const oneSsid = !!w2.oneSsidEnable;
  if (oneSsid) return [entry(w2, 1, true, nm('1'), password), { Index: 5, wlEnable: !!w5.wlEnable, oneSsidEnable: true }];
  return [
    entry(w2, 1, false, nm('1'), password), { Index: 2, SSID: String(g2.SSID ?? '') },
    entry(w5, 5, false, nm('5'), password), { Index: 6, SSID: String(g5.SSID ?? '') },
  ];
}

// ═══ الرسائل (oid=cellwan_sms) ═══
// جدول GSM 03.38 الأساسي + الإضافي (gsmDefaultCharacter / gsmExtensionCharacter في الصفحة)
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT: Record<number, string> = { 10: '\f', 20: '^', 40: '{', 41: '}', 47: '\\', 60: '[', 61: '~', 62: ']', 64: '|', 101: '€' };
/** contentGsmDecoder: بايتات hex كل وحدة رقم في جدول GSM، و 27 (ESC) = الحرف الجاي من الجدول الإضافي */
export function gsmHexDecode(hex: string): string {
  const b = (hex.match(/[0-9a-f]{2}/gi) ?? []).map(h => parseInt(h, 16));
  let out = '';
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 27 && i + 1 < b.length) { out += GSM_EXT[b[++i]] ?? ''; continue; }
    out += GSM[b[i]] ?? '';
  }
  return out;
}
/** smsContentConverter: 0 = GSM (hex لو supportSmsCmd) · 1 = نص · 2 = UCS2 hex */
export function zxSmsText(cs: number, content: string, smsCmd: boolean): string {
  if (cs === 2) return content.replace(/([0-9A-F]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (cs === 0 && smsCmd) return gsmHexDecode(content);
  return content;
}
/** "26/10/31,12:05:44+12" ← "2026-10-31 12:05:44" */
export function zxSmsDate(ts: string): string {
  const m = String(ts ?? '').match(/^(\d{2})\/(\d{2})\/(\d{2}),(\d{2}:\d{2}:\d{2})/);
  return m ? `20${m[1]}-${m[2]}-${m[3]} ${m[4]}` : String(ts ?? '');
}
export function zxSmsList(o: any, box: 'inbox' | 'sent', smsCmd: boolean): SmsMessage[] {
  const all: any[] = Array.isArray(o?.SMS_Inbox) ? o.SMS_Inbox : [];
  return all
    .filter(m => (box === 'sent' ? Number(m.State) === 2 : Number(m.State) !== 2))
    .map(m => ({
      index: String(m.ObjIndex),
      phone: (Number(m.FromType) & 80) === 80 ? gsmHexDecode(String(m.From ?? '')) : String(m.From ?? ''),
      content: zxSmsText(Number(m.CharacterSet), String(m.Content ?? ''), smsCmd),
      date: zxSmsDate(m.TimeStamp),
      unread: Number(m.State) === 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
/**
 * جسم POST للإرسال (cellWanSmsOutbox): ASCII ← IRA (hex بخانتين) · غيره (عربي) ← UCS2 (hex بأربع)
 * رسالة وحدة بس: 160 حرف IRA / 70 UCS2 — الأطول يحتاج تقسيم بترويسة UDH (الصفحة تسويه) وما بنيناه.
 */
export function zxSmsBody(to: string, text: string, smsCmd: boolean): Record<string, unknown> | null {
  const ascii = /^[\x00-\x7f]*$/.test(text);
  if (text.length > (ascii ? 160 : 70)) return null;
  const hex = ascii
    ? text.replace(/./gs, c => ('00' + c.charCodeAt(0).toString(16)).slice(-2))
    : text.replace(/./gs, c => ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
  const b: Record<string, unknown> = {
    SMS_Format: 0, SMS_CharacterSet: ascii ? 'IRA' : 'UCS2', SMS_To: to.replace(/\D/g, ''),
    SMS_ContentLength: text.length, SMS_TimeStamp: '', SMS_Content: hex,
  };
  if (smsCmd) { b.SMS_Content_divLen = [text.length]; b.SMS_Content_divData = [hex]; }
  return b;
}

// ═══ حظر الأجهزة (oid=macfilter) — MAC: {Filter_Enable, Restrict} · whitelist: [{List_Enable, HostName, MACAddress}] ═══
// Restrict = true ← القائمة محظورة · false ← القائمة بس المسموحة (الصفحة تشترط عنصر مفعّل فيها)
export function zxBlocked(o: any): ConnectedDevice[] {
  const on = !!o?.MAC?.Filter_Enable && !!o?.MAC?.Restrict;
  if (!on) return [];
  const l: any[] = Array.isArray(o?.whitelist) ? o.whitelist : [];
  return l.filter(x => x.List_Enable && x.MACAddress).map(x => ({ mac: String(x.MACAddress).toUpperCase(), name: x.HostName && x.HostName !== 'unknown' ? String(x.HostName) : undefined, blocked: true }));
}
/** PUT للحظر/الفك — نفس صيغة applyHandler: أول عنصر الإعداد العام، بعده ADD / EDIT / DELE بالـ Index (يبدأ من 1) */
export function zxBlockPayload(o: any, mac: string, block: boolean, name?: string): unknown[] | null {
  const l: any[] = Array.isArray(o?.whitelist) ? o.whitelist : [];
  const m = mac.toUpperCase();
  const i = l.findIndex(x => String(x.MACAddress ?? '').toUpperCase() === m);
  const head = { Filter_Enable: block ? true : !!o?.MAC?.Filter_Enable, Restrict: block ? true : !!o?.MAC?.Restrict };
  if (block) {
    if (i >= 0 && l[i].List_Enable && o?.MAC?.Filter_Enable && o?.MAC?.Restrict) return null;
    if (i >= 0) return [head, { Action: 'EDIT', Index: i + 1, HostName: l[i].HostName || 'unknown', MACAddress: m, List_Enable: true }];
    return [head, { Action: 'ADD', Index: 0, List_Enable: true, HostName: (name || 'unknown').slice(0, 31), MACAddress: m }];
  }
  if (i < 0) return null;
  return [head, { Action: 'DELE', Index: i + 1 }];
}

// ═══ البوصلة (oid=azimuth — FWA505 الخارجي) ═══
export interface ZxAzimuth { deg: number; accuracy: number; compensated?: number; lockDeg?: number }
export function zxAzimuth(o: any): ZxAzimuth | null {
  if (!o || o.AzimuthStatus !== 'RetrieveDate') return null;
  const m = Array.isArray(o.mag) ? o.mag[0] : null;
  const deg = Number(m?.angle);
  if (!m || !Number.isFinite(deg)) return null;
  const r: ZxAzimuth = { deg, accuracy: Number(m.accuracy) || 0 };
  if (String(m.compStatus) === '1' && Number.isFinite(Number(m.AngleAfterCompensation))) r.compensated = Number(m.AngleAfterCompensation);
  if (String(m.lockStatus) !== '0' && Number.isFinite(Number(m.lockAngle))) r.lockDeg = Number(m.lockAngle);
  return r;
}

// ═══ قناة الواي فاي (صفحة Wireless › General: doWifiApply) ═══
// الصفحة ترسل كل إعدادات الشبكة مع القناة — نبنيها من نفس الكائن بالضبط مثل ما تحسبها الصفحة وقت التحميل
// (updateWifiRadio / sidebandOptionUpdate / updateWifiSec / changeEncryptionMode) ونغيّر القناة بس.
export type ZxWifiVariant = 'nr5103e' | 'fwa505';
type Flags = { ShowAllWiFiChannel?: boolean; hideWlanChannel1213?: boolean; SupportWPAMixMode?: boolean };
const isWpa = (m: string) => m.slice(0, 3) === 'WPA';

/** العرض كما تعرضه الصفحة: '80' · '40' · '0' (20/40 على 2.4 مع OBSS) · '20' */
export function zxBw(o: any, band: '2.4' | '5'): string {
  const b = String(o?.bandwidth ?? '');
  if (b === '80MHz') return '80';
  if (b === '40MHz') return o?.X_ZYXEL_OBSS_coex && band === '2.4' ? '0' : '40';
  return '20';
}
function sideband(o: any, band: '2.4' | '5'): string {
  let bw = zxBw(o, band);
  if (bw === '0' && band === '2.4') bw = '40';
  return bw === '40' ? (Number(o?.extcha) === 2 ? '2' : '1') : '0';
}
/** قائمة القنوات المسموحة حسب العرض والجانب (channelListUpdate) */
export function zxChannels(o: any, band: '2.4' | '5', f: Flags = {}): string[] {
  let bw = zxBw(o, band);
  if (bw === '0' && band === '2.4') bw = '40';
  const sb = sideband(o, band);
  let a = '';
  if (bw === '80') a = String(o?.X_ZYXEL_AC80_Channels ?? '');
  else if (bw === '40') a = f.ShowAllWiFiChannel ? String(o?.PossibleChannels ?? '') : sb === '1' ? String(o?.X_ZYXEL_LowerChannels ?? '') : (f.hideWlanChannel1213 ? '5,6,7,8,9,10,11' : String(o?.X_ZYXEL_UpperChannels ?? ''));
  else a = f.hideWlanChannel1213 ? '1,2,3,4,5,6,7,8,9,10,11' : String(o?.PossibleChannels ?? '');
  return a.split(',').map(x => x.trim()).filter(Boolean).sort((x, y) => Number(x) - Number(y));
}
export function zxChannelPayload(list: any[], band: '2.4' | '5', channel: string, variant: ZxWifiVariant, f: Flags = {}): unknown {
  const o = band === '2.4' ? list[0] : list[4];
  if (!o) throw new Error('wlan: رد غير متوقع');
  const mode = String(o.SecurityMode ?? '');
  const range = isWpa(mode) ? 2 : mode.slice(0, 3) === 'WEP' ? 1 : 0;
  const wpaMode = mode === 'WPA-WPA2-Personal' ? 'wpawpa2psk' : mode === 'WPA2-Enterprise' ? 'wpa2' : mode === 'WPA3-Personal' ? 'wpa3psk' : mode === 'WPA2-WPA3-Personal' ? 'wpa2wpa3psk' : 'wpa2psk';
  let encryp = o.encryp;
  if (['WPA2-Enterprise', 'WPA2-Personal', 'WPA3-Personal', 'WPA2-WPA3-Personal'].includes(mode)) encryp = 'aes';
  else if (f.SupportWPAMixMode && mode === 'WPA-WPA2-Personal') encryp = 'tkipaes';
  const ch = Number(channel) || 0;
  let sb = sideband(o, band);
  // checkSidebandSupport: مع ShowAllWiFiChannel الجانب يتبع القناة المختارة
  let bwEff = zxBw(o, band); if (bwEff === '0' && band === '2.4') bwEff = '40';
  if (f.ShowAllWiFiChannel && bwEff === '40' && ch) {
    const lo = String(o.X_ZYXEL_LowerChannels ?? '').split(','), up = String(o.X_ZYXEL_UpperChannels ?? '').split(',');
    if (!lo.includes(String(ch))) sb = '2';
    if (!up.includes(String(ch))) sb = '1';
  }
  const t: Record<string, unknown> = {
    oneSsidEnable: o.oneSsidEnable, Index: band === '2.4' ? 1 : 5, wlEnable: o.wlEnable, X_ZYXEL_Multicast_Fwd: o.X_ZYXEL_Multicast_Fwd,
    SSID: o.SSID, upRate: Number(o.upRate) === 0 ? '' : o.upRate, downRate: Number(o.downRate) === 0 ? '' : o.downRate,
    MaxAssociatedDevices: o.MaxAssociatedDevices, wlHide: o.wlHide, secMode: range === 0 ? 43 : range === 1 ? 149 : 255, wpaMode,
    AutoGenPSK: o.AutoGenPSK, psk_value: o.AutoGenPSK ? o.AutoGenPSKValue : o.PskDisplay, encryp, RekeyingInterval: o.RekeyingInterval,
    X_ZYXEL_Preauth: o.X_ZYXEL_Preauth, X_ZYXEL_ReauthInterval: o.X_ZYXEL_ReauthInterval,
    RadiusServerIPAddr: o.RadiusServerIPAddr, RadiusServerPort: o.RadiusServerPort, RadiusSecret: o.RadiusSecret,
    div_wifiAdvance: true, channel: ch, bandwidth: zxBw(o, band), extcha: sb, subnetObjAction: '', div_wifiSubnet: false,
  };
  const one = o.oneSsidEnable;
  const s5 = { Index: 5, SSID: list[4]?.SSID ?? '', oneSsidEnable: one };
  if (variant === 'nr5103e') return t.Index === 1 ? [t, s5] : t;
  // FWA505: الصفحة تضيف شبكات الضيوف (2 و 6) بأسمائها مع كل حفظ
  const g2 = { Index: 2, SSID: list[1]?.SSID ?? '', oneSsidEnable: one }, g6 = { Index: 6, SSID: list[5]?.SSID ?? '', oneSsidEnable: one };
  return t.Index === 1 ? [t, s5, g2, g6] : [t, g2, g6];
}
