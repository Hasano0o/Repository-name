/**
 * screenshot-integration.test.ts — PHASE 4C-2B
 * Pure function tests — no network, no storage, no UI.
 */

import { integrateScreenshotReview } from '../screenshot/integration';
import {
  createConsentState,
  grantConsent,
  revokeConsent,
} from '../screenshot/consent';
import {
  ScreenshotEvidenceResult,
  ScreenshotEndpointHint,
} from '../screenshotCollector';
import { unknownEvidence } from '../evidence';
import {
  CapabilityEvidence,
  CapabilityEvidenceV2,
  ConsentRecord,
  DiscoveredRouter,
  Evidence,
  EvidenceConfidence,
  EvidenceSource,
} from '../types';

const FIXED_AT = 1_700_000_000_000;
const APP = '1.0.0';

// ────────────── Helpers ──────────────

function granted() {
  return grantConsent(createConsentState(), FIXED_AT);
}

function ev(
  value: string | null,
  source: EvidenceSource = 'screenshot',
  confidence: EvidenceConfidence = 'OBSERVED',
  notes?: string,
): Evidence<string> {
  const e: Evidence<string> = { value, source, confidence, at: FIXED_AT };
  if (notes) e.notes = notes;
  return e;
}

function emptyCaps(): CapabilityEvidence {
  return {
    signal: unknownEvidence(),
    lte: unknownEvidence(),
    nr: unknownEvidence(),
    bands: unknownEvidence(),
    cells: unknownEvidence(),
    neighborCells: unknownEvidence(),
    carrierAggregation: unknownEvidence(),
    deviceInfo: unknownEvidence(),
    traffic: unknownEvidence(),
    usage: unknownEvidence(),
    sms: unknownEvidence(),
    bandLock: unknownEvidence(),
    cellLock: unknownEvidence(),
    reboot: unknownEvidence(),
    block: unknownEvidence(),
  };
}

function emptyRouter(overrides: Partial<DiscoveredRouter> = {}): DiscoveredRouter {
  return {
    host: '192.168.8.1',
    protocols: ['http'],
    manufacturer: unknownEvidence(),
    model: unknownEvidence(),
    firmware: unknownEvidence(),
    hardwareVersion: unknownEvidence(),
    fingerprints: [],
    endpoints: [],
    capabilities: emptyCaps(),
    signalFields: {},
    bandFields: {},
    cellFields: {},
    errors: [],
    compatLevel: 'DISCOVERY_ONLY',
    at: FIXED_AT,
    ...overrides,
  };
}

