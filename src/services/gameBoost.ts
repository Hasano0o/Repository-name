/**
 * «تعزيز اللعب» — التشغيل الفعلي (الشبكة والراوتر). المنطق والدرجات في src/utils/gameNet.ts.
 */
import * as Notifications from 'expo-notifications';
import { pingOnce } from '../utils/latency';
import {
  runBloat, BloatResult, LoadHandle, natVerdict, NatVerdict, sameLan, MatchDevice, normMac,
} from '../utils/gameNet';
import { SavedRouter, listRouters } from '../store/routers';
import { withSession, routerWrite } from '../store/sessions';
import { getMatch, saveMatch, clearMatch, StoredMatch } from '../store/matchMode';
import { ensureAndroidChannel } from '../utils/notify';
import { selfLanIp } from './selfIp';
import { diag } from './diag';

const CF = 'https://speed.cloudflare.com';
const nocache = () => `r=${Math.random().toString(36).slice(2, 9)}`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/* ═══════════ Bufferbloat ═══════════ */

function startLoad(kind: 'down' | 'up'): LoadHandle {
  const ctrl = new AbortController();
  let bytes = 0;
  let on = true;
  const body = kind === 'up' ? '0'.repeat(1_000_000) : '';
  const worker = async () => {
    while (on) {
      try {
        if (kind === 'down') {
          const r = await fetch(`${CF}/__down?bytes=10000000&${nocache()}`, { signal: ctrl.signal });
          const b = await r.arrayBuffer();
          bytes += b.byteLength;
        } else {
          const r = await fetch(`${CF}/__up?${nocache()}`, { method: 'POST', body, signal: ctrl.signal });
          await r.text();
          bytes += body.length;
        }
      } catch {
        if (!on) break;
        await sleep(300);
      }
    }
  };
  // ٣ خطوط تنزيل / خطين رفع — يكفي يعبّي خطوط 4G/5G
  const ws = Array.from({ length: kind === 'down' ? 3 : 2 }, worker);
  return {
    stop: async () => {
      on = false;
      ctrl.abort();
      await Promise.allSettled(ws);
      return bytes;
    },
  };
}

/** أول رابط يرد من روابط المنطقة (نفس سيرفر اللعبة المختار) */
async function firstAlive(urls: string[]): Promise<string | null> {
  for (const u of urls) if ((await pingOnce(u, 3000)) !== null) return u;
  return null;
}

export async function runBloatTest(
  urls: string[],
  o: { cancelled?: () => boolean; onStep?: (step: 'idle' | 'down' | 'up', ms: number | null) => void } = {},
): Promise<BloatResult> {
  const url = await firstAlive(urls);
  if (!url) throw new Error('سيرفر اللعبة ما رد — جرّب منطقة ثانية أو تأكد من النت');
  await pingOnce(url, 3000); // تسخين
  return runBloat({
    ping: () => pingOnce(url, 2500),
    startLoad,
    sleep,
    now: () => Date.now(),
    cancelled: o.cancelled,
    onStep: o.onStep,
  });
}

/* ═══════════ NAT / CGNAT / IPv6 ═══════════ */

