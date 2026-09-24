/**
 * screenshot-review-ui.test.ts — PHASE 4C-2C-2
 * Pure display-helper tests — no React, no snapshots.
 */

import {
  formatReviewedField,
  shouldShowBucket,
  shouldShowIdentity,
  translateEditReason,
  FIELD_LABELS,
  FIELD_UNITS,
} from '../screenshot/ui-helpers';
import { ReviewedField } from '../screenshot/review';

function f(value: string, edited = false): ReviewedField {
  return {
    currentValue: value,
    originalValue: value,
    edited,
    source: 'screenshot',
    confidence: 'OBSERVED',
    volatility: 'dynamic',
    at: 1_700_000_000_000,
  };
}

describe('formatReviewedField — signal fields', () => {
  test('rsrp with dBm unit', () => {
    const x = formatReviewedField('rsrp', f('-92'));
    expect(x.label).toBe('RSRP');
    expect(x.unit).toBe('dBm');
    expect(x.value).toBe('-92');
    expect(x.display).toBe('RSRP: -92 dBm');
  });
  test('sinr with dB unit', () => {
    expect(formatReviewedField('sinr', f('18')).display).toBe('SINR: 18 dB');
  });
  test('rsrq with dB unit', () => {
    expect(formatReviewedField('rsrq', f('-10')).unit).toBe('dB');
  });
  test('rssi with dBm unit', () => {
    expect(formatReviewedField('rssi', f('-65')).unit).toBe('dBm');
  });
  test('pci has no unit', () => {
    const x = formatReviewedField('pci', f('123'));
    expect(x.unit).toBe('');
    expect(x.display).toBe('PCI: 123');
  });
});

describe('formatReviewedField — band/cell', () => {
  test('band no unit', () => {
    expect(formatReviewedField('band', f('n78')).display).toBe('Band: n78');
  });
  test('nrarfcn label', () => {
    expect(formatReviewedField('nrarfcn', f('640000')).display).toBe('NR-ARFCN: 640000');
  });
  test('earfcn label', () => {
    expect(formatReviewedField('earfcn', f('1650')).label).toBe('EARFCN');
  });
  test('cell_id label', () => {
    expect(formatReviewedField('cell_id', f('abc')).label).toBe('Cell ID');
  });
});

describe('formatReviewedField — identity', () => {
  test('vendor Arabic label', () => {
    const x = formatReviewedField('vendor', f('Huawei'));
    expect(x.label).toBe('الشركة');
    expect(x.display).toBe('الشركة: Huawei');
  });
  test('model Arabic label', () => {
    expect(formatReviewedField('model', f('MC888')).label).toBe('الموديل');
  });
});

describe('formatReviewedField — unknown key', () => {
  test('unknown key uses key as label', () => {
    expect(formatReviewedField('foo', f('bar')).label).toBe('foo');
  });
  test('unknown key has no unit', () => {
    expect(formatReviewedField('foo', f('bar')).unit).toBe('');
  });
});

describe('formatReviewedField — edited marker', () => {
  test('edited=true propagated', () => {
    expect(formatReviewedField('rsrp', f('-92', true)).edited).toBe(true);
  });
  test('edited=false propagated', () => {
    expect(formatReviewedField('rsrp', f('-92', false)).edited).toBe(false);
  });
});

describe('shouldShowBucket', () => {
  test('empty → false', () => expect(shouldShowBucket({})).toBe(false));
  test('one field → true', () => expect(shouldShowBucket({ rsrp: f('-92') })).toBe(true));
  test('many fields → true', () => expect(shouldShowBucket({ a: f('1'), b: f('2') })).toBe(true));
});

describe('shouldShowIdentity', () => {
  test('both null → false', () => expect(shouldShowIdentity({ vendor: null, model: null })).toBe(false));
  test('vendor only → true', () => expect(shouldShowIdentity({ vendor: f('X'), model: null })).toBe(true));
  test('model only → true', () => expect(shouldShowIdentity({ vendor: null, model: f('Y') })).toBe(true));
  test('both → true', () => expect(shouldShowIdentity({ vendor: f('X'), model: f('Y') })).toBe(true));
});

describe('translateEditReason', () => {
  test('INVALID_VALUE', () => {
    expect(translateEditReason('INVALID_VALUE')).toBe('القيمة غير صالحة');
  });
  test('SENSITIVE_VALUE', () => {
    expect(translateEditReason('SENSITIVE_VALUE')).toMatch(/حساس/);
  });
  test('UNKNOWN_FIELD', () => {
    expect(translateEditReason('UNKNOWN_FIELD')).toBe('حقل غير معروف');
  });
});

describe('FIELD_LABELS completeness', () => {
  const keys = [
    'rsrp', 'rsrq', 'rssi', 'sinr', 'pci',
    'earfcn', 'nrarfcn', 'band', 'bandwidth',
    'cell_id', 'tac', 'mcc', 'mnc',
    'network_type', 'operator', 'vendor', 'model',
  ];
  test.each(keys)('has label for %s', (k) => {
    expect(FIELD_LABELS[k]).toBeTruthy();
  });
});

describe('FIELD_UNITS sanity', () => {
  test('only known signal fields have units', () => {
    expect(FIELD_UNITS.rsrp).toBe('dBm');
    expect(FIELD_UNITS.rsrq).toBe('dB');
    expect(FIELD_UNITS.pci).toBeUndefined();
    expect(FIELD_UNITS.band).toBeUndefined();
    expect(FIELD_UNITS.cell_id).toBeUndefined();
  });
});
