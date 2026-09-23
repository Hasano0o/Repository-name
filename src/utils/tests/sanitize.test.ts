/**
 * PHASE 1b — Sanitization Hardening Regression Tests
 *
 * الأهداف:
 *  1. إثبات أن الحقول الحساسة تُمسح دائمًا (password, IMEI, SSID...)
 *  2. إثبات أن حقول الشبكة القياسية لا تُمس (rsrp, pci, earfcn...)
 *  3. كشف IMEI/ICCID بقيم Luhn-valid فقط (بدون oversanitization)
 *  4. تغطية XML / JSON / key=value + casing + edge cases
 *
 * ملاحظة: قيم الاختبار اصطناعية بالكامل — لا تحتوي أي بيانات حقيقية.
 */

import { sanitize, sanitizeField, MASK } from '../probe';

// ─── Synthetic test values (not real-world data) ───
const S = {
  ssid: 'SyntheticSSID',
  name: 'SyntheticName',
  hostname: 'synthetic-host.lan',
  device: 'synthetic-device',
  password: 'SyntheticPass123',
  token: 'SyntheticTokenABCDEF',
  mac: 'AA:BB:CC:DD:EE:FF',
  imeiValid: '490154203237518',
  imeiInvalid: '356789012345678',
  iccidValid: '89014103211118510720',
  imsi: '310150123456789',
  longToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD',
};

describe('sanitizeField — sensitive field names', () => {
  const sensitiveKeys: Array<[string, string]> = [
    ['ssid', S.ssid],
    ['SSID', S.ssid],
    ['SSID1', S.ssid],
    ['ssid_5g', S.ssid],
    ['wifi_name', S.ssid],
    ['wifiname', S.ssid],
    ['wlan_name', S.ssid],
    ['network_name', S.ssid],
    ['name', S.name],
    ['Name', S.name],
    ['hostname', S.hostname],
    ['HostName', S.hostname],
    ['actualname', S.name],
    ['ActualName', S.name],
    ['devicename', S.device],
    ['device_name', S.device],
    ['router_name', S.name],
    ['wan_name', S.name],
    ['apn_name', S.name],
    ['apnname', S.name],
    ['profile_name', S.name],
    ['username', 'admin'],
    ['user_name', 'admin'],
    ['login_user', 'admin'],
    ['password', S.password],
    ['pwd', S.password],
    ['passwd', S.password],
    ['token', S.token],
    ['access_token', S.token],
    ['auth_token', S.token],
    ['session_id', 'sess-abc-123'],
    ['session', 'sess-abc-123'],
    ['cookie', 'sess=abc'],
    ['authorization', 'Bearer abc'],
    ['credential', 'cred-abc'],
    ['imei', S.imeiValid],
    ['IMSI', S.imsi],
    ['iccid', S.iccidValid],
    ['meid', 'A000000A1B2C3D'],
    ['msisdn', '966500000000'],
    ['phone_number', '966500000000'],
    ['serial', 'SN123456'],
    ['serial_number', 'SN123456'],
    ['mac', S.mac],
    ['mac_addr', S.mac],
    ['macaddr', S.mac],
  ];
  test.each(sensitiveKeys)('mask key=%s', (key, value) => {
    expect(sanitizeField(key, value)).toBe(MASK);
  });
});

describe('sanitizeField — safe network fields', () => {
  const safeKeys: Array<[string, string]> = [
    ['rsrp', '-85'],
    ['rsrp', '-85.5'],
    ['RSRP', '-91'],
    ['rsrq', '-9'],
    ['sinr', '20'],
    ['rssi', '-65'],
    ['snr', '22'],
    ['cqi', '12'],
    ['mcs', '18'],
    ['tx_power', '10'],
    ['txpower', '10'],
    ['rank', '2'],
    ['streams', '2'],
    ['pci', '456'],
    ['PCI', '132'],
    ['earfcn', '1650'],
    ['arfcn', '640000'],
    ['nrarfcn', '640000'],
    ['nr_arfcn', '640000'],
    ['cell_id', '0x0A1B2C3'],
    ['cellid', '1234567'],
    ['enodeb_id', '112233'],
    ['gnb_id', '445566'],
    ['tac', '12345'],
    ['band', '3'],
    ['nr_band', '78'],
    ['lte_band', '3'],
    ['bandwidth', '20'],
    ['dl_bandwidth', '20'],
    ['ul_bandwidth', '10'],
    ['bw', '20'],
    ['mcc', '310'],
    ['mnc', '15'],
    ['plmn', '310150'],
    ['signalbar', '5'],
    ['signal_bar', '5'],
    ['signal_icon', '4'],
    ['signal_strength', '4'],
    ['network_type', '5G_NSA'],
    ['network_provider', 'STC'],
    ['operator', 'STC'],
    ['sim_state', '1'],
    ['sim_status', '1'],
    ['connection_status', '901'],
    ['ppp_status', 'connected'],
    ['modem_state', '1'],
  ];
  test.each(safeKeys)('preserve key=%s value=%s', (key, value) => {
    expect(sanitizeField(key, value)).toBe(value);
  });
});

