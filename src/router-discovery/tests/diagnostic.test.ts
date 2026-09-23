/**
 * diagnostic.test.ts — PHASE 4A
 * Pure — no network, no storage.
 */

import {
  buildDiagnosticPackage,
  describePackageContents,
} from '../diagnostic';
import {
  ConsentRecord,
  DiscoveredRouter,
  CapabilityEvidence,
} from '../types';
import { unknownEvidence } from '../evidence';

const CONSENT: ConsentRecord = {
  at: new Date('2026-09-24T00:00:00Z').toISOString(),
  scopes: ['device', 'signal', 'bands', 'cells'],
  version: 1,
};

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

function makeRouter(overrides: Partial<DiscoveredRouter> = {}): DiscoveredRouter {
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
    at: Date.now(),
    ...overrides,
  };
}

describe('buildDiagnosticPackage', () => {
  test('without consent → throws', () => {
    const r = makeRouter();
    expect(() => buildDiagnosticPackage(r, null as any, '1.0.0')).toThrow();
  });

  test('consent with empty at → throws', () => {
    const r = makeRouter();
    const bad: ConsentRecord = { at: '', scopes: [], version: 1 };
    expect(() => buildDiagnosticPackage(r, bad, '1.0.0')).toThrow();
  });

  test('valid consent → produces package', () => {
    const r = makeRouter();
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.schema).toBe(1);
    expect(pkg.appVersion).toBe('1.0.0');
    expect(pkg.userConsent).toBe(CONSENT);
  });

  test('host anonymized (192.168.8.1 → 192.168.x.x)', () => {
    const r = makeRouter({ host: '192.168.8.1' });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.discovery.hostPattern).toBe('192.168.x.x');
    expect(JSON.stringify(pkg)).not.toContain('192.168.8.1');
  });

  test('screenshots empty in 4A', () => {
    const r = makeRouter();
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.screenshots).toEqual([]);
  });

  test('capabilitiesV2 is included', () => {
    const r = makeRouter();
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.capabilitiesV2).toBeDefined();
    expect(pkg.capabilitiesV2!.bandLock.value).toBe('UNKNOWN');
  });

  test('no raw body field in package', () => {
    const r = makeRouter();
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    const json = JSON.stringify(pkg);
    expect(json).not.toContain('bodyRaw');
    expect(json).not.toContain('rawBody');
  });

  test('protocols preserved', () => {
    const r = makeRouter({ protocols: ['http', 'https'] });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.discovery.protocols).toEqual(['http', 'https']);
  });

  test('errors preserved but no sensitive content', () => {
    const r = makeRouter({
      errors: [
        { step: 'probe', kind: 'http', status: 401, message: 'Auth required', at: Date.now() },
      ],
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.errors.length).toBe(1);
    expect(pkg.errors[0].message).toBe('Auth required');
  });
});

