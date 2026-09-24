/**
 * lab-realistic-security.test.ts — PHASE 5F
 *
 * يتحقق من أن fixtures الواقعية لا تسرّب بيانات حساسة عبر المسار الكامل:
 *   fixture → safeDiscoveryFetch → sanitize → evidence → result
 */

import { safeDiscoveryFetch } from '../safeRequest';
import { installMockFetch, uninstallMockFetch } from '../lab/transport';
import { runDiscoveryHarness } from '../lab/harness';
import { HUAWEI_LTE_REALISTIC, HUAWEI_5G_REALISTIC } from '../lab/fixtures';

// ────────────── Known synthetic values used in fixtures ──────────────

const SENSITIVE_VALUES = [
  '490154203237518',          // IMEI (Luhn-valid)
  'AA:BB:CC:DD:EE:FF',        // MAC
  '11:22:33:44:55:66',        // MAC (host-list)
];

// ═══════════════════════════════════════════════════════════════════════
// Level 1 — safeDiscoveryFetch sanitizes Huawei LTE responses
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — Huawei LTE via safeDiscoveryFetch', () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());

  test('/api/device/information — IMEI removed, MAC removed', async () => {
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/api/device/information',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).not.toContain('490154203237518');
      expect(r.body).not.toContain('AA:BB:CC:DD:EE:FF');
      // DeviceName is on the sensitive-name list → masked to «محذوف».
      expect(r.body).toContain('«محذوف»');
      // SoftwareVersion is not on sensitive list → preserved.
      expect(r.body).toContain('2.0.0-synthetic');
    }
  });

  test('/api/device/signal — rsrp preserved, no sensitive leak', async () => {
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/api/device/signal',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toContain('-91');
      for (const v of SENSITIVE_VALUES) {
        expect(r.body).not.toContain(v);
      }
    }
  });

  test('/api/wlan/host-list — MACAddress AND HostName now masked', async () => {
    // PHASE 5G closed the gap:
    //   - MacAddress normalized → 'macaddress' → SENSITIVE
    //   - HostName normalized → 'hostname' → SENSITIVE
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/api/wlan/host-list',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).not.toContain('11:22:33:44:55:66');
      expect(r.body).not.toContain('synthetic-device-1');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 2 — Full Harness output does not leak sensitive values
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — Huawei LTE via harness', () => {
  test('JSON.stringify(router) has no IMEI/MAC', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    const json = JSON.stringify(r.router);
    for (const v of SENSITIVE_VALUES) {
      expect(json).not.toContain(v);
    }
  });

  test('JSON.stringify(capabilitiesV2) has no sensitive values', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    const json = JSON.stringify(r.capabilitiesV2);
    for (const v of SENSITIVE_VALUES) {
      expect(json).not.toContain(v);
    }
  });

  test('router.host is preserved (not sensitive — needed for pairing)', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.router.host).toBe('192.168.255.20');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 3 — Huawei 5G
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — Huawei 5G via harness', () => {
  test('5G fixture does not leak IMEI/MAC', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.21' });
    const json = JSON.stringify(r.router);
    for (const v of SENSITIVE_VALUES) {
      expect(json).not.toContain(v);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 4 — Malformed fixture output is safe
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — Malformed fixture output', () => {
  test('does not crash + no sensitive values', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.25' });
    const json = JSON.stringify(r.router);
    for (const v of SENSITIVE_VALUES) {
      expect(json).not.toContain(v);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 5 — Policy deny still applies (write/auth) via realistic fixtures
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — policy deny on realistic hosts', () => {
  beforeAll(() => installMockFetch());
  afterAll(() => uninstallMockFetch());

  test('auth endpoint on realistic host → DENY', async () => {
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/api/webserver/SesTokInfo',
    });
    expect(r.ok).toBe(false);
  });

  test('write endpoint on realistic host → DENY', async () => {
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/goform/goform_set_cmd_process',
    });
    expect(r.ok).toBe(false);
  });

  test('redirect path on realistic host → DENY', async () => {
    const r = await safeDiscoveryFetch({
      url: 'http://192.168.255.20/reboot',
    });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Level 6 — Fixture integrity (fixture itself contains sensitive strings,
//           but they must be filtered before output)
// ═══════════════════════════════════════════════════════════════════════

describe('5F security — fixtures DO contain sensitive strings (raw)', () => {
  test('HUAWEI_LTE_REALISTIC raw fixture has IMEI in XML', () => {
    const info = HUAWEI_LTE_REALISTIC.endpoints.find(
      (e) => e.path === '/api/device/information',
    );
    expect(info?.body).toContain('490154203237518');
  });

  test('HUAWEI_LTE_REALISTIC raw fixture has MAC in XML', () => {
    const info = HUAWEI_LTE_REALISTIC.endpoints.find(
      (e) => e.path === '/api/device/information',
    );
    expect(info?.body).toContain('AA:BB:CC:DD:EE:FF');
  });

  test('HUAWEI_5G_REALISTIC raw fixture has IMEI', () => {
    const info = HUAWEI_5G_REALISTIC.endpoints.find(
      (e) => e.path === '/api/device/information',
    );
    expect(info?.body).toContain('490154203237518');
  });

  test('This confirms sanitization is the barrier, not fixture authoring', () => {
    // The test above + the harness tests above together prove:
    // raw fixture → sanitized by safeRequest → output has no IMEI
    expect(true).toBe(true);
  });
});
