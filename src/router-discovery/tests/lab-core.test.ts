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
import {
  HUAWEI_GENERIC_V1,
  HUAWEI_GENERIC_V2,
  ZTE_GENERIC_V1,
  ZTE_GENERIC_V2,
  UNKNOWN_NOISY,
} from '../lab/profiles';

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
    expect(r.lookup('/api/device/signal').response?.body).toContain('"password"');
  });

  test('SENSITIVE_VALUES_FIXTURE has token field', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/device/signal').response?.body).toContain('"token"');
  });

  test('SENSITIVE_VALUES_FIXTURE has IMEI', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/device/signal').response?.body).toContain('490154203237518');
  });

  test('SENSITIVE_VALUES_FIXTURE has MAC', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/device/signal').response?.body).toContain('AA:BB:CC:DD:EE:FF');
  });

  test('SENSITIVE_VALUES_FIXTURE has SSID', () => {
    const r = createMockRouter(SENSITIVE_VALUES_FIXTURE);
    expect(r.lookup('/api/device/signal').response?.body).toContain('HomeWiFi');
  });

  test('REDIRECT_FIXTURE returns 302 with location to public host', () => {
    const r = createMockRouter(REDIRECT_FIXTURE);
    const res = r.lookup('/login.html');
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
  test('NORMAL_PROFILES has 6 entries', () => {
    expect(NORMAL_PROFILES.length).toBe(6);
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

// ═══════════════════════════════════════════════════════════════════════
// Backward-compat aliases
// ═══════════════════════════════════════════════════════════════════════

describe('backward-compat aliases', () => {
  test('HUAWEI_GENERIC === HUAWEI_GENERIC_V1', () => {
    expect(HUAWEI_GENERIC).toBe(HUAWEI_GENERIC_V1);
  });
  test('ZTE_GENERIC === ZTE_GENERIC_V1', () => {
    expect(ZTE_GENERIC).toBe(ZTE_GENERIC_V1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Firmware variants — Huawei
// ═══════════════════════════════════════════════════════════════════════

describe('firmware variants — Huawei', () => {
  test('V1 and V2 differ in model', () => {
    expect(HUAWEI_GENERIC_V1.model).not.toBe(HUAWEI_GENERIC_V2.model);
  });
  test('V1 has /api/net/current-plmn; V2 does not', () => {
    const v1 = HUAWEI_GENERIC_V1.endpoints.map((e) => e.path);
    const v2 = HUAWEI_GENERIC_V2.endpoints.map((e) => e.path);
    expect(v1).toContain('/api/net/current-plmn');
    expect(v2).not.toContain('/api/net/current-plmn');
  });
  test('V2 has /api/device/seccellinfo; V1 does not', () => {
    const v1 = HUAWEI_GENERIC_V1.endpoints.map((e) => e.path);
    const v2 = HUAWEI_GENERIC_V2.endpoints.map((e) => e.path);
    expect(v2).toContain('/api/device/seccellinfo');
    expect(v1).not.toContain('/api/device/seccellinfo');
  });
  test('V1 and V2 differ in /api/device/signal Content-Type', () => {
    const v1 = HUAWEI_GENERIC_V1.endpoints.find((e) => e.path === '/api/device/signal');
    const v2 = HUAWEI_GENERIC_V2.endpoints.find((e) => e.path === '/api/device/signal');
    expect(v1?.contentType).toBe('text/xml');
    expect(v2?.contentType).toBe('application/xml');
  });
  test('V1 uses <rsrp>; V2 uses <lte_rsrp>', () => {
    const v1 = HUAWEI_GENERIC_V1.endpoints.find((e) => e.path === '/api/device/signal');
    const v2 = HUAWEI_GENERIC_V2.endpoints.find((e) => e.path === '/api/device/signal');
    expect(v1?.body).toContain('<rsrp>');
    expect(v2?.body).toContain('<lte_rsrp>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Firmware variants — ZTE
// ═══════════════════════════════════════════════════════════════════════

describe('firmware variants — ZTE', () => {
  test('V1 and V2 differ in model', () => {
    expect(ZTE_GENERIC_V1.model).not.toBe(ZTE_GENERIC_V2.model);
  });
  test('V1 has /status.json; V2 does not', () => {
    const v1 = ZTE_GENERIC_V1.endpoints.map((e) => e.path);
    const v2 = ZTE_GENERIC_V2.endpoints.map((e) => e.path);
    expect(v1).toContain('/status.json');
    expect(v2).not.toContain('/status.json');
  });
  test('V2 has /device/status (text/plain); V1 does not', () => {
    const v1 = ZTE_GENERIC_V1.endpoints.map((e) => e.path);
    const v2 = ZTE_GENERIC_V2.endpoints.find((e) => e.path === '/device/status');
    expect(v1).not.toContain('/device/status');
    expect(v2?.contentType).toBe('text/plain');
  });
  test('V2 includes 5G NSA fields', () => {
    const goform = ZTE_GENERIC_V2.endpoints.find(
      (e) => e.path === '/goform/goform_get_cmd_process',
    );
    expect(goform?.body).toContain('nr5g_pci');
    expect(goform?.body).toContain('nr5g_action_band');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// UNKNOWN_NOISY — status codes coverage
// ═══════════════════════════════════════════════════════════════════════

describe('UNKNOWN_NOISY status codes', () => {
  test('includes 403', () => {
    expect(UNKNOWN_NOISY.endpoints.map((e) => e.status)).toContain(403);
  });
  test('includes 404', () => {
    expect(UNKNOWN_NOISY.endpoints.map((e) => e.status)).toContain(404);
  });
  test('includes 500', () => {
    expect(UNKNOWN_NOISY.endpoints.map((e) => e.status)).toContain(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Content-Type coverage — across NORMAL_PROFILES
// ═══════════════════════════════════════════════════════════════════════

describe('content-type coverage across normal profiles', () => {
  const endpoints = NORMAL_PROFILES.flatMap((p) => p.endpoints);
  const pages = NORMAL_PROFILES.flatMap((p) => p.pages);

  test('text/html present in pages', () => {
    expect(pages.some((r) => r.contentType === 'text/html')).toBe(true);
  });
  test('application/xml present', () => {
    expect(endpoints.some((r) => r.contentType === 'application/xml')).toBe(true);
  });
  test('text/xml present', () => {
    expect(endpoints.some((r) => r.contentType === 'text/xml')).toBe(true);
  });
  test('application/json present', () => {
    expect(endpoints.some((r) => r.contentType === 'application/json')).toBe(true);
  });
  test('text/plain present', () => {
    expect(endpoints.some((r) => r.contentType === 'text/plain')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Registry integrity — aliases not counted
// ═══════════════════════════════════════════════════════════════════════

describe('registry integrity', () => {
  test('NORMAL_PROFILES ids are v1/v2/generic/noisy', () => {
    const ids = NORMAL_PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        'huawei-generic-v1',
        'huawei-generic-v2',
        'unknown-generic',
        'unknown-noisy',
        'zte-generic-v1',
        'zte-generic-v2',
      ].sort(),
    );
  });
  test('aliases not present in NORMAL_PROFILES by their old ids', () => {
    const ids = NORMAL_PROFILES.map((p) => p.id);
    expect(ids).not.toContain('huawei-generic');
    expect(ids).not.toContain('zte-generic');
  });
});
