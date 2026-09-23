/**
 * screenshot-input.test.ts — PHASE 4C-1
 */

import {
  textToBlocks,
  runScreenshotTextPipeline,
  createConsentState,
  grantConsent,
  revokeConsent,
} from '../screenshot';

const FIXED_AT = 1_700_000_000_000;

function granted() {
  return grantConsent(createConsentState(), FIXED_AT);
}

// ═══════════════════════════════════════════════════════════════════════
// textToBlocks
// ═══════════════════════════════════════════════════════════════════════

describe('textToBlocks', () => {
  test('empty string → []', () => {
    expect(textToBlocks('')).toEqual([]);
  });

  test('whitespace only → []', () => {
    expect(textToBlocks('   \t  \n\n  ')).toEqual([]);
  });

  test('single line → 1 block', () => {
    const r = textToBlocks('RSRP: -92');
    expect(r.length).toBe(1);
    expect(r[0].text).toBe('RSRP: -92');
  });

  test('multi-line single paragraph → 1 block', () => {
    const r = textToBlocks('RSRP: -92\nSINR: 18');
    expect(r.length).toBe(1);
    expect(r[0].text).toBe('RSRP: -92\nSINR: 18');
  });

  test('multi-paragraph → multiple blocks', () => {
    const r = textToBlocks('RSRP: -92\nSINR: 18\n\nBand: B3\nPCI: 123');
    expect(r.length).toBe(2);
    expect(r[0].text).toBe('RSRP: -92\nSINR: 18');
    expect(r[1].text).toBe('Band: B3\nPCI: 123');
  });

  test('trims each block', () => {
    const r = textToBlocks('  RSRP: -92  \n\n  SINR: 18  ');
    expect(r[0].text).toBe('RSRP: -92');
    expect(r[1].text).toBe('SINR: 18');
  });

  test('drops empty paragraphs between separators', () => {
    const r = textToBlocks('RSRP: -92\n\n\n\nSINR: 18');
    expect(r.length).toBe(2);
  });

  test('non-string input → []', () => {
    expect(textToBlocks(null as any)).toEqual([]);
    expect(textToBlocks(undefined as any)).toEqual([]);
    expect(textToBlocks(123 as any)).toEqual([]);
  });

  test('CRLF handled', () => {
    const r = textToBlocks('RSRP: -92\r\n\r\nSINR: 18');
    expect(r.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// runScreenshotTextPipeline — consent gate
// ═══════════════════════════════════════════════════════════════════════

describe('pipeline — consent gate', () => {
  test('PENDING consent → CONSENT_MISSING', () => {
    const r = runScreenshotTextPipeline({
      consent: createConsentState(),
      text: 'RSRP: -92',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('CONSENT_MISSING');
  });

  test('REVOKED consent → CONSENT_MISSING', () => {
    const r = runScreenshotTextPipeline({
      consent: revokeConsent(granted()),
      text: 'RSRP: -92',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('CONSENT_MISSING');
  });

  test('GRANTED consent + empty text → EMPTY_INPUT', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: '',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EMPTY_INPUT');
  });

  test('GRANTED consent + whitespace only → EMPTY_INPUT', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: '   \n\n   ',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EMPTY_INPUT');
  });

  test('GRANTED consent + valid text → ok:true', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'RSRP: -92\nSINR: 18',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// runScreenshotTextPipeline — evidence flow
// ═══════════════════════════════════════════════════════════════════════

describe('pipeline — evidence extraction', () => {
  test('extracts signal fields', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'RSRP: -92\nSINR: 18\nPCI: 123',
      capturedAt: FIXED_AT,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.signalFields.rsrp?.value).toBe('-92');
      expect(r.result.signalFields.sinr?.value).toBe('18');
      expect(r.result.signalFields.pci?.value).toBe('123');
    }
  });

  test('extracts identity', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'Vendor: ZTE\nModel: MC888',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      expect(r.result.identity.vendor?.value).toBe('ZTE');
      expect(r.result.identity.model?.value).toBe('MC888');
    }
  });

  test('passes capturedAt through', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'RSRP: -92',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      expect(r.result.signalFields.rsrp?.at).toBe(FIXED_AT);
    }
  });

  test('multi-paragraph text works', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'Vendor: Huawei\n\nRSRP: -92\nSINR: 18\n\nBand: B3',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      expect(r.result.identity.vendor?.value).toBe('Huawei');
      expect(r.result.signalFields.rsrp?.value).toBe('-92');
      expect(r.result.bandFields.band?.value).toBe('B3');
    }
  });

  test('endpoint hints extracted', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'RSRP: -92\n/api/device/signal',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      expect(r.result.endpointHints.length).toBe(1);
      expect(r.result.endpointHints[0].path).toBe('/api/device/signal');
    }
  });

  test('sensitive fields dropped from pipeline', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'RSRP: -92\nIMEI: 490154203237518\nPassword: secret123',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      const json = JSON.stringify(r.result);
      expect(json).not.toContain('490154203237518');
      expect(json).not.toContain('secret123');
      expect(r.result.warnings).toContain('SENSITIVE_FIELD_DROPPED');
    }
  });

  test('does not mutate consent state', () => {
    const c = granted();
    const snap = JSON.stringify(c);
    runScreenshotTextPipeline({
      consent: c,
      text: 'RSRP: -92',
      capturedAt: FIXED_AT,
    });
    expect(JSON.stringify(c)).toBe(snap);
  });

  test('same input → same output (deterministic)', () => {
    const input = {
      consent: granted(),
      text: 'RSRP: -92\nSINR: 18\nBand: B3',
      capturedAt: FIXED_AT,
    };
    const r1 = runScreenshotTextPipeline(input);
    const r2 = runScreenshotTextPipeline(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test('result has no capabilities field', () => {
    const r = runScreenshotTextPipeline({
      consent: granted(),
      text: 'Band Lock\nReboot Device\nRSRP: -92',
      capturedAt: FIXED_AT,
    });
    if (r.ok) {
      expect((r.result as any).capabilities).toBeUndefined();
      expect((r.result as any).bandLock).toBeUndefined();
      expect((r.result as any).reboot).toBeUndefined();
    }
  });
});
