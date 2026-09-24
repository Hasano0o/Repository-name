/**
 * lab-harness.test.ts — PHASE 5D
 *
 * يشغّل Discovery الحقيقي ضد Mock Transport.
 * يعتمد على safeDiscoveryFetch الموجود.
 */

import {
  runDiscoveryHarness,
  HARNESS_TARGETS,
  HarnessResult,
} from '../lab/harness';
import { isMockFetchInstalled } from '../lab/transport';

// ────────────── Hosts ──────────────
const HUAWEI_V1     = '192.168.255.1';
const HUAWEI_V2     = '192.168.255.2';
const ZTE_V1        = '192.168.255.3';
const ZTE_V2        = '192.168.255.4';
const UNKNOWN_GEN   = '192.168.255.5';
const UNKNOWN_NOISY = '192.168.255.6';
const SENSITIVE     = '192.168.255.10';
const REDIRECT      = '192.168.255.11';

// ────────────── Helpers ──────────────

function stripTimestamps(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripTimestamps);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'at' || k === 'ms') continue;
      out[k] = stripTimestamps(v);
    }
    return out;
  }
  return obj;
}

async function run(host: string): Promise<HarnessResult> {
  return runDiscoveryHarness({ host });
}

// ═══════════════════════════════════════════════════════════════════════
// Input validation
// ═══════════════════════════════════════════════════════════════════════

