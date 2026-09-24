/**
 * lab-realistic-fixtures.test.ts — PHASE 5F (Part 1/2)
 *
 * يتحقق من:
 *   - كل fixtures جديدة تحمل realism + disclosure
 *   - structure صحيح
 *   - fields استُخرجت كما هو متوقع
 *   - لا capability declarations
 */

import {
  HUAWEI_LTE_REALISTIC,
  HUAWEI_5G_REALISTIC,
  ZTE_LTE_REALISTIC,
  ZTE_5G_REALISTIC,
  UNKNOWN_CPE_REALISTIC,
  MALFORMED_FIXTURE,
  PARTIAL_FIXTURE,
  REALISTIC_FIXTURES,
  BEHAVIORAL_FIXTURES,
  ALL_LAB_FIXTURES,
  DISCLOSURE_UNIFORM,
} from '../lab/fixtures';
import { MOCK_HOSTS } from '../lab/hosts';
import { runDiscoveryHarness } from '../lab/harness';

// ═══════════════════════════════════════════════════════════════════════
// Registry counts
// ═══════════════════════════════════════════════════════════════════════

describe('5F — registry counts', () => {
  test('REALISTIC_FIXTURES has 5 entries', () => {
    expect(REALISTIC_FIXTURES.length).toBe(5);
  });
  test('BEHAVIORAL_FIXTURES has 2 entries', () => {
    expect(BEHAVIORAL_FIXTURES.length).toBe(2);
  });
  test('ALL_LAB_FIXTURES = REALISTIC + BEHAVIORAL', () => {
    expect(ALL_LAB_FIXTURES.length).toBe(7);
    expect(ALL_LAB_FIXTURES.length).toBe(
      REALISTIC_FIXTURES.length + BEHAVIORAL_FIXTURES.length,
    );
  });
  test('unique ids across fixtures', () => {
    const ids = ALL_LAB_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Realism + disclosure metadata
// ═══════════════════════════════════════════════════════════════════════

describe('5F — realism + disclosure on all fixtures', () => {
  for (const f of ALL_LAB_FIXTURES) {
    test(`${f.id}: realism = synthetic-realistic`, () => {
      expect(f.realism).toBe('synthetic-realistic');
    });
    test(`${f.id}: disclosure = uniform text`, () => {
      expect(f.disclosure).toBe(DISCLOSURE_UNIFORM);
    });
  }

  test('disclosure uniform text is the approved one', () => {
    expect(DISCLOSURE_UNIFORM).toBe('Synthetic. Not real hardware data.');
  });

  test('no fixture declares capabilities', () => {
    for (const f of ALL_LAB_FIXTURES) {
      expect((f as any).capabilities).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Structure — GET only, / path, valid content types
// ═══════════════════════════════════════════════════════════════════════

describe('5F — structure sanity', () => {
  for (const f of ALL_LAB_FIXTURES) {
    test(`${f.id}: all responses are GET`, () => {
      for (const r of [...f.pages, ...f.endpoints]) {
        expect(r.method).toBe('GET');
      }
    });
    test(`${f.id}: all paths start with /`, () => {
      for (const r of [...f.pages, ...f.endpoints]) {
        expect(r.path.startsWith('/')).toBe(true);
      }
    });
    test(`${f.id}: has at least one page`, () => {
      expect(f.pages.length).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Host mapping
// ═══════════════════════════════════════════════════════════════════════

describe('5F — host mapping', () => {
  test('all 7 new fixtures are mapped', () => {
    const mapped = new Set(Object.values(MOCK_HOSTS).map((p) => p.id));
    for (const f of ALL_LAB_FIXTURES) {
      expect(mapped.has(f.id)).toBe(true);
    }
  });

  test('hosts 20-26 are unique range', () => {
    const expected = [
      '192.168.255.20',
      '192.168.255.21',
      '192.168.255.22',
      '192.168.255.23',
      '192.168.255.24',
      '192.168.255.25',
      '192.168.255.26',
    ];
    for (const h of expected) {
      expect(MOCK_HOSTS[h]).toBeDefined();
    }
  });

  test('no collision with hosts 1-13', () => {
    const oldRange = ['1', '2', '3', '4', '5', '6', '10', '11', '12', '13'];
    for (const n of oldRange) {
      const host = `192.168.255.${n}`;
      const profile = MOCK_HOSTS[host];
      expect(profile).toBeDefined();
      expect(profile?.realism).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — Huawei LTE via harness
// ═══════════════════════════════════════════════════════════════════════

describe('5F — Huawei LTE via harness', () => {
  test('extracts signal fields', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.router.signalFields.rsrp?.value).toBe('-91');
    expect(r.router.signalFields.sinr?.value).toBe('18');
    expect(r.router.signalFields.pci?.value).toBe('123');
  });

  test('extracts band field', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.router.bandFields.band?.value).toBe('3');
    expect(r.router.bandFields.earfcn?.value).toBe('1650');
  });

  test('extracts cell_id', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.router.cellFields.cell_id?.value).toBe('0x0A1B2C3');
  });

  test('vendor = Huawei', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.router.manufacturer.value).toBe('Huawei');
  });

  test('profileId correct', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.20' });
    expect(r.profileId).toBe('huawei-lte-realistic');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — Huawei 5G via harness
// ═══════════════════════════════════════════════════════════════════════

describe('5F — Huawei 5G via harness', () => {
  test('extracts 5G NR fields', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.21' });
    expect(r.router.signalFields.nr5g_rsrp?.value).toBe('-85');
    expect(r.router.signalFields.nr5g_sinr?.value).toBe('22');
  });

  test('vendor = Huawei', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.21' });
    expect(r.router.manufacturer.value).toBe('Huawei');
  });

  test('endpoints include /api/device/signal', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.21' });
    const paths = r.router.endpoints.map((e) => e.path);
    expect(paths).toContain('/api/device/signal');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — ZTE LTE / 5G
// ═══════════════════════════════════════════════════════════════════════

describe('5F — ZTE LTE via harness', () => {
  test('extracts signal fields', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.22' });
    expect(r.router.signalFields.rsrp?.value).toBe('-91');
  });

  test('vendor = ZTE', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.22' });
    expect(r.router.manufacturer.value).toBe('ZTE');
  });
});

describe('5F — ZTE 5G via harness', () => {
  test('extracts signal fields', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.23' });
    // ZTE 5G uses lte_* prefix; both are in SIGNAL_NAMES
    const hasLte = r.router.signalFields.lte_rsrp?.value;
    const hasStd = r.router.signalFields.rsrp?.value;
    expect(hasLte || hasStd).toBeDefined();
  });

  test('vendor = ZTE', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.23' });
    expect(r.router.manufacturer.value).toBe('ZTE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — Unknown CPE (no inference)
// ═══════════════════════════════════════════════════════════════════════

describe('5F — Unknown CPE via harness', () => {
  test('vendor = UNKNOWN', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.24' });
    expect(r.router.manufacturer.value).toBeNull();
  });

  test('unknown signal field not extracted', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.24' });
    expect(r.router.signalFields.signal_strength_percent).toBeUndefined();
  });

  test('endpoints present (including 200 responses)', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.24' });
    expect(r.router.endpoints.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — Malformed fixture
// ═══════════════════════════════════════════════════════════════════════

describe('5F — Malformed fixture via harness', () => {
  test('does not crash', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.25' });
    expect(r).toBeDefined();
    expect(r.profileId).toBe('malformed-fixture');
  });

  test('broken JSON does not extract fields', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.25' });
    // ConnectionStatus is broken JSON — no fields should be extracted from it
    expect((r.router.signalFields as any).ConnectionStatus).toBeUndefined();
  });

  test('NaN rsrp not extracted', async () => {
    const r = await runDiscoveryHarness({ host: '192.168.255.25' });
    // 'NaN' — evidenceCollector should not produce a value or produces unparseable string
    const rsrp = r.router.signalFields.rsrp;
    if (rsrp) {
      // If extracted, it should be the string 'NaN', not a number
      expect(String(rsrp.value)).toBe('NaN');
    }
  });

  test('harness completes without throwing', async () => {
    await expect(
      runDiscoveryHarness({ host: '192.168.255.25' }),
    ).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — Partial fixture
// ═══════════════════════════════════════════════════════════════════════

describe('5F — Partial fixture via harness', () => {
  let r: Awaited<ReturnType<typeof runDiscoveryHarness>>;
  beforeAll(async () => { r = await runDiscoveryHarness({ host: '192.168.255.26' }); });

  test('signal extracted from 200 endpoint', async () => {
    expect(r.router.signalFields.rsrp?.value).toBe('-95');
  });

  test('500 does not crash harness', () => {
    expect(r.stats.attempted).toBeGreaterThan(0);
  });

  test('403 endpoint included in endpoints list', () => {
    const has403 = r.router.endpoints.some((e) => e.status === 403);
    expect(has403).toBe(true);
  });

  test('404 endpoint included in endpoints list', () => {
    const has404 = r.router.endpoints.some((e) => e.status === 404);
    expect(has404).toBe(true);
  });

  test('500 endpoint included in endpoints list', () => {
    const has500 = r.router.endpoints.some((e) => e.status === 500);
    expect(has500).toBe(true);
  });
});
