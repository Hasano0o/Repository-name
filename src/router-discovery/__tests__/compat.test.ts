/**
 * اختبارات Compat Levels.
 * الهدف: نثبت أن كل مدخل ينتج المستوى الصحيح — وأن UNKNOWN لا يُرقّى زورًا.
 */

import {
  computeCompatibility,
  CompatInput,
  COMPAT_LABEL,
  COMPAT_DESCRIPTION,
  COMPAT_COLOR,
  COMPAT_RANK,
  isBetterLevel,
} from '../compat';
import {
  unknownEvidence,
  observedEvidence,
} from '../evidence';
import { CapabilityEvidence } from '../types';

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function capsUnknown(): CapabilityEvidence {
  return {
    signal: unknownEvidence<boolean>(),
    lte: unknownEvidence<boolean>(),
    nr: unknownEvidence<boolean>(),
    bands: unknownEvidence<boolean>(),
    cells: unknownEvidence<boolean>(),
    neighborCells: unknownEvidence<boolean>(),
    carrierAggregation: unknownEvidence<boolean>(),
    deviceInfo: unknownEvidence<boolean>(),
    traffic: unknownEvidence<boolean>(),
    usage: unknownEvidence<boolean>(),
    sms: unknownEvidence<boolean>(),
    bandLock: unknownEvidence<boolean>(),
    cellLock: unknownEvidence<boolean>(),
    reboot: unknownEvidence<boolean>(),
    block: unknownEvidence<boolean>(),
  };
}

function withTrue(
  c: CapabilityEvidence,
  ...keys: Array<keyof CapabilityEvidence>
): CapabilityEvidence {
  const copy = { ...c };
  for (const k of keys) {
    copy[k] = observedEvidence(true, 'api');
  }
  return copy;
}

function makeInput(partial: Partial<CompatInput>): CompatInput {
  return {
    hasDriver: false,
    hasLiveEndpoint: false,
    capabilities: capsUnknown(),
    ...partial,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// computeCompatibility
// ═══════════════════════════════════════════════════════════════════════

describe('computeCompatibility', () => {
  test('no live endpoint → UNSUPPORTED (even with driver)', () => {
    const lvl = computeCompatibility(
      makeInput({ hasLiveEndpoint: false, hasDriver: true }),
    );
    expect(lvl).toBe('UNSUPPORTED');
  });

  test('live endpoint but no driver → DISCOVERY_ONLY', () => {
    const lvl = computeCompatibility(
      makeInput({ hasLiveEndpoint: true, hasDriver: false }),
    );
    expect(lvl).toBe('DISCOVERY_ONLY');
  });

  test('driver but signal UNKNOWN → DISCOVERY_ONLY', () => {
    const lvl = computeCompatibility(
      makeInput({ hasLiveEndpoint: true, hasDriver: true }),
    );
    expect(lvl).toBe('DISCOVERY_ONLY');
  });

  test('driver + signal only → PARTIAL', () => {
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: withTrue(capsUnknown(), 'signal'),
      }),
    );
    expect(lvl).toBe('PARTIAL');
  });

  test('driver + signal + bands + cells, no write → READ_ONLY', () => {
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: withTrue(
          capsUnknown(),
          'signal',
          'bands',
          'cells',
        ),
      }),
    );
    expect(lvl).toBe('READ_ONLY');
  });

  test('driver + signal + bands + cells + bandLock → FULL', () => {
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: withTrue(
          capsUnknown(),
          'signal',
          'bands',
          'cells',
          'bandLock',
        ),
      }),
    );
    expect(lvl).toBe('FULL');
  });

  test('driver + signal + bands + cells + cellLock → FULL', () => {
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: withTrue(
          capsUnknown(),
          'signal',
          'bands',
          'cells',
          'cellLock',
        ),
      }),
    );
    expect(lvl).toBe('FULL');
  });

  test('signal=true but bands=UNKNOWN → PARTIAL (not READ_ONLY)', () => {
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: withTrue(capsUnknown(), 'signal', 'cells'),
      }),
    );
    expect(lvl).toBe('PARTIAL');
  });

  test('signal=false (observed) → falls through to DISCOVERY_ONLY', () => {
    const caps = { ...capsUnknown(), signal: observedEvidence(false, 'api') };
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: caps,
      }),
    );
    expect(lvl).toBe('DISCOVERY_ONLY');
  });

  test('signal=true but bands=false → PARTIAL', () => {
    const caps = {
      ...capsUnknown(),
      signal: observedEvidence(true, 'api'),
      bands: observedEvidence(false, 'api'),
      cells: observedEvidence(true, 'api'),
    };
    const lvl = computeCompatibility(
      makeInput({
        hasLiveEndpoint: true,
        hasDriver: true,
        capabilities: caps,
      }),
    );
    expect(lvl).toBe('PARTIAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Metadata — Labels / Colors / Ranks
// ═══════════════════════════════════════════════════════════════════════

describe('COMPAT_LABEL / COMPAT_DESCRIPTION / COMPAT_COLOR', () => {
  const levels = [
    'FULL',
    'READ_ONLY',
    'PARTIAL',
    'DISCOVERY_ONLY',
    'UNSUPPORTED',
  ] as const;

  test.each(levels)('has Arabic label for %s', (lvl) => {
    expect(COMPAT_LABEL[lvl]).toBeTruthy();
    expect(COMPAT_LABEL[lvl].length).toBeGreaterThan(0);
  });

  test.each(levels)('has description for %s', (lvl) => {
    expect(COMPAT_DESCRIPTION[lvl]).toBeTruthy();
  });

  test.each(levels)('has hex color for %s', (lvl) => {
    expect(COMPAT_COLOR[lvl]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('COMPAT_RANK / isBetterLevel', () => {
  test('rank is strictly decreasing FULL > READ_ONLY > PARTIAL > DISCOVERY_ONLY > UNSUPPORTED', () => {
    expect(COMPAT_RANK.FULL).toBeGreaterThan(COMPAT_RANK.READ_ONLY);
    expect(COMPAT_RANK.READ_ONLY).toBeGreaterThan(COMPAT_RANK.PARTIAL);
    expect(COMPAT_RANK.PARTIAL).toBeGreaterThan(COMPAT_RANK.DISCOVERY_ONLY);
    expect(COMPAT_RANK.DISCOVERY_ONLY).toBeGreaterThan(
      COMPAT_RANK.UNSUPPORTED,
    );
  });

  test('isBetterLevel FULL vs READ_ONLY → true', () => {
    expect(isBetterLevel('FULL', 'READ_ONLY')).toBe(true);
  });

  test('isBetterLevel PARTIAL vs FULL → false', () => {
    expect(isBetterLevel('PARTIAL', 'FULL')).toBe(false);
  });

  test('isBetterLevel same → false', () => {
    expect(isBetterLevel('FULL', 'FULL')).toBe(false);
    expect(isBetterLevel('UNSUPPORTED', 'UNSUPPORTED')).toBe(false);
  });
});
