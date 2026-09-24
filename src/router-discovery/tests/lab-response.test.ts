/**
 * lab-response.test.ts — PHASE 5C
 */

import { buildMockResponse } from '../lab/response';

const BASE = {
  status: 200,
  url: 'http://192.168.255.1/test',
  contentType: 'text/plain',
  body: 'hello',
};

describe('buildMockResponse — basic fields', () => {
  test('status preserved', () => {
    expect(buildMockResponse(BASE).status).toBe(200);
  });
  test('url preserved', () => {
    expect(buildMockResponse(BASE).url).toBe('http://192.168.255.1/test');
  });
  test('status 302 preserved', () => {
    expect(buildMockResponse({ ...BASE, status: 302 }).status).toBe(302);
  });
});

describe('buildMockResponse — headers', () => {
  test('content-type readable', () => {
    expect(buildMockResponse(BASE).headers.get('content-type')).toBe('text/plain');
  });
  test('content-type case-insensitive', () => {
    const r = buildMockResponse(BASE);
    expect(r.headers.get('Content-Type')).toBe('text/plain');
    expect(r.headers.get('CONTENT-TYPE')).toBe('text/plain');
  });
  test('content-length = ASCII byte length', () => {
    expect(buildMockResponse(BASE).headers.get('content-length')).toBe('5');
  });
  test('content-length = Unicode byte length', () => {
    const r = buildMockResponse({ ...BASE, body: 'مرحبا' });
    const cl = parseInt(r.headers.get('content-length')!, 10);
    expect(cl).toBeGreaterThan(5);
  });
  test('extra headers included', () => {
    const r = buildMockResponse({ ...BASE, extraHeaders: { location: '/x' } });
    expect(r.headers.get('location')).toBe('/x');
  });
  test('unknown header returns null', () => {
    expect(buildMockResponse(BASE).headers.get('nonexistent')).toBeNull();
  });
});

describe('buildMockResponse — body stream', () => {
  test('getReader returns reader with read/cancel', () => {
    const r = buildMockResponse(BASE) as any;
    const reader = r.body.getReader();
    expect(typeof reader.read).toBe('function');
    expect(typeof reader.cancel).toBe('function');
  });

  test('reads full small body in one chunk then done', async () => {
    const r = buildMockResponse(BASE) as any;
    const reader = r.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value.byteLength).toBe(5);
    const second = await reader.read();
    expect(second.done).toBe(true);
  });

  test('large body split into multiple chunks', async () => {
    const big = 'x'.repeat(10000);
    const r = buildMockResponse({ ...BASE, body: big }) as any;
    const reader = r.body.getReader();
    let chunks = 0;
    let total = 0;
    for (;;) {
      const c = await reader.read();
      if (c.done) break;
      chunks++;
      total += c.value.byteLength;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(total).toBe(10000);
  });

  test('empty body yields done immediately', async () => {
    const r = buildMockResponse({ ...BASE, body: '' }) as any;
    const reader = r.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(true);
  });

  test('cancel stops reading', async () => {
    const r = buildMockResponse({ ...BASE, body: 'x'.repeat(10000) }) as any;
    const reader = r.body.getReader();
    await reader.read();
    await reader.cancel();
    const after = await reader.read();
    expect(after.done).toBe(true);
  });

  test('body is not truncated (5000 bytes) → full', async () => {
    const big = 'a'.repeat(5000);
    const r = buildMockResponse({ ...BASE, body: big }) as any;
    const reader = r.body.getReader();
    let total = 0;
    for (;;) {
      const c = await reader.read();
      if (c.done) break;
      total += c.value.byteLength;
    }
    expect(total).toBe(5000);
  });
});

describe('buildMockResponse — text / arrayBuffer', () => {
  test('text returns original string', async () => {
    const r = buildMockResponse(BASE);
    expect(await r.text()).toBe('hello');
  });
  test('arrayBuffer has correct byte length', async () => {
    const r = buildMockResponse(BASE);
    const buf = await r.arrayBuffer();
    expect(buf.byteLength).toBe(5);
  });
  test('Unicode preserved in text', async () => {
    const body = 'راوتر LTE';
    const r = buildMockResponse({ ...BASE, body });
    expect(await r.text()).toBe(body);
  });
  test('Unicode arrayBuffer byte length matches UTF-8 size', async () => {
    const body = 'مرحبا';
    const r = buildMockResponse({ ...BASE, body });
    const buf = await r.arrayBuffer();
    expect(buf.byteLength).toBe(new TextEncoder().encode(body).byteLength);
  });
});
