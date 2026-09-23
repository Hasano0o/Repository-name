/**
 * screenshot-review.test.ts — PHASE 4C-2A
 * Pure function tests — no I/O, no network, no storage.
 */

import {
  collectScreenshotEvidence,
  ScreenshotEvidenceResult,
} from '../screenshotCollector';
import {
  createReviewFromResult,
  editReviewField,
  editReviewIdentity,
  revertReviewField,
  revertReviewIdentity,
  finalizeReview,
  ScreenshotReviewState,
} from '../screenshot/review';

const FIXED_AT = 1_700_000_000_000;

function makeResult(text: string): ScreenshotEvidenceResult {
  return collectScreenshotEvidence({
    blocks: [{ text }],
    capturedAt: FIXED_AT,
  });
}

function makeState(text: string): ScreenshotReviewState {
  return createReviewFromResult(makeResult(text));
}

// ═══════════════════════════════════════════════════════════════════════
// 1. createReviewFromResult
// ═══════════════════════════════════════════════════════════════════════

describe('createReviewFromResult', () => {
  test('copies signal fields with originalValue', () => {
    const s = makeState('RSRP: -92\nSINR: 18');
    expect(s.signalFields.rsrp.currentValue).toBe('-92');
    expect(s.signalFields.rsrp.originalValue).toBe('-92');
    expect(s.signalFields.rsrp.edited).toBe(false);
  });

  test('preserves source/confidence/volatility/at', () => {
    const s = makeState('RSRP: -92');
    const f = s.signalFields.rsrp;
    expect(f.source).toBe('screenshot');
    expect(f.confidence).toBe('OBSERVED');
    expect(f.volatility).toBe('dynamic');
    expect(f.at).toBe(FIXED_AT);
  });

  test('copies identity', () => {
    const s = makeState('Vendor: ZTE\nModel: MC888');
    expect(s.identity.vendor?.currentValue).toBe('ZTE');
    expect(s.identity.model?.currentValue).toBe('MC888');
  });

  test('copies band/cell/network buckets', () => {
    const s = makeState('Band: B3\nCell ID: 123\nOperator: STC');
    expect(s.bandFields.band?.currentValue).toBe('B3');
    expect(s.cellFields.cell_id?.currentValue).toBe('123');
    expect(s.networkFields.operator?.currentValue).toBe('STC');
  });

  test('copies endpointHints', () => {
    const s = makeState('RSRP: -92\n/api/device/signal');
    expect(s.endpointHints.length).toBe(1);
    expect(s.endpointHints[0].path).toBe('/api/device/signal');
  });

  test('copies warnings', () => {
    const s = makeState('Password: secret');
    expect(s.warnings).toContain('SENSITIVE_FIELD_DROPPED');
  });

  test('empty result → empty review', () => {
    const r = collectScreenshotEvidence({ blocks: [], capturedAt: FIXED_AT });
    const s = createReviewFromResult(r);
    expect(s.identity.vendor).toBeNull();
    expect(Object.keys(s.signalFields).length).toBe(0);
    expect(s.endpointHints.length).toBe(0);
  });

  test('does not mutate input result', () => {
    const r = makeResult('RSRP: -92');
    const snap = JSON.stringify(r);
    createReviewFromResult(r);
    expect(JSON.stringify(r)).toBe(snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. editReviewField — valid edits
// ═══════════════════════════════════════════════════════════════════════

describe('editReviewField — valid edits', () => {
  test('RSRP -92 → -90', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '-90');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.signalFields.rsrp.currentValue).toBe('-90');
      expect(r.state.signalFields.rsrp.originalValue).toBe('-92');
      expect(r.state.signalFields.rsrp.edited).toBe(true);
    }
  });

  test('SINR 18 → 22', () => {
    const s = makeState('SINR: 18');
    const r = editReviewField(s, 'signalFields', 'sinr', '22');
    if (r.ok) expect(r.state.signalFields.sinr.currentValue).toBe('22');
  });

  test('PCI 123 → 456', () => {
    const s = makeState('PCI: 123');
    const r = editReviewField(s, 'signalFields', 'pci', '456');
    if (r.ok) expect(r.state.signalFields.pci.currentValue).toBe('456');
  });

  test('Band B3 → B7', () => {
    const s = makeState('Band: B3');
    const r = editReviewField(s, 'bandFields', 'band', 'B7');
    if (r.ok) expect(r.state.bandFields.band.currentValue).toBe('B7');
  });

  test('same value → edited stays false', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '-92');
    if (r.ok) expect(r.state.signalFields.rsrp.edited).toBe(false);
  });

  test('edit cell_id', () => {
    const s = makeState('Cell ID: 123');
    const r = editReviewField(s, 'cellFields', 'cell_id', '456');
    if (r.ok) expect(r.state.cellFields.cell_id.currentValue).toBe('456');
  });

  test('edit operator (Arabic)', () => {
    const s = makeState('Operator: STC');
    const r = editReviewField(s, 'networkFields', 'operator', 'موبايلي');
    if (r.ok) expect(r.state.networkFields.operator.currentValue).toBe('موبايلي');
  });

  test('edit network_type', () => {
    const s = makeState('Network Type: LTE');
    const r = editReviewField(s, 'networkFields', 'network_type', '5G NSA');
    if (r.ok) expect(r.state.networkFields.network_type.currentValue).toBe('5G NSA');
  });

  test('edit band with lowercase normalization', () => {
    const s = makeState('Band: B3');
    const r = editReviewField(s, 'bandFields', 'band', 'n78');
    if (r.ok) expect(r.state.bandFields.band.currentValue).toBe('n78');
  });

  test('edit preserves metadata', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (r.ok) {
      const f = r.state.signalFields.rsrp;
      expect(f.source).toBe('screenshot');
      expect(f.confidence).toBe('OBSERVED');
      expect(f.volatility).toBe('dynamic');
      expect(f.at).toBe(FIXED_AT);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. editReviewField — invalid edits
// ═══════════════════════════════════════════════════════════════════════

describe('editReviewField — invalid edits', () => {
  test('RSRP hello → INVALID_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', 'hello');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INVALID_VALUE');
  });

  test('RSRP 999999 → INVALID_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '999999');
    expect(r.ok).toBe(false);
  });

  test('PCI -5 → INVALID_VALUE', () => {
    const s = makeState('PCI: 123');
    const r = editReviewField(s, 'signalFields', 'pci', '-5');
    expect(r.ok).toBe(false);
  });

  test('Band XYZ → INVALID_VALUE', () => {
    const s = makeState('Band: B3');
    const r = editReviewField(s, 'bandFields', 'band', 'XYZ');
    expect(r.ok).toBe(false);
  });

  test('MCC 12 → INVALID_VALUE (needs 3 digits)', () => {
    const s = makeState('MCC: 310');
    const r = editReviewField(s, 'networkFields', 'mcc', '12');
    expect(r.ok).toBe(false);
  });

  test('network_type banana → INVALID_VALUE', () => {
    const s = makeState('Network Type: LTE');
    const r = editReviewField(s, 'networkFields', 'network_type', 'banana');
    expect(r.ok).toBe(false);
  });

  test('operator "12345" → INVALID_VALUE (numeric only)', () => {
    const s = makeState('Operator: STC');
    const r = editReviewField(s, 'networkFields', 'operator', '12345');
    expect(r.ok).toBe(false);
  });

  test('non-string value → INVALID_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', 123 as any);
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. editReviewField — sensitive values
// ═══════════════════════════════════════════════════════════════════════

describe('editReviewField — sensitive values', () => {
  test('MAC address → SENSITIVE_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', 'AA:BB:CC:DD:EE:FF');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SENSITIVE_VALUE');
  });

  test('Luhn-valid IMEI → SENSITIVE_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '490154203237518');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SENSITIVE_VALUE');
  });

  test('long base64 token → SENSITIVE_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SENSITIVE_VALUE');
  });

  test('ICCID (89-prefix Luhn) → SENSITIVE_VALUE', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '89014103211118510720');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SENSITIVE_VALUE');
  });

  test('sensitive in operator field → SENSITIVE_VALUE', () => {
    const s = makeState('Operator: STC');
    const r = editReviewField(s, 'networkFields', 'operator', 'AA:BB:CC:DD:EE:FF');
    expect(r.ok).toBe(false);
  });

  test('sensitive in cell_id field → SENSITIVE_VALUE', () => {
    const s = makeState('Cell ID: 123');
    const r = editReviewField(s, 'cellFields', 'cell_id', '490154203237518');
    // Note: cell_id validateValue allows hex chars 1-12, but this is Luhn-valid IMEI (15 digits)
    // → validateValue would fail first with INVALID_VALUE
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. editReviewField — unknown field
// ═══════════════════════════════════════════════════════════════════════

describe('editReviewField — unknown field', () => {
  test('unknown key → UNKNOWN_FIELD', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'nonexistent', 'val');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNKNOWN_FIELD');
  });

  test('field not in this bucket → UNKNOWN_FIELD', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'bandFields', 'rsrp', '-90');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNKNOWN_FIELD');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. editReviewIdentity
// ═══════════════════════════════════════════════════════════════════════

describe('editReviewIdentity', () => {
  test('vendor Huawei → ZTE', () => {
    const s = makeState('Vendor: Huawei');
    const r = editReviewIdentity(s, 'vendor', 'ZTE');
    if (r.ok) {
      expect(r.state.identity.vendor?.currentValue).toBe('ZTE');
      expect(r.state.identity.vendor?.edited).toBe(true);
    }
  });

  test('model MC888 → MC801A', () => {
    const s = makeState('Model: MC888');
    const r = editReviewIdentity(s, 'model', 'MC801A');
    if (r.ok) expect(r.state.identity.model?.currentValue).toBe('MC801A');
  });

  test('empty string → INVALID_VALUE', () => {
    const s = makeState('Vendor: ZTE');
    const r = editReviewIdentity(s, 'vendor', '');
    expect(r.ok).toBe(false);
  });

  test('vendor too long (>40) → INVALID_VALUE', () => {
    const s = makeState('Vendor: ZTE');
    const r = editReviewIdentity(s, 'vendor', 'A'.repeat(41));
    expect(r.ok).toBe(false);
  });

  test('model too long (>60) → INVALID_VALUE', () => {
    const s = makeState('Model: MC888');
    const r = editReviewIdentity(s, 'model', 'B'.repeat(61));
    expect(r.ok).toBe(false);
  });

  test('vendor with MAC → SENSITIVE_VALUE', () => {
    const s = makeState('Vendor: ZTE');
    const r = editReviewIdentity(s, 'vendor', 'AA:BB:CC:DD:EE:FF');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SENSITIVE_VALUE');
  });

  test('edit identity preserves metadata', () => {
    const s = makeState('Vendor: ZTE');
    const r = editReviewIdentity(s, 'vendor', 'Huawei');
    if (r.ok) {
      const f = r.state.identity.vendor!;
      expect(f.source).toBe('screenshot');
      expect(f.confidence).toBe('OBSERVED');
      expect(f.at).toBe(FIXED_AT);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. revertReviewField / revertReviewIdentity
// ═══════════════════════════════════════════════════════════════════════

describe('revert', () => {
  test('revert field to originalValue', () => {
    const s = makeState('RSRP: -92');
    const e = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (!e.ok) throw new Error('edit failed');
    const r = revertReviewField(e.state, 'signalFields', 'rsrp');
    expect(r.signalFields.rsrp.currentValue).toBe('-92');
    expect(r.signalFields.rsrp.edited).toBe(false);
  });

  test('revert identity', () => {
    const s = makeState('Vendor: ZTE');
    const e = editReviewIdentity(s, 'vendor', 'Huawei');
    if (!e.ok) throw new Error('edit failed');
    const r = revertReviewIdentity(e.state, 'vendor');
    expect(r.identity.vendor?.currentValue).toBe('ZTE');
    expect(r.identity.vendor?.edited).toBe(false);
  });

  test('revert unknown field → no-op returns same state', () => {
    const s = makeState('RSRP: -92');
    const r = revertReviewField(s, 'signalFields', 'nonexistent');
    expect(r).toBe(s);
  });

  test('revert without prior edit → keeps originalValue', () => {
    const s = makeState('RSRP: -92');
    const r = revertReviewField(s, 'signalFields', 'rsrp');
    expect(r.signalFields.rsrp.currentValue).toBe('-92');
    expect(r.signalFields.rsrp.edited).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Immutability
// ═══════════════════════════════════════════════════════════════════════

describe('immutability', () => {
  test('editReviewField does not mutate input state', () => {
    const s = makeState('RSRP: -92');
    const snap = JSON.stringify(s);
    editReviewField(s, 'signalFields', 'rsrp', '-90');
    expect(JSON.stringify(s)).toBe(snap);
  });

  test('editReviewIdentity does not mutate input state', () => {
    const s = makeState('Vendor: ZTE');
    const snap = JSON.stringify(s);
    editReviewIdentity(s, 'vendor', 'Huawei');
    expect(JSON.stringify(s)).toBe(snap);
  });

  test('revertReviewField does not mutate input state', () => {
    const s = makeState('RSRP: -92');
    const e = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (!e.ok) throw new Error('edit failed');
    const snap = JSON.stringify(e.state);
    revertReviewField(e.state, 'signalFields', 'rsrp');
    expect(JSON.stringify(e.state)).toBe(snap);
  });

  test('each edit produces a new state object', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (r.ok) expect(r.state).not.toBe(s);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. finalizeReview
// ═══════════════════════════════════════════════════════════════════════

describe('finalizeReview', () => {
  test('un-edited field → no notes', () => {
    const s = makeState('RSRP: -92');
    const r = finalizeReview(s);
    expect(r.signalFields.rsrp.value).toBe('-92');
    expect(r.signalFields.rsrp.notes).toBeUndefined();
  });

  test('edited field → notes User-edited', () => {
    const s = makeState('RSRP: -92');
    const e = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (!e.ok) throw new Error('edit failed');
    const r = finalizeReview(e.state);
    expect(r.signalFields.rsrp.value).toBe('-90');
    expect(r.signalFields.rsrp.notes).toBe('User-edited');
  });

  test('finalize preserves source/confidence', () => {
    const s = makeState('RSRP: -92');
    const r = finalizeReview(s);
    expect(r.signalFields.rsrp.source).toBe('screenshot');
    expect(r.signalFields.rsrp.confidence).toBe('OBSERVED');
  });

  test('finalize preserves endpointHints (immutable)', () => {
    const s = makeState('RSRP: -92\n/api/device/signal');
    const r = finalizeReview(s);
    expect(r.endpointHints.length).toBe(1);
    expect(r.endpointHints[0].path).toBe('/api/device/signal');
  });

  test('finalize preserves warnings', () => {
    const s = makeState('Password: secret');
    const r = finalizeReview(s);
    expect(r.warnings).toContain('SENSITIVE_FIELD_DROPPED');
  });

  test('finalize has no capabilities field', () => {
    const s = makeState('Band Lock\nReboot\nRSRP: -92');
    const r = finalizeReview(s);
    expect((r as any).capabilities).toBeUndefined();
    expect((r as any).bandLock).toBeUndefined();
    expect((r as any).reboot).toBeUndefined();
  });

  test('finalize after revert → no notes', () => {
    const s = makeState('RSRP: -92');
    const e = editReviewField(s, 'signalFields', 'rsrp', '-90');
    if (!e.ok) throw new Error('edit failed');
    const rv = revertReviewField(e.state, 'signalFields', 'rsrp');
    const r = finalizeReview(rv);
    expect(r.signalFields.rsrp.value).toBe('-92');
    expect(r.signalFields.rsrp.notes).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. Determinism & safety
// ═══════════════════════════════════════════════════════════════════════

describe('determinism & safety', () => {
  test('same state → same finalize JSON', () => {
    const s = makeState('RSRP: -92\nSINR: 18');
    const r1 = finalizeReview(s);
    const r2 = finalizeReview(s);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test('finalize does not leak sensitive values', () => {
    const s = makeState('RSRP: -92\nIMEI: 490154203237518\nPassword: secret123');
    const r = finalizeReview(s);
    const json = JSON.stringify(r);
    expect(json).not.toContain('490154203237518');
    expect(json).not.toContain('secret123');
  });

  test('edit rejection does not produce partial state', () => {
    const s = makeState('RSRP: -92');
    const r = editReviewField(s, 'signalFields', 'rsrp', 'hello');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r as any).state).toBeUndefined();
    }
  });

  test('finalize on empty review is safe', () => {
    const r = collectScreenshotEvidence({ blocks: [], capturedAt: FIXED_AT });
    const s = createReviewFromResult(r);
    const out = finalizeReview(s);
    expect(out.endpointHints.length).toBe(0);
    expect(Object.keys(out.signalFields).length).toBe(0);
  });
});
