/**
 * اختبار سرعة الإنترنت (تحميل + رفع + بنق) عبر خوادم Cloudflare — ما يضغط على سيرفرنا.
 * الجوال متصل بواي فاي الراوتر، فالنتيجة = سرعة إنترنت الراوتر (محدودة بقوة الواي فاي).
 * كل مرحلة ~٧ ثواني، بسقف للاستهلاك.
 */
const DOWN = 'https://speed.cloudflare.com/__down?bytes=';
const UP = 'https://speed.cloudflare.com/__up';

export interface LiveSpeed { down: number; up: number; ping: number; at: number; mb: number }
export type SpeedPhase = 'ping' | 'down' | 'up';

const now = () => Date.now();

async function pingMs(): Promise<number> {
  const v: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = now();
    try { const r = await fetch(`${DOWN}0&r=${Math.random()}`, { cache: 'no-store' as RequestCache }); await r.text(); v.push(now() - t); }
    catch {}
  }
  if (!v.length) throw new Error('ما فيه اتصال بالإنترنت');
  v.sort((a, b) => a - b);
  return v.slice(1).length ? v[1] : v[0];   // نتجاهل أول قياس (فتح الاتصال)
}

/** يشغّل عدة خيوط متوازية لمدة محددة ويرجع Mbps */
function run(kind: 'down' | 'up', ms: number, maxBytes: number, onLive: (mbps: number) => void, cancel: () => boolean) {
  return new Promise<{ mbps: number; bytes: number }>(resolve => {
    const THREADS = 3;
    const loaded: number[] = Array(THREADS).fill(0);
    const done: number[] = Array(THREADS).fill(0);
    const xhrs: (XMLHttpRequest | null)[] = Array(THREADS).fill(null);
    const payload = kind === 'up' ? makePayload(1_000_000) : '';
    let t0 = 0;
    let finished = false;
    const total = () => loaded.reduce((a, b) => a + b, 0) + done.reduce((a, b) => a + b, 0);
    const mbps = () => { const s = (now() - t0) / 1000; return s > 0.2 ? (total() * 8) / s / 1e6 : 0; };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(iv);
      const r = { mbps: mbps(), bytes: total() };
      xhrs.forEach(x => { try { x?.abort(); } catch {} });
      resolve(r);
    };
    const start = (i: number) => {
      if (finished) return;
      const x = new XMLHttpRequest();
      xhrs[i] = x;
      loaded[i] = 0;
      const onProg = (e: any) => { if (!t0) t0 = now(); loaded[i] = e.loaded || 0; };
      if (kind === 'down') {
        x.open('GET', `${DOWN}25000000&r=${Math.random()}`);
        x.responseType = 'blob';
        x.onprogress = onProg;
      } else {
        x.open('POST', UP);
        x.setRequestHeader('Content-Type', 'text/plain');
        if (x.upload) x.upload.onprogress = onProg;
      }
      x.onload = () => {
        if (!t0) t0 = now();
        done[i] += kind === 'down' ? Math.max(loaded[i], 0) : payload.length;
        loaded[i] = 0;
        start(i);
      };
      x.onerror = () => { loaded[i] = 0; setTimeout(() => start(i), 300); };
      x.send(kind === 'up' ? payload : null);
    };
    const tStart = now();
    for (let i = 0; i < THREADS; i++) start(i);
    const iv = setInterval(() => {
      if (t0) onLive(mbps());
      const el = now() - (t0 || tStart);
      if (cancel() || total() >= maxBytes || el >= ms || now() - tStart > ms + 6000) finish();
    }, 250);
  });
}

function makePayload(n: number) {
  // نص عشوائي (ما ينضغط) — نبنيه مرة وحدة
  const chunk = Array.from({ length: 4096 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join('');
  return chunk.repeat(Math.ceil(n / chunk.length)).slice(0, n);
}

export async function speedTest(onPhase: (p: SpeedPhase, liveMbps?: number) => void, cancel: () => boolean = () => false): Promise<LiveSpeed> {
  onPhase('ping');
  const ping = await pingMs();
  onPhase('down', 0);
  const d = await run('down', 7000, 120_000_000, m => onPhase('down', m), cancel);
  if (cancel()) throw new Error('انلغى');
  onPhase('up', 0);
  const u = await run('up', 6000, 40_000_000, m => onPhase('up', m), cancel);
  if (d.bytes < 50_000) throw new Error('ما قدرنا نقيس التحميل — تأكد من النت');
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { down: r1(d.mbps), up: r1(u.mbps), ping: Math.round(ping), at: Date.now(), mb: Math.round((d.bytes + u.bytes) / 1e6) };
}

export const fmtMbps = (v?: number) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
