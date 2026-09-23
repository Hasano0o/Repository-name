/**
 * capabilities.test.ts — PHASE 4A
 * All pure — no network, no drivers.
 */

import { buildCapabilityEvidence } from '../capabilities';
import {
  DiscoveredEndpoint,
  FieldEvidence,
} from '../types';

function ep(path: string, status = 200): DiscoveredEndpoint {
  return {
    path,
    method: 'GET',
    status,
    contentType: 'application/json',
    authRequired: false,
    source: 'api',
    ms: 10,
    at: Date.now(),
  };
}

function field(v: string, source: 'api' | 'field_probe' = 'api'): FieldEvidence[string] {
  return { value: v, source, confidence: 'OBSERVED', at: Date.now(), volatility: 'dynamic' };
}

describe('capabilities — no evidence', () => {
  test('all UNKNOWN when no endpoints, no fields', () => {
    const c = buildCapabilityEvidence([], {}, {}, {});
    expect(c.signal.value).toBe('UNKNOWN');
    expect(c.bands.value).toBe('UNKNOWN');
    expect(c.cells.value).toBe('UNKNOWN');
    expect(c.deviceInfo.value).toBe('UNKNOWN');
    expect(c.carrierAggregation.value).toBe('UNKNOWN');
  });
});

describe('capabilities — signal', () => {
  test('signal endpoint + no fields → PARTIAL_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/device/signal')], {}, {}, {});
    expect(c.signal.value).toBe('PARTIAL_READ');
  });

  test('signal endpoint + 1 field → PARTIAL_READ (min 2 needed)', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/signal')],
      { rsrp: field('-85') },
      {},
      {},
    );
    expect(c.signal.value).toBe('PARTIAL_READ');
  });

  test('signal endpoint + 2 fields → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/signal')],
      { rsrp: field('-85'), sinr: field('18') },
      {},
      {},
    );
    expect(c.signal.value).toBe('CONFIRMED_READ');
  });

  test('endpoint with status 500 → not counted', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/signal', 500)],
      { rsrp: field('-85'), sinr: field('18') },
      {},
      {},
    );
    expect(c.signal.value).toBe('PARTIAL_READ');
  });

  test('fields only (no endpoint) → PARTIAL_READ', () => {
    const c = buildCapabilityEvidence(
      [],
      { rsrp: field('-85'), sinr: field('18') },
      {},
      {},
    );
    expect(c.signal.value).toBe('PARTIAL_READ');
  });
});

describe('capabilities — bands / cells', () => {
  test('bands endpoint + band field → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/net/net-mode')],
      {},
      { band: field('B3', 'field_probe') },
      {},
    );
    expect(c.bands.value).toBe('CONFIRMED_READ');
  });

  test('cells endpoint + cell field → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/seccellinfo')],
      {},
      {},
      { cell_id: field('1234567', 'field_probe') },
    );
    expect(c.cells.value).toBe('CONFIRMED_READ');
  });

  test('cells alias neighborCells', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/seccellinfo')],
      {},
      {},
      { cell_id: field('1', 'field_probe') },
    );
    expect(c.neighborCells.value).toBe(c.cells.value);
  });
});

describe('capabilities — write capabilities are always UNKNOWN', () => {
  test('bandLock UNKNOWN without any evidence', () => {
    const c = buildCapabilityEvidence([], {}, {}, {});
    expect(c.bandLock.value).toBe('UNKNOWN');
  });

  test('bandLock UNKNOWN even with /api/band/lock endpoint', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/band/lock')],
      { band: field('B3') },
      {},
      {},
    );
    expect(c.bandLock.value).toBe('UNKNOWN');
  });

  test('cellLock UNKNOWN even with /api/cell/lock endpoint', () => {
    const c = buildCapabilityEvidence([ep('/api/cell/lock')], {}, {}, {});
    expect(c.cellLock.value).toBe('UNKNOWN');
  });

  test('reboot UNKNOWN even with /api/reboot endpoint', () => {
    const c = buildCapabilityEvidence([ep('/api/reboot')], {}, {}, {});
    expect(c.reboot.value).toBe('UNKNOWN');
  });

  test('block UNKNOWN even with write-looking endpoint', () => {
    const c = buildCapabilityEvidence([ep('/api/wlan/mac-filter/set')], {}, {}, {});
    expect(c.block.value).toBe('UNKNOWN');
  });
});

describe('capabilities — evidence cannot upgrade without sufficient proof', () => {
  test('vendor name alone (no endpoint) → signal UNKNOWN', () => {
    // المحاكاة: لا endpoint، لا fields
    const c = buildCapabilityEvidence([], {}, {}, {});
    expect(c.signal.value).toBe('UNKNOWN');
  });

  test('endpoint alone (status 200) without fields → only PARTIAL_READ', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/signal')],
      {},
      {},
      {},
    );
    expect(c.signal.value).toBe('PARTIAL_READ');
    expect(c.signal.value).not.toBe('CONFIRMED_READ');
  });

  test('endpoint with wrong name does not upgrade signal', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/some/other/endpoint')],
      { rsrp: field('-85'), sinr: field('18') },
      {},
      {},
    );
    // fields only → PARTIAL_READ (not CONFIRMED)
    expect(c.signal.value).toBe('PARTIAL_READ');
  });

  test('endpoint 200 but empty body has no field evidence', () => {
    const c = buildCapabilityEvidence([ep('/api/device/signal')], {}, {}, {});
    // Only endpoint → PARTIAL_READ
    expect(c.signal.value).toBe('PARTIAL_READ');
  });
});

describe('capabilities — carrier aggregation', () => {
  test('seccellinfo endpoint + ca field → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/seccellinfo')],
      { wan_lte_ca: field('activ') },
      {},
      {},
    );
    expect(c.carrierAggregation.value).toBe('CONFIRMED_READ');
  });

  test('seccellinfo endpoint alone → PARTIAL_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/device/seccellinfo')], {}, {}, {});
    expect(c.carrierAggregation.value).toBe('PARTIAL_READ');
  });
});

describe('capabilities — deviceInfo / traffic / usage / sms', () => {
  test('device info endpoint → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/device/information')], {}, {}, {});
    expect(c.deviceInfo.value).toBe('CONFIRMED_READ');
  });

  test('traffic endpoint → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/monitoring/traffic-statistics')], {}, {}, {});
    expect(c.traffic.value).toBe('CONFIRMED_READ');
  });

  test('usage endpoint → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/monitoring/month_statistics')], {}, {}, {});
    expect(c.usage.value).toBe('CONFIRMED_READ');
  });

  test('sms endpoint → CONFIRMED_READ', () => {
    const c = buildCapabilityEvidence([ep('/api/sms/sms-list')], {}, {}, {});
    expect(c.sms.value).toBe('CONFIRMED_READ');
  });
});

describe('capabilities — lte / nr aliases', () => {
  test('lte mirrors signal', () => {
    const c = buildCapabilityEvidence(
      [ep('/api/device/signal')],
      { rsrp: field('-85'), sinr: field('18') },
      {},
      {},
    );
    expect(c.lte.value).toBe(c.signal.value);
    expect(c.nr.value).toBe(c.signal.value);
  });
});
