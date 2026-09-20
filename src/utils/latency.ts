export interface LatencyResult {
  median: number;
  min: number;
  jitter: number;
  lossPct: number;
  samples: number;
}

const ENDPOINT = 'https://speed.cloudflare.com/__down?bytes=0';

async function once(timeoutMs: number): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const r = await fetch(`${ENDPOINT}&r=${Math.random()}`, {
      signal: ctrl.signal,
      cache: 'no-store' as RequestCache,
    });
    await r.text();
    return Date.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function measureLatency(n = 12, timeoutMs = 3000): Promise<LatencyResult> {
  const values: number[] = [];
  let lost = 0;

  await once(timeoutMs);

  for (let i = 0; i < n; i++) {
    const v = await once(timeoutMs);
    if (v === null) lost += 1;
    else values.push(v);
    await new Promise(r => setTimeout(r, 120));
  }

  if (!values.length) {
    return { median: 0, min: 0, jitter: 0, lossPct: 100, samples: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];

  let diffs = 0;
  for (let i = 1; i < values.length; i++) diffs += Math.abs(values[i] - values[i - 1]);
  const jitter = values.length > 1 ? Math.round(diffs / (values.length - 1)) : 0;

  return {
    median: Math.round(median),
    min: Math.round(min),
    jitter,
    lossPct: Math.round((lost / n) * 100),
    samples: values.length,
  };
}

export function gamingGrade(r: LatencyResult): { label: string; score: number } {
  if (!r.samples) return { label: 'فشل القياس', score: 0 };
  const p = r.median + r.jitter * 2 + r.lossPct * 8;
  if (p < 60) return { label: 'ممتاز للألعاب', score: 1 };
  if (p < 100) return { label: 'جيد', score: 0.75 };
  if (p < 160) return { label: 'مقبول', score: 0.5 };
  if (p < 250) return { label: 'ضعيف', score: 0.28 };
  return { label: 'سيئ', score: 0.12 };
}
