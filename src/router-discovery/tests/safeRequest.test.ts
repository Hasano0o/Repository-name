/**
 * safeRequest.test.ts — PHASE 3
 * Mock globalThis.fetch. No Router Lab. No real network.
 */

import { safeDiscoveryFetch } from '../safeRequest';

const LAN = '192.168.1.1';

const originalFetch = global.fetch;

function makeRes(opts: {
  status?: number;
  url?: string;
  contentType?: string;
  body?: string;
  contentLength?: number;
  noStream?: boolean;
}): Response {
  const bodyStr = opts.body ?? '';
  const bodyBytes = new TextEncoder().encode(bodyStr);
  const headers = new Map<string, string>();
  if (opts.contentType !== undefined) headers.set('content-type', opts.contentType);
  if (opts.contentLength !== undefined) headers.set('content-length', String(opts.contentLength));

  let idx = 0;
  const chunkSize = 4096;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bodyBytes.length; i += chunkSize) {
    chunks.push(bodyBytes.slice(i, i + chunkSize));
  }

  const stream = {
    getReader() {
      return {
        read: async () => {
          if (idx >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[idx++] };
        },
        cancel: async () => { idx = chunks.length; },
      };
    },
  };

  const res: any = {
    status: opts.status ?? 200,
    url: opts.url ?? `http://${LAN}/`,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: opts.noStream ? null : stream,
    arrayBuffer: async () => bodyBytes.buffer,
    text: async () => bodyStr,
  };
  return res as Response;
}