describe('sanitizeField — value-based detection', () => {
  test('MAC value in ambiguous field → masked', () => {
    expect(sanitizeField('data', S.mac)).toBe(MASK);
  });
  test('Luhn-valid IMEI in ambiguous field → masked', () => {
    expect(sanitizeField('data', S.imeiValid)).toBe(MASK);
  });
  test('Luhn-INVALID 15-digit number → preserved', () => {
    expect(sanitizeField('data', S.imeiInvalid)).toBe(S.imeiInvalid);
  });
  test('Luhn-valid ICCID (starts 89) → masked', () => {
    expect(sanitizeField('data', S.iccidValid)).toBe(MASK);
  });
  test('long base64 token → masked', () => {
    expect(sanitizeField('data', S.longToken)).toBe(MASK);
  });
  test('short text → unchanged', () => {
    expect(sanitizeField('data', 'hello world')).toBe('hello world');
  });
  test('10-digit number → unchanged', () => {
    expect(sanitizeField('data', '1234567890')).toBe('1234567890');
  });
  test('all-ones 15-digit (fails Luhn) → unchanged', () => {
    expect(sanitizeField('data', '111111111111111')).toBe('111111111111111');
  });
});

describe('sanitize — XML format', () => {
  test('<Name> → masked', () => {
    expect(sanitize('<Name>' + S.name + '</Name>')).toBe('<Name>' + MASK + '</Name>');
  });
  test('<HostName> → masked', () => {
    expect(sanitize('<HostName>' + S.hostname + '</HostName>')).toBe('<HostName>' + MASK + '</HostName>');
  });
  test('<ActualName> → masked', () => {
    expect(sanitize('<ActualName>' + S.name + '</ActualName>')).toBe('<ActualName>' + MASK + '</ActualName>');
  });
  test('<SSID> → masked', () => {
    expect(sanitize('<SSID>' + S.ssid + '</SSID>')).toBe('<SSID>' + MASK + '</SSID>');
  });
  test('<wifiname> → masked', () => {
    expect(sanitize('<wifiname>' + S.ssid + '</wifiname>')).toBe('<wifiname>' + MASK + '</wifiname>');
  });
  test('<IMEI> → masked', () => {
    expect(sanitize('<IMEI>' + S.imeiValid + '</IMEI>')).toBe('<IMEI>' + MASK + '</IMEI>');
  });
  test('<Serial> → masked', () => {
    expect(sanitize('<Serial>SN123456</Serial>')).toBe('<Serial>' + MASK + '</Serial>');
  });
  test('<rsrp> → unchanged', () => {
    const xml = '<rsrp>-85</rsrp>';
    expect(sanitize(xml)).toBe(xml);
  });
  test('<pci> → unchanged', () => {
    const xml = '<pci>456</pci>';
    expect(sanitize(xml)).toBe(xml);
  });
  test('<earfcn> → unchanged', () => {
    const xml = '<earfcn>1650</earfcn>';
    expect(sanitize(xml)).toBe(xml);
  });
  test('<nrarfcn> → unchanged', () => {
    const xml = '<nrarfcn>640000</nrarfcn>';
    expect(sanitize(xml)).toBe(xml);
  });
  test('<cell_id> → unchanged', () => {
    const xml = '<cell_id>1234567</cell_id>';
    expect(sanitize(xml)).toBe(xml);
  });
  test('<band> → unchanged', () => {
    const xml = '<band>3</band>';
    expect(sanitize(xml)).toBe(xml);
  });
});

describe('sanitize — JSON format', () => {
  test('{"ssid":"X"} → masked', () => {
    expect(sanitize('{"ssid":"' + S.ssid + '"}')).toBe('{"ssid":"' + MASK + '"}');
  });
  test('{"name":"X"} → masked', () => {
    expect(sanitize('{"name":"' + S.name + '"}')).toBe('{"name":"' + MASK + '"}');
  });
  test('{"hostname":"X"} → masked', () => {
    expect(sanitize('{"hostname":"' + S.hostname + '"}')).toBe('{"hostname":"' + MASK + '"}');
  });
  test('{"imei":"valid"} → masked', () => {
    expect(sanitize('{"imei":"' + S.imeiValid + '"}')).toBe('{"imei":"' + MASK + '"}');
  });
  test('{"pci":456} → unchanged', () => {
    const j = '{"pci":456}';
    expect(sanitize(j)).toBe(j);
  });
  test('{"rsrp":-85} → unchanged', () => {
    const j = '{"rsrp":-85}';
    expect(sanitize(j)).toBe(j);
  });
  test('{"band":3} → unchanged', () => {
    const j = '{"band":3}';
    expect(sanitize(j)).toBe(j);
  });
  test('{"cell_id":1234567} → unchanged', () => {
    const j = '{"cell_id":1234567}';
    expect(sanitize(j)).toBe(j);
  });
});