describe('runDiscoveryHarness — validation', () => {
  test('throws on non-mock host', async () => {
    await expect(run('192.168.1.1')).rejects.toThrow();
  });
  test('throws on public host', async () => {
    await expect(run('8.8.8.8')).rejects.toThrow();
  });
  test('throws on mock subnet but unmapped host', async () => {
    await expect(run('192.168.255.99')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Huawei V1
// ═══════════════════════════════════════════════════════════════════════

describe('harness — Huawei V1', () => {
  let r: HarnessResult;
  beforeAll(async () => { r = await run(HUAWEI_V1); });

  test('profileId is huawei-generic-v1', () => {
    expect(r.profileId).toBe('huawei-generic-v1');
  });
  test('manufacturer = Huawei', () => {
    expect(r.router.manufacturer.value).toBe('Huawei');
  });
  test('signalFields has rsrp', () => {
    expect(r.router.signalFields.rsrp?.value).toBe('-91');
  });
  test('signalFields has sinr', () => {
    expect(r.router.signalFields.sinr?.value).toBe('18');
  });
  test('bandFields has earfcn', () => {
    expect(r.router.bandFields.earfcn?.value).toBe('1650');
  });
  test('signal capability = CONFIRMED_READ', () => {
    expect(r.capabilitiesV2.signal.value).toBe('CONFIRMED_READ');
  });
  test('endpoints count > 0', () => {
    expect(r.router.endpoints.length).toBeGreaterThan(0);
  });
  test('compat level is set', () => {
    expect(r.router.compatLevel).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Huawei V2
// ═══════════════════════════════════════════════════════════════════════

describe('harness — Huawei V2', () => {
  let r: HarnessResult;
  beforeAll(async () => { r = await run(HUAWEI_V2); });

  test('profileId is huawei-generic-v2', () => {
    expect(r.profileId).toBe('huawei-generic-v2');
  });
  test('manufacturer = Huawei', () => {
    expect(r.router.manufacturer.value).toBe('Huawei');
  });
  test('signalFields uses lte_rsrp naming', () => {
    expect(r.router.signalFields.lte_rsrp?.value).toBe('-88');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ZTE V1 / V2
// ═══════════════════════════════════════════════════════════════════════

describe('harness — ZTE V1', () => {
  let r: HarnessResult;
  beforeAll(async () => { r = await run(ZTE_V1); });

  test('profileId is zte-generic-v1', () => {
    expect(r.profileId).toBe('zte-generic-v1');
  });
  test('manufacturer = ZTE', () => {
    expect(r.router.manufacturer.value).toBe('ZTE');
  });
  test('signalFields has rsrp', () => {
    expect(r.router.signalFields.rsrp?.value).toBe('-91');
  });
  test('signal capability = CONFIRMED_READ', () => {
    expect(r.capabilitiesV2.signal.value).toBe('CONFIRMED_READ');
  });
});

describe('harness — ZTE V2', () => {
  let r: HarnessResult;
  beforeAll(async () => { r = await run(ZTE_V2); });

  test('profileId is zte-generic-v2', () => {
    expect(r.profileId).toBe('zte-generic-v2');
  });
  test('manufacturer = ZTE', () => {
    expect(r.router.manufacturer.value).toBe('ZTE');
  });
  test('signalFields uses lte_rsrp naming', () => {
    expect(r.router.signalFields.lte_rsrp?.value).toBe('-88');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Unknown — no vendor inference
// ═══════════════════════════════════════════════════════════════════════

describe('harness — Unknown (no inference)', () => {
  test('Unknown Generic: vendor = UNKNOWN', async () => {
    const r = await run(UNKNOWN_GEN);
    expect(r.router.manufacturer.value).toBeNull();
    expect(r.router.manufacturer.confidence).toBe('UNKNOWN');
  });
  test('Unknown Generic: signalFields empty (no recognized fields)', async () => {
    const r = await run(UNKNOWN_GEN);
    expect(Object.keys(r.router.signalFields).length).toBe(0);
  });
  test('Unknown Noisy: vendor = UNKNOWN', async () => {
    const r = await run(UNKNOWN_NOISY);
    expect(r.router.manufacturer.value).toBeNull();
  });
  test('Unknown Noisy: endpoints include 404 responses', async () => {
    const r = await run(UNKNOWN_NOISY);
    const has404 = r.router.endpoints.some((e) => e.status === 404);
    expect(has404).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Malicious fixtures
// ═══════════════════════════════════════════════════════════════════════

describe('harness — malicious fixtures', () => {
  test('Sensitive: IMEI sanitized out of body', async () => {
    const r = await run(SENSITIVE);
    const json = JSON.stringify(r.router);
    expect(json).not.toContain('490154203237518');
    expect(json).not.toContain('SECRET_VALUE');
    expect(json).not.toContain('ABC123TOKEN');
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).not.toContain('HomeWiFi');
  });

  test('Sensitive: rsrp preserved', async () => {
    const r = await run(SENSITIVE);
    expect(r.router.signalFields.rsrp?.value).toBe('-91');
  });

  test('Redirect: stats.redirectBlocked = 1', async () => {
    const r = await run(REDIRECT);
    expect(r.stats.redirectBlocked).toBe(1);
  });

  test('Redirect: login.html raises errored error', async () => {
    const r = await run(REDIRECT);
    expect(r.router.errors.some((e) => e.step === 'login-page')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Stats invariants
// ═══════════════════════════════════════════════════════════════════════

describe('harness — stats invariants', () => {
  const hosts = [HUAWEI_V1, HUAWEI_V2, ZTE_V1, ZTE_V2, UNKNOWN_GEN, UNKNOWN_NOISY, SENSITIVE, REDIRECT];

  for (const h of hosts) {
    test(`${h}: attempted === allowed + denied`, async () => {
      const r = await run(h);
      expect(r.stats.attempted).toBe(r.stats.allowed + r.stats.denied);
    });

    test(`${h}: ok + denied + errored === attempted`, async () => {
      const r = await run(h);
      expect(r.stats.ok + r.stats.denied + r.stats.errored).toBe(r.stats.attempted);
    });

    test(`${h}: attempted === targets.length`, async () => {
      const r = await run(h);
      expect(r.stats.attempted).toBe(HARNESS_TARGETS.length);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('harness — lifecycle', () => {
  test('mock uninstalled after successful run', async () => {
    await run(HUAWEI_V1);
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('mock not installed initially', () => {
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('multiple sequential runs are independent', async () => {
    const a = await run(HUAWEI_V1);
    const b = await run(ZTE_V1);
    expect(a.profileId).not.toBe(b.profileId);
    expect(isMockFetchInstalled()).toBe(false);
  });

  test('validation failure does not install mock', async () => {
    try { await run('192.168.1.1'); } catch {}
    expect(isMockFetchInstalled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════════════════════════════

describe('harness — determinism', () => {
  test('same host → identical result (timestamps excluded)', async () => {
    const a = await run(HUAWEI_V1);
    const b = await run(HUAWEI_V1);
    expect(JSON.stringify(stripTimestamps(a.router)))
      .toBe(JSON.stringify(stripTimestamps(b.router)));
    expect(a.stats).toEqual(b.stats);
  });

  test('different hosts → different profileId', async () => {
    const a = await run(HUAWEI_V1);
    const b = await run(ZTE_V1);
    expect(a.profileId).not.toBe(b.profileId);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Custom targets
// ═══════════════════════════════════════════════════════════════════════

describe('harness — custom targets', () => {
  test('single target /', async () => {
    const r = await runDiscoveryHarness({
      host: HUAWEI_V1,
      targets: [{ path: '/', label: 'home' }],
    });
    expect(r.stats.attempted).toBe(1);
    expect(r.stats.ok).toBe(1);
  });

  test('deny target increments denied', async () => {
    const r = await runDiscoveryHarness({
      host: HUAWEI_V1,
      targets: [{ path: '/reboot', label: 'dangerous' }],
    });
    expect(r.stats.denied).toBe(1);
    expect(r.stats.ok).toBe(0);
    expect(r.router.endpoints.length).toBe(0);
  });

  test('mixed targets', async () => {
    const r = await runDiscoveryHarness({
      host: HUAWEI_V1,
      targets: [
        { path: '/', label: 'home' },
        { path: '/reboot', label: 'danger' },
        { path: '/api/device/signal', label: 'signal' },
      ],
    });
    expect(r.stats.attempted).toBe(3);
    expect(r.stats.denied).toBe(1);
    expect(r.stats.ok).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Error kinds
// ═══════════════════════════════════════════════════════════════════════

describe('harness — error kinds', () => {
  test('policy-denied error recorded', async () => {
    const r = await runDiscoveryHarness({
      host: HUAWEI_V1,
      targets: [{ path: '/reboot', label: 'danger' }],
    });
    const e = r.router.errors.find((x) => x.step === 'danger');
    expect(e?.kind).toBe('policy-denied');
  });
});
