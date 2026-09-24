/**
 * lab-core.test.ts — PHASE 5A
 * Pure tests — no React، no network، no storage.
 */

import {
  MockRouter,
  createMockRouter,
  normalizePath,
  HUAWEI_GENERIC,
  ZTE_GENERIC,
  UNKNOWN_GENERIC,
  SENSITIVE_VALUES_FIXTURE,
  REDIRECT_FIXTURE,
  WRITE_ENDPOINT_FIXTURE,
  AUTH_ENDPOINT_FIXTURE,
  NORMAL_PROFILES,
  MALICIOUS_FIXTURES,
  ALL_PROFILES,
  MockRouterProfile,
} from '../lab';

// ═══════════════════════════════════════════════════════════════════════
// normalizePath
// ═══════════════════════════════════════════════════════════════════════

describe('normalizePath', () => {
  test('root stays root', () => expect(normalizePath('/')).toBe('/'));
  test('empty → root', () => expect(normalizePath('')).toBe('/'));
  test('simple path unchanged', () => expect(normalizePath('/api/status')).toBe('/api/status'));
  test('trailing slash stripped', () => expect(normalizePath('/api/status/')).toBe('/api/status'));
  test('root with trailing slash stays root', () => expect(normalizePath('/')).toBe('/'));
  test('query stripped', () => expect(normalizePath('/api/status?x=1')).toBe('/api/status'));
  test('query with multiple params', () =>
    expect(normalizePath('/goform/goform_get_cmd_process?cmd=rsrp&multi_data=1')).toBe(
      '/goform/goform_get_cmd_process',
    ));
  test('only query', () => expect(normalizePath('/?x=1')).toBe('/'));
  test('no leading slash added', () => expect(normalizePath('api/status')).toBe('/api/status'));
  test('non-string → root', () => {
    expect(normalizePath(null as any)).toBe('/');
    expect(normalizePath(undefined as any)).toBe('/');
    expect(normalizePath(123 as any)).toBe('/');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Profile sanity
// ═══════════════════════════════════════════════════════════════════════

describe('profile sanity', () => {
  for (const p of ALL_PROFILES) {
    test(`"${p.id}" has non-empty id`, () => {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
    });

    test(`"${p.id}" has vendor and model`, () => {
      expect(typeof p.vendor).toBe('string');
      expect(p.vendor.length).toBeGreaterThan(0);
      expect(typeof p.model).toBe('string');
      expect(p.model.length).toBeGreaterThan(0);
    });

    test(`"${p.id}" has at least one page`, () => {
      expect(p.pages.length).toBeGreaterThan(0);
    });

    test(`"${p.id}" all responses are GET`, () => {
      for (const r of [...p.pages, ...p.endpoints]) {
        expect(r.method).toBe('GET');
      }
    });

    test(`"${p.id}" all paths start with /`, () => {
      for (const r of [...p.pages, ...p.endpoints]) {
        expect(r.path.startsWith('/')).toBe(true);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// MockRouter construction
// ═══════════════════════════════════════════════════════════════════════

describe('MockRouter construction', () => {
  test('constructs from HUAWEI_GENERIC', () => {
    expect(() => new MockRouter(HUAWEI_GENERIC)).not.toThrow();
  });

  test('createMockRouter returns instance', () => {
    expect(createMockRouter(HUAWEI_GENERIC)).toBeInstanceOf(MockRouter);
  });

  test('profile getter returns same reference', () => {
    const r = new MockRouter(HUAWEI_GENERIC);
    expect(r.profile).toBe(HUAWEI_GENERIC);
  });

  test('throws on duplicate path', () => {
    const bad: MockRouterProfile = {
      id: 'dup',
      vendor: 'X',
      model: 'Y',
      pages: [
        { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: 'a' },
      ],
      endpoints: [
        { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: 'b' },
      ],
    };
    expect(() => new MockRouter(bad)).toThrow(/duplicate/);
  });

  test('throws on duplicate after normalization (trailing slash)', () => {
    const bad: MockRouterProfile = {
      id: 'dup-norm',
      vendor: 'X',
      model: 'Y',
      pages: [
        { method: 'GET', path: '/api/x', status: 200, contentType: 'text/plain', body: 'a' },
      ],
      endpoints: [
        { method: 'GET', path: '/api/x/', status: 200, contentType: 'text/plain', body: 'b' },
      ],
    };
    expect(() => new MockRouter(bad)).toThrow(/duplicate/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MockRouter.lookup
// ═══════════════════════════════════════════════════════════════════════

describe('MockRouter.lookup', () => {
  test('finds homepage', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const res = r.lookup('/');
    expect(res.matched).toBe(true);
    expect(res.response?.status).toBe(200);
  });

  test('finds known endpoint', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const res = r.lookup('/api/device/information');
    expect(res.matched).toBe(true);
    expect(res.response?.contentType).toBe('application/xml');
  });

  test('unknown path → matched:false with reason', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const res = r.lookup('/does/not/exist');
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('NOT_FOUND');
    expect(res.response).toBeUndefined();
  });

  test('query string ignored', () => {
    const r = createMockRouter(ZTE_GENERIC);
    const a = r.lookup('/goform/goform_get_cmd_process');
    const b = r.lookup('/goform/goform_get_cmd_process?cmd=rsrp&multi_data=1');
    expect(a.matched).toBe(true);
    expect(b.matched).toBe(true);
    expect(a.response).toBe(b.response);
  });

  test('trailing slash ignored', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const a = r.lookup('/api/monitoring/status');
    const b = r.lookup('/api/monitoring/status/');
    expect(a.matched).toBe(b.matched);
    expect(a.response).toBe(b.response);
  });

  test('lookup never throws for any input', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    expect(() => r.lookup('')).not.toThrow();
    expect(() => r.lookup('/')).not.toThrow();
    expect(() => r.lookup('/???')).not.toThrow();
    expect(() => r.lookup(null as any)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════════════════════════════

describe('MockRouter — determinism', () => {
  test('same lookup 100 times → identical response', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const first = r.lookup('/api/device/information');
    for (let i = 0; i < 100; i++) {
      const x = r.lookup('/api/device/information');
      expect(x.matched).toBe(first.matched);
      expect(x.response).toBe(first.response);
    }
  });

  test('two routers from same profile → identical responses', () => {
    const r1 = createMockRouter(HUAWEI_GENERIC);
    const r2 = createMockRouter(HUAWEI_GENERIC);
    expect(r1.lookup('/').response).toBe(r2.lookup('/').response);
  });

  test('listPaths is deterministic and sorted', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const a = r.listPaths();
    const b = r.listPaths();
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Non-mutation
// ═══════════════════════════════════════════════════════════════════════

describe('MockRouter — non-mutation', () => {
  test('profile not modified after lookups', () => {
    const snap = JSON.stringify(HUAWEI_GENERIC);
    const r = createMockRouter(HUAWEI_GENERIC);
    r.lookup('/');
    r.lookup('/api/device/information');
    r.lookup('/unknown');
    r.listPaths();
    expect(JSON.stringify(HUAWEI_GENERIC)).toBe(snap);
  });

  test('lookup response is the same object as profile entry', () => {
    const r = createMockRouter(HUAWEI_GENERIC);
    const res = r.lookup('/api/device/information');
    const original = HUAWEI_GENERIC.endpoints.find(
      (e) => e.path === '/api/device/information',
    );
    expect(res.response).toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Normal profiles — clean (no sensitive values)
// ═══════════════════════════════════════════════════════════════════════

const SENSITIVE_RE = [
  /"password"/i,
  /"token"/i,
  /secret/i,
  /"imei"/i,
  /"imsi"/i,
  /"iccid"/i,
  /"mac"/i,
  /"ssid"/i,
  /AA:BB:CC/i,
  /490154203237518/,
];

describe('normal profiles are clean', () => {
  for (const p of NORMAL_PROFILES) {
    test(`"${p.id}" has no sensitive patterns in endpoints`, () => {
      // HTML pages legitimately contain `type="password"` inputs.
      // The sensitive-value invariant applies to API responses (endpoints).
      for (const r of p.endpoints) {
        for (const re of SENSITIVE_RE) {
          expect(r.body).not.toMatch(re);
        }
      }
    });

    test(`"${p.id}" has no auth endpoints`, () => {
      for (const r of [...p.pages, ...p.endpoints]) {
        expect(r.path).not.toContain('SesTokInfo');
        expect(r.path).not.toContain('state-login');
        expect(r.path).not.toContain('webserver/token');
      }
    });

    test(`"${p.id}" has no write endpoints`, () => {
      for (const r of [...p.pages, ...p.endpoints]) {
        expect(r.path).not.toContain('goform_set_cmd_process');
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Malicious fixtures — must contain the intended properties
// ═══════════════════════════════════════════════════════════════════════

describe('malicious fixtures — content sanity', () => {
  test('SENSITIVE_VALUES_FIXTURE has password field', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/status').response?.body).toContain('"password"');
  });

  test('SENSITIVE_VALUES_FIXTURE has token field', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/status').response?.body).toContain('"token"');
  });

  test('SENSITIVE_VALUES_FIXTURE has IMEI', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/status').response?.body).toContain('490154203237518');
  });

  test('SENSITIVE_VALUES_FIXTURE has MAC', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/status').response?.body).toContain('AA:BB:CC:DD:EE:FF');
  });

  test('SENSITIVE_VALUES_FIXTURE has SSID', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/status').response?.body).toContain('HomeWiFi');
  });

  test('REDIRECT_FIXTURE returns 302 with location to public host', () => {
    const r = createMockRouter(REDIRECT_FIXTURE);
    const res = r.lookup('/api/status');
    expect(res.response?.status).toBe(302);
    expect(res.response?.headers?.location).toContain('evil.example.com');
  });

  test('WRITE_ENDPOINT_FIXTURE has set_cmd_process path', () => {
    const r = createMockRouter(WRITE_ENDPOINT_FIXTURE);
    expect(r.listPaths()).toContain('/goform/goform_set_cmd_process');
  });

  test('AUTH_ENDPOINT_FIXTURE has SesTokInfo path', () => {
    const r = createMockRouter(AUTH_ENDPOINT_FIXTURE);
    expect(r.listPaths()).toContain('/api/webserver/SesTokInfo');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// All profiles construct + lookup homepage
// ═══════════════════════════════════════════════════════════════════════

describe('all profiles can construct and lookup /', () => {
  for (const p of ALL_PROFILES) {
    test(`"${p.id}" constructs and finds /`, () => {
      const r = createMockRouter(p);
      expect(r.lookup('/').matched).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════

describe('registry — NORMAL vs MALICIOUS separation', () => {
  test('NORMAL_PROFILES has 3 entries', () => {
    expect(NORMAL_PROFILES.length).toBe(3);
  });

  test('MALICIOUS_FIXTURES has 4 entries', () => {
    expect(MALICIOUS_FIXTURES.length).toBe(4);
  });

  test('ALL_PROFILES = NORMAL + MALICIOUS', () => {
    expect(ALL_PROFILES.length).toBe(NORMAL_PROFILES.length + MALICIOUS_FIXTURES.length);
  });

  test('no id collisions', () => {
    const ids = ALL_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
