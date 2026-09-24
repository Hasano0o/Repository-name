/**
 * sanitize-camelcase.test.ts — PHASE 5G
 *
 * يثبت أن sanitize يتعامل مع:
 *   - camelCase (macAddress, authToken)
 *   - snake_case (mac_address, auth_token)
 *   - kebab-case (mac-address, auth-token)
 *   - UPPER (MACADDRESS, MAC_ADDRESS)
 *
 * ويثبت أنه لا oversanitize القيم الشرعية.
 */

import { sanitize, sanitizeField, MASK } from '../../router-discovery/sanitize';

// ═══════════════════════════════════════════════════════════════════════
// Group A — Regressions from PHASE 5F
// ═══════════════════════════════════════════════════════════════════════

describe('5G — PHASE 5F regressions', () => {
  test('<MacAddress> is now masked', () => {
    expect(sanitize('<MacAddress>AA:BB:CC:DD:EE:FF</MacAddress>'))
      .toBe('<MacAddress>' + MASK + '</MacAddress>');
  });

  test('<HostName> is now masked', () => {
    expect(sanitize('<HostName>synthetic-device-1</HostName>'))
      .toBe('<HostName>' + MASK + '</HostName>');
  });

  test('<DeviceName> remains masked (from 4A)', () => {
    expect(sanitize('<DeviceName>Synthetic Huawei CPE</DeviceName>'))
      .toBe('<DeviceName>' + MASK + '</DeviceName>');
  });

  test('<ModelName> is PRESERVED (SAFE — not sensitive)', () => {
    expect(sanitize('<ModelName>B535</ModelName>'))
      .toBe('<ModelName>B535</ModelName>');
  });

  test('<Model> is PRESERVED', () => {
    expect(sanitize('<Model>MC888</Model>')).toBe('<Model>MC888</Model>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group B — camelCase / snake_case / kebab-case variants
// ═══════════════════════════════════════════════════════════════════════

describe('5G — case-insensitive sensitive field names', () => {
  const SENSITIVE_VARIANTS: Array<[string, string]> = [
    ['macAddress', 'AA:BB:CC:DD:EE:FF'],
    ['mac_address', 'AA:BB:CC:DD:EE:FF'],
    ['mac-address', 'AA:BB:CC:DD:EE:FF'],
    ['MACAddress', 'AA:BB:CC:DD:EE:FF'],
    ['MAC_ADDRESS', 'AA:BB:CC:DD:EE:FF'],
    ['wifiName', 'HomeNet'],
    ['wifi_name', 'HomeNet'],
    ['WlanSsid', 'HomeNet'],
    ['ssidName', 'HomeNet'],
    ['authToken', 'tok123'],
    ['auth_token', 'tok123'],
    ['accessToken', 'tok123'],
    ['sessionId', 'sess123'],
    ['session_id', 'sess123'],
    ['userPassword', 'pass123'],
    ['user_password', 'pass123'],
    ['adminPassword', 'pass123'],
    ['hostname', 'router.lan'],
    ['host_name', 'router.lan'],
    ['deviceName', 'CPE'],
    ['device_name', 'CPE'],
    ['serialNumber', 'SN123'],
    ['serial_number', 'SN123'],
    ['phoneNumber', '966501234567'],
    ['phone_number', '966501234567'],
    ['emailAddress', 'a@b.com'],
    ['email_address', 'a@b.com'],
    ['iccid', '89014103211118510720'],
    ['imei', '490154203237518'],
    ['imsi', '310150123456789'],
    ['MEID', 'A000000A1B2C3D'],
  ];

  test.each(SENSITIVE_VARIANTS)(
    'mask key=%s',
    (key, value) => {
      expect(sanitizeField(key, value)).toBe(MASK);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Group C — Preserved radio/network fields (no oversanitization)
// ═══════════════════════════════════════════════════════════════════════

describe('5G — radio/network fields preserved', () => {
  const SAFE_FIELDS: Array<[string, string]> = [
    ['rsrp', '-91'],
    ['RSRP', '-91'],
    ['lte_rsrp', '-91'],
    ['lteRsrp', '-91'],
    ['LTE_RSRP', '-91'],
    ['nr5g_rsrp', '-85'],
    ['nr5g_rsrq', '-11'],
    ['nr5g_sinr', '22'],
    ['nr5g_pci', '789'],
    ['z5g_rsrp', '-85'],
    ['pci', '123'],
    ['earfcn', '1650'],
    ['nrarfcn', '640000'],
    ['NRARFCN', '640000'],
    ['cell_id', '1234567'],
    ['cellId', '1234567'],
    ['enodeb_id', '112233'],
    ['gnb_id', '445566'],
    ['tac', '12345'],
    ['band', '3'],
    ['nr_band', '78'],
    ['lte_band', '3'],
    ['bandwidth', '20'],
    ['dl_bandwidth', '20'],
    ['mcc', '310'],
    ['mnc', '15'],
    ['plmn', '310150'],
    ['network_type', 'LTE'],
    ['networkType', 'LTE'],
    ['signalbar', '4'],
    ['signal_bar', '4'],
    ['network_provider', 'STC'],
    ['operator', 'STC'],
    ['model', 'B535'],
    ['modelName', 'B535'],
    ['vendor', 'Huawei'],
    ['manufacturer', 'Huawei'],
    ['softwareVersion', '2.0.0'],
    ['hardwareVersion', 'B535'],
    ['firmware', '1.0.0'],
  ];

  test.each(SAFE_FIELDS)(
    'preserve key=%s value=%s',
    (key, value) => {
      expect(sanitizeField(key, value)).toBe(value);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Group D — SSID variants (structured matching)
// ═══════════════════════════════════════════════════════════════════════

describe('5G — SSID / WiFi variants', () => {
  test('ssid exact → mask', () => {
    expect(sanitizeField('ssid', 'HomeNet')).toBe(MASK);
  });
  test('ssid1 → mask', () => {
    expect(sanitizeField('ssid1', 'HomeNet')).toBe(MASK);
  });
  test('ssid_5g → mask', () => {
    expect(sanitizeField('ssid_5g', 'HomeNet')).toBe(MASK);
  });
  test('SSID_5G → mask', () => {
    expect(sanitizeField('SSID_5G', 'HomeNet')).toBe(MASK);
  });
  test('wifiName → mask', () => {
    expect(sanitizeField('wifiName', 'HomeNet')).toBe(MASK);
  });
  test('wlanName → mask', () => {
    expect(sanitizeField('wlanName', 'HomeNet')).toBe(MASK);
  });
  test('wifiSSID → mask', () => {
    expect(sanitizeField('wifiSSID', 'HomeNet')).toBe(MASK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group E — pass / password structured rule
// ═══════════════════════════════════════════════════════════════════════

describe('5G — pass structured rule', () => {
  test('password → mask', () => {
    expect(sanitizeField('password', 'abc')).toBe(MASK);
  });
  test('userPassword → mask', () => {
    expect(sanitizeField('userPassword', 'abc')).toBe(MASK);
  });
  test('passwd → mask', () => {
    expect(sanitizeField('passwd', 'abc')).toBe(MASK);
  });
  test('passcode → mask', () => {
    expect(sanitizeField('passcode', '1234')).toBe(MASK);
  });
  test('pwd → mask', () => {
    expect(sanitizeField('pwd', 'abc')).toBe(MASK);
  });

  test('passenger is NOT masked (structured rule)', () => {
    expect(sanitizeField('passenger', 'John')).toBe('John');
  });
  test('passive is NOT masked', () => {
    expect(sanitizeField('passive', 'mode')).toBe('mode');
  });
  test('compass is NOT masked', () => {
    expect(sanitizeField('compass', 'value')).toBe('value');
  });
  test('bypass is NOT masked', () => {
    expect(sanitizeField('bypass', 'value')).toBe('value');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group F — XML / JSON / key=value formats
// ═══════════════════════════════════════════════════════════════════════

describe('5G — formats', () => {
  test('XML <MacAddress> masked', () => {
    expect(sanitize('<MacAddress>AA:BB:CC:DD:EE:FF</MacAddress>'))
      .toContain(MASK);
  });

  test('JSON "macAddress":"..." masked', () => {
    expect(sanitize('{"macAddress":"AA:BB:CC:DD:EE:FF"}'))
      .toBe('{"macAddress":"' + MASK + '"}');
  });

  test('key=value macAddress=... masked', () => {
    expect(sanitize('macAddress=AA:BB:CC:DD:EE:FF')).toContain(MASK);
  });

  test('nested JSON authToken masked', () => {
    const out = sanitize('{"session":{"authToken":"t123abc"}}');
    expect(out).not.toContain('t123abc');
    expect(out).toContain(MASK);
  });

  test('JSON preserve rsrp', () => {
    expect(sanitize('{"rsrp":"-91"}')).toBe('{"rsrp":"-91"}');
  });

  test('XML preserve <Model>', () => {
    expect(sanitize('<Model>B535</Model>')).toBe('<Model>B535</Model>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group G — Value-based masking (Luhn, MAC, base64)
// ═══════════════════════════════════════════════════════════════════════

describe('5G — value-based masking', () => {
  test('Luhn IMEI in generic field → mask', () => {
    expect(sanitizeField('unknownField', '490154203237518')).toBe(MASK);
  });
  test('Non-Luhn 15-digit → preserved', () => {
    expect(sanitizeField('unknownField', '356789012345678'))
      .toBe('356789012345678');
  });
  test('MAC pattern in generic field → mask', () => {
    expect(sanitizeField('unknownField', 'AA:BB:CC:DD:EE:FF')).toBe(MASK);
  });
  test('ICCID (89-prefix + Luhn) → mask', () => {
    expect(sanitizeField('unknownField', '89014103211118510720')).toBe(MASK);
  });
  test('long base64 → mask', () => {
    expect(sanitizeField('unknownField',
      'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD')).toBe(MASK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group H — No oversanitization of numeric radio values
// ═══════════════════════════════════════════════════════════════════════

describe('5G — no oversanitization of radio values', () => {
  test('10-digit cell_id preserved', () => {
    expect(sanitizeField('cell_id', '1234567890')).toBe('1234567890');
  });
  test('EARFCN 640000 preserved', () => {
    expect(sanitizeField('earfcn', '640000')).toBe('640000');
  });
  test('NRARFCN 640000 preserved', () => {
    expect(sanitizeField('nrarfcn', '640000')).toBe('640000');
  });
  test('PCI 123 preserved', () => {
    expect(sanitizeField('pci', '123')).toBe('123');
  });
  test('12-digit random (non-Luhn) preserved', () => {
    expect(sanitizeField('customField', '123456789012'))
      .toBe('123456789012');
  });
  test('standalone "nrarfcn=640000" in body preserved', () => {
    expect(sanitize('nrarfcn=640000')).toBe('nrarfcn=640000');
  });
  test('standalone "pci=456" preserved', () => {
    expect(sanitize('pci=456')).toBe('pci=456');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Group I — End-to-end (sanitize over realistic fixture bodies)
// ═══════════════════════════════════════════════════════════════════════

describe('5G — end-to-end on realistic snippets', () => {
  const HUAWEI_INFO_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<response>',
    '  <DeviceName>Synthetic Huawei CPE</DeviceName>',
    '  <SoftwareVersion>2.0.0-synthetic</SoftwareVersion>',
    '  <HardwareVersion>B535-synthetic</HardwareVersion>',
    '  <Imei>490154203237518</Imei>',
    '  <MacAddress>AA:BB:CC:DD:EE:FF</MacAddress>',
    '  <WanIPAddress>192.168.8.100</WanIPAddress>',
    '</response>',
  ].join('\n');

  test('no IMEI in sanitized Huawei info', () => {
    const out = sanitize(HUAWEI_INFO_XML);
    expect(out).not.toContain('490154203237518');
  });

  test('no MAC in sanitized Huawei info', () => {
    const out = sanitize(HUAWEI_INFO_XML);
    expect(out).not.toContain('AA:BB:CC:DD:EE:FF');
  });

  test('SoftwareVersion preserved', () => {
    const out = sanitize(HUAWEI_INFO_XML);
    expect(out).toContain('2.0.0-synthetic');
  });

  const HUAWEI_SIGNAL_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<response>',
    '  <rsrp>-91</rsrp>',
    '  <rsrq>-10</rsrq>',
    '  <sinr>18</sinr>',
    '  <pci>123</pci>',
    '  <earfcn>1650</earfcn>',
    '  <band>3</band>',
    '</response>',
  ].join('\n');

  test('all signal fields preserved', () => {
    const out = sanitize(HUAWEI_SIGNAL_XML);
    expect(out).toContain('-91');
    expect(out).toContain('-10');
    expect(out).toContain('18');
    expect(out).toContain('123');
    expect(out).toContain('1650');
    expect(out).toContain('3');
  });
});
