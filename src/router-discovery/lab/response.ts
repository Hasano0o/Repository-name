/**
 * Router Lab — Mock Response Builder — PHASE 5C
 *
 * Builds a Response-like object compatible with safeDiscoveryFetch.
 * - Does NOT truncate body (safeDiscoveryFetch enforces 1 MB bounded read).
 * - Does NOT decide redirect safety (transport handles URL resolution;
 *   safeRequest.ts validates the final URL).
 * - Provides: status, url, headers.get, body.getReader, arrayBuffer, text
 */

export interface MockResponseInit {
  readonly status: number;
  readonly url: string;
  readonly contentType: string;
  readonly body: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

const CHUNK_SIZE = 4096;

export function buildMockResponse(init: MockResponseInit): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(init.body);

  const headerMap = new Map<string, string>();
  headerMap.set('content-type', init.contentType);
  headerMap.set('content-length', String(bytes.byteLength));
  if (init.extraHeaders) {
    for (const [k, v] of Object.entries(init.extraHeaders)) {
      headerMap.set(k.toLowerCase(), v);
    }
  }

  const makeReader = () => {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
      chunks.push(bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.byteLength)));
    }
    let idx = 0;
    return {
      read: async () => {
        if (idx >= chunks.length) {
          return { done: true as const, value: undefined };
        }
        return { done: false as const, value: chunks[idx++] };
      },
      cancel: async () => { idx = chunks.length; },
    };
  };

  const res: any = {
    status: init.status,
    url: init.url,
    headers: {
      get(name: string): string | null {
        return headerMap.get(name.toLowerCase()) ?? null;
      },
    },
    body: { getReader: makeReader },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
    async text(): Promise<string> {
      return init.body;
    },
  };

  return res as Response;
}