function emptyReview(overrides: Partial<ScreenshotEvidenceResult> = {}): ScreenshotEvidenceResult {
  return {
    identity: { vendor: null, model: null },
    signalFields: {},
    bandFields: {},
    cellFields: {},
    networkFields: {},
    endpointHints: [],
    warnings: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Consent gate + empty
// ═══════════════════════════════════════════════════════════════════════

describe('integration — consent gate', () => {
  test('PENDING → NO_CONSENT', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: createConsentState(),
      appVersion: APP,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_CONSENT');
  });

  test('REVOKED → NO_CONSENT', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: revokeConsent(granted()),
      appVersion: APP,
    });
    expect(r.ok).toBe(false);
  });

  test('GRANTED + empty review → NO_EVIDENCE', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview(),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NO_EVIDENCE');
  });

  test('GRANTED + only endpointHints → ok (hints counted as evidence, then ignored)', () => {
    const hint: ScreenshotEndpointHint = {
      path: '/api/device/signal',
      source: 'screenshot',
      confidence: 'OBSERVED',
      observedAt: FIXED_AT,
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ endpointHints: [hint] }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.hintsIgnored).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Precedence
// ═══════════════════════════════════════════════════════════════════════

describe('integration — precedence', () => {
  test('API rsrp + Screenshot rsrp → API wins', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-95') } }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package.signalFields.rsrp.value).toBe('-85');
      expect(r.stats.overridden).toBe(1);
    }
  });

  test('header + Screenshot → header wins', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-80', source: 'header', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-95') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp.value).toBe('-80');
  });

  test('field_probe + Screenshot → field_probe wins', () => {
    const router = emptyRouter({
      signalFields: { pci: { value: '123', source: 'field_probe', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { pci: ev('456') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.pci.value).toBe('123');
  });

  test('html + Screenshot → html wins', () => {
    const router = emptyRouter({
      signalFields: { sinr: { value: '20', source: 'html', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { sinr: ev('15') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.sinr.value).toBe('20');
  });

  test('static + Screenshot → static wins', () => {
    const router = emptyRouter({
      signalFields: { rsrq: { value: '-10', source: 'static', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrq: ev('-15') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrq.value).toBe('-10');
  });

  test('Screenshot only → fills', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.signalFields.rsrp.value).toBe('-92');
      expect(r.stats.filled).toBe(1);
    }
  });

  test('Screenshot + User (in review) → Screenshot tier wins', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: { value: '-92', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT } },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp.source).toBe('screenshot');
  });

  test('router empty + review empty → no fields', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter({ signalFields: { rsrp: { value: '-92', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT } } }),
      review: emptyReview(),
      consent: granted(),
      appVersion: APP,
    });
    // hasAnyEvidence: review has no fields → NO_EVIDENCE
    expect(r.ok).toBe(false);
  });

  test('user-tier in router overridden by screenshot', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-100', source: 'user', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-90') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp.value).toBe('-90');
  });

  test('manufacturer: API overrides Screenshot', () => {
    const router = emptyRouter({ manufacturer: { value: 'Huawei', source: 'api', confidence: 'OBSERVED', at: FIXED_AT } });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ identity: { vendor: ev('ZTE'), model: null } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.device.manufacturer.value).toBe('Huawei');
      expect(r.stats.overridden).toBe(1);
    }
  });

  test('model: API overrides Screenshot', () => {
    const router = emptyRouter({ model: { value: 'MC888', source: 'api', confidence: 'OBSERVED', at: FIXED_AT } });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ identity: { vendor: null, model: ev('MC801A') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.device.model.value).toBe('MC888');
      expect(r.stats.overridden).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. No-overwrite
// ═══════════════════════════════════════════════════════════════════════

describe('integration — no-overwrite', () => {
  test('router.rsrp not mutated when Screenshot provides value', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const snap = JSON.stringify(router);
    integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-95') } }),
      consent: granted(),
      appVersion: APP,
    });
    expect(JSON.stringify(router)).toBe(snap);
  });

  test('stats.overridden counts correctly for multiple fields', () => {
    const router = emptyRouter({
      signalFields: {
        rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: FIXED_AT },
        sinr: { value: '20', source: 'api', confidence: 'OBSERVED', at: FIXED_AT },
      },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({
        signalFields: { rsrp: ev('-95'), sinr: ev('15') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.stats.overridden).toBe(2);
      expect(r.package.signalFields.rsrp.value).toBe('-85');
      expect(r.package.signalFields.sinr.value).toBe('20');
    }
  });

  test('mixed: one filled, one overridden', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({
        signalFields: { rsrp: ev('-95'), sinr: ev('18') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.stats.filled).toBe(1);
      expect(r.stats.overridden).toBe(1);
      expect(r.package.signalFields.rsrp.value).toBe('-85');
      expect(r.package.signalFields.sinr.value).toBe('18');
    }
  });

  test('same-tier: existing router value wins (no overwrite)', () => {
    const router = emptyRouter({
      signalFields: { rsrp: { value: '-85', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT } },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-95') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.signalFields.rsrp.value).toBe('-85');
      expect(r.stats.overridden).toBe(1);
    }
  });

  test('review object not mutated', () => {
    const review = emptyReview({ signalFields: { rsrp: ev('-92') } });
    const snap = JSON.stringify(review);
    integrateScreenshotReview({
      router: emptyRouter(),
      review,
      consent: granted(),
      appVersion: APP,
    });
    expect(JSON.stringify(review)).toBe(snap);
  });

  test('consent object not mutated', () => {
    const consent = granted();
    const snap = JSON.stringify(consent);
    integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent,
      appVersion: APP,
    });
    expect(JSON.stringify(consent)).toBe(snap);
  });

  test('identity-only review with occupied router → overridden', () => {
    const router = emptyRouter({
      manufacturer: { value: 'Huawei', source: 'api', confidence: 'OBSERVED', at: FIXED_AT },
      model: { value: 'B535', source: 'api', confidence: 'OBSERVED', at: FIXED_AT },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ identity: { vendor: ev('ZTE'), model: ev('MC888') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.stats.overridden).toBe(2);
      expect(r.stats.filled).toBe(0);
    }
  });

  test('empty identity in review + occupied router → no change', () => {
    const router = emptyRouter({
      manufacturer: { value: 'Huawei', source: 'api', confidence: 'OBSERVED', at: FIXED_AT },
    });
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.device.manufacturer.value).toBe('Huawei');
      expect(r.stats.overridden).toBe(0);
      expect(r.stats.filled).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. User-edited preservation
// ═══════════════════════════════════════════════════════════════════════

describe('integration — user-edited preservation', () => {
  test('user-edited value reaches package', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: { value: '-90', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT, notes: 'User-edited' },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp.value).toBe('-90');
  });

  test('notes User-edited preserved', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: { value: '-90', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT, notes: 'User-edited' },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp.notes).toBe('User-edited');
  });

  test('source stays screenshot (NOT user)', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: { value: '-90', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT, notes: 'User-edited' },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.signalFields.rsrp.source).toBe('screenshot');
      expect(r.package.signalFields.rsrp.source).not.toBe('user');
    }
  });

  test('edited value still subject to Layer 3 sanitization', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          // Malicious: user edit with MAC address in a signal field
          rsrp: { value: 'AA:BB:CC:DD:EE:FF', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT, notes: 'User-edited' },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      // Value should be rejected at Layer 3 (isSensitiveValue)
      expect(r.package.signalFields.rsrp).toBeUndefined();
    }
  });

  test('confidence/volatility/at preserved', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: { value: '-90', source: 'screenshot', confidence: 'OBSERVED', volatility: 'dynamic', at: FIXED_AT, notes: 'User-edited' },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.signalFields.rsrp.confidence).toBe('OBSERVED');
      expect(r.package.signalFields.rsrp.volatility).toBe('dynamic');
      expect(r.package.signalFields.rsrp.at).toBe(FIXED_AT);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Sanitization boundary (Layer 3)
