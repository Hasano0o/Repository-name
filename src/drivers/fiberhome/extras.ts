/**
 * مركز التحكم في FiberHome 5G CPE — منطق صافي بدون شبكة (عليه اختبارات).
 * كل اسم وقيمة هنا من صفحات الراوتر الحقيقية (تقرير ٢٦ أكتوبر، LG6121D على STC):
 *   natSet.js      Firewall.NATType            1 = مقيّد (symmetry) · 2 = مفتوح (cone)
 *   upnpSet.js     DeviceInfo.UPNP_Enable      + جدول UPNPRULE (بعد كتابة UPNP_Request = "Request")
 *   dmzSet.js      Firewall.DMZEnable / DMZIP
 *   led.js         DeviceInfo.LedSwitch        1 = الأنوار شغّالة (set_single_by_xmlnode) — يظهر لـ LG6121H/LG6121D بس
 *   reboot.js      TimedReboot.enable / repeatdays ("Monday,Tuesday,…") / time ("HH:MM")
 *   wifiBasic*.js  WLANConfiguration.<n>.     2.4 = 1..(MainSSIDIndex_58G-1) · 5 = MainSSIDIndex_58G وبعده
 *                  RadioEnabled يتغيّر بـ set_single_by_xmlnode على الشبكة الأساسية لكل نطاق
 *                  الصفحة تمنع إطفاء النطاق لو «دمج الشبكتين» (BandSteering) شغّال
 *                  LG6121D: 2.4 بس (صفحة 5G مخفية له)
 *   deviceInfo.js  get_cmd_result_web {key:"UPTIME"} ← ثواني · Temperature.Modem5GTemperature بالألف
 *   restore.js     do_cmd_web RECORD_MESSAGE_WEB ثم UBUS_RESTORE_MODE_2
 */
import { RouterExtras } from '../types';

/** خانات القراءة: المفتاح = اسم الخانة في الرد */
export const EX_FIELDS: Record<string, [string, string]> = {
  upnp: ['x_DeviceInfo_obj', 'x_UPNP_Enable'],
  dmzOn: ['x_Firewall_obj', 'x_Firewall_DMZEnable'],
  dmzIp: ['x_Firewall_obj', 'x_Firewall_DMZIP'],
  nat: ['x_Firewall_obj', 'x_Firewall_NATType'],
  led: ['x_DeviceInfo_obj', 'x_DeviceInfo_LedSwitch'],
  rbOn: ['x_TimedReboot_obj', 'x_TimedReboot_enable'],
  rbDays: ['x_TimedReboot_obj', 'x_TimedReboot_repeatdays'],
  rbTime: ['x_TimedReboot_obj', 'x_TimedReboot_time'],
  temp: ['x_Temperature_obj', 'x_Modem5GTemperature'],
  steer: ['x_wifi_WifiBandSteering_obj', 'x_BandSteering_Enable'],
};

export const EX_NEED = {
  nat: ['x_Firewall_obj', 'x_Firewall_NATType'],
  upnp: ['x_DeviceInfo_obj', 'x_UPNP_Enable'],
  upnpRules: ['x_DeviceInfo_obj', 'x_UPNP_Request', 'x_UPNPRULE_Obj', 'x_UPNPRULE_IPAddress', 'x_UPNPRULE_Protocol', 'x_UPNPRULE_ExternalPort', 'x_UPNPRULE_Description'],
  dmz: ['x_Firewall_obj', 'x_Firewall_DMZEnable', 'x_Firewall_DMZIP'],
  led: ['x_DeviceInfo_obj', 'x_DeviceInfo_LedSwitch'],
  reboot: ['x_TimedReboot_obj', 'x_TimedReboot_enable', 'x_TimedReboot_repeatdays', 'x_TimedReboot_time'],
  wifi: ['x_WLANConfiguration_obj', 'x_wifi_RadioEnabled', 'x_wifi_SSID', 'x_wifi_BeaconType', 'x_wifi_Enable'],
  wifiPass: ['x_wifi_PreSharedKey'],
};

export const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** صف من WLANConfiguration — بدون كلمة المرور (ما نطلبها أصلاً) */
export interface WlanRow { idx: string; radio: string; ssid: string; beacon: string; enable: string }

export function wlanRows(data: unknown): WlanRow[] {
  const arr: any[] = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data as any[] : [];
  return arr.map(e => ({
    idx: String(e?.child_node_idx ?? ''), radio: String(e?.RadioEnabled ?? ''), ssid: String(e?.SSID ?? ''),
    beacon: String(e?.BeaconType ?? ''), enable: String(e?.Enable ?? ''),
  })).filter(r => r.idx !== '');
}

/** موديلات اللي صفحتها فيها زر الأنوار (menudata.js) */
export const ledShown = (model: string) => /LG6121[HD]/i.test(model);
/** LG6121D (الخارجي) واي فاي 2.4 بس — صفحة 5G مخفية له */
export const has5g = (model: string, wifi5?: unknown) => !/LG6121D/i.test(model) && String(wifi5 ?? '') !== '0';

