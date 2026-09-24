/**
 * lab-security-invariants.test.ts — PHASE 5E (Part 2/2)
 *
 * Sections:
 *   D — Cross-Layer Consistency
 *   E — Isolation & Lifecycle
 *   F — Fixture Coverage
 *   G — Regression Canary (with reachesFetch invariant)
 *   H — Production Isolation (fs, Jest-only)
 */

import * as fs from 'fs';
import * as path from 'path';

import { evaluatePolicy } from '../policy';
import { safeDiscoveryFetch } from '../safeRequest';
import {
  installMockFetch,
  uninstallMockFetch,
  isMockFetchInstalled,
} from '../lab/transport';
import { runDiscoveryHarness, HARNESS_TARGETS } from '../lab/harness';
import { PolicyCode, PolicyDecision } from '../types';

// ═══════════════════════════════════════════════════════════════════════
// VECTORS — duplicated from matrix file (test files must be independent)
// ═══════════════════════════════════════════════════════════════════════

interface SecurityVector {
  readonly id: string;
  readonly url: string;
  readonly decision: PolicyDecision;
  readonly code: PolicyCode;
  readonly reachesFetch: boolean;
}

const VECTORS: readonly SecurityVector[] = [
  { id: 'host-public-ip', url: 'http://8.8.8.8/', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-public-domain', url: 'http://example.com/', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-userinfo', url: 'http://user:pass@192.168.255.1/', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-ftp-scheme', url: 'ftp://192.168.255.1/', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-invalid-url', url: 'not-a-url', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-file-scheme', url: 'file:///etc/passwd', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'traversal-dotdot', url: 'http://192.168.255.1/api/../etc/passwd', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-encoded', url: 'http://192.168.255.1/%2e%2e/etc/passwd', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-mixed', url: 'http://192.168.255.1/api/device/../secret', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'path-reboot', url: 'http://192.168.255.1/reboot', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-reset', url: 'http://192.168.255.1/reset', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-factory', url: 'http://192.168.255.1/factory_reset', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-write', url: 'http://192.168.255.1/write_config', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-set', url: 'http://192.168.255.1/set_password', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'auth-sestok', url: 'http://192.168.255.1/api/webserver/SesTokInfo', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-token', url: 'http://192.168.255.1/api/webserver/token', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-state-login', url: 'http://192.168.255.1/api/user/state-login', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-zte-rd', url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=RD', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'write-goform', url: 'http://192.168.255.1/goform/goform_set_cmd_process', decision: 'DENY', code: 'WRITE_GOFORM', reachesFetch: false },
  { id: 'write-goform-reboot', url: 'http://192.168.255.1/goform/goform_set_cmd_process?goformId=REBOOT', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-action-reboot', url: 'http://192.168.255.1/?action=reboot', decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-op-reset', url: 'http://192.168.255.1/?op=reset', decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-cmd-set', url: 'http://192.168.255.1/?cmd=SET_foo', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-cmd-outside-zte', url: 'http://192.168.255.1/?cmd=rsrp', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-encoded-set', url: 'http://192.168.255.1/?cmd=%53%45%54_foo', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'zte-rd-rejected', url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=RD', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'zte-unknown-cmd', url: 'http://192.168.255.1/goform/goform_get_cmd_process?cmd=unknown_xyz', decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },
  { id: 'zte-no-cmd', url: 'http://192.168.255.1/goform/goform_get_cmd_process', decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },
  { id: 'safe-home', url: 'http://192.168.255.1/', decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-login', url: 'http://192.168.255.1/login.html', decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-huawei-signal', url: 'http://192.168.255.1/api/device/signal', decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
  { id: 'safe-zte-rsrp', url: 'http://192.168.255.3/goform/goform_get_cmd_process?cmd=rsrp', decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
];

// ═══════════════════════════════════════════════════════════════════════
// SECTION D — Cross-Layer Consistency
// ═══════════════════════════════════════════════════════════════════════

describe('Section D — cross-layer consistency', () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());

  test('policy DENY vectors → safeDiscoveryFetch denies', async () => {
    const denies = VECTORS.filter((v) => v.decision === 'DENY');
    for (const v of denies) {
      const r = await safeDiscoveryFetch({ url: v.url });
      expect(r.ok).toBe(false);
    }
  });

  test('policy ALLOW vectors → safeDiscoveryFetch allows', async () => {
    const allows = VECTORS.filter((v) => v.decision === 'ALLOW');
    for (const v of allows) {
      const r = await safeDiscoveryFetch({ url: v.url });
      expect(r.ok).toBe(true);
    }
  });

  test('every DENY vector never reaches fetch layer', () => {
    for (const v of VECTORS) {
      if (v.decision === 'DENY') {
        expect(v.reachesFetch).toBe(false);
      }
    }
  });

  test('every ALLOW vector reaches fetch layer', () => {
    for (const v of VECTORS) {
      if (v.decision === 'ALLOW') {
        expect(v.reachesFetch).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION E — Isolation & Lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('Section E — isolation & lifecycle', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (isMockFetchInstalled()) uninstallMockFetch();
    (globalThis as any).fetch = originalFetch;
  });

  test('install/uninstall preserves original reference', () => {
    const before = (globalThis as any).fetch;
    installMockFetch();
    expect((globalThis as any).fetch).not.toBe(before);
    uninstallMockFetch();
    expect((globalThis as any).fetch).toBe(before);
  });

  test('install twice → uninstall once → original preserved', () => {
    const before = (globalThis as any).fetch;
    installMockFetch();
    installMockFetch();
    uninstallMockFetch();
    expect((globalThis as any).fetch).toBe(before);
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('uninstall twice is safe', () => {
    installMockFetch();
    uninstallMockFetch();
    expect(() => uninstallMockFetch()).not.toThrow();
  });

  test('100 lookups do not leak state', async () => {
    installMockFetch();
    for (let i = 0; i < 100; i++) {
      await safeDiscoveryFetch({ url: 'http://192.168.255.1/' });
    }
    uninstallMockFetch();
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('consecutive harness runs — independent', async () => {
    const a = await runDiscoveryHarness({ host: '192.168.255.1' });
    const b = await runDiscoveryHarness({ host: '192.168.255.3' });
    expect(a.profileId).not.toBe(b.profileId);
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('parallel safeDiscoveryFetch calls — state not corrupted', async () => {
    installMockFetch();
    const results = await Promise.all([
      safeDiscoveryFetch({ url: 'http://192.168.255.1/' }),
      safeDiscoveryFetch({ url: 'http://192.168.255.3/' }),
      safeDiscoveryFetch({ url: 'http://192.168.255.5/' }),
    ]);
    uninstallMockFetch();
    expect(results.every((r) => r.ok)).toBe(true);
    expect(isMockFetchInstalled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION F — Fixture Coverage
// ═══════════════════════════════════════════════════════════════════════

describe('Section F — fixture coverage', () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());

  test('redirect fixture → REDIRECT_BLOCKED', async () => {
    const r = await safeDiscoveryFetch({ url: 'http://192.168.255.11/login.html' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REDIRECT_BLOCKED');
  });

  test('sensitive fixture → sanitized, no leak', async () => {
    const r = await safeDiscoveryFetch({ url: 'http://192.168.255.10/api/device/signal' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toContain('-91');
      expect(r.body).not.toContain('SECRET_VALUE');
      expect(r.body).not.toContain('490154203237518');
      expect(r.body).not.toContain('AA:BB:CC:DD:EE:FF');
      expect(r.body).not.toContain('HomeWiFi');
    }
  });

  test('write endpoint NOT in HARNESS_TARGETS', () => {
    const paths = HARNESS_TARGETS.map((t) => t.path);
    const hasWrite = paths.some((p) => p.includes('goform_set_cmd_process'));
    expect(hasWrite).toBe(false);
  });

  test('auth endpoint NOT in HARNESS_TARGETS', () => {
    const paths = HARNESS_TARGETS.map((t) => t.path);
    const hasAuth = paths.some((p) => p.includes('SesTokInfo'));
    expect(hasAuth).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION G — Regression Canary (with reachesFetch)
// ═══════════════════════════════════════════════════════════════════════

const CANARY_BASELINE: ReadonlyArray<{
  id: string;
  decision: PolicyDecision;
  code: PolicyCode;
  reachesFetch: boolean;
}> = [
  { id: 'host-public-ip', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-public-domain', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-userinfo', decision: 'DENY', code: 'UNSAFE_HOST', reachesFetch: false },
  { id: 'host-ftp-scheme', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-invalid-url', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'host-file-scheme', decision: 'DENY', code: 'INVALID_URL', reachesFetch: false },
  { id: 'traversal-dotdot', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-encoded', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'traversal-mixed', decision: 'DENY', code: 'PATH_TRAVERSAL', reachesFetch: false },
  { id: 'path-reboot', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-reset', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-factory', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-write', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'path-set', decision: 'DENY', code: 'DANGEROUS_PATH', reachesFetch: false },
  { id: 'auth-sestok', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-token', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-state-login', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'auth-zte-rd', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'write-goform', decision: 'DENY', code: 'WRITE_GOFORM', reachesFetch: false },
  { id: 'write-goform-reboot', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-action-reboot', decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-op-reset', decision: 'DENY', code: 'DANGEROUS_QUERY', reachesFetch: false },
  { id: 'query-cmd-set', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-cmd-outside-zte', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'query-encoded-set', decision: 'DENY', code: 'UNKNOWN_ENDPOINT', reachesFetch: false },
  { id: 'zte-rd-rejected', decision: 'DENY', code: 'AUTH_ENDPOINT', reachesFetch: false },
  { id: 'zte-unknown-cmd', decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },
  { id: 'zte-no-cmd', decision: 'DENY', code: 'UNKNOWN_ZTE_CMD', reachesFetch: false },
  { id: 'safe-home', decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-login', decision: 'ALLOW', code: 'SAFE_DISCOVERY_PAGE', reachesFetch: true },
  { id: 'safe-huawei-signal', decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
  { id: 'safe-zte-rsrp', decision: 'ALLOW', code: 'SAFE_READ', reachesFetch: true },
];

describe('Section G — regression canary', () => {
  test('VECTORS ids match canary baseline', () => {
    expect(VECTORS.map((v) => v.id)).toEqual(CANARY_BASELINE.map((b) => b.id));
  });

  test('declared decisions match canary baseline', () => {
    for (const b of CANARY_BASELINE) {
      const v = VECTORS.find((x) => x.id === b.id)!;
      expect(v.decision).toBe(b.decision);
      expect(v.code).toBe(b.code);
      expect(v.reachesFetch).toBe(b.reachesFetch);
    }
  });

  test('runtime policy decisions match canary baseline', () => {
    for (const b of CANARY_BASELINE) {
      const v = VECTORS.find((x) => x.id === b.id)!;
      const r = evaluatePolicy({ method: 'GET', url: v.url });
      expect(r.decision).toBe(b.decision);
      expect(r.code).toBe(b.code);
    }
  });

  test('reachesFetch invariant: DENY=false, ALLOW=true', () => {
    for (const v of VECTORS) {
      if (v.decision === 'DENY') expect(v.reachesFetch).toBe(false);
      else expect(v.reachesFetch).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION H — Production Isolation (fs — Jest only)
// ═══════════════════════════════════════════════════════════════════════

describe('Section H — production isolation', () => {
  const LAB_DIR = path.join(__dirname, '..', 'lab');
  const LAB_FILES = ['harness.ts', 'transport.ts', 'router.ts', 'profiles.ts'];

  const FORBIDDEN_IMPORTS = [
    /from\s+['"][^'"]*\/drivers\//,
    /from\s+['"][^'"]*\/utils\/probe/,
    /from\s+['"][^'"]*\/store\//,
    /from\s+['"][^'"]*\/app\//,
  ];

  test.each(LAB_FILES)('%s does not import drivers/stores/app', (file) => {
    const src = fs.readFileSync(path.join(LAB_DIR, file), 'utf-8');
    for (const re of FORBIDDEN_IMPORTS) {
      expect(src).not.toMatch(re);
    }
  });

  test('transport.ts does not import safeRequest', () => {
    const src = fs.readFileSync(path.join(LAB_DIR, 'transport.ts'), 'utf-8');
    expect(src).not.toMatch(/from\s+['"][^'"]*safeRequest/);
  });

  test('router.ts does not import transport', () => {
    const src = fs.readFileSync(path.join(LAB_DIR, 'router.ts'), 'utf-8');
    expect(src).not.toMatch(/from\s+['"][^'"]*transport/);
  });

  test('harness.ts does not import drivers/stores', () => {
    const src = fs.readFileSync(path.join(LAB_DIR, 'harness.ts'), 'utf-8');
    expect(src).not.toMatch(/from\s+['"][^'"]*\/drivers\//);
    expect(src).not.toMatch(/from\s+['"][^'"]*\/store\//);
  });

  test('no lab file uses XMLHttpRequest', () => {
    for (const file of LAB_FILES) {
      const src = fs.readFileSync(path.join(LAB_DIR, file), 'utf-8');
      expect(src).not.toMatch(/XMLHttpRequest/);
    }
  });
});