describe('describePackageContents', () => {
  test('returns willSend and willNotSend arrays', () => {
    const r = makeRouter();
    const d = describePackageContents(r);
    expect(Array.isArray(d.willSend)).toBe(true);
    expect(Array.isArray(d.willNotSend)).toBe(true);
    expect(d.willSend.length).toBeGreaterThan(0);
    expect(d.willNotSend.length).toBeGreaterThan(0);
  });

  test('willSend includes device info', () => {
    const d = describePackageContents(makeRouter());
    const joined = d.willSend.join(' ').toLowerCase();
    expect(joined).toMatch(/manufacturer|model/);
    expect(joined).toMatch(/signal/);
    expect(joined).toMatch(/endpoint/);
  });

  test('willNotSend includes credentials', () => {
    const d = describePackageContents(makeRouter());
    const joined = d.willNotSend.join(' ').toLowerCase();
    expect(joined).toMatch(/password/);
    expect(joined).toMatch(/token/);
    expect(joined).toMatch(/imei/);
    expect(joined).toMatch(/ssid/);
    expect(joined).toMatch(/mac/);
  });

  test('willNotSend includes raw bodies', () => {
    const d = describePackageContents(makeRouter());
    const joined = d.willNotSend.join(' ').toLowerCase();
    expect(joined).toMatch(/raw/);
  });

  test('pure function — same output for same input', () => {
    const r = makeRouter();
    const d1 = describePackageContents(r);
    const d2 = describePackageContents(r);
    expect(d1).toEqual(d2);
  });

  test('no side effects on router', () => {
    const r = makeRouter();
    const snapshot = JSON.stringify(r);
    describePackageContents(r);
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});

describe('diagnostic — sensitive data exclusions', () => {
  test('signal fields with IMEI → builder removes IMEI', () => {
    const r = makeRouter({
      signalFields: {
        rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        imei: { value: '490154203237518', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.rsrp.value).toBe('-85');
    expect(pkg.signalFields.imei).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain('490154203237518');
  });

  test('endpoints only carry path/method/status — no body', () => {
    const r = makeRouter({
      endpoints: [
        {
          path: '/api/device/signal',
          method: 'GET',
          status: 200,
          contentType: 'application/json',
          authRequired: false,
          source: 'api',
          ms: 12,
          at: Date.now(),
        },
      ],
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    const ep = pkg.endpoints[0];
    expect(ep.path).toBe('/api/device/signal');
    expect((ep as any).body).toBeUndefined();
    expect((ep as any).response).toBeUndefined();
  });
});

describe('diagnostic — defense-in-depth sanitization inside builder', () => {
  const sensitiveCases: Array<[string, string]> = [
    ['imei', '490154203237518'],
    ['imsi', '310150123456789'],
    ['mac', 'AA:BB:CC:DD:EE:FF'],
    ['ssid', 'SyntheticWiFi'],
    ['password', 'SyntheticPass123'],
    ['token', 'SyntheticTokenABCDEF'],
    ['cookie', 'session=synthetic-abc'],
    ['phone', '966500000000'],
    ['apn_name', 'synthetic-apn'],
    ['serial_number', 'SYNTH-SN-12345'],
  ];

  test.each(sensitiveCases)(
    'injected "%s" field in signalFields is removed by builder',
    (key, val) => {
      const r = makeRouter({
        signalFields: {
          rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: Date.now() },
          [key]: { value: val, source: 'api', confidence: 'OBSERVED', at: Date.now() },
        },
      });
      const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
      expect(pkg.signalFields.rsrp.value).toBe('-85');
      expect(pkg.signalFields[key]).toBeUndefined();
      expect(JSON.stringify(pkg)).not.toContain(val);
    },
  );

  test.each(sensitiveCases)(
    'injected "%s" field in bandFields is removed by builder',
    (key, val) => {
      const r = makeRouter({
        bandFields: {
          band: { value: 'B3', source: 'api', confidence: 'OBSERVED', at: Date.now() },
          [key]: { value: val, source: 'api', confidence: 'OBSERVED', at: Date.now() },
        },
      });
      const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
      expect(pkg.bandFields.band.value).toBe('B3');
      expect(pkg.bandFields[key]).toBeUndefined();
      expect(JSON.stringify(pkg)).not.toContain(val);
    },
  );

  test.each(sensitiveCases)(
    'injected "%s" field in cellFields is removed by builder',
    (key, val) => {
      const r = makeRouter({
        cellFields: {
          cell_id: { value: '1234567', source: 'api', confidence: 'OBSERVED', at: Date.now() },
          [key]: { value: val, source: 'api', confidence: 'OBSERVED', at: Date.now() },
        },
      });
      const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
      expect(pkg.cellFields.cell_id.value).toBe('1234567');
      expect(pkg.cellFields[key]).toBeUndefined();
      expect(JSON.stringify(pkg)).not.toContain(val);
    },
  );

  test('safe signal fields preserved by builder after sanitization', () => {
    const r = makeRouter({
      signalFields: {
        rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        sinr: { value: '18', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        pci: { value: '123', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.rsrp.value).toBe('-85');
    expect(pkg.signalFields.sinr.value).toBe('18');
    expect(pkg.signalFields.pci.value).toBe('123');
  });

  test('safe band fields preserved by builder', () => {
    const r = makeRouter({
      bandFields: {
        band: { value: 'B3', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        earfcn: { value: '1650', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.bandFields.band.value).toBe('B3');
    expect(pkg.bandFields.earfcn.value).toBe('1650');
  });

  test('null value preserved by builder', () => {
    const r = makeRouter({
      signalFields: {
        rsrp: { value: null, source: 'api', confidence: 'UNKNOWN', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.rsrp.value).toBeNull();
  });

  test('empty string value dropped by builder', () => {
    const r = makeRouter({
      signalFields: {
        rsrp: { value: '', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.rsrp).toBeUndefined();
  });

  test('multiple sensitive fields removed in one pass', () => {
    const r = makeRouter({
      signalFields: {
        rsrp: { value: '-85', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        imei: { value: '490154203237518', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        imsi: { value: '310150123456789', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        mac: { value: 'AA:BB:CC:DD:EE:FF', source: 'api', confidence: 'OBSERVED', at: Date.now() },
        password: { value: 'SyntheticPass123', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.rsrp.value).toBe('-85');
    expect(pkg.signalFields.imei).toBeUndefined();
    expect(pkg.signalFields.imsi).toBeUndefined();
    expect(pkg.signalFields.mac).toBeUndefined();
    expect(pkg.signalFields.password).toBeUndefined();
    const json = JSON.stringify(pkg);
    expect(json).not.toContain('490154203237518');
    expect(json).not.toContain('310150123456789');
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).not.toContain('SyntheticPass123');
  });

  test('mac value in generic field is masked by value check', () => {
    const r = makeRouter({
      signalFields: {
        data: { value: 'AA:BB:CC:DD:EE:FF', source: 'api', confidence: 'OBSERVED', at: Date.now() },
      },
    });
    const pkg = buildDiagnosticPackage(r, CONSENT, '1.0.0');
    expect(pkg.signalFields.data).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain('AA:BB:CC:DD:EE:FF');
  });
});
