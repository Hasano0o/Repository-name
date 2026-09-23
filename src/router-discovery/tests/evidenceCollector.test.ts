/**
 * evidenceCollector.test.ts — PHASE 4A
 * Pure function tests — no network, no drivers.
 */

import {
  extractIdentityFromHtml,
  extractSignalFields,
  extractBandFields,
  extractCellFields,
} from '../evidenceCollector';

const OPTS = { source: 'html' as const, now: 1_700_000_000_000 };

describe('extractIdentityFromHtml', () => {
  test('empty HTML → all UNKNOWN', () => {
    const r = extractIdentityFromHtml('', OPTS);
    expect(r.vendor.value).toBeNull();
    expect(r.vendor.confidence).toBe('UNKNOWN');
    expect(r.model.value).toBeNull();
    expect(r.firmware.value).toBeNull();
    expect(r.hardwareVersion.value).toBeNull();
  });

  test('<title>Huawei</title> → vendor observed', () => {
    const r = extractIdentityFromHtml('<html><title>Huawei Router</title></html>', OPTS);
    expect(r.vendor.value).toMatch(/huawei/i);
    expect(r.vendor.confidence).toBe('OBSERVED');
  });

  test('<meta name="generator" content="ZTE"> → vendor observed', () => {
    const html = '<meta name="generator" content="ZTE">';
    const r = extractIdentityFromHtml(html, OPTS);
    expect(r.vendor.value).toBe('ZTE');
  });

  test('<title>Zyxel</title> → vendor observed', () => {
    const r = extractIdentityFromHtml('<title>Zyxel NR5103E</title>', OPTS);
    expect(r.vendor.value).toBe('Zyxel');
  });

  test('vendor volatility = static', () => {
    const r = extractIdentityFromHtml('<title>Huawei</title>', OPTS);
    expect(r.vendor.volatility).toBe('static');
  });

  test('firmware volatility = slow', () => {
    const r = extractIdentityFromHtml('<title>Huawei</title>', OPTS);
    expect(r.firmware.volatility).toBe('slow');
  });

  test('does NOT extract from <input>', () => {
    const html = '<title>Huawei</title><input name="ssid" value="MyWiFi"><input name="imei" value="123456789012345">';
    const r = extractIdentityFromHtml(html, OPTS);
    expect(r.vendor.value).toMatch(/huawei/i);
    // لا يجب أن يظهر أي من قيم <input>
    expect(JSON.stringify(r)).not.toContain('MyWiFi');
    expect(JSON.stringify(r)).not.toContain('123456789012345');
  });

  test('meta with sensitive name is skipped', () => {
    const html = '<meta name="password" content="secret"><meta name="generator" content="ZTE">';
    const r = extractIdentityFromHtml(html, OPTS);
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  test('source propagated', () => {
    const r = extractIdentityFromHtml('<title>ZTE</title>', { source: 'html' });
    expect(r.vendor.source).toBe('html');
  });

  test('now propagated', () => {
    const r = extractIdentityFromHtml('<title>ZTE</title>', OPTS);
    expect(r.vendor.at).toBe(OPTS.now);
  });
});

describe('extractSignalFields — JSON', () => {
  test('valid JSON with rsrp/sinr → observed', () => {
    const body = '{"rsrp":"-85","sinr":"18","pci":"123"}';
    const r = extractSignalFields(body, 'json', { source: 'api' });
    expect(r.rsrp.value).toBe('-85');
    expect(r.sinr.value).toBe('18');
    expect(r.pci.value).toBe('123');
    expect(r.rsrp.confidence).toBe('OBSERVED');
    expect(r.rsrp.volatility).toBe('dynamic');
  });

  test('non-numeric values OK', () => {
    const r = extractSignalFields('{"rsrp":"-85.5"}', 'json', { source: 'api' });
    expect(r.rsrp.value).toBe('-85.5');
  });

  test('unknown fields ignored', () => {
    const r = extractSignalFields('{"foo":"bar","rsrp":"-85"}', 'json', { source: 'api' });
    expect(r.foo).toBeUndefined();
    expect(r.rsrp.value).toBe('-85');
  });

  test('sensitive fields ignored', () => {
    const body = '{"rsrp":"-85","imei":"490154203237518","password":"abc"}';
    const r = extractSignalFields(body, 'json', { source: 'api' });
    expect(r.rsrp.value).toBe('-85');
    expect(r.imei).toBeUndefined();
    expect(r.password).toBeUndefined();
  });

  test('MASK values skipped', () => {
    const body = '{"rsrp":"«محذوف»"}';
    const r = extractSignalFields(body, 'json', { source: 'api' });
    expect(r.rsrp).toBeUndefined();
  });

  test('empty body → empty result', () => {
    const r = extractSignalFields('', 'json', { source: 'api' });
    expect(Object.keys(r).length).toBe(0);
  });

  test('malformed JSON → empty result (regex picks nothing)', () => {
    const r = extractSignalFields('{broken', 'json', { source: 'api' });
    expect(Object.keys(r).length).toBe(0);
  });

  test('multiple signal fields', () => {
    const body = '{"rsrp":"-85","rsrq":"-10","sinr":"18","rssi":"-65","snr":"22","cqi":"12"}';
    const r = extractSignalFields(body, 'json', { source: 'api' });
    expect(Object.keys(r).length).toBe(6);
  });
});

describe('extractSignalFields — XML', () => {
  test('valid XML with rsrp/sinr → observed', () => {
    const body = '<signal><rsrp>-85</rsrp><sinr>18</sinr></signal>';
    const r = extractSignalFields(body, 'xml', { source: 'api' });
    expect(r.rsrp.value).toBe('-85');
    expect(r.sinr.value).toBe('18');
  });

  test('sensitive tags ignored', () => {
    const body = '<r><rsrp>-85</rsrp><imei>490154203237518</imei></r>';
    const r = extractSignalFields(body, 'xml', { source: 'api' });
    expect(r.rsrp.value).toBe('-85');
    expect(r.imei).toBeUndefined();
  });

  test('empty tags ignored', () => {
    const body = '<r><rsrp></rsrp></r>';
    const r = extractSignalFields(body, 'xml', { source: 'api' });
    expect(r.rsrp).toBeUndefined();
  });

  test('MASK value skipped', () => {
    const body = '<r><rsrp>«محذوف»</rsrp></r>';
    const r = extractSignalFields(body, 'xml', { source: 'api' });
    expect(r.rsrp).toBeUndefined();
  });

  test('nested tags handled', () => {
    const body = '<root><a><rsrp>-85</rsrp></a></root>';
    const r = extractSignalFields(body, 'xml', { source: 'api' });
    expect(r.rsrp.value).toBe('-85');
  });

  test('malformed XML → empty', () => {
    const r = extractSignalFields('<broken', 'xml', { source: 'api' });
    expect(Object.keys(r).length).toBe(0);
  });
});

describe('extractBandFields', () => {
  test('band + earfcn extracted', () => {
    const body = '{"band":"B3","earfcn":"1650"}';
    const r = extractBandFields(body, 'json', { source: 'api' });
    expect(r.band.value).toBe('B3');
    expect(r.earfcn.value).toBe('1650');
  });

  test('band volatility = slow', () => {
    const r = extractBandFields('{"band":"B3"}', 'json', { source: 'api' });
    expect(r.band.volatility).toBe('slow');
  });

  test('XML band extracted', () => {
    const body = '<net><band>B3</band></net>';
    const r = extractBandFields(body, 'xml', { source: 'api' });
    expect(r.band.value).toBe('B3');
  });

  test('irrelevant fields ignored', () => {
    const r = extractBandFields('{"rsrp":"-85","band":"B3"}', 'json', { source: 'api' });
    expect(r.rsrp).toBeUndefined();
    expect(r.band.value).toBe('B3');
  });
});

describe('extractCellFields', () => {
  test('cell_id + pci extracted', () => {
    const body = '{"cell_id":"1234567","pci":"123"}';
    const r = extractCellFields(body, 'json', { source: 'api' });
    expect(r.cell_id.value).toBe('1234567');
  });

  test('enodeb_id + tac extracted', () => {
    const body = '{"enodeb_id":"112233","tac":"456"}';
    const r = extractCellFields(body, 'json', { source: 'api' });
    expect(r.enodeb_id.value).toBe('112233');
    expect(r.tac.value).toBe('456');
  });

  test('XML cell fields', () => {
    const body = '<cell><cell_id>abc</cell_id></cell>';
    const r = extractCellFields(body, 'xml', { source: 'api' });
    expect(r.cell_id.value).toBe('abc');
  });

  test('cell volatility = dynamic', () => {
    const r = extractCellFields('{"cell_id":"1"}', 'json', { source: 'api' });
    expect(r.cell_id.volatility).toBe('dynamic');
  });
});
