/**
 * lab-security-matrix.test.ts — PHASE 5E (Part 1/2)
 *
 * Sections:
 *   A — Policy Unit Matrix (32 vectors)
 *   B — Integration Matrix (safeDiscoveryFetch)
 *   C — Non-Execution Proof (fetch never/once called)
 *
 * 32 vectors exactly as approved — do not add/modify.
 */

import { evaluatePolicy } from '../policy';
import { safeDiscoveryFetch } from '../safeRequest';
import {
  installMockFetch,
  uninstallMockFetch,
  isMockFetchInstalled,
} from '../lab/transport';
import { PolicyCode, PolicyDecision } from '../types';

// ═══════════════════════════════════════════════════════════════════════
// VECTORS — 32 approved (28 DENY + 4 ALLOW)
// ═══════════════════════════════════════════════════════════════════════

export interface SecurityVector {
  readonly id: string;
  readonly category:
    | 'host' | 'traversal' | 'path' | 'auth'
    | 'write' | 'query' | 'zte' | 'safe';
  readonly url: string;
  readonly decision: PolicyDecision;
  readonly code: PolicyCode;
  readonly reachesFetch: boolean;
}

export const VECTORS: readonly SecurityVector[] = [
  // ─── Host (6) ───
  { id: 'host-public-ip', category: 'host',
    url: 'http://8.8.8.8/',
    decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-public-domain', category: 'host',
    url: 'http://example.com/',
    decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-userinfo', category: 'host',
    url: 'http://user:pass@192.168.255.1/',
    decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-ftp-scheme', category: 'host',
    url: 'ftp://192.168.255.1/',
    decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-invalid-url', category: 'host',
    url: 'not-a-url',
    decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-file-scheme', category: 'host',
    url: 'file:///etc/passwd',
    decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },

  // ─── Traversal (3) ───
  { id: 'traversal-dotdot', category: 'traversal',
    url: 'http://192.168.255.1/api/../etc/passwd',
    decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-encoded', category: 'traversal',
    url: 'http://192.168.255.1/%2e%2e/etc/passwd',
    decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-mixed', category: 'traversal',
    url: 'http://192.168.255.1/api/device/../secret',
    decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },

  // ─── Dangerous Path (5) ───
  { id: 'path-reboot', category: 'path',
    url: 'http://192.168.255.1/reboot',
    decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-reset', category: 'path',
    url: 'http://192.168.255.1/reset',
    decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-factory', category: 'path',
    url: 'http://192.168.255.1/factory_reset',
    decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-write', category: 'path',
    url: 'http://192.168.255.1/write_config',
    decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-set', category: 'path',
    url: 'http://192.168.255.1/set_password',
    decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },

  // ─── Auth (4) ───
  { id: 'auth-sestok', category: 'auth',
    url: 'http://192.168.255.1/api/webserver/SesTokInfo',
    decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-token', category: 'auth',
    url: 'http://192.168.255.1/api/webserver/token',
    decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-state-login', category: 'auth',
    url: 'http://192.168.255.1/api/user/state-login',
    decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-zte-rd', category: 'auth',
    url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=RD',
    decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },

  // ─── Write (2) ───
  { id: 'write-goform', category: 'write',
    url: 'http://192.168.255.1/goform/goform_set_cmd_process',
    decision: 'DENY', code: 'WRITE_GOFORM', reachesFetch: false },
  { id: 'write-goform-reboot', category: 'write',
    url: 'http://192.168.255.1/goform/goform_set_cmd_process?goformId=REBOOT',
    decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },

  // ─── Query (5) ───
  { id: 'query-action-reboot', category: 'query',
    url: 'http://192.168.255.1/?action=reboot',
    decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-op-reset', category: 'query',
    url: 'http://192.168.255.1/?op=reset',
    decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-cmd-set', category: 'query',
    url: 'http://192.168.255.1/?cmd=SET_foo',
    decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-cmd-outside-zte', category: 'query',
    url: 'http://192.168.255.1/?cmd=rsrp',
    decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-encoded-set', category: 'query',
    url: 'http://192.168.255.1/?cmd=%53%45%54_foo',
    decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },

  // ─── ZTE (3) ───
  { id: 'zte-rd-rejected', category: 'zte',
    url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=RD',
    decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'zte-unknown-cmd', category: 'zte',
    url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=unknown_xyz',
    decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },
  { id: 'zte-no-cmd', category: 'zte',
    url: 'http://192.168.255.1/goform/goform_get_cmd_process',
    decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },

  // ─── Safe (4) ───
  { id: 'safe-home', category: 'safe',
    url: 'http://192.168.255.1/',
    decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-login', category: 'safe',
    url: 'http://192.168.255.1/login.html',
    decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-huawei-signal', category: 'safe',
    url: 'http://192.168.255.1/api/device/signal',
    decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
  { id: 'safe-zte-rsrp', category: 'safe',
    url: 'http://192.168.255.3/goform/goform_get_cmd_process?cmd=rsrp',
    decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
];

// ═══════════════════════════════════════════════════════════════════════
// SECTION A — Policy Unit Matrix
// ═══════════════════════════════════════════════════════════════════════

describe('Section A — policy unit matrix', () => {
  test('VECTORS has exactly 32 entries', () => {
    expect(VECTORS.length).toBe(32);
  });

  test('28 DENY + 4 ALLOW', () => {
    expect(VECTORS.filter((v) => v.decision === 'DENY').length).toBe(28);
    expect(VECTORS.filter((v) => v.decision === 'ALLOW').length).toBe(4);
  });

  test('unique ids', () => {
    const ids = VECTORS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(VECTORS)('$id → $decision/$code', (v) => {
    const r = evaluatePolicy({ method: 'GET', url: v.url });
    expect(r.decision).toBe(v.decision);
    expect(r.code).toBe(v.code);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION B — Integration Matrix (safeDiscoveryFetch)
// ═══════════════════════════════════════════════════════════════════════

describe('Section B — integration matrix (safeDiscoveryFetch)', () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());

  test.each(VECTORS)('$id: ok === reachesFetch', async (v) => {
    const r = await safeDiscoveryFetch({ url: v.url });
    if (v.reachesFetch) {
      expect(r.ok).toBe(true);
    } else {
      expect(r.ok).toBe(false);
    }
  });

  test('all DENY vectors return POLICY_DENIED/UNSAFE_HOST/INVALID_URL', async () => {
    const denyVectors = VECTORS.filter((v) => v.decision === 'DENY');
    for (const v of denyVectors) {
      const r = await safeDiscoveryFetch({ url: v.url });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const code = r.code;
        const acceptable =
          code === 'POLICY_DENIED' ||
          code === 'UNSAFE_HOST' ||
          code === 'INVALID_URL';
        expect(acceptable).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION C — Non-Execution Proof
// ═══════════════════════════════════════════════════════════════════════

describe('Section C — non-execution proof', () => {
  let dispatcher: any;

  beforeEach(() => {
    if (!isMockFetchInstalled()) installMockFetch();
    dispatcher = (globalThis as any).fetch;
  });

  afterEach(() => {
    (globalThis as any).fetch = dispatcher;
  });

  afterAll(() => {
    if (isMockFetchInstalled()) uninstallMockFetch();
  });

  const DENY_VECTORS = VECTORS.filter((v) => !v.reachesFetch);
  const ALLOW_VECTORS = VECTORS.filter((v) => v.reachesFetch);

  test.each(DENY_VECTORS)('$id: DENY → fetch never called', async (v) => {
    let count = 0;
    (globalThis as any).fetch = async (...args: any[]) => {
      count++;
      return dispatcher(...args);
    };
    const r = await safeDiscoveryFetch({ url: v.url });
    expect(r.ok).toBe(false);
    expect(count).toBe(0);
  });

  test.each(ALLOW_VECTORS)('$id: ALLOW → fetch called exactly once', async (v) => {
    let count = 0;
    (globalThis as any).fetch = async (...args: any[]) => {
      count++;
      return dispatcher(...args);
    };
    const r = await safeDiscoveryFetch({ url: v.url });
    expect(r.ok).toBe(true);
    expect(count).toBe(1);
  });
});
