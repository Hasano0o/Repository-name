/**
 * مركز التحكم في هواوي — مجرّب على H158-381 (5G CPE Pro 5):
 *   security/nat     NATType 1=Cone 0=Symmetric (نرسل كل الحقول)
 *   security/upnp    UpnpStatus
 *   security/dmz     DmzStatus + DmzIPAddress + DmzMacAddress
 *   led/appctrlled   ledctrlswitch + starttime/endtime (HH:MM)
 *   diagnosis/time_reboot  enable (بعض الموديلات ما تسمح بتعديل الوقت — نغيّر التشغيل بس)
 * أي مسار يرجع خطأ = الراوتر ما يدعم الميزة، فما نعرضها.
 */
import { RouterExtras, TimeRule } from '../types';
import { ensureSession, type Io } from './apn-dns';

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
const inner = (xml: string) => xml.match(/<response>([\s\S]*)<\/response>/)?.[1] ?? '';
const fieldsOf = (b: string): [string, string][] => [...b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
const ok = async (io: Io, p: string) => { try { const x = await io.get(p); return x.includes('<error>') ? null : x; } catch { return null; } };

export async function getExtras(io: Io): Promise<RouterExtras> {
  await ensureSession(io);
  const out: RouterExtras = {};
  const nat = await ok(io, 'security/nat');
  if (nat && tag(nat, 'NATType') !== undefined && tag(nat, 'NATEnable') !== '0') out.nat = tag(nat, 'NATType') === '1' ? 'cone' : 'symmetric';
  const up = await ok(io, 'security/upnp');
  if (up && tag(up, 'UpnpStatus') !== undefined) out.upnp = tag(up, 'UpnpStatus') === '1';
  const dmz = await ok(io, 'security/dmz');
  if (dmz && tag(dmz, 'DmzStatus') !== undefined) out.dmz = { on: tag(dmz, 'DmzStatus') === '1', ip: tag(dmz, 'DmzIPAddress') ?? '' };
  const led = await ok(io, 'led/appctrlled');
  if (led && tag(led, 'ledctrlswitch') !== undefined) out.ledNight = { on: tag(led, 'ledctrlswitch') === '1', start: tag(led, 'starttime') ?? '00:00', end: tag(led, 'endtime') ?? '06:00' };
  const rb = await ok(io, 'diagnosis/time_reboot');
  if (rb && tag(rb, 'enable') !== undefined) {
    out.autoReboot = {
      on: tag(rb, 'enable') === '1',
      everyDays: Number(tag(rb, 'dayinterval') ?? 7) || 7,
      from: Number(tag(rb, 'begintime') ?? 60), to: Number(tag(rb, 'endtime') ?? 300),
    };
  }
  if (out.upnp !== undefined) {
    const maps = await ok(io, 'ntwk/lan_upnp_portmapping');
    if (maps) {
      out.upnpMaps = [...maps.matchAll(/<upnpportmapping>([\s\S]*?)<\/upnpportmapping>/gi)].map(m => {
        const f = Object.fromEntries(fieldsOf(m[1]).map(([k, v]) => [k.toLowerCase(), v]));
        return {
          app: f.description || f.portmappingdescription || f.name || '',
          ip: f.internalclient || f.ipaddress || f.lanip || '',
          port: f.externalport || f.port || '',
          proto: f.protocol || f.portmappingprotocol || '',
        };
      });
    }
  }
  // ── شبكة الضيوف ──
  const mb = await ok(io, 'wlan/multi-basic-settings');
  if (mb) {
    const g = ssidBlocks(mb).find(b => tag(b, 'wifiisguestnetwork') === '1');
    if (g) {
      out.guest = {
        on: tag(g, 'WifiEnable') === '1',
        name: unesc(tag(g, 'WifiSsid') ?? ''),
        open: /^open$/i.test(tag(g, 'WifiAuthmode') ?? ''),
        offHours: Number(tag(g, 'wifiguestofftime') ?? 0) || 0,
      };
      if (out.guest.on) {
        const gt = await ok(io, 'wlan/guesttime-setting');
        const rem = Number(gt && tag(gt, 'remaintime'));
        if (rem > 0) out.guest.remainSecs = rem;
      }
    }
  }
  // ── تشغيل/إطفاء كل شبكة ──
  const sw = await ok(io, 'wlan/status-switch-settings');
  if (sw) {
    const rs = radioBlocks(sw);
    if (rs.length) out.bands = rs.map(b => ({ band: radioBand(b), on: tag(b, 'wifienable') === '1' }));
  }
  // ── أوقات النت ──
  const tr = await ok(io, 'timerule/timerule');
  if (tr && tag(tr, 'TimeRuleMaxNum') !== undefined) {
    out.timeRuleMax = Number(tag(tr, 'TimeRuleMaxNum')) || 16;
    out.timeRules = [...tr.matchAll(/<TimeControlRule>([\s\S]*?)<\/TimeControlRule>/g)].map(m => {
      const b = m[1];
      return {
        id: tag(b, 'ID') ?? '', mac: (tag(b, 'DevicesMAC') ?? '').toUpperCase(),
        on: tag(b, 'Enable') === '1', days: tag(b, 'WeekEnable') ?? '1111111',
        start: tag(b, 'StartTime') ?? '00:00', end: tag(b, 'EndTime') ?? '00:00', raw: b,
      } as TimeRule;
    });
  }
  // ── حجب المواقع ──
  const uf = await ok(io, 'security/url-filter');
  if (uf && /<urlfilters/.test(uf)) {
    out.urlBlocks = [...uf.matchAll(/<urlfilter>([\s\S]*?)<\/urlfilter>/g)].map(m => ({
      url: unesc(tag(m[1], 'value') ?? ''),
      macs: [...m[1].matchAll(/<devicemac>([^<]*)<\/devicemac>/g)].map(x => x[1].toUpperCase()),
    })).filter(x => x.url);
  }
  // ── مدة التشغيل ──
  const bt = await ok(io, 'device/boot_time');
  if (bt && tag(bt, 'boot_time')) out.uptime = tag(bt, 'boot_time');
  return out;
}

const unesc = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ssidBlocks = (x: string) => [...x.matchAll(/<Ssid>([\s\S]*?)<\/Ssid>/g)].map(m => m[1]);
const radioBlocks = (x: string) => [...x.matchAll(/<radio>([\s\S]*?)<\/radio>/g)].map(m => m[1]);
/** Radio.1 = 2.4، Radio.2 = 5 (أو index 0/1) */
const radioBand = (b: string): '2.4' | '5' => {
  const n = (tag(b, 'ID') ?? '').match(/Radio\.(\d+)/)?.[1] ?? String(Number(tag(b, 'index') ?? 0) + 1);
  return n === '1' ? '2.4' : '5';
};
/** نشيل كلمات السر قبل الإرسال — مثل صفحة الراوتر (clearSecureData) عشان ما تتغيّر */
const SECRET = /key|psk|wep/i;
const stripSecrets = (b: string) => b.replace(/<(\w+)>[^<]*<\/\1>/g, (m, k) => (SECRET.test(k) ? '' : m));

/** الضيوف: نرسل كل الشبكات (الإطفاء ما يمشي لو أرسلنا شبكة الضيوف لحالها) */
export async function setGuest(io: Io, on: boolean, offHours: number) {
  const x = await io.get('wlan/multi-basic-settings');
  const blocks = ssidBlocks(x).map(b => {
    let c = stripSecrets(b);
    if (tag(b, 'wifiisguestnetwork') === '1') {
      c = c.replace(/<WifiEnable>[^<]*<\/WifiEnable>/, `<WifiEnable>${on ? '1' : '0'}</WifiEnable>`)
        .replace(/<wifiguestofftime>[^<]*<\/wifiguestofftime>/, `<wifiguestofftime>${offHours}</wifiguestofftime>`);
    }
    return `<Ssid>${c}</Ssid>`;
  });
  await io.post('wlan/multi-basic-settings', `<Ssids>${blocks.join('')}</Ssids><WifiRestart>1</WifiRestart>`);
}

export async function setBandOn(io: Io, band: '2.4' | '5', on: boolean) {
  const x = await io.get('wlan/status-switch-settings');
  const rs = radioBlocks(x).map(b => (radioBand(b) === band
    ? b.replace(/<wifienable>[^<]*<\/wifienable>/, `<wifienable>${on ? '1' : '0'}</wifienable>`) : b));
  if (!rs.some(b => tag(b, 'wifienable') === '1')) throw new Error('ما نقدر نطفي كل الشبكات — بتنقطع عن الراوتر');
  await io.post('wlan/status-switch-settings', `<radios>${rs.map(b => `<radio>${b}</radio>`).join('')}</radios><WifiRestart>1</WifiRestart>`);
}

const ruleXml = (r: Record<string, string>, mac: string, name: string) =>
  `<TimeControlRules><TimeControlRule><Action>${r.Action}</Action><Enable>${r.Enable}</Enable><TimeMode>${r.TimeMode}</TimeMode>`
  + `<ID>${esc(r.ID)}</ID><DevicesMACs><DevicesMAC>${esc(mac)}</DevicesMAC></DevicesMACs><DevicesNames><DevicesName>${esc(name)}</DevicesName></DevicesNames>`
  + `<WeekEnable>${r.WeekEnable}</WeekEnable><StartTime>${r.StartTime}</StartTime><EndTime>${r.EndTime}</EndTime></TimeControlRule></TimeControlRules>`;

export async function addTimeRule(io: Io, r: { mac: string; name: string; days: string; start: string; end: string }) {
  await io.post('timerule/timerule', ruleXml({
    Action: 'create', Enable: '1', TimeMode: r.days === '1111111' ? '0' : '1', ID: '',
    WeekEnable: r.days, StartTime: r.start, EndTime: r.end,
  }, r.mac, r.name));
}
export async function updateTimeRule(io: Io, r: TimeRule, action: 'update' | 'delete', on?: boolean) {
  const b = r.raw ?? '';
  await io.post('timerule/timerule', ruleXml({
    Action: action, Enable: on === undefined ? (r.on ? '1' : '0') : (on ? '1' : '0'),
    TimeMode: tag(b, 'TimeMode') ?? (r.days === '1111111' ? '0' : '1'), ID: r.id,
    WeekEnable: r.days, StartTime: r.start, EndTime: r.end,
  }, r.mac, tag(b, 'DevicesName') ?? r.mac));
}
export async function setUrlBlocks(io: Io, list: { url: string; macs: string[] }[]) {
  const items = list.map(x => `<urlfilter><value>${esc(x.url)}</value><status>1</status>`
    + (x.macs.length ? `<devicemacs>${x.macs.map(m => `<devicemac>${esc(m)}</devicemac>`).join('')}</devicemacs>` : '')
    + '</urlfilter>').join('');
  await io.post('security/url-filter', `<urlfilters>${items}</urlfilters>`);
}

export async function setNat(io: Io, t: 'cone' | 'symmetric') {
  const cur = fieldsOf(inner(await io.get('security/nat')));
  const f = Object.fromEntries(cur);
  f.NATType = t === 'cone' ? '1' : '0';
  await io.post('security/nat', xml(f));
}
export async function setUpnp(io: Io, on: boolean) {
  await io.post('security/upnp', xml({ UpnpStatus: on ? '1' : '0' }));
}
export async function setDmz(io: Io, on: boolean, ip: string, mac = '') {
  await io.post('security/dmz', xml({ DmzStatus: on ? '1' : '0', DmzIPAddress: ip, DmzMacAddress: mac }));
}
export async function setLedNight(io: Io, on: boolean, start: string, end: string) {
  await io.post('led/appctrlled', xml({ ledctrlswitch: on ? '1' : '0', starttime: start, endtime: end }));
}
export async function setAutoReboot(io: Io, on: boolean) {
  await io.post('diagnosis/time_reboot', xml({ enable: on ? '1' : '0' }));
}
