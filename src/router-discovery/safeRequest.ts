/**
 * safeDiscoveryFetch — PHASE 3
 *
 * البوابة الوحيدة لشبكة Discovery.
 * كل request يمر عبر:
 *   URL validation → Policy → credentials:omit → Safe headers
 *   → fetch → redirect check → content-length check
 *   → content-type check → bounded read → sanitize → result
 *
 * لا يستخدم credentials, لا يرسل Authorization, لا ينفذ login.
 * GET فقط. لا bypass. لا headers عشوائية.
 */

import { isLanHost } from '../utils/host';
import { evaluatePolicy } from './policy';
import { sanitize } from './sanitize';
import { PolicyContext } from './types';

export type SafeFetchErrorCode =
  | 'POLICY_DENIED'
  | 'UNSAFE_HOST'
  | 'INVALID_URL'
  | 'RESPONSE_TOO_LARGE'
  | 'RESPONSE_STREAM_UNAVAILABLE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'REDIRECT_BLOCKED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE';

export interface SafeFetchSuccess {
  ok: true;
  status: number;
  contentType: string;
  body: string;
  bodyRawLength: number;
  ms: number;
  redirected: boolean;
  policyCode: string;
}

export interface SafeFetchFailure {
  ok: false;
  code: SafeFetchErrorCode;
  reason: string;
  requiresConfirmation?: boolean;
  status?: number;
  ms: number;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

export interface SafeFetchInput {
  url: string;
  context?: PolicyContext;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'text/plain',
  'text/xml',
  'text/javascript',
  'application/json',
  'application/xml',
  'application/javascript',
]);

function baseContentType(ct: string): string {
  return (ct || '').split(';')[0].trim().toLowerCase();
}
function contentTypeAllowed(ct: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(baseContentType(ct));
}

type ReadOutcome =
  | { kind: 'ok'; text: string; bytes: number }
  | { kind: 'exceeded' }
  | { kind: 'unavailable' }
  | { kind: 'readError' };

async function readBounded(
  res: Response,
  maxBytes: number,
): Promise<ReadOutcome> {
  const body: any = (res as any).body;
  if (!body || typeof body.getReader !== 'function') {
    // Hard requirement: never fall back to unbounded reads.
    // If the runtime does not expose ReadableStream, refuse the body.
    return { kind: 'unavailable' };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          return { kind: 'exceeded' };
        }
        chunks.push(value);
      }
    }
  } catch {
    try { await reader.cancel(); } catch {}
    return { kind: 'readError' };
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
  return { kind: 'ok', text, bytes: total };
}