describe('safeDiscoveryFetch', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });
  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  // ─── Policy integration ───
  test('DENY path → fetch not called, POLICY_DENIED', async () => {
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/reboot` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('POLICY_DENIED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('ALLOW path → fetch called once', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: '<html></html>', contentType: 'text/html' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('REQUIRE_USER_CONFIRMATION → fetch not called', async () => {
    fetchMock.mockClear();
    const r = await safeDiscoveryFetch({
      url: `http://${LAN}/`,
      context: { hasAuth: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.requiresConfirmation).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── credentials ───
  test('credentials: omit', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'x', contentType: 'text/plain' }));
    await safeDiscoveryFetch({ url: `http://${LAN}/` });
    const init = fetchMock.mock.calls[0][1];
    expect(init.credentials).toBe('omit');
    expect(init.credentials).not.toBe('include');
    expect(init.credentials).not.toBe('same-origin');
  });

  // ─── headers ───
  test('no Cookie / Authorization / X-Auth-Token / X-CSRF-Token', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'x', contentType: 'text/plain' }));
    await safeDiscoveryFetch({ url: `http://${LAN}/` });
    const init = fetchMock.mock.calls[0][1];
    const h = init.headers || {};
    expect(h.Cookie).toBeUndefined();
    expect(h.Authorization).toBeUndefined();
    expect(h['X-Auth-Token']).toBeUndefined();
    expect(h['X-CSRF-Token']).toBeUndefined();
  });

  // ─── methods ───
  test('POST/PUT/PATCH/DELETE/OPTIONS/HEAD rejected at caller (input is GET only)', async () => {
    // safeDiscoveryFetch has no method field — always GET
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'x', contentType: 'text/plain' }));
    await safeDiscoveryFetch({ url: `http://${LAN}/` });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('GET');
  });

  // ─── authentication ───
  test('RD / LD rejected', async () => {
    const r = await safeDiscoveryFetch({
      url: `http://${LAN}/goform/goform_get_cmd_process?cmd=RD`,
    });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('SesTokInfo rejected', async () => {
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/api/webserver/SesTokInfo` });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('state-login rejected', async () => {
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/api/user/state-login` });
    expect(r.ok).toBe(false);
  });

  // ─── dangerous GET ───
  test.each(['/reboot', '/reset', '/config', '/set', '/save', '/apply', '/delete'])(
    'dangerous GET %s rejected',
    async (p) => {
      const r = await safeDiscoveryFetch({ url: `http://${LAN}${p}` });
      expect(r.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  // ─── ZTE ───
  test('goform_set_cmd_process rejected', async () => {
    const r = await safeDiscoveryFetch({
      url: `http://${LAN}/goform/goform_set_cmd_process`,
    });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('goform_get_cmd_process?cmd=rsrp → ALLOWED', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: '{"rsrp":"-85"}', contentType: 'application/json' }));
    const r = await safeDiscoveryFetch({
      url: `http://${LAN}/goform/goform_get_cmd_process?cmd=rsrp`,
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── cmd outside ZTE ───
  test('?cmd=rsrp outside ZTE read path → DENY', async () => {
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/?cmd=rsrp` });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── host ───
  test('8.8.8.8 rejected', async () => {
    const r = await safeDiscoveryFetch({ url: 'http://8.8.8.8/' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNSAFE_HOST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('example.com rejected', async () => {
    const r = await safeDiscoveryFetch({ url: 'http://example.com/' });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── response content-types ───
  test('JSON allowed + parsed successfully', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: '{"rsrp":"-85"}',
      contentType: 'application/json; charset=utf-8',
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toContain('rsrp');
  });

  test('XML allowed', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: '<x/>', contentType: 'application/xml' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
  });

  test('HTML allowed', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: '<html></html>', contentType: 'text/html' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
  });

  test('plain text allowed', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'hello', contentType: 'text/plain' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
  });

  test('unsupported content-type rejected', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'x', contentType: 'application/octet-stream' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNSUPPORTED_CONTENT_TYPE');
  });

  test('oversized Content-Length rejected before reading', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'x', contentType: 'text/plain', contentLength: 5_000_000,
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('RESPONSE_TOO_LARGE');
  });

  test('oversized body rejected during read', async () => {
    const big = 'x'.repeat(1024 * 1024 + 100);
    fetchMock.mockResolvedValueOnce(makeRes({ body: big, contentType: 'text/plain' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('RESPONSE_TOO_LARGE');
  });

  test('no ReadableStream → RESPONSE_STREAM_UNAVAILABLE (no unbounded fallback)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'some body that should never be read',
      contentType: 'text/plain',
      noStream: true,
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('RESPONSE_STREAM_UNAVAILABLE');
  });

  test('no ReadableStream does NOT call .text() or .arrayBuffer()', async () => {
    const textSpy = jest.fn().mockResolvedValue('unsafe');
    const abSpy = jest.fn().mockResolvedValue(new ArrayBuffer(10));
    const fakeRes: any = {
      status: 200,
      url: `http://${LAN}/`,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
      body: null,
      text: textSpy,
      arrayBuffer: abSpy,
    };
    fetchMock.mockResolvedValueOnce(fakeRes);
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    expect(textSpy).not.toHaveBeenCalled();
    expect(abSpy).not.toHaveBeenCalled();
  });

  test('no ReadableStream → RESPONSE_STREAM_UNAVAILABLE (no unbounded fallback)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'some body that should never be read',
      contentType: 'text/plain',
      noStream: true,
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('RESPONSE_STREAM_UNAVAILABLE');
  });

  test('no ReadableStream does NOT call .text() or .arrayBuffer()', async () => {
    const textSpy = jest.fn().mockResolvedValue('unsafe');
    const abSpy = jest.fn().mockResolvedValue(new ArrayBuffer(10));
    const fakeRes: any = {
      status: 200,
      url: `http://${LAN}/`,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
      body: null,
      text: textSpy,
      arrayBuffer: abSpy,
    };
    fetchMock.mockResolvedValueOnce(fakeRes);
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    expect(textSpy).not.toHaveBeenCalled();
    expect(abSpy).not.toHaveBeenCalled();
  });

  test('no ReadableStream → RESPONSE_STREAM_UNAVAILABLE (no unbounded fallback)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'some body that should never be read',
      contentType: 'text/plain',
      noStream: true,
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('RESPONSE_STREAM_UNAVAILABLE');
  });

  test('no ReadableStream does NOT call .text() or .arrayBuffer()', async () => {
    const textSpy = jest.fn().mockResolvedValue('unsafe');
    const abSpy = jest.fn().mockResolvedValue(new ArrayBuffer(10));
    const fakeRes: any = {
      status: 200,
      url: `http://${LAN}/`,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
      body: null,
      text: textSpy,
      arrayBuffer: abSpy,
    };
    fetchMock.mockResolvedValueOnce(fakeRes);
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    expect(textSpy).not.toHaveBeenCalled();
    expect(abSpy).not.toHaveBeenCalled();
  });

  test('empty response OK', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: '', contentType: 'text/plain' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe('');
  });

  // ─── redirect ───
  test('same-host redirect allowed', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'x', contentType: 'text/plain', url: `http://${LAN}/redirected`,
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
  });

  test('redirect to different LAN host blocked', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'x', contentType: 'text/plain', url: 'http://192.168.2.1/',
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REDIRECT_BLOCKED');
  });

  test('redirect to public host blocked', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: 'x', contentType: 'text/plain', url: 'http://8.8.8.8/',
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REDIRECT_BLOCKED');
  });

  // ─── sanitization ───
  test('sanitization: IMEI hidden in JSON response', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: '{"rsrp":"-85","imei":"490154203237518"}',
      contentType: 'application/json',
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toContain('-85');
      expect(r.body).not.toContain('490154203237518');
    }
  });

  test('sanitization: SSID hidden in XML response', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({
      body: '<wifi><SSID>MyWiFi</SSID><rsrp>-85</rsrp></wifi>',
      contentType: 'application/xml',
    }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).not.toContain('MyWiFi');
      expect(r.body).toContain('-85');
    }
  });

  // ─── network error ───
  test('network error returns NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NETWORK_ERROR');
  });

  test('abort returns TIMEOUT', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortErr);
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TIMEOUT');
  });

  // ─── result shape ───
  test('success result has required fields', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ body: 'ok', contentType: 'text/plain' }));
    const r = await safeDiscoveryFetch({ url: `http://${LAN}/` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.status).toBe('number');
      expect(typeof r.contentType).toBe('string');
      expect(typeof r.body).toBe('string');
      expect(typeof r.bodyRawLength).toBe('number');
      expect(typeof r.ms).toBe('number');
      expect(typeof r.policyCode).toBe('string');
    }
  });
});