/** رقم الشبكة الأساسية لـ 5G (MainSSIDIndex_58G) — الافتراضي في main.js = 9 */
export function main5Index(v: unknown): string {
  const n = parseInt(String(v ?? ''), 10);
  return String(Number.isFinite(n) && n > 1 ? n : 9);
}

const toMins = (t: string) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const secsToUptime = (v: unknown): string | undefined => {
  const s = Math.floor(Number(String(v ?? '').trim()));
  if (!Number.isFinite(s) || s <= 0) return undefined;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
/** Modem5GTemperature بالألف (45000 = 45°) — ونقبل الدرجة نفسها لو جت كذا */
export function tempC(v: unknown): number | undefined {
  const x = parseFloat(String(v ?? ''));
  if (!Number.isFinite(x) || x <= 0) return undefined;
  const c = x > 200 ? x / 1000 : x;
  return c > 0 && c < 130 ? Math.round(c) : undefined;
}

/** أيام إعادة التشغيل ← كل كم يوم تقريباً */
export function rebootEvery(days: string): number {
  const n = days.split(',').map(x => x.trim()).filter(x => WEEK.includes(x)).length;
  return n === 0 || n >= 7 ? 1 : Math.max(1, Math.round(7 / n));
}

export function extrasFrom(v: Record<string, unknown>, rows: WlanRow[] | null, o: { model: string; wifi5?: unknown; main5?: unknown; uptime?: unknown }): RouterExtras {
  const s = (k: string) => (v[k] === undefined || v[k] === null ? undefined : String(v[k]).trim());
  const ex: RouterExtras = {};
  const nat = s('nat');
  if (nat === '1') ex.nat = 'symmetric';
  else if (nat === '2') ex.nat = 'cone';
  const upnp = s('upnp');
  if (upnp === '0' || upnp === '1') ex.upnp = upnp === '1';
  const dmz = s('dmzOn');
  if (dmz === '0' || dmz === '1') ex.dmz = { on: dmz === '1', ip: s('dmzIp') ?? '' };
  const led = s('led');
  if (ledShown(o.model) && (led === '0' || led === '1')) ex.led = led === '1';
  const rb = s('rbOn');
  if (rb === '0' || rb === '1') {
    const t = toMins(s('rbTime') ?? '');
    const at = Number.isFinite(t) ? t : 4 * 60;
    ex.autoReboot = { on: rb === '1', everyDays: rebootEvery(s('rbDays') ?? ''), from: at, to: at };
  }
  const up = secsToUptime(o.uptime);
  if (up) ex.uptime = up;
  const c = tempC(v.temp);
  if (c !== undefined) ex.health = { tempC: c, throttle: false };

  if (rows && rows.length) {
    const i5 = main5Index(o.main5);
    const five = has5g(o.model, o.wifi5);
    const r24 = rows.find(r => r.idx === '1');
    const r5 = five ? rows.find(r => r.idx === i5) : undefined;
    const bands: NonNullable<RouterExtras['bands']> = [];
    if (r24 && (r24.radio === '0' || r24.radio === '1')) bands.push({ band: '2.4', on: r24.radio === '1' });
    if (r5 && (r5.radio === '0' || r5.radio === '1')) bands.push({ band: '5', on: r5.radio === '1' });
    if (bands.length) ex.bands = bands;
    const nets: NonNullable<RouterExtras['wifiNets']> = [];
    for (const [r, band] of [[r24, '2.4'], [r5, '5']] as const) {
      if (r && r.enable === '1' && r.ssid) nets.push({ index: r.idx, band, name: r.ssid, secured: !!r.beacon && r.beacon !== 'None' });
    }
    if (nets.length) ex.wifiNets = nets;
  }
  return ex;
}

/** نفس شروط صفحة الراوتر (checkSSID) — ما فيها مسافات ولا حروف عربية */
const SSID_RE = /^[一-龥！（），：；？￥—‘’“”…、。《》【】\x21\x23-\x3b\x3d\x40-\x5b\x5d\x5e\x5f\x61-\x7e]+$/;
const PASS_RE = /^[\x21\x23-\x3b\x3d\x40-\x5b\x5d\x5e\x5f\x61-\x7e]+$/;
const utf8Len = (t: string) => { let n = 0; for (const ch of t) { const c = ch.codePointAt(0)!; n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };

export function ssidError(name: string): string | null {
  if (!name || utf8Len(name) > 32) return 'اسم الشبكة لازم يكون من ١ إلى ٣٢ حرف.';
  if (!SSID_RE.test(name)) return 'راوترك ما يقبل في اسم الشبكة مسافات ولا حروف عربية ولا الرموز " < > ? \\ ` — استخدم حروف إنجليزية وأرقام (مثل Bandly_Home).';
  return null;
}
export function wifiPassError(p: string): string | null {
  if (p.length < 8 || p.length > 32) return 'كلمة مرور الواي فاي في راوترك لازم تكون من ٨ إلى ٣٢ حرف.';
  if (!PASS_RE.test(p)) return 'راوترك ما يقبل في كلمة المرور مسافات ولا حروف عربية ولا الرموز " < > ? \\ ` — استخدم حروف إنجليزية وأرقام.';
  return null;
}

export const isIPv4 = (ip: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
