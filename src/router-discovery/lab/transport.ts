/**
 * Router Lab — Mock HTTP Transport — PHASE 5C
 *
 * ⚠️ DEV-ONLY MODULE — not exported from lab/index.ts.
 * Caller is responsible for guarding with __DEV__.
 *
 * Replaces globalThis.fetch with a dispatcher:
 *   - Mock hosts (MOCK_HOSTS) → MockRouter → Mock Response
 *   - Any other host → original fetch (transparent passthrough)
 *
 * This module does NOT decide safety. Policy is evaluated by
 * safeRequest.ts BEFORE fetch is called. For non-GET or DENY paths,
 * fetch is never reached.
 */

import { createMockRouter } from './router';
import { getProfileForHost, isMockHost } from './hosts';
import { buildMockResponse } from './response';

let originalFetch: typeof fetch | null = null;
let installed = false;

export interface InstallResult {
  readonly installed: boolean;
  readonly previousHadFetch: boolean;
}

function extractUrlString(input: any): string | null {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    if (typeof input.url === 'string') return input.url;
    if (typeof input.href === 'string') return input.href;
  }
  return null;
}

/**
 * Resolves a Location header against a base URL.
 * Handles absolute, root-relative, and parent-relative paths.
 * The transport does NOT decide safety — it only simulates HTTP.
 */
export function resolveRedirectUrl(location: string, baseUrl: string): string {
  if (!location) return baseUrl;
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

export function isMockFetchInstalled(): boolean {
  return installed;
}

export function installMockFetch(): InstallResult {
  if (installed) {
    return { installed: true, previousHadFetch: true };
  }
  const g = globalThis as any;
  const prev = g.fetch;
  const previousHadFetch = typeof prev === 'function';
  originalFetch = previousHadFetch ? prev : null;

  g.fetch = async (input: any, init?: any) => {
    let urlStr: string | null = null;
    try {
      urlStr = extractUrlString(input);
      if (!urlStr) {
        if (!originalFetch) {
          throw new Error('mock transport: no URL and no original fetch');
        }
        return originalFetch(input, init);
      }
      let url: URL;
      try {
        url = new URL(urlStr);
      } catch {
        if (!originalFetch) {
          throw new Error('mock transport: invalid URL and no original fetch');
        }
        return originalFetch(input, init);
      }
      const host = url.hostname;
      if (!isMockHost(host)) {
        if (!originalFetch) {
          throw new Error('mock transport: original fetch unavailable');
        }
        return originalFetch(input, init);
      }
      const profile = getProfileForHost(host);
      if (!profile) {
        if (!originalFetch) {
          throw new Error('mock transport: profile missing');
        }
        return originalFetch(input, init);
      }
      const router = createMockRouter(profile);
      const lookup = router.lookup(url.pathname);
      if (!lookup.matched || !lookup.response) {
        return buildMockResponse({
          status: 404,
          url: url.toString(),
          contentType: 'text/plain',
          body: 'Not Found',
        });
      }
      const r = lookup.response;
      let finalUrl = url.toString();
      if (r.status >= 300 && r.status < 400 && r.headers?.location) {
        finalUrl = resolveRedirectUrl(r.headers.location, url.toString());
      }
      return buildMockResponse({
        status: r.status,
        url: finalUrl,
        contentType: r.contentType,
        body: r.body,
        extraHeaders: r.headers,
      });
    } catch (e) {
      if (!originalFetch) throw e;
      return originalFetch(input, init);
    }
  };

  installed = true;
  return { installed: true, previousHadFetch };
}

export function uninstallMockFetch(): void {
  if (!installed) return;
  const g = globalThis as any;
  if (originalFetch) {
    g.fetch = originalFetch;
  } else {
    delete g.fetch;
  }
  originalFetch = null;
  installed = false;
}
