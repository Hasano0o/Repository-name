/**
 * «هل يفيدك مسرّع؟» (المرحلة ١ من مسرّع Bandly)
 * - قائمة سيرفرات المسرّع من الرسيفر (data/accel.json) — نضيف/نشيل سيرفر بدون تحديث للتطبيق.
 * - نقيس: الجوال ← سيرفر اللعبة مباشر · الجوال ← سيرفرنا (/ping) · وسيرفرنا ← سيرفر اللعبة (/routes يقيسها هو كل دقيقتين).
 * - النتيجة تنرسل للرسيفر مجهولة (الشركة + الحي + الأرقام) عشان نعرف كم عضو يستفيد قبل نبني المسرّع الفعلي.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';
import { deviceId, getArea, getConsent } from './community';
import { GameRegion, LatencyResult, measureUrl, regionUrls } from '../utils/latency';
import { AccelServer, AccelVerdict, Leg, accelVerdict, parseAccelConfig } from '../utils/accelCore';

const CFG_KEY = 'bandly.accelCfg';
const CFG_TTL = 6 * 3600_000;

async function getJson(url: string, ms = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** سيرفرات المسرّع — فاضية = الزر ما يطلع */
export async function accelServers(force = false): Promise<AccelServer[]> {
  try {
    const raw = await AsyncStorage.getItem(CFG_KEY);
    if (raw && !force) {
      const c = JSON.parse(raw);
      if (Date.now() - c.at < CFG_TTL) return parseAccelConfig(c.j);
    }
  } catch {}
  const j = await getJson(`${LIVE_BASE}/live-api/community/accel-config`);
  if (j) {
    try { await AsyncStorage.setItem(CFG_KEY, JSON.stringify({ at: Date.now(), j })); } catch {}
    return parseAccelConfig(j);
  }
  try {
    const raw = await AsyncStorage.getItem(CFG_KEY);
    if (raw) return parseAccelConfig(JSON.parse(raw).j);
  } catch {}
  return [];
}

const leg = (r: LatencyResult | null): Leg | null => (r ? { median: r.median, jitter: r.jitter, lossPct: r.lossPct, samples: r.samples } : null);

export interface AccelResult { server: AccelServer; verdict: AccelVerdict; direct: LatencyResult; toServer: LatencyResult; route: Leg | null }

/** فحص سيرفر واحد لمنطقة اللعبة المختارة */
export async function checkAccel(server: AccelServer, reg: GameRegion, step?: (t: string) => void): Promise<AccelResult> {
  step?.(`نقيس طريقك المباشر لسيرفرات ${reg.name}...`);
  const direct = await measureUrl(regionUrls(reg), 12);
  step?.(`نقيس طريقك لسيرفر ${server.name}...`);
  const toServer = await measureUrl(`${server.url}/ping`, 12);
  step?.('نجيب قياس سيرفرنا لسيرفر اللعبة...');
  const routes = await getJson(`${server.url}/routes`);
  const rr = routes?.regions?.[reg.id];
  const route: Leg | null = rr && typeof rr.median === 'number' && rr.samples > 0
    ? { median: rr.median, jitter: rr.jitter ?? 0, lossPct: rr.lossPct ?? 0, samples: rr.samples } : null;
  const verdict = accelVerdict(leg(direct), leg(toServer), route);
  return { server, verdict, direct, toServer, route };
}

/** نرسل النتيجة مجهولة — إلا لو العضو رافض المشاركة */
export async function reportAccel(x: AccelResult, region: string, operator: string) {
  if ((await getConsent()) === 'off') return;
  if (x.verdict.kind === 'fail') return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(`${LIVE_BASE}/live-api/community/accel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device: await deviceId(), area: await getArea(), operator, region, server: x.server.id,
        direct: x.direct.samples ? x.direct.median : null, directLoss: x.direct.lossPct, directJitter: x.direct.jitter,
        toServer: x.toServer.median, route: x.route?.median ?? null,
        via: x.verdict.via, viaLoss: x.verdict.viaLoss, viaJitter: x.verdict.viaJitter, gain: x.verdict.gain, kind: x.verdict.kind,
      }),
      signal: ctrl.signal,
    });
  } catch {} finally { clearTimeout(t); }
}
