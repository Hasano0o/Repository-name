/**
 * مركز التحكم لراوترات ZTE (MU5001 وأخواتها) — من أوامر صفحة الراوتر نفسها (js/service.js):
 *  UPnP ............ UPNP_SETTING  upnp_setting_option=1/0          ← قراءة upnpEnabled
 *  DMZ ............. DMZ_SETTING   DMZEnabled, DMZIPAddress           ← DMZEnable, DMZIPAddress
 *  أنوار الليل ..... SET_DEVICE_LED night_mode_switch/start/end/close_all_led ← night_mode_*
 *  الضيوف/الشبكات .. setAccessPointInfo ChipIndex/AccessPointIndex/AccessPointSwitchStatus
 *                    ← queryAccessPointInfo (ResponseList) + queryWiFiGuestLeftTime
 *  حجب المواقع ..... URL_FILTER_ADD addURLFilter / URL_FILTER_DELETE url_filter_delete_id ← websURLFilters
 * كل كتابة يتأكد منها مركز التحكم بإعادة القراءة.
 */
import type { RouterExtras } from '../types';

export interface ZteIo {
  get(fields: string[]): Promise<Record<string, string>>;
  getRaw(field: string): Promise<Record<string, unknown> | null>;
  act(body: Record<string, string>): Promise<string>;
}

const ok = (out: string) => /success|"result"\s*:\s*"?0"?/i.test(out);
const fail = (what: string, out: string) =>
  new Error(`الراوتر رفض ${what} (${(out || 'بدون رد').replace(/\s+/g, ' ').slice(0, 60)})`);
const hhmm = (v?: string, def = '00:00') => {
  const m = /^(\d{1,2}):(\d{1,2})/.exec(v ?? '');
  return m ? `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}` : def;
};

export interface Ap { ChipIndex: string; AccessPointIndex: string; AccessPointSwitchStatus: string; SSID?: string; AuthMode?: string; QrImageShow?: string; GuestSSIDActiveTime?: string }

export async function accessPoints(io: ZteIo): Promise<Ap[]> {
  const r = await io.getRaw('queryAccessPointInfo').catch(() => null);
  const list = (r?.ResponseList ?? []) as any[];
  return Array.isArray(list) ? list.map(x => ({ ...x, ChipIndex: String(x.ChipIndex), AccessPointIndex: String(x.AccessPointIndex), AccessPointSwitchStatus: String(x.AccessPointSwitchStatus ?? '0') })) : [];
}

export async function zteExtras(io: ZteIo): Promise<RouterExtras> {
  const ex: RouterExtras = {};
  const f = await io.get([
    'upnpEnabled', 'DMZEnable', 'DMZIPAddress',
    'night_mode_switch', 'night_mode_start_time', 'night_mode_end_time',
    'websURLFilters', 'ps_no_service_restart_flag', 'sysIdleTimeToSleep',
    'battery_vol_percent', 'battery_charging', 'battery_temp', 'pm_sensor_mdm', 'pm_sensor_pa1', 'pm_sensor_ambient',
    'therm_pa_level', 'therm_tj_level',
  ]).catch(() => ({} as Record<string, string>));

  if (f.upnpEnabled === '0' || f.upnpEnabled === '1') ex.upnp = f.upnpEnabled === '1';
  if (f.DMZEnable === '0' || f.DMZEnable === '1') ex.dmz = { on: f.DMZEnable === '1', ip: f.DMZIPAddress ?? '' };
  if (f.night_mode_switch === '0' || f.night_mode_switch === '1') {
    ex.ledNight = { on: f.night_mode_switch === '1', start: hhmm(f.night_mode_start_time, '23:00'), end: hhmm(f.night_mode_end_time, '06:00') };
  }
  if (f.websURLFilters !== undefined) {
    ex.urlBlocks = f.websURLFilters.split(';').map(s => s.trim()).filter(Boolean).map(url => ({ url, macs: [] }));
  }
  if (f.ps_no_service_restart_flag === '0' || f.ps_no_service_restart_flag === '1') ex.autoRecover = f.ps_no_service_restart_flag === '1';
  if (/^-?\d+$/.test(f.sysIdleTimeToSleep ?? '')) ex.wifiSleep = Number(f.sysIdleTimeToSleep);
  const temps = [f.pm_sensor_mdm, f.pm_sensor_pa1, f.pm_sensor_ambient].map(Number).filter(t => t > 0 && t < 120);
  const bat = Number(f.battery_vol_percent);
  if (temps.length || f.battery_vol_percent) {
    ex.health = {
      battery: f.battery_vol_percent && bat >= 0 && bat <= 100 ? bat : undefined,
      charging: f.battery_charging === '1',
      tempC: temps.length ? Math.max(...temps) : undefined,
      throttle: Number(f.therm_pa_level) > 0 || Number(f.therm_tj_level) > 0,
    };
  }

  const aps = await accessPoints(io);
  const main = aps.filter(a => a.AccessPointIndex === '0');
  if (main.length) {
    ex.bands = main.map(a => ({ band: a.ChipIndex === '1' ? '5' as const : '2.4' as const, on: a.AccessPointSwitchStatus === '1' }));
  }
  const g = aps.find(a => a.ChipIndex === '0' && a.AccessPointIndex === '1');
  if (g) {
    const left = await io.getRaw('queryWiFiGuestLeftTime').catch(() => null);
    const remain = Number(left?.WiFiGuestLeftTime ?? 0);
    // MU5001: الشبكة الثانية بدون مؤقت (GuestSSIDActiveTime فاضي)
    const noTimer = (g.GuestSSIDActiveTime ?? '') === '';
    const t = Number(g.GuestSSIDActiveTime || 0);
    ex.guest = {
      noTimer,
      on: g.AccessPointSwitchStatus === '1',
      name: g.SSID ?? '',
      open: /OPEN|NONE/i.test(g.AuthMode ?? ''),
      offHours: [0, 4, 24].includes(t) ? t : 0,
      remainSecs: remain > 0 ? remain : undefined,
    };
  }
  return ex;
}

