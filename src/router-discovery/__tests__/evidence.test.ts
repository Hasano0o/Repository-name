/**
 * اختبارات Evidence helpers.
 * الهدف: نثبت أن البناء والدمج والفحص تعمل بشكل صحيح، ونمنع أي قيم غير متسقة.
 */

import {
  makeEvidence,
  unknownEvidence,
  observedEvidence,
  confirmedEvidence,
  partialEvidence,
  isKnown,
  isConfirmed,
  mergeEvidence,
  anonymizeHost,
} from '../evidence';

describe('Evidence builders', () => {
  test('unknownEvidence has null value and UNKNOWN confidence', () => {
    const e = unknownEvidence<string>('api');
    expect(e.value).toBeNull();
    expect(e.confidence).toBe('UNKNOWN');
    expect(e.source).toBe('api');
    expect(typeof e.at).toBe('number');
  });

  test('observedEvidence keeps value with OBSERVED confidence', () => {
    const e = observedEvidence('Zyxel', 'html');
    expect(e.value).toBe('Zyxel');
    expect(e.confidence).toBe('OBSERVED');
    expect(e.source).toBe('html');
  });

  test('confirmedEvidence keeps value with CONFIRMED confidence', () => {
    const e = confirmedEvidence(42, 'api');
    expect(e.value).toBe(42);
    expect(e.confidence).toBe('CONFIRMED');
  });

  test('partialEvidence keeps value with PARTIAL confidence', () => {
    const e = partialEvidence('V1', 'user');
    expect(e.value).toBe('V1');
    expect(e.confidence).toBe('PARTIAL');
  });
});

describe('makeEvidence validation', () => {
  test('throws if UNKNOWN with non-null value', () => {
    expect(() => makeEvidence('value', 'api', 'UNKNOWN')).toThrow();
  });

  test('throws if non-UNKNOWN with null value', () => {
    expect(() =>
      makeEvidence<string>(null, 'api', 'CONFIRMED'),
    ).toThrow();
    expect(() =>
      makeEvidence<string>(null, 'api', 'OBSERVED'),
    ).toThrow();
    expect(() =>
      makeEvidence<string>(null, 'api', 'PARTIAL'),
    ).toThrow();
  });

  test('accepts UNKNOWN with null', () => {
    expect(() =>
      makeEvidence<string>(null, 'api', 'UNKNOWN'),
    ).not.toThrow();
  });

  test('accepts CONFIRMED with value', () => {
    expect(() =>
      makeEvidence('x', 'api', 'CONFIRMED'),
    ).not.toThrow();
  });
});

describe('isKnown / isConfirmed', () => {
  test('isKnown false for UNKNOWN', () => {
    expect(isKnown(unknownEvidence())).toBe(false);
  });

  test('isKnown true for OBSERVED and above', () => {
    expect(isKnown(observedEvidence(1, 'api'))).toBe(true);
    expect(isKnown(confirmedEvidence(1, 'api'))).toBe(true);
    expect(isKnown(partialEvidence(1, 'api'))).toBe(true);
  });

  test('isConfirmed only true for CONFIRMED', () => {
    expect(isConfirmed(observedEvidence(1, 'api'))).toBe(false);
    expect(isConfirmed(partialEvidence(1, 'api'))).toBe(false);
    expect(isConfirmed(confirmedEvidence(1, 'api'))).toBe(true);
    expect(isConfirmed(unknownEvidence())).toBe(false);
  });
});

describe('mergeEvidence', () => {
  test('UNKNOWN + OBSERVED → OBSERVED', () => {
    const merged = mergeEvidence(
      unknownEvidence<string>(),
      observedEvidence('Zyxel', 'html'),
    );
    expect(merged.value).toBe('Zyxel');
    expect(merged.confidence).toBe('OBSERVED');
  });

  test('OBSERVED + UNKNOWN → OBSERVED', () => {
    const merged = mergeEvidence(
      observedEvidence('Zyxel', 'html'),
      unknownEvidence<string>(),
    );
    expect(merged.value).toBe('Zyxel');
    expect(merged.confidence).toBe('OBSERVED');
  });

  test('same value from two sources → CONFIRMED', () => {
    const merged = mergeEvidence(
      observedEvidence('Zyxel', 'html'),
      observedEvidence('Zyxel', 'api'),
    );
    expect(merged.value).toBe('Zyxel');
    expect(merged.confidence).toBe('CONFIRMED');
    expect(merged.notes).toMatch(/Confirmed by both/);
  });

  test('conflicting values → higher confidence wins', () => {
    const merged = mergeEvidence(
      observedEvidence('Zyxel', 'html'),
      confirmedEvidence('ZTE', 'api'),
    );
    expect(merged.value).toBe('ZTE');
    expect(merged.confidence).toBe('CONFIRMED');
    expect(merged.notes).toMatch(/Conflict/);
  });

  test('conflicting values same confidence → first wins (prev)', () => {
    const merged = mergeEvidence(
      observedEvidence('Zyxel', 'html'),
      observedEvidence('ZTE', 'api'),
    );
    expect(merged.value).toBe('Zyxel');
    expect(merged.notes).toMatch(/Conflict/);
  });
});

describe('anonymizeHost', () => {
  test('192.168.8.1 → 192.168.x.x', () => {
    expect(anonymizeHost('192.168.8.1')).toBe('192.168.x.x');
  });

  test('192.168.255.4 → 192.168.x.x', () => {
    expect(anonymizeHost('192.168.255.4')).toBe('192.168.x.x');
  });

  test('10.0.0.138 → 10.x.x.x', () => {
    expect(anonymizeHost('10.0.0.138')).toBe('10.x.x.x');
  });

  test('172.16.5.4 → 172.16.x.x', () => {
    expect(anonymizeHost('172.16.5.4')).toBe('172.16.x.x');
  });

  test('172.31.9.9 → 172.31.x.x', () => {
    expect(anonymizeHost('172.31.9.9')).toBe('172.31.x.x');
  });

  test('172.15.9.9 (not private) → x.x.x.x', () => {
    expect(anonymizeHost('172.15.9.9')).toBe('x.x.x.x');
  });

  test('127.0.0.1 → 127.x.x.x', () => {
    expect(anonymizeHost('127.0.0.1')).toBe('127.x.x.x');
  });

  test('fe80::1 → fe80::x', () => {
    expect(anonymizeHost('fe80::1')).toBe('fe80::x');
  });

  test('router.lan → *.lan', () => {
    expect(anonymizeHost('router.lan')).toBe('*.lan');
  });

  test('empty → empty', () => {
    expect(anonymizeHost('')).toBe('');
  });
});