async function getText(url: string, ms = 6000): Promise<string | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}${nocache()}`, { signal: ctrl.signal });
    return r.ok ? await r.text() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

const jsonIp = (t?: string) => { try { return t ? String(JSON.parse(t).ip ?? '') || undefined : undefined; } catch { return undefined; } };

async function publicV4(): Promise<string | undefined> {
  return jsonIp(await getText('https://api.ipify.org?format=json'))
    ?? (await getText('https://1.1.1.1/cdn-cgi/trace'))?.match(/^ip=(.+)$/m)?.[1]?.trim();
}

/** api6 ما يرد إلا لو الاتصال فيه IPv6 فعلاً */
const publicV6 = async () => jsonIp(await getText('https://api6.ipify.org?format=json', 5000));

export interface NatReport extends NatVerdict { wan?: string; pub?: string; v6Addr?: string; selfIp?: string }

export async function checkNat(r: SavedRouter): Promise<NatReport> {
  const [pub, v6Addr, wan, selfIp] = await Promise.all([
    publicV4(),
    publicV6(),
    withSession(r, async d => (d.getDeviceDetails ? (await d.getDeviceDetails()).wanIp : undefined), false).catch(() => undefined),
    selfLanIp(r.host).catch(() => undefined),
  ]);
  const v = natVerdict({ wan: wan || undefined, pub, v6: v6Addr, onWifi: sameLan(selfIp, r.host) });
  diag(`[gameboost] nat=${v.kind} wan=${wan ? 'y' : 'n'} v6=${v6Addr ? 'y' : 'n'} self=${selfIp ? 'y' : 'n'}`);
  return { ...v, wan: wan || undefined, pub, v6Addr, selfIp };
}

/* ═══════════ وضع المباراة ═══════════ */

export { selfLanIp };

async function scheduleEnd(until: number): Promise<string | undefined> {
  try {
    await ensureAndroidChannel();
    return await Notifications.scheduleNotificationAsync({
      content: { title: '🎮 خلص وضع المباراة', body: 'افتح Bandly عشان نرجّع النت للأجهزة اللي وقّفناها', sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(until) },
    });
  } catch {
    return undefined;
  }
}

/**
 * يوقف الأجهزة المختارة لمدة. الحالة تنحفظ قبل أول حظر (لو انقطع في النص نعرف وش نرجّع).
 * يرجّع اللي انوقفوا واللي فشلوا.
 */
export async function startMatch(r: SavedRouter, targets: MatchDevice[], minutes: number): Promise<{ ok: MatchDevice[]; failed: MatchDevice[] }> {
  const now = Date.now();
  const until = now + minutes * 60_000;
  const state: StoredMatch = { routerId: r.id, devices: targets.map(t => ({ mac: normMac(t.mac), name: t.name })), at: now, until };
  await saveMatch(state);
  const ok: MatchDevice[] = [];
  const failed: MatchDevice[] = [];
  try {
    await routerWrite(r, async d => {
      if (!d.blockDevice) throw new Error('راوترك ما يدعم إيقاف الأجهزة');
      for (const t of targets) {
        try { await d.blockDevice(t.mac, true, t.name); ok.push(t); }
        catch (e) { failed.push(t); diag(`[match] block ✗ ${String((e as any)?.message ?? e).slice(0, 60)}`); }
      }
    }, { label: 'وضع المباراة' });
  } finally {
    if (!ok.length) await clearMatch(r.id);
    else await saveMatch({ ...state, devices: state.devices.filter(x => ok.some(o => normMac(o.mac) === x.mac)), notifId: await scheduleEnd(until) });
  }
  return { ok, failed };
}

/** يرجّع النت لكل الأجهزة اللي وقّفناها. اللي فشل يبقى محفوظ للمرة الجاية. */
export async function endMatch(r: SavedRouter): Promise<{ restored: number; left: number }> {
  const s = await getMatch(r.id);
  if (!s) return { restored: 0, left: 0 };
  const left: StoredMatch['devices'] = [];
  await routerWrite(r, async d => {
    for (const x of s.devices) {
      try { await d.blockDevice!(x.mac, false); }
      catch (e) { left.push(x); diag(`[match] unblock ✗ ${String((e as any)?.message ?? e).slice(0, 60)}`); }
    }
  }, { label: 'إنهاء وضع المباراة' });
  if (s.notifId) { try { await Notifications.cancelScheduledNotificationAsync(s.notifId); } catch {} }
  if (left.length) await saveMatch({ ...s, devices: left, notifId: undefined });
  else await clearMatch(r.id);
  return { restored: s.devices.length - left.length, left: left.length };
}

let recovering = false;
/** عند فتح التطبيق: أي وضع مباراة خلص وقته ← نرجّع الأجهزة */
export async function recoverMatches(): Promise<string | null> {
  if (recovering) return null;
  recovering = true;
  let restored = 0;
  try {
    for (const r of await listRouters()) {
      const s = await getMatch(r.id);
      if (!s || Date.now() < s.until) continue;
      try { restored += (await endMatch(r)).restored; } catch (e) { diag(`[match] recover ✗ ${String((e as any)?.message ?? e).slice(0, 60)}`); }
    }
  } finally {
    recovering = false;
  }
  return restored ? `خلص وضع المباراة — رجّعنا النت لـ ${restored} ${restored === 1 ? 'جهاز' : 'أجهزة'}` : null;
}
