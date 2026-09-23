/**
 * screenshot-ui-helpers.test.ts — PHASE 4C-2C-1
 * Pure function tests — no React, no I/O.
 */

import {
  MAX_TEXT_INPUT_LENGTH,
  isTextInputValid,
  isTextInputEmpty,
  isTextInputTooLong,
  buildMinimalRouter,
  WARNING_LABELS,
  translateWarning,
  BUCKET_LABELS,
} from '../screenshot/ui-helpers';

const NOW = 1_700_000_000_000;

describe('isTextInputEmpty', () => {
  test('empty → true', () => expect(isTextInputEmpty('')).toBe(true));
  test('whitespace → true', () => expect(isTextInputEmpty('   \n\n  ')).toBe(true));
  test('single char → false', () => expect(isTextInputEmpty('x')).toBe(false));
  test('multi-line → false', () => expect(isTextInputEmpty('RSRP: -92')).toBe(false));
  test('non-string → true', () => {
    expect(isTextInputEmpty(null as any)).toBe(true);
    expect(isTextInputEmpty(undefined as any)).toBe(true);
    expect(isTextInputEmpty(123 as any)).toBe(true);
  });
});

describe('isTextInputTooLong', () => {
  test('exactly MAX → false', () => {
    expect(isTextInputTooLong('a'.repeat(MAX_TEXT_INPUT_LENGTH))).toBe(false);
  });
  test('MAX + 1 → true', () => {
    expect(isTextInputTooLong('a'.repeat(MAX_TEXT_INPUT_LENGTH + 1))).toBe(true);
  });
  test('short → false', () => expect(isTextInputTooLong('hello')).toBe(false));
  test('non-string → false', () => expect(isTextInputTooLong(null as any)).toBe(false));
});

describe('isTextInputValid', () => {
  test('valid → true', () => expect(isTextInputValid('RSRP: -92')).toBe(true));
  test('empty → false', () => expect(isTextInputValid('')).toBe(false));
  test('too long → false', () => {
    expect(isTextInputValid('a'.repeat(MAX_TEXT_INPUT_LENGTH + 1))).toBe(false);
  });
  test('whitespace only → false', () => expect(isTextInputValid('   ')).toBe(false));
});

describe('buildMinimalRouter', () => {
  test('host preserved', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).host).toBe('192.168.8.1');
  });
  test('protocols = [http]', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).protocols).toEqual(['http']);
  });
  test('manufacturer/model UNKNOWN', () => {
    const r = buildMinimalRouter('192.168.8.1', NOW);
    expect(r.manufacturer.value).toBeNull();
    expect(r.manufacturer.confidence).toBe('UNKNOWN');
    expect(r.model.value).toBeNull();
  });
  test('firmware/hardwareVersion UNKNOWN', () => {
    const r = buildMinimalRouter('192.168.8.1', NOW);
    expect(r.firmware.value).toBeNull();
    expect(r.hardwareVersion.value).toBeNull();
  });
  test('endpoints empty', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).endpoints).toEqual([]);
  });
  test('fingerprints empty', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).fingerprints).toEqual([]);
  });
  test('signal/band/cell fields empty', () => {
    const r = buildMinimalRouter('192.168.8.1', NOW);
    expect(Object.keys(r.signalFields)).toEqual([]);
    expect(Object.keys(r.bandFields)).toEqual([]);
    expect(Object.keys(r.cellFields)).toEqual([]);
  });
  test('errors empty', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).errors).toEqual([]);
  });
  test('capabilities all UNKNOWN', () => {
    const r = buildMinimalRouter('192.168.8.1', NOW);
    for (const v of Object.values(r.capabilities)) {
      expect(v.value).toBeNull();
      expect(v.confidence).toBe('UNKNOWN');
    }
  });
  test('compatLevel = DISCOVERY_ONLY', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).compatLevel).toBe('DISCOVERY_ONLY');
  });
  test('at = now', () => {
    expect(buildMinimalRouter('192.168.8.1', NOW).at).toBe(NOW);
  });
});

describe('WARNING_LABELS', () => {
  const codes = [
    'SENSITIVE_FIELD_DROPPED',
    'VALUE_SANITIZED',
    'LAN_ENDPOINT_DROPPED',
    'WRITE_ENDPOINT_DROPPED',
    'INVALID_VALUE_DROPPED',
    'AMBIGUOUS_FIELD_DROPPED',
    'INVALID_TIMESTAMP',
  ] as const;

  test.each(codes)('has Arabic label for %s', (code) => {
    expect(WARNING_LABELS[code]).toBeTruthy();
    expect(/[\u0600-\u06FF]/.test(WARNING_LABELS[code])).toBe(true);
  });
});

describe('translateWarning', () => {
  test('known code → Arabic', () => {
    expect(translateWarning('SENSITIVE_FIELD_DROPPED')).toMatch(/حساس/);
  });
  test('unknown → fallback without leaking code', () => {
    const r = translateWarning('MADE_UP' as any);
    expect(r).toBeTruthy();
    expect(r).not.toBe('MADE_UP');
  });
  test('all codes non-empty', () => {
    const codes = Object.keys(WARNING_LABELS) as Array<keyof typeof WARNING_LABELS>;
    for (const c of codes) {
      expect(translateWarning(c).length).toBeGreaterThan(0);
    }
  });
});

describe('BUCKET_LABELS', () => {
  test('all 4 buckets present', () => {
    expect(BUCKET_LABELS.signalFields).toBeTruthy();
    expect(BUCKET_LABELS.bandFields).toBeTruthy();
    expect(BUCKET_LABELS.cellFields).toBeTruthy();
    expect(BUCKET_LABELS.networkFields).toBeTruthy();
  });
  test('all Arabic', () => {
    for (const v of Object.values(BUCKET_LABELS)) {
      expect(/[\u0600-\u06FF]/.test(v)).toBe(true);
    }
  });
});
