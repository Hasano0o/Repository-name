/**
 * screenshotCollector.test.ts — PHASE 4B
 * Pure function tests — no network, no storage.
 */

import {
  collectScreenshotEvidence,
  ScreenshotTextBlock,
} from '../screenshotCollector';

const FIXED_AT = 1_700_000_000_000;

function blocks(...texts: string[]): ScreenshotTextBlock[] {
  return texts.map((text) => ({ text }));
}

function collect(texts: string[], capturedAt = FIXED_AT) {
  return collectScreenshotEvidence({ blocks: blocks(...texts), capturedAt });
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Identity
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — identity extraction', () => {
  test('Vendor: ZTE → vendor observed', () => {
    const r = collect(['Vendor: ZTE']);
    expect(r.identity.vendor?.value).toBe('ZTE');
  });

  test('Manufacturer: Huawei → vendor observed', () => {
    const r = collect(['Manufacturer: Huawei']);
    expect(r.identity.vendor?.value).toBe('Huawei');
  });

  test('Brand: Zyxel → vendor observed', () => {
    const r = collect(['Brand: Zyxel']);
    expect(r.identity.vendor?.value).toBe('Zyxel');
  });

  test('Model: MC888 → model observed', () => {
    const r = collect(['Model: MC888']);
    expect(r.identity.model?.value).toBe('MC888');
  });

  test('Device Model: H112-372 → model observed', () => {
    const r = collect(['Device Model: H112-372']);
    expect(r.identity.model?.value).toBe('H112-372');
  });

  test('Model Number: MC801A → model observed', () => {
    const r = collect(['Model Number: MC801A']);
    expect(r.identity.model?.value).toBe('MC801A');
  });

  test('source is always screenshot', () => {
    const r = collect(['Vendor: ZTE']);
    expect(r.identity.vendor?.source).toBe('screenshot');
  });

  test('confidence is always OBSERVED', () => {
    const r = collect(['Vendor: ZTE']);
    expect(r.identity.vendor?.confidence).toBe('OBSERVED');
  });

  test('volatility is static', () => {
    const r = collect(['Vendor: ZTE']);
    expect(r.identity.vendor?.volatility).toBe('static');
  });

  test('at = capturedAt', () => {
    const r = collect(['Vendor: ZTE']);
    expect(r.identity.vendor?.at).toBe(FIXED_AT);
  });

  test('unknown vendor name not rejected (still observed)', () => {
    const r = collect(['Vendor: ACME']);
    expect(r.identity.vendor?.value).toBe('ACME');
  });

  test('"Powered by Huawei" without key → not extracted', () => {
    const r = collect(['Powered by Huawei technology']);
    expect(r.identity.vendor).toBeNull();
  });

  test('Device: MC888 (without Model key) → not extracted', () => {
    const r = collect(['Device: MC888']);
    expect(r.identity.model).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Signal fields
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — signal fields', () => {
  test('RSRP: -92 → extracted', () => {
    const r = collect(['RSRP: -92']);
    expect(r.signalFields.rsrp?.value).toBe('-92');
  });

  test('RSRP: -92 dBm → extracted (units stripped)', () => {
    const r = collect(['RSRP: -92 dBm']);
    expect(r.signalFields.rsrp?.value).toBe('-92');
  });

  test('LTE RSRP: -105 → extracted', () => {
    const r = collect(['LTE RSRP: -105']);
    expect(r.signalFields.rsrp?.value).toBe('-105');
  });

  test('RSRP (dBm): -85 → extracted', () => {
    const r = collect(['RSRP (dBm): -85']);
    expect(r.signalFields.rsrp?.value).toBe('-85');
  });

  test('5G SINR: 18 → sinr extracted', () => {
    const r = collect(['5G SINR: 18']);
    expect(r.signalFields.sinr?.value).toBe('18');
  });

  test('SINR: 18 dB → extracted', () => {
    const r = collect(['SINR: 18 dB']);
    expect(r.signalFields.sinr?.value).toBe('18');
  });

  test('SNR: 22 → sinr extracted (alias)', () => {
    const r = collect(['SNR: 22']);
    expect(r.signalFields.sinr?.value).toBe('22');
  });

  test('RSRQ: -10 → extracted', () => {
    const r = collect(['RSRQ: -10']);
    expect(r.signalFields.rsrq?.value).toBe('-10');
  });

  test('RSSI: -65 → extracted', () => {
    const r = collect(['RSSI: -65']);
    expect(r.signalFields.rssi?.value).toBe('-65');
  });

  test('PCI: 123 → extracted', () => {
    const r = collect(['PCI: 123']);
    expect(r.signalFields.pci?.value).toBe('123');
  });

  test('Physical Cell ID: 456 → pci extracted', () => {
    const r = collect(['Physical Cell ID: 456']);
    expect(r.signalFields.pci?.value).toBe('456');
  });

  test('case insensitive: rsrp: -92', () => {
    const r = collect(['rsrp: -92']);
    expect(r.signalFields.rsrp?.value).toBe('-92');
  });

  test('signal volatility is dynamic', () => {
    const r = collect(['RSRP: -92']);
    expect(r.signalFields.rsrp?.volatility).toBe('dynamic');
  });

  test('signal source is screenshot', () => {
    const r = collect(['RSRP: -92']);
    expect(r.signalFields.rsrp?.source).toBe('screenshot');
  });

  test('multiple signal fields in one line', () => {
    const r = collect(['RSRP: -92 SINR: 18 PCI: 123']);
    expect(r.signalFields.rsrp?.value).toBe('-92');
    expect(r.signalFields.sinr?.value).toBe('18');
    expect(r.signalFields.pci?.value).toBe('123');
  });

  test('multiple blocks combined', () => {
    const r = collect(['RSRP: -92', 'SINR: 18']);
    expect(r.signalFields.rsrp?.value).toBe('-92');
    expect(r.signalFields.sinr?.value).toBe('18');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Band fields
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — band fields', () => {
  test('Band: B3 → extracted', () => {
    const r = collect(['Band: B3']);
    expect(r.bandFields.band?.value).toBe('B3');
  });

  test('Band: n78 → extracted', () => {
    const r = collect(['Band: n78']);
    expect(r.bandFields.band?.value).toBe('n78');
  });

  test('LTE Band: B7 → extracted', () => {
    const r = collect(['LTE Band: B7']);
    expect(r.bandFields.band?.value).toBe('B7');
  });

  test('NR Band: n41 → extracted', () => {
    const r = collect(['NR Band: n41']);
    expect(r.bandFields.band?.value).toBe('n41');
  });

  test('EARFCN: 1650 → extracted', () => {
    const r = collect(['EARFCN: 1650']);
    expect(r.bandFields.earfcn?.value).toBe('1650');
  });

  test('NRARFCN: 640000 → extracted', () => {
    const r = collect(['NRARFCN: 640000']);
    expect(r.bandFields.nrarfcn?.value).toBe('640000');
  });

  test('Bandwidth: 20 MHz → extracted (units stripped)', () => {
    const r = collect(['Bandwidth: 20 MHz']);
    expect(r.bandFields.bandwidth?.value).toBe('20');
  });

  test('band volatility is dynamic', () => {
    const r = collect(['Band: B3']);
    expect(r.bandFields.band?.volatility).toBe('dynamic');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Cell fields
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — cell fields', () => {
  test('Cell ID: 1234567 → extracted', () => {
    const r = collect(['Cell ID: 1234567']);
    expect(r.cellFields.cell_id?.value).toBe('1234567');
  });

  test('Cell ID: 0x0A1B2C3 → extracted', () => {
    const r = collect(['Cell ID: 0x0A1B2C3']);
    expect(r.cellFields.cell_id?.value).toBe('0x0A1B2C3');
  });

  test('CellID: abc123 → extracted', () => {
    const r = collect(['CellID: abc123']);
    expect(r.cellFields.cell_id?.value).toBe('abc123');
  });

  test('TAC: 456 → extracted', () => {
    const r = collect(['TAC: 456']);
    expect(r.cellFields.tac?.value).toBe('456');
  });

  test('cell volatility is dynamic', () => {
    const r = collect(['Cell ID: 123']);
    expect(r.cellFields.cell_id?.volatility).toBe('dynamic');
  });

  test('cell source is screenshot', () => {
    const r = collect(['Cell ID: 123']);
    expect(r.cellFields.cell_id?.source).toBe('screenshot');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Network fields
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — network fields', () => {
  test('Network Type: 5G NSA → extracted', () => {
    const r = collect(['Network Type: 5G NSA']);
    expect(r.networkFields.network_type?.value).toBe('5G NSA');
  });

  test('Network Type: LTE → extracted', () => {
    const r = collect(['Network Type: LTE']);
    expect(r.networkFields.network_type?.value).toBe('LTE');
  });

  test('MCC: 310 → extracted', () => {
    const r = collect(['MCC: 310']);
    expect(r.networkFields.mcc?.value).toBe('310');
  });

  test('MNC: 15 → extracted', () => {
    const r = collect(['MNC: 15']);
    expect(r.networkFields.mnc?.value).toBe('15');
  });

  test('Operator: STC → extracted', () => {
    const r = collect(['Operator: STC']);
    expect(r.networkFields.operator?.value).toBe('STC');
  });

  test('Operator: موبايلي → extracted (Arabic)', () => {
    const r = collect(['Operator: موبايلي']);
    expect(r.networkFields.operator?.value).toBe('موبايلي');
  });

  test('Operator: Saudi Telecom Co. → extracted', () => {
    const r = collect(['Operator: Saudi Telecom Co.']);
    expect(r.networkFields.operator?.value).toBe('Saudi Telecom Co.');
  });

  test('operator volatility is slow', () => {
    const r = collect(['Operator: STC']);
    expect(r.networkFields.operator?.volatility).toBe('slow');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Invalid values dropped
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — invalid values dropped', () => {
  test('RSRP: hello → dropped', () => {
    const r = collect(['RSRP: hello']);
    expect(r.signalFields.rsrp).toBeUndefined();
  });

  test('RSRP: 999999 → dropped', () => {
    const r = collect(['RSRP: 999999']);
    expect(r.signalFields.rsrp).toBeUndefined();
  });

  test('PCI: abc → dropped', () => {
    const r = collect(['PCI: abc']);
    expect(r.signalFields.pci).toBeUndefined();
  });

  test('PCI: -5 → dropped (no negative)', () => {
    const r = collect(['PCI: -5']);
    expect(r.signalFields.pci).toBeUndefined();
  });

  test('Band: XYZ → dropped', () => {
    const r = collect(['Band: XYZ']);
    expect(r.bandFields.band).toBeUndefined();
  });

  test('Band: 3 (no prefix) → dropped', () => {
    const r = collect(['Band: 3']);
    expect(r.bandFields.band).toBeUndefined();
  });

  test('MCC: 12 → dropped (needs 3 digits)', () => {
    const r = collect(['MCC: 12']);
    expect(r.networkFields.mcc).toBeUndefined();
  });

  test('Operator: 12345 → dropped (numeric only)', () => {
    const r = collect(['Operator: 12345']);
    expect(r.networkFields.operator).toBeUndefined();
  });

  test('unknown field with signal-ish name → warning', () => {
    const r = collect(['Signal: whatever']);
    expect(r.warnings).toContain('AMBIGUOUS_FIELD_DROPPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Sensitive fields dropped
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — sensitive fields dropped', () => {
  const cases: Array<[string, string]> = [
    ['IMEI', '490154203237518'],
    ['IMSI', '310150123456789'],
    ['ICCID', '89014103211118510720'],
    ['Serial', 'SN-12345'],
    ['MAC', 'AA:BB:CC:DD:EE:FF'],
    ['SSID', 'MyWiFi'],
    ['WiFi Name', 'HomeNet'],
    ['Password', 'secret123'],
    ['Token', 'abc123token'],
    ['Cookie', 'sess=xyz'],
    ['Username', 'admin'],
    ['Phone', '966501234567'],
    ['Email', 'a@b.com'],
    ['APN', 'internet'],
    ['PIN', '1234'],
    ['PUK', '12345678'],
  ];

  test.each(cases)('field "%s" is dropped', (key, value) => {
    const r = collect([`${key}: ${value}`]);
    expect(r.warnings).toContain('SENSITIVE_FIELD_DROPPED');
    expect(JSON.stringify(r)).not.toContain(value);
  });

  test('sensitive value in generic field (MAC) → dropped', () => {
    const r = collect(['Device: AA:BB:CC:DD:EE:FF']);
    expect(JSON.stringify(r)).not.toContain('AA:BB:CC:DD:EE:FF');
  });

  test('standalone Luhn IMEI in generic field → dropped', () => {
    const r = collect(['Device ID: 490154203237518']);
    expect(JSON.stringify(r)).not.toContain('490154203237518');
  });

  test('long base64 token in generic field → dropped', () => {
    const r = collect(['Data: AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD']);
    expect(JSON.stringify(r)).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Endpoint hints
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — endpoint hints', () => {
  test('/api/device/signal → hint observed', () => {
    const r = collect(['GET /api/device/signal']);
    expect(r.endpointHints.length).toBe(1);
    expect(r.endpointHints[0].path).toBe('/api/device/signal');
    expect(r.endpointHints[0].source).toBe('screenshot');
    expect(r.endpointHints[0].confidence).toBe('OBSERVED');
  });

  test('/goform/goform_get_cmd_process → hint observed', () => {
    const r = collect(['/goform/goform_get_cmd_process?cmd=rsrp']);
    expect(r.endpointHints.length).toBe(1);
  });

  test('full LAN URL → path extracted, host not stored', () => {
    const r = collect(['See http://192.168.8.1/api/device/signal here']);
    expect(r.endpointHints.length).toBe(1);
    expect(r.endpointHints[0].path).toBe('/api/device/signal');
    expect(JSON.stringify(r)).not.toContain('192.168.8.1');
  });

  test('public URL → dropped + warning', () => {
    const r = collect(['See https://example.com/api/device/signal here']);
    expect(r.warnings).toContain('LAN_ENDPOINT_DROPPED');
    expect(JSON.stringify(r)).not.toContain('example.com');
  });

  test('write endpoint /goform/goform_set_cmd_process → dropped + warning', () => {
    const r = collect(['/goform/goform_set_cmd_process']);
    expect(r.warnings).toContain('WRITE_ENDPOINT_DROPPED');
    expect(r.endpointHints.length).toBe(0);
  });

  test('/api/reboot → dropped + warning (write-looking path)', () => {
    const r = collect(['/api/reboot']);
    expect(r.warnings).toContain('WRITE_ENDPOINT_DROPPED');
    expect(r.endpointHints.length).toBe(0);
  });

  test('duplicate endpoint paths deduplicated', () => {
    const r = collect(['/api/device/signal', '/api/device/signal']);
    expect(r.endpointHints.length).toBe(1);
  });

  test('endpoint hint carries observedAt = capturedAt', () => {
    const r = collect(['/api/device/signal']);
    expect(r.endpointHints[0].observedAt).toBe(FIXED_AT);
  });

  test('query with sensitive key dropped', () => {
    const r = collect(['/api/status?password=secret']);
    expect(r.warnings).toContain('SENSITIVE_FIELD_DROPPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. No capability upgrade
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — no capability upgrade', () => {
  test('"Band Lock" text → no capabilities field', () => {
    const r = collect(['Band Lock']);
    expect((r as any).capabilities).toBeUndefined();
    expect((r as any).bandLock).toBeUndefined();
  });

  test('"Cell Lock" text → no cellLock in result', () => {
    const r = collect(['Cell Lock']);
    expect((r as any).cellLock).toBeUndefined();
  });

  test('"Reboot Device" text → no reboot capability', () => {
    const r = collect(['Reboot Device']);
    expect((r as any).reboot).toBeUndefined();
  });

  test('"Signal API available" → no signal capability upgrade', () => {
    const r = collect(['Signal API available']);
    expect((r as any).capabilities).toBeUndefined();
  });

  test('endpoint hint alone does NOT produce capabilities', () => {
    const r = collect(['/api/device/signal']);
    expect((r as any).capabilities).toBeUndefined();
    expect(r.endpointHints.length).toBe(1);
  });

  test('combined hints + fields still no capabilities', () => {
    const r = collect([
      'RSRP: -92 SINR: 18',
      '/api/device/signal',
      'Band Lock',
      'Reboot',
    ]);
    expect((r as any).capabilities).toBeUndefined();
    expect(r.signalFields.rsrp?.value).toBe('-92');
    expect(r.endpointHints.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. Warnings — form + no sensitive leak
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — warnings shape', () => {
  test('warnings is an array', () => {
    const r = collect(['RSRP: -92']);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test('warnings are codes (not free text)', () => {
    const r = collect(['Password: secret']);
    for (const w of r.warnings) {
      expect(typeof w).toBe('string');
      expect(/^[A-Z_]+$/.test(w)).toBe(true);
    }
  });

  test('warnings do NOT contain sensitive values', () => {
    const r = collect(['Password: secret', 'IMEI: 490154203237518']);
    const joined = r.warnings.join(' ');
    expect(joined).not.toContain('secret');
    expect(joined).not.toContain('490154203237518');
    expect(joined).not.toContain('Password');
  });

  test('same warning emitted once (deduplicated)', () => {
    const r = collect(['Password: a', 'Token: b']);
    const dropped = r.warnings.filter((w) => w === 'SENSITIVE_FIELD_DROPPED');
    expect(dropped.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 11. Empty / malformed
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — empty and malformed', () => {
  test('empty blocks → empty result, no crash', () => {
    const r = collectScreenshotEvidence({ blocks: [], capturedAt: FIXED_AT });
    expect(r.endpointHints.length).toBe(0);
    expect(Object.keys(r.signalFields).length).toBe(0);
    expect(r.identity.vendor).toBeNull();
  });

  test('empty text → no crash', () => {
    const r = collect(['']);
    expect(r.warnings.length).toBe(0);
  });

  test('whitespace-only → no crash', () => {
    const r = collect(['   \t  ']);
    expect(r.warnings.length).toBe(0);
  });

  test('single char → no crash', () => {
    const r = collect(['x']);
    expect(r.warnings.length).toBe(0);
  });

  test('very long line → no crash', () => {
    const r = collect(['RSRP: -92 ' + 'x'.repeat(5000)]);
    expect(r.signalFields.rsrp?.value).toBe('-92');
  });

  test('block without text → ignored', () => {
    const r = collectScreenshotEvidence({
      blocks: [{} as any],
      capturedAt: FIXED_AT,
    });
    expect(r.warnings.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 12. Timestamp handling
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — capturedAt handling', () => {
  test('valid capturedAt → used', () => {
    const r = collect(['RSRP: -92'], 1234567890);
    expect(r.signalFields.rsrp?.at).toBe(1234567890);
  });

  test('undefined capturedAt → Date.now() fallback, no warning', () => {
    const r = collectScreenshotEvidence({ blocks: blocks('RSRP: -92') });
    expect(r.warnings).not.toContain('INVALID_TIMESTAMP');
    expect(r.signalFields.rsrp?.at).toBeGreaterThan(0);
  });

  test('NaN capturedAt → fallback + warning', () => {
    const r = collectScreenshotEvidence({
      blocks: blocks('RSRP: -92'),
      capturedAt: NaN,
    });
    expect(r.warnings).toContain('INVALID_TIMESTAMP');
  });

  test('Infinity capturedAt → fallback + warning', () => {
    const r = collectScreenshotEvidence({
      blocks: blocks('RSRP: -92'),
      capturedAt: Infinity,
    });
    expect(r.warnings).toContain('INVALID_TIMESTAMP');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 13. Pure function
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — pure function', () => {
  test('same input → same output', () => {
    const r1 = collect(['RSRP: -92 SINR: 18']);
    const r2 = collect(['RSRP: -92 SINR: 18']);
    expect(r1).toEqual(r2);
  });

  test('does not mutate input blocks', () => {
    const b = blocks('RSRP: -92');
    const snapshot = JSON.stringify(b);
    collectScreenshotEvidence({ blocks: b, capturedAt: FIXED_AT });
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  test('no Date.now() when capturedAt is valid', () => {
    const originalNow = Date.now;
    let called = false;
    Date.now = () => {
      called = true;
      return originalNow();
    };
    try {
      collectScreenshotEvidence({
        blocks: blocks('RSRP: -92'),
        capturedAt: FIXED_AT,
      });
      expect(called).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 14. Output shape
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — output shape', () => {
  test('result has all expected keys', () => {
    const r = collect(['RSRP: -92']);
    expect(r).toHaveProperty('identity');
    expect(r).toHaveProperty('signalFields');
    expect(r).toHaveProperty('bandFields');
    expect(r).toHaveProperty('cellFields');
    expect(r).toHaveProperty('networkFields');
    expect(r).toHaveProperty('endpointHints');
    expect(r).toHaveProperty('warnings');
  });

  test('all Evidence source is screenshot', () => {
    const r = collect([
      'RSRP: -92',
      'Band: B3',
      'Cell ID: 123',
      'Operator: STC',
      'Vendor: ZTE',
    ]);
    expect(r.signalFields.rsrp?.source).toBe('screenshot');
    expect(r.bandFields.band?.source).toBe('screenshot');
    expect(r.cellFields.cell_id?.source).toBe('screenshot');
    expect(r.networkFields.operator?.source).toBe('screenshot');
    expect(r.identity.vendor?.source).toBe('screenshot');
  });

  test('all Evidence confidence is OBSERVED', () => {
    const r = collect(['RSRP: -92', 'Band: B3', 'Vendor: ZTE']);
    expect(r.signalFields.rsrp?.confidence).toBe('OBSERVED');
    expect(r.bandFields.band?.confidence).toBe('OBSERVED');
    expect(r.identity.vendor?.confidence).toBe('OBSERVED');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 15. Privacy invariant (JSON-level)
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — privacy invariant', () => {
  const sensitiveText = [
    'IMEI: 490154203237518',
    'IMSI: 310150123456789',
    'MAC: AA:BB:CC:DD:EE:FF',
    'SSID: HomeNetwork',
    'Password: SuperSecret123',
    'Token: abcdef1234567890abcdef',
    'Cookie: sess=xyz123',
    'Serial: SN-ABCD-1234',
    'Phone: 966501234567',
    'Email: secret@example.com',
    'APN: my.apn.provider',
  ];

  test.each(sensitiveText)('JSON does not contain "%s"', (line) => {
    const r = collect([line]);
    const json = JSON.stringify(r);
    // Extract only the value after ":" and verify absence
    const value = line.substring(line.indexOf(':') + 1).trim();
    if (value.length >= 6) {
      expect(json).not.toContain(value);
    }
  });

  test('mixed blocks — no sensitive leak anywhere', () => {
    const r = collect([
      'RSRP: -92 SINR: 18',
      'IMEI: 490154203237518',
      'Password: SuperSecret',
      'Operator: STC',
      '/api/device/signal',
      'MAC: AA:BB:CC:DD:EE:FF',
    ]);
    const json = JSON.stringify(r);
    expect(json).not.toContain('490154203237518');
    expect(json).not.toContain('SuperSecret');
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(json).toContain('-92');
    expect(json).toContain('STC');
  });

  test('public URL value not in result', () => {
    const r = collect(['Visit https://example.com/secret/path']);
    const json = JSON.stringify(r);
    expect(json).not.toContain('example.com');
    expect(json).not.toContain('/secret/path');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 16. Determinism
// ═══════════════════════════════════════════════════════════════════════

describe('screenshot — determinism', () => {
  test('same blocks + capturedAt → identical JSON', () => {
    const input = ['RSRP: -92', 'Band: B3', 'Vendor: ZTE', '/api/device/signal'];
    const r1 = collect(input, FIXED_AT);
    const r2 = collect(input, FIXED_AT);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test('warning order is stable within same input', () => {
    const r1 = collect(['Password: a', 'Token: b', 'MAC: AA:BB:CC:DD:EE:FF']);
    const r2 = collect(['Password: a', 'Token: b', 'MAC: AA:BB:CC:DD:EE:FF']);
    expect(r1.warnings).toEqual(r2.warnings);
  });
});