export async function safeDiscoveryFetch(
  input: SafeFetchInput,
): Promise<SafeFetchResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  // 1. URL validation
  let reqUrl: URL;
  try {
    reqUrl = new URL(input.url);
  } catch {
    return { ok: false, code: 'INVALID_URL', reason: 'Unparseable URL', ms: Date.now() - started };
  }
  if (!isLanHost(reqUrl.hostname)) {
    return { ok: false, code: 'UNSAFE_HOST', reason: 'Host not LAN', ms: Date.now() - started };
  }

  // 2. Policy
  const decision = evaluatePolicy({
    method: 'GET',
    url: input.url,
    context: input.context,
  });
  if (decision.decision === 'REQUIRE_USER_CONFIRMATION') {
    return {
      ok: false,
      code: 'POLICY_DENIED',
      reason: decision.code + ': ' + decision.reason,
      requiresConfirmation: true,
      ms: Date.now() - started,
    };
  }
  if (decision.decision !== 'ALLOW') {
    return {
      ok: false,
      code: 'POLICY_DENIED',
      reason: decision.code + ': ' + decision.reason,
      ms: Date.now() - started,
    };
  }

  // 3. Fetch (GET + omit + safe headers only)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  const fetchOpts: RequestInit = {
    method: 'GET',
    credentials: 'omit',
    redirect: 'follow',
    signal: ctrl.signal,
    // No custom headers — Discovery sends the absolute minimum.
  };
  // PHASE 5I — Discovery credentials invariant (dev-only, documentation-in-code).
  // This is NOT a network-layer guarantee. See docs/security-gate-closure.md.
  if (__DEV__ && fetchOpts.credentials !== 'omit') {
    // eslint-disable-next-line no-console
    console.warn(
      '[safeRequest] SECURITY: credentials must remain "omit" for discovery',
    );
  }
  try {
    res = await fetch(input.url, fetchOpts);
  } catch (e: any) {
    clearTimeout(timer);
    const isAbort = e?.name === 'AbortError';
    return {
      ok: false,
      code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
      reason: isAbort ? 'Timed out' : 'Network error',
      ms: Date.now() - started,
    };
  }
  clearTimeout(timer);

  // 3.5. Early redirect block — PHASE 5I
  // React Native fetch may follow redirects. If response.redirected is true,
  // at least one redirect occurred. We refuse to consume the body in that
  // case, regardless of the final URL. This is stricter than the URL-based
  // checks below (which are retained as additional defense-in-depth).
  if ((res as any).redirected === true) {
    return {
      ok: false,
      code: 'REDIRECT_BLOCKED',
      reason: 'Redirect detected — response not consumed',
      status: res.status,
      ms: Date.now() - started,
    };
  }

  // 4. Redirect check (post-hoc, RN limitation documented)
  let finalUrl: URL;
  try {
    finalUrl = new URL(res.url || input.url);
  } catch {
    return {
      ok: false,
      code: 'REDIRECT_BLOCKED',
      reason: 'Invalid final URL',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  if (!isLanHost(finalUrl.hostname)) {
    return {
      ok: false,
      code: 'REDIRECT_BLOCKED',
      reason: 'Redirect left LAN',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  if (finalUrl.hostname !== reqUrl.hostname) {
    return {
      ok: false,
      code: 'REDIRECT_BLOCKED',
      reason: 'Redirect changed host',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  const redirected = res.url !== input.url;

  // 5. Content-Length early check
  const cl = res.headers.get('content-length');
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return {
        ok: false,
        code: 'RESPONSE_TOO_LARGE',
        reason: 'Content-Length exceeds limit',
        status: res.status,
        ms: Date.now() - started,
      };
    }
  }

  // 6. Content-Type check
  const rawCt = res.headers.get('content-type') || '';
  if (!contentTypeAllowed(rawCt)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_CONTENT_TYPE',
      reason: 'Content-Type not allowed',
      status: res.status,
      ms: Date.now() - started,
    };
  }

  // 7. Bounded read — strict: no unbounded fallback
  let read: ReadOutcome;
  try {
    read = await readBounded(res, maxBytes);
  } catch {
    return {
      ok: false,
      code: 'MALFORMED_RESPONSE',
      reason: 'Failed to read body',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  if (read.kind === 'unavailable') {
    return {
      ok: false,
      code: 'RESPONSE_STREAM_UNAVAILABLE',
      reason: 'ReadableStream not available — refusing unbounded read',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  if (read.kind === 'exceeded') {
    return {
      ok: false,
      code: 'RESPONSE_TOO_LARGE',
      reason: 'Body exceeds limit',
      status: res.status,
      ms: Date.now() - started,
    };
  }
  if (read.kind === 'readError') {
    return {
      ok: false,
      code: 'MALFORMED_RESPONSE',
      reason: 'Stream read error',
      status: res.status,
      ms: Date.now() - started,
    };
  }

  // 8. Sanitize
  const safeBody = sanitize(read.text);

  return {
    ok: true,
    status: res.status,
    contentType: baseContentType(rawCt),
    body: safeBody,
    bodyRawLength: read.bytes,
    ms: Date.now() - started,
    redirected,
    policyCode: decision.code,
  };
}