export async function zteSetUpnp(io: ZteIo, on: boolean) {
  const out = await io.act({ goformId: 'UPNP_SETTING', upnp_setting_option: on ? '1' : '0' });
  if (!ok(out)) throw fail('UPnP', out);
}

export async function zteSetDmz(io: ZteIo, on: boolean, ip: string) {
  const body: Record<string, string> = { goformId: 'DMZ_SETTING', DMZEnabled: on ? '1' : '0' };
  if (on) body.DMZIPAddress = ip;
  const out = await io.act(body);
  if (!ok(out)) throw fail('DMZ', out);
}

export async function zteSetLedNight(io: ZteIo, on: boolean, start: string, end: string) {
  const body: Record<string, string> = { goformId: 'SET_DEVICE_LED', night_mode_switch: on ? '1' : '0' };
  if (on) Object.assign(body, { night_mode_start_time: start, night_mode_end_time: end, night_mode_close_all_led: '1' });
  const out = await io.act(body);
  if (!ok(out)) throw fail('وضع الليل', out);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * تشغيل/إطفاء شبكة واي فاي (نفس طلب صفحة الراوتر لما تغيّر المفتاح بس).
 * MU5001 يرد «failure» مع إنه يطبّق التغيير — فنتأكد بإعادة القراءة بدل الرد.
 */
async function switchAp(io: ZteIo, chip: string, idx: string, on: boolean, extra: Record<string, string> = {}) {
  const aps = await accessPoints(io);
  const ap = aps.find(a => a.ChipIndex === chip && a.AccessPointIndex === idx && a.SSID);
  if (!ap) throw new Error('الشبكة هذي مو موجودة في راوترك');
  const want = on ? '1' : '0';
  if (ap.AccessPointSwitchStatus === want) return;
  const body: Record<string, string> = {
    goformId: 'setAccessPointInfo', ChipIndex: chip, AccessPointIndex: idx,
    QrImageShow: ap.QrImageShow || '0', lan_sec_ssid_control: '', wifi_syncparas_flag: '',
    AccessPointSwitchStatus: want,
    ...extra,
  };
  const out = await io.act(body);
  let readOk = false;
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    const list = await accessPoints(io).catch(() => null);
    if (!list?.length) continue; // الجوال انفصل لأنه على نفس الشبكة — نحكم بالقراءة الجاية
    readOk = true;
    const now = list.find(a => a.ChipIndex === chip && a.AccessPointIndex === idx);
    if (now?.AccessPointSwitchStatus === want) return;
  }
  if (readOk) throw fail('تغيير الواي فاي', out);
}

export const zteSetBandOn = (io: ZteIo, band: '2.4' | '5', on: boolean) => switchAp(io, band === '5' ? '1' : '0', '0', on);
export async function zteSetGuest(io: ZteIo, on: boolean, offHours: number) {
  const g = (await accessPoints(io)).find(a => a.ChipIndex === '0' && a.AccessPointIndex === '1');
  const timer = (g?.GuestSSIDActiveTime ?? '') !== '';
  return switchAp(io, '0', '1', on, timer ? { GuestSSIDActiveTime: String(offHours) } : {});
}

