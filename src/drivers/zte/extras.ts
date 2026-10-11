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

interface Ap { ChipIndex: string; AccessPointIndex: string; AccessPointSwitchStatus: string; SSID?: string; AuthMode?: string; QrImageShow?: string; GuestSSIDActiveTime?: string }

async function accessPoints(io: ZteIo): Promise<Ap[]> {
  const r = await io.getRaw('queryAccessPointInfo').catch(() => null);
  const list = (r?.ResponseList ?? []) as any[];
  return Array.isArray(list) ? list.map(x => ({ ...x, ChipIndex: String(x.ChipIndex), AccessPointIndex: String(x.AccessPointIndex), AccessPointSwitchStatus: String(x.AccessPointSwitchStatus ?? '0') })) : [];
}

export async function zteExtras(io: ZteIo): Promise<RouterExtras> {
  const ex: RouterExtras = {};
  const f = await io.get([
    'upnpEnabled', 'DMZEnable', 'DMZIPAddress',
    'night_mode_switch', 'night_mode_start_time', 'night_mode_end_time',
    'websURLFilters', 'realtime_time',
  ]).catch(() => ({} as Record<string, string>));

  if (f.upnpEnabled === '0' || f.upnpEnabled === '1') ex.upnp = f.upnpEnabled === '1';
  if (f.DMZEnable === '0' || f.DMZEnable === '1') ex.dmz = { on: f.DMZEnable === '1', ip: f.DMZIPAddress ?? '' };
  if (f.night_mode_switch === '0' || f.night_mode_switch === '1') {
    ex.ledNight = { on: f.night_mode_switch === '1', start: hhmm(f.night_mode_start_time, '23:00'), end: hhmm(f.night_mode_end_time, '06:00') };
  }
  if (f.websURLFilters !== undefined) {
    ex.urlBlocks = f.websURLFilters.split(';').map(s => s.trim()).filter(Boolean).map(url => ({ url, macs: [] }));
  }
  const secs = Number(f.realtime_time);
  if (secs > 0) {
    const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
    ex.uptime = d ? `${d}:${h}:${m}` : `${h}:${m}:00`;
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
    const t = Number(g.GuestSSIDActiveTime ?? 0);
    ex.guest = {
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

/** تشغيل/إطفاء شبكة واي فاي (نفس طلب صفحة الراوتر لما تغيّر المفتاح بس) */
async function switchAp(io: ZteIo, chip: string, idx: string, on: boolean, extra: Record<string, string> = {}) {
  const aps = await accessPoints(io);
  const ap = aps.find(a => a.ChipIndex === chip && a.AccessPointIndex === idx);
  if (!ap) throw new Error('الشبكة هذي مو موجودة في راوترك');
  const body: Record<string, string> = {
    goformId: 'setAccessPointInfo', ChipIndex: chip, AccessPointIndex: idx,
    QrImageShow: ap.QrImageShow ?? '0', lan_sec_ssid_control: '', wifi_syncparas_flag: '',
    AccessPointSwitchStatus: on ? '1' : '0',
    ...extra,
  };
  if (chip === '0' && idx === '1' && body.GuestSSIDActiveTime === undefined) body.GuestSSIDActiveTime = ap.GuestSSIDActiveTime ?? '0';
  const out = await io.act(body);
  if (!ok(out)) throw fail('تغيير الواي فاي', out);
}

export const zteSetBandOn = (io: ZteIo, band: '2.4' | '5', on: boolean) => switchAp(io, band === '5' ? '1' : '0', '0', on);
export const zteSetGuest = (io: ZteIo, on: boolean, offHours: number) =>
  switchAp(io, '0', '1', on, { GuestSSIDActiveTime: String(offHours) });

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
