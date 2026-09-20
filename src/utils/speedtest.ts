export interface SpeedResult {
  pingMs: number;
  downloadMbps: number;
  uploadMbps: number;
}

async function timed(url: string, init: RequestInit = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function runSpeedTest(): Promise<SpeedResult> {
  const base = 'https://speed.cloudflare.com';
  try {
    const pings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await timed(`${base}/__down?bytes=0&r=${Math.random()}`, {}, 8000);
      await r.text();
      pings.push(Date.now() - t0);
    }

    let start = Date.now();
    const down = await timed(`${base}/__down?bytes=25000000&r=${Math.random()}`);
    const buf = await down.arrayBuffer();
    const downSecs = Math.max((Date.now() - start) / 1000, 0.001);

    const payload = 'x'.repeat(5000000);
    start = Date.now();
    const up = await timed(`${base}/__up?r=${Math.random()}`, { method: 'POST', body: payload });
    await up.text();
    const upSecs = Math.max((Date.now() - start) / 1000, 0.001);

    return {
      pingMs: Math.min(...pings),
      downloadMbps: (buf.byteLength * 8) / downSecs / 1e6,
      uploadMbps: (payload.length * 8) / upSecs / 1e6,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('الاختبار أخذ وقت طويل — الاتصال بطيء أو منقطع');
    throw new Error('تعذر إجراء الاختبار — تأكد إن الإنترنت شغال');
  }
}
