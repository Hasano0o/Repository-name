/**
 * مركز التحكم في هواوي — مجرّب على H158-381 (5G CPE Pro 5):
 *   security/nat     NATType 1=Cone 0=Symmetric (نرسل كل الحقول)
 *   security/upnp    UpnpStatus
 *   security/dmz     DmzStatus + DmzIPAddress + DmzMacAddress
 *   led/appctrlled   ledctrlswitch + starttime/endtime (HH:MM)
 *   diagnosis/time_reboot  enable (بعض الموديلات ما تسمح بتعديل الوقت — نغيّر التشغيل بس)
 * أي مسار يرجع خطأ = الراوتر ما يدعم الميزة، فما نعرضها.
 */
import { RouterExtras } from '../types';
import type { Io } from './apn-dns';

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
const inner = (xml: string) => xml.match(/<response>([\s\S]*)<\/response>/)?.[1] ?? '';
const fieldsOf = (b: string): [string, string][] => [...b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
const ok = async (io: Io, p: string) => { try { const x = await io.get(p); return x.includes('<error>') ? null : x; } catch { return null; } };

export async function getExtras(io: Io): Promise<RouterExtras> {
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
  return out;
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