export async function zteSetUrlBlocks(io: ZteIo, list: { url: string; macs: string[] }[]) {
  const cur = ((await io.get(['websURLFilters'])).websURLFilters ?? '').split(';').map(s => s.trim()).filter(Boolean);
  const want = list.map(l => l.url.trim()).filter(Boolean);
  const del = cur.map((u, i) => (want.includes(u) ? -1 : i)).filter(i => i >= 0);
  if (del.length) {
    const out = await io.act({ goformId: 'URL_FILTER_DELETE', url_filter_delete_id: del.join(';') + ';' });
    if (!ok(out)) throw fail('حذف الموقع', out);
  }
  for (const u of want.filter(u => !cur.includes(u))) {
    const out = await io.act({ goformId: 'URL_FILTER_ADD', addURLFilter: u });
    if (!ok(out)) throw fail('حجب الموقع', out);
  }
}

// ───── قنوات الواي فاي (MU5001: شريحة 0 = 2.4، شريحة 1 = 5) ─────
/** قنوات 5 جيجا المسموحة حسب الدولة (من config.js في صفحة الراوتر) */
const CH5: [string[], string[]][] = [
  [['US', 'CA', 'AU', 'BH', 'EG', 'IN', 'MY', 'SG', 'BR', 'NZ', 'TH', 'VN', 'PH', 'HK'], ['36', '40', '44', '48', '149', '153', '157', '161', '165']],
  [['LB', 'QA', 'MO', 'MW'], ['149', '153', '157', '161']],
  [['CN', 'PK', 'BD', 'AR', 'TW', 'NG'], ['149', '153', '157', '161', '165']],
];
const ch5For = (cc: string) => CH5.find(([codes]) => codes.includes(cc))?.[1] ?? ['36', '40', '44', '48'];
const CH24 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];

export async function zteRadios(io: ZteIo) {
  const aps = (await accessPoints(io)).filter(a => a.AccessPointIndex === '0' && (a as any).Band);
  return aps.map(a => {
    const five = (a as any).Band === 'a' || a.ChipIndex === '1';
    return {
      band: five ? '5' as const : '2.4' as const,
      channel: String((a as any).Channel ?? '0'),
      allowed: ['0', ...(five ? ch5For((a as any).CountryCode ?? 'SA') : CH24)],
      writable: true,
    };
  });
}

export async function zteSetChannel(io: ZteIo, band: '2.4' | '5', channel: string) {
  const ap: any = (await accessPoints(io)).find(a => a.AccessPointIndex === '0' && (((a as any).Band === 'a') === (band === '5')));
  if (!ap) throw new Error('ما لقينا شبكة هذا النطاق في راوترك');
  const out = await io.act({
    goformId: 'setWiFiChipAdvancedInfo', ChipIndex: ap.ChipIndex,
    WirelessMode: ap.WirelessMode || (band === '5' ? '8' : '7'), CountryCode: ap.CountryCode || 'SA',
    Channel: channel, BandWidth: ap.BandWidth || (band === '5' ? '4' : '2'), abg_rate: '0',
  });
  // الواي فاي يعيد التشغيل بعد التغيير — الجوال ينفصل ثواني لو كان على نفس الشبكة،
  // فشاشة القنوات هي اللي تنتظر رجوعه وتتأكد من القناة (مجرّب حي: 6 و 13 و 1 على MU5001)
  if (!ok(out)) throw fail('تغيير القناة', out);
}

/** يرجّع الاتصال لحاله لو انقطعت الخدمة (مجرّب على MU5001) */
export async function zteSetAutoRecover(io: ZteIo, on: boolean) {
  const out = await io.act({ goformId: 'PS_NO_SERVICE_RESTART_SET', ps_no_service_restart_flag: on ? '1' : '0' });
  if (!ok(out)) throw fail('الإرجاع التلقائي', out);
}

/** نوم الواي فاي: -1 دايماً شغّال، أو دقائق (5/10/20/30/60/120) — مجرّب على MU5001 */
export async function zteSetWifiSleep(io: ZteIo, mins: number) {
  const out = await io.act({ goformId: 'SET_WIFI_SLEEP_INFO', sysIdleTimeToSleep: String(mins) });
  if (!ok(out)) throw fail('نوم الواي فاي', out);
}