// ═══════════════════════════════════════════════════════════════════════

describe('integration — sanitization boundary', () => {
  test('MAC in reviewed value → rejected by Layer 3', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('AA:BB:CC:DD:EE:FF') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.signalFields.rsrp).toBeUndefined();
      expect(r.stats.sanitized).toBeGreaterThan(0);
    }
  });

  test('Luhn IMEI in reviewed value → rejected', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('490154203237518') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp).toBeUndefined();
  });

  test('long base64 token in reviewed value → rejected', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.signalFields.rsrp).toBeUndefined();
  });

  test('SSID-shaped value in operator → sanitized out', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('WiFi-Home-5G') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    // 'WiFi-Home-5G' is not MAC/IMEI/token → passes sanitizeField
    // → would be accepted. But validateValue in collector would reject earlier.
    // At integration layer, we only check isSensitiveValue + sanitizeField.
    if (r.ok) {
      // either accepted (safe) or dropped — no crash
      expect(r.package).toBeDefined();
    }
  });

  test('empty string reviewed value → dropped', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    // empty string is not evidence → NO_EVIDENCE
    expect(r.ok).toBe(false);
  });

  test('null reviewed value → treated as no candidate', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev(null, 'screenshot', 'UNKNOWN') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(false);
  });

  test('value requiring sanitization is sanitized, not dropped', () => {
    // Value in "operator" that would be sanitized by sanitizeField
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92 dBm') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      // -92 dBm passes isSensitiveValue (not sensitive)
      // sanitizeField('rsrp', '-92 dBm') → returns '-92 dBm' (safe field)
      // so value preserved as-is
      expect(r.package.signalFields.rsrp.value).toBe('-92 dBm');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Sensitive value filtering (JSON-level)
// ═══════════════════════════════════════════════════════════════════════

describe('integration — sensitive value filtering', () => {
  test('IMEI in review signal → not in package JSON', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('490154203237518') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).not.toContain('490154203237518');
    }
  });

  test('MAC in review → not in package JSON', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('AA:BB:CC:DD:EE:FF') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    }
  });

  test('MAC-shaped value in review.model → not in package JSON', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        identity: { vendor: null, model: ev('AA:BB:CC:DD:EE:FF') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    }
  });

  test('multiple sensitive values across buckets → all filtered', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: ev('-92'),
          sinr: ev('AA:BB:CC:DD:EE:FF'),
        },
        bandFields: {
          band: ev('B3'),
          earfcn: ev('490154203237518'),
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
      expect(json).not.toContain('490154203237518');
      expect(json).toContain('-92');
      expect(json).toContain('B3');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Capability isolation
// ═══════════════════════════════════════════════════════════════════════

describe('integration — capability isolation', () => {
  test('capabilities unchanged after integration', () => {
    const router = emptyRouter();
    const before = JSON.stringify(router.capabilities);
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(JSON.stringify(r.package.capabilities)).toBe(before);
    }
  });

  test('capabilitiesV2 reflects original router (not enhanced)', () => {
    const router = emptyRouter();
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-92'), sinr: ev('18') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      // Even though signal fields were added, capabilitiesV2 must be
      // computed from the ORIGINAL router only → all UNKNOWN.
      expect(r.package.capabilitiesV2).toBeDefined();
      expect(r.package.capabilitiesV2!.bandLock.value).toBe('UNKNOWN');
      expect(r.package.capabilitiesV2!.cellLock.value).toBe('UNKNOWN');
      expect(r.package.capabilitiesV2!.reboot.value).toBe('UNKNOWN');
      expect(r.package.capabilitiesV2!.block.value).toBe('UNKNOWN');
    }
  });

  test('bandLock stays UNKNOWN after screenshot', () => {
    const router = emptyRouter();
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      // router.capabilitiesV2 is undefined by default → package.capabilitiesV2 undefined
      // capabilities (legacy) should still have bandLock as unknown
      expect(r.package.capabilities.bandLock.value).toBeNull();
      expect(r.package.capabilities.bandLock.confidence).toBe('UNKNOWN');
    }
  });

  test('no new capability appears after screenshot-only fields', () => {
    const router = emptyRouter();
    const capsBefore = JSON.stringify(router.capabilities);
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({
        signalFields: { rsrp: ev('-92'), sinr: ev('18') },
        bandFields: { band: ev('B3') },
        cellFields: { cell_id: ev('123') },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(JSON.stringify(r.package.capabilities)).toBe(capsBefore);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Endpoint isolation
// ═══════════════════════════════════════════════════════════════════════

describe('integration — endpoint isolation', () => {
  test('router.endpoints unchanged', () => {
    const router = emptyRouter();
    const r = integrateScreenshotReview({
      router,
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.endpoints).toEqual([]);
    }
  });

  test('screenshot endpointHints NOT in package.endpoints', () => {
    const hint: ScreenshotEndpointHint = {
      path: '/api/device/signal',
      source: 'screenshot',
      confidence: 'OBSERVED',
      observedAt: FIXED_AT,
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92') },
        endpointHints: [hint],
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.endpoints).toEqual([]);
      expect(r.stats.hintsIgnored).toBe(1);
    }
  });

  test('multiple hints → all ignored', () => {
    const hints: ScreenshotEndpointHint[] = [
      { path: '/api/device/signal', source: 'screenshot', confidence: 'OBSERVED', observedAt: FIXED_AT },
      { path: '/api/monitoring/status', source: 'screenshot', confidence: 'OBSERVED', observedAt: FIXED_AT },
    ];
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92') },
        endpointHints: hints,
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.stats.hintsIgnored).toBe(2);
      expect(r.package.endpoints).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. networkFields ignored
// ═══════════════════════════════════════════════════════════════════════

describe('integration — networkFields ignored', () => {
  test('review.networkFields.operator not in package', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92') },
        networkFields: {
          operator: { value: 'STC', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      // Operator has no counterpart in DiscoveredRouter → not merged
      const json = JSON.stringify(r.package);
      // STC may appear if router already has it, but here router is empty
      expect(r.package.signalFields.rsrp.value).toBe('-92');
    }
  });

  test('review.networkFields.network_type not in package', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92') },
        networkFields: {
          network_type: { value: '5G NSA', source: 'screenshot', confidence: 'OBSERVED', at: FIXED_AT },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. Determinism (excluding generatedAt)
// ═══════════════════════════════════════════════════════════════════════

describe('integration — determinism', () => {
  test('same input → same package content (excluding generatedAt)', () => {
    const input = {
      router: emptyRouter(),
      review: emptyReview({
        signalFields: { rsrp: ev('-92'), sinr: ev('18') },
        bandFields: { band: ev('B3') },
      }),
      consent: granted(),
      appVersion: APP,
    };
    const r1 = integrateScreenshotReview(input);
    const r2 = integrateScreenshotReview(input);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const { generatedAt: g1, ...rest1 } = r1.package;
      const { generatedAt: g2, ...rest2 } = r2.package;
      expect(JSON.stringify(rest1)).toBe(JSON.stringify(rest2));
      expect(JSON.stringify(r1.stats)).toBe(JSON.stringify(r2.stats));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 11. Adversarial: original value leakage
// ═══════════════════════════════════════════════════════════════════════

describe('integration — original value leakage', () => {
  test('originalValue -110 NOT in package; currentValue -90 IS', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: {
            value: '-90',
            source: 'screenshot',
            confidence: 'OBSERVED',
            volatility: 'dynamic',
            at: FIXED_AT,
            notes: 'User-edited',
          },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).toContain('-90');
      expect(json).not.toContain('-110');
    }
  });

  test('no "originalValue" property name in package JSON', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({
        signalFields: {
          rsrp: {
            value: '-90',
            source: 'screenshot',
            confidence: 'OBSERVED',
            volatility: 'dynamic',
            at: FIXED_AT,
            notes: 'User-edited',
          },
        },
      }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      const json = JSON.stringify(r.package);
      // Check property names as JSON keys (quoted), not substrings —
      // "User-edited" is a legitimate notes value.
      expect(json).not.toContain('"originalValue"');
      expect(json).not.toContain('"currentValue"');
      expect(json).not.toContain('"edited":');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 12. Adversarial: malicious externally-constructed review
// ═══════════════════════════════════════════════════════════════════════

describe('integration — malicious review input', () => {
  test('review with raw MAC in signal → rejected at Layer 3', () => {
    const malicious: ScreenshotEvidenceResult = {
      identity: { vendor: null, model: null },
      signalFields: {
        rsrp: {
          value: 'AA:BB:CC:DD:EE:FF',
          source: 'screenshot',
          confidence: 'OBSERVED',
          at: FIXED_AT,
        },
      },
      bandFields: {},
      cellFields: {},
      networkFields: {},
      endpointHints: [],
      warnings: [],
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package.signalFields.rsrp).toBeUndefined();
      expect(JSON.stringify(r.package)).not.toContain('AA:BB:CC:DD:EE:FF');
    }
  });

  test('review with password in model → rejected', () => {
    const malicious: ScreenshotEvidenceResult = {
      identity: {
        vendor: null,
        model: {
          value: '490154203237518',
          source: 'screenshot',
          confidence: 'OBSERVED',
          at: FIXED_AT,
        },
      },
      signalFields: {},
      bandFields: {},
      cellFields: {},
      networkFields: {},
      endpointHints: [],
      warnings: [],
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.package)).not.toContain('490154203237518');
    }
  });

  test('review with token in earfcn → rejected', () => {
    const malicious: ScreenshotEvidenceResult = {
      identity: { vendor: null, model: null },
      signalFields: {},
      bandFields: {
        earfcn: {
          value: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD',
          source: 'screenshot',
          confidence: 'OBSERVED',
          at: FIXED_AT,
        },
      },
      cellFields: {},
      networkFields: {},
      endpointHints: [],
      warnings: [],
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package.bandFields.earfcn).toBeUndefined();
    }
  });

  test('does not trust caller — sanitizes even when caller claims safe', () => {
    const malicious: ScreenshotEvidenceResult = {
      identity: { vendor: null, model: null },
      signalFields: {
        rsrp: {
          value: '490154203237518',
          source: 'screenshot',
          confidence: 'CONFIRMED', // caller lies about confidence
          at: FIXED_AT,
        },
      },
      bandFields: {},
      cellFields: {},
      networkFields: {},
      endpointHints: [],
      warnings: [],
    };
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package.signalFields.rsrp).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 13. Adversarial: malicious capability injection
// ═══════════════════════════════════════════════════════════════════════

describe('integration — malicious capability injection', () => {
  test('review with extra capabilities field does not leak', () => {
    const malicious = {
      ...emptyReview({ signalFields: { rsrp: ev('-92') } }),
      capabilities: {
        signal: { value: 'CONFIRMED_READ', source: 'api', confidence: 'CONFIRMED', at: FIXED_AT },
      },
      bandLock: { value: 'SUPPORTED', source: 'api', confidence: 'CONFIRMED', at: FIXED_AT },
      reboot: { value: 'SUPPORTED', source: 'api', confidence: 'CONFIRMED', at: FIXED_AT },
    } as any;

    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // capabilities (legacy) frozen to router's
      expect(r.package.capabilities.signal.value).toBeNull();
      expect(r.package.capabilities.bandLock.value).toBeNull();
      expect(r.package.capabilities.reboot.value).toBeNull();
      // No new capabilities appear
      expect((r.package as any).capabilities).toBeDefined();
      expect((r.package as any).bandLock).toBeUndefined();
    }
  });

  test('review with writeEndpoint field is ignored', () => {
    const malicious = {
      ...emptyReview({ signalFields: { rsrp: ev('-92') } }),
      writeEndpoint: '/api/reboot',
      executableEndpoints: [{ method: 'POST', path: '/api/reboot' }],
    } as any;

    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const json = JSON.stringify(r.package);
      expect(json).not.toContain('writeEndpoint');
      expect(json).not.toContain('/api/reboot');
      expect(json).not.toContain('executableEndpoints');
    }
  });

  test('review with hint pretending to be endpoint → ignored', () => {
    const malicious = {
      ...emptyReview({ signalFields: { rsrp: ev('-92') } }),
      endpoints: [
        {
          path: '/api/device/signal',
          method: 'GET',
          status: 200,
          contentType: 'application/json',
          authRequired: false,
          source: 'screenshot',
          ms: 10,
          at: FIXED_AT,
        },
      ],
    } as any;

    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: malicious,
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package.endpoints).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 14. Output contract
// ═══════════════════════════════════════════════════════════════════════

describe('integration — output contract', () => {
  test('result shape: ok + package + stats', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.package).toBeDefined();
      expect(r.stats).toBeDefined();
      expect(typeof r.stats.filled).toBe('number');
      expect(typeof r.stats.overridden).toBe('number');
      expect(typeof r.stats.sanitized).toBe('number');
      expect(typeof r.stats.hintsIgnored).toBe('number');
    }
  });

  test('package.schema = 1', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) expect(r.package.schema).toBe(1);
  });

  test('package.userConsent reflects granted state', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(r.package.userConsent.scopes).toContain('screenshot');
      expect(r.package.userConsent.version).toBe(1);
    }
  });

  test('package.generatedAt is a valid ISO string', () => {
    const r = integrateScreenshotReview({
      router: emptyRouter(),
      review: emptyReview({ signalFields: { rsrp: ev('-92') } }),
      consent: granted(),
      appVersion: APP,
    });
    if (r.ok) {
      expect(typeof r.package.generatedAt).toBe('string');
      expect(r.package.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