describe('sanitize — key=value format', () => {
  test('ssid=X → masked', () => {
    expect(sanitize('ssid=' + S.ssid)).toBe('ssid=' + MASK);
  });
  test('imei=valid → masked', () => {
    expect(sanitize('imei=' + S.imeiValid)).toBe('imei=' + MASK);
  });
  test('hostname=X → masked', () => {
    expect(sanitize('hostname=' + S.hostname)).toBe('hostname=' + MASK);
  });
  test('pci=456 → unchanged', () => {
    const kv = 'pci=456';
    expect(sanitize(kv)).toBe(kv);
  });
  test('earfcn=1650 → unchanged', () => {
    const kv = 'earfcn=1650';
    expect(sanitize(kv)).toBe(kv);
  });
  test('channel_number=5 → unchanged', () => {
    const kv = 'channel_number=5';
    expect(sanitize(kv)).toBe(kv);
  });
});

describe('sanitize — case insensitivity', () => {
  test('<SSID>/<ssid>/<Ssid> all masked', () => {
    expect(sanitize('<SSID>x</SSID>')).toContain(MASK);
    expect(sanitize('<ssid>x</ssid>')).toContain(MASK);
    expect(sanitize('<Ssid>x</Ssid>')).toContain(MASK);
  });
  test('<NAME>/<name>/<Name> all masked', () => {
    expect(sanitize('<NAME>x</NAME>')).toContain(MASK);
    expect(sanitize('<name>x</name>')).toContain(MASK);
    expect(sanitize('<Name>x</Name>')).toContain(MASK);
  });
  test('<RSRP>/<rsrp> both preserved', () => {
    expect(sanitize('<RSRP>-85</RSRP>')).toBe('<RSRP>-85</RSRP>');
    expect(sanitize('<rsrp>-85</rsrp>')).toBe('<rsrp>-85</rsrp>');
  });
});

describe('sanitize — edge cases', () => {
  test('empty string → empty', () => {
    expect(sanitize('')).toBe('');
  });
  test('plain "null" → unchanged', () => {
    expect(sanitize('null')).toBe('null');
  });
  test('malformed XML → no crash', () => {
    expect(() => sanitize('<Name>unclosed')).not.toThrow();
  });
  test('very long input → no crash', () => {
    const long = '<Name>' + 'A'.repeat(5000) + '</Name>';
    expect(() => sanitize(long)).not.toThrow();
  });
  test('Arabic text in <Name> → masked', () => {
    expect(sanitize('<Name>راوتر البيت</Name>')).toBe('<Name>' + MASK + '</Name>');
  });
  test('Unicode in unknown field → preserved', () => {
    expect(sanitizeField('custom_field', 'مرحبا')).toBe('مرحبا');
  });
  test('standalone MAC → masked', () => {
    const result = sanitize('see ' + S.mac + ' end');
    expect(result).not.toContain(S.mac);
    expect(result).toContain(MASK);
  });
  test('standalone Luhn-valid IMEI → masked', () => {
    const result = sanitize('device ' + S.imeiValid + ' here');
    expect(result).not.toContain(S.imeiValid);
  });
  test('standalone Luhn-invalid 15-digit → preserved', () => {
    const result = sanitize('value ' + S.imeiInvalid + ' end');
    expect(result).toContain(S.imeiInvalid);
  });
  test('IPv4 private address in ambiguous field → preserved', () => {
    expect(sanitizeField('host', '192.168.1.1')).toBe('192.168.1.1');
  });
});

describe('sanitize — oversanitization prevention', () => {
  test('10-digit Cell ID in ambiguous field → preserved', () => {
    expect(sanitizeField('cell_info', '1234567890')).toBe('1234567890');
  });
  test('13-digit number (no Luhn) → preserved', () => {
    expect(sanitizeField('info', '1234567890123')).toBe('1234567890123');
  });
  test('nrarfcn=640000 standalone → preserved', () => {
    expect(sanitize('nrarfcn=640000')).toBe('nrarfcn=640000');
  });
  test('{"pci":456} → preserved', () => {
    expect(sanitize('{"pci":456}')).toBe('{"pci":456}');
  });
  test('<band>3</band> → preserved', () => {
    expect(sanitize('<band>3</band>')).toBe('<band>3</band>');
  });
  test('<tac>12345</tac> → preserved', () => {
    expect(sanitize('<tac>12345</tac>')).toBe('<tac>12345</tac>');
  });
});

describe('sanitize — adversarial input robustness', () => {
  const adversarial = [
    '', 'null', '{}', '[]', '<', '>', '""', "''", '&amp;', '<>' + 'x'.repeat(1000) + '</>',
  ];
  test.each(adversarial)('handles input without throwing (idx=%#)', (input) => {
    expect(() => sanitize(input)).not.toThrow();
  });
});
