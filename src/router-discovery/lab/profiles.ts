/**
 * Router Lab — Profiles — PHASE 5B
 *
 * Normal (6):
 *   HUAWEI_GENERIC_V1  / HUAWEI_GENERIC_V2
 *   ZTE_GENERIC_V1     / ZTE_GENERIC_V2
 *   UNKNOWN_GENERIC    / UNKNOWN_NOISY
 * Malicious (4, unchanged from 5A):
 *   SENSITIVE_VALUES_FIXTURE / REDIRECT_FIXTURE
 *   WRITE_ENDPOINT_FIXTURE   / AUTH_ENDPOINT_FIXTURE
 *
 * Backward-compat aliases (exports only, NOT in registries):
 *   HUAWEI_GENERIC === HUAWEI_GENERIC_V1
 *   ZTE_GENERIC    === ZTE_GENERIC_V1
 *
 * All responses are GET-only, deterministic.
 * Normal profiles contain no sensitive values in their endpoints.
 * Capabilities are NEVER declared here — only HTTP evidence.
 */

import { MockRouterProfile } from './types';

// ═══════════════════════════════════════════════════════════════════════
// Shared private bodies
// ═══════════════════════════════════════════════════════════════════════

const HUAWEI_HOME =
  '<!DOCTYPE html><html><head><title>Huawei Router</title></head><body></body></html>';

const ZTE_HOME =
  '<!DOCTYPE html><html><head><title>ZTE Router</title></head><body></body></html>';

const UNKNOWN_HOME =
  '<!DOCTYPE html><html><head><title>Router</title></head><body><form action="/login" method="post"><input type="password" name="pw"></form></body></html>';

// ═══════════════════════════════════════════════════════════════════════
// Huawei V1 — text/xml + application/xml mix
// ═══════════════════════════════════════════════════════════════════════

const HUAWEI_V1_INFO =
  '<?xml version="1.0"?><response><DeviceName>Huawei CPE</DeviceName><SoftwareVersion>1.0.0</SoftwareVersion><HardwareVersion>B535</HardwareVersion></response>';

const HUAWEI_V1_SIGNAL =
  '<?xml version="1.0"?><response><rsrp>-91</rsrp><rsrq>-10</rsrq><sinr>18</sinr><pci>123</pci><earfcn>1650</earfcn></response>';

const HUAWEI_V1_STATUS =
  '<?xml version="1.0"?><response><ConnectionStatus>901</ConnectionStatus><CurrentNetworkType>19</CurrentNetworkType></response>';

const HUAWEI_V1_TRAFFIC =
  '<?xml version="1.0"?><response><CurrentDownloadRate>125000</CurrentDownloadRate><CurrentUploadRate>5000</CurrentUploadRate><CurrentConnectTime>3600</CurrentConnectTime></response>';

const HUAWEI_V1_PLMN =
  '<?xml version="1.0"?><response><FullName>TestOperator</FullName><ShortName>TEST</ShortName></response>';

export const HUAWEI_GENERIC_V1: MockRouterProfile = {
  id: 'huawei-generic-v1',
  vendor: 'Huawei',
  model: 'B535',
  description: 'Huawei LTE CPE — V1 (text/xml + rsrp naming)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
    { method: 'GET', path: '/html/home.html', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/information', status: 200, contentType: 'application/xml', body: HUAWEI_V1_INFO },
    { method: 'GET', path: '/api/device/signal', status: 200, contentType: 'text/xml', body: HUAWEI_V1_SIGNAL },
    { method: 'GET', path: '/api/monitoring/status', status: 200, contentType: 'application/xml', body: HUAWEI_V1_STATUS },
    { method: 'GET', path: '/api/monitoring/traffic-statistics', status: 200, contentType: 'application/xml', body: HUAWEI_V1_TRAFFIC },
    { method: 'GET', path: '/api/net/current-plmn', status: 200, contentType: 'application/xml', body: HUAWEI_V1_PLMN },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// Huawei V2 — different Content-Type + different field names
// ═══════════════════════════════════════════════════════════════════════

const HUAWEI_V2_INFO =
  '<?xml version="1.0"?><response><DeviceName>Huawei CPE</DeviceName><SoftwareVersion>2.0.0</SoftwareVersion><HardwareVersion>B818</HardwareVersion></response>';

const HUAWEI_V2_SIGNAL =
  '<?xml version="1.0"?><response><lte_rsrp>-88</lte_rsrp><lte_rsrq>-9</lte_rsrq><lte_sinr>20</lte_sinr><lte_pci>456</lte_pci><lte_earfcn>1300</lte_earfcn></response>';

const HUAWEI_V2_STATUS =
  '<?xml version="1.0"?><response><ConnectionStatus>901</ConnectionStatus><CurrentNetworkTypeEx>112</CurrentNetworkTypeEx></response>';

const HUAWEI_V2_TRAFFIC =
  '<?xml version="1.0"?><response><CurrentDownloadRate>250000</CurrentDownloadRate><CurrentUploadRate>10000</CurrentUploadRate><CurrentConnectTime>7200</CurrentConnectTime></response>';

const HUAWEI_V2_SECCELL =
  '<?xml version="1.0"?><response><lteseccell_list>1650,B3,20,123,-89,-10,0,19;3450,B7,20,456,-95,-12,0,15</lteseccell_list></response>';

export const HUAWEI_GENERIC_V2: MockRouterProfile = {
  id: 'huawei-generic-v2',
  vendor: 'Huawei',
  model: 'B818',
  description: 'Huawei LTE CPE — V2 (application/xml + lte_* naming)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
    { method: 'GET', path: '/html/home.html', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/information', status: 200, contentType: 'application/xml', body: HUAWEI_V2_INFO },
    { method: 'GET', path: '/api/device/signal', status: 200, contentType: 'application/xml', body: HUAWEI_V2_SIGNAL },
    { method: 'GET', path: '/api/monitoring/status', status: 200, contentType: 'application/xml', body: HUAWEI_V2_STATUS },
    { method: 'GET', path: '/api/monitoring/traffic-statistics', status: 200, contentType: 'application/xml', body: HUAWEI_V2_TRAFFIC },
    { method: 'GET', path: '/api/device/seccellinfo', status: 200, contentType: 'application/xml', body: HUAWEI_V2_SECCELL },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// ZTE V1 — JSON goform + status.json
// ═══════════════════════════════════════════════════════════════════════

const ZTE_V1_GOFORM =
  '{"rsrp":"-91","rsrq":"-10","sinr":"18","pci":"123","lte_band":"3","lte_ca_pcell_band":"3","lte_ca_pcell_freq":"1300","network_type":"LTE","wa_inner_version":"ZTE_GENERIC_V1"}';

const ZTE_V1_STATUS =
  '{"modem_main_state":"modem_init_complete","ppp_status":"ppp_connected","network_provider":"TestOperator"}';

export const ZTE_GENERIC_V1: MockRouterProfile = {
  id: 'zte-generic-v1',
  vendor: 'ZTE',
  model: 'MC801A',
  description: 'ZTE LTE CPE — V1 (LTE fields)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: ZTE_HOME },
    { method: 'GET', path: '/index.html', status: 200, contentType: 'text/html', body: ZTE_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/goform/goform_get_cmd_process', status: 200, contentType: 'application/json', body: ZTE_V1_GOFORM },
    { method: 'GET', path: '/status.json', status: 200, contentType: 'application/json', body: ZTE_V1_STATUS },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// ZTE V2 — 5G NSA + text/plain status endpoint
// ═══════════════════════════════════════════════════════════════════════

const ZTE_V2_GOFORM =
  '{"lte_rsrp":"-88","lte_rsrq":"-9","lte_snr":"20","lte_pci":"456","lte_band":"7","nr5g_pci":"789","nr5g_action_band":"78","nr5g_action_channel":"640000","network_type":"5G_NSA","wa_inner_version":"ZTE_GENERIC_V2"}';

const ZTE_V2_STATUS_TEXT =
  'modem_main_state=modem_init_complete\nppp_status=ppp_connected\nnetwork_provider=TestOperator';

export const ZTE_GENERIC_V2: MockRouterProfile = {
  id: 'zte-generic-v2',
  vendor: 'ZTE',
  model: 'MC888',
  description: 'ZTE 5G CPE — V2 (5G NSA fields, text/plain status)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: ZTE_HOME },
    { method: 'GET', path: '/index.html', status: 200, contentType: 'text/html', body: ZTE_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/goform/goform_get_cmd_process', status: 200, contentType: 'application/json', body: ZTE_V2_GOFORM },
    { method: 'GET', path: '/device/status', status: 200, contentType: 'text/plain', body: ZTE_V2_STATUS_TEXT },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// Unknown — Generic (unchanged from 5A) + Noisy (new)
// ═══════════════════════════════════════════════════════════════════════

const UNKNOWN_STATUS = 'OK';
const UNKNOWN_API = '{"signal":"unknown","vendor":"generic"}';

export const UNKNOWN_GENERIC: MockRouterProfile = {
  id: 'unknown-generic',
  vendor: 'Generic',
  model: 'Unknown',
  description: 'Unknown router — minimal responses',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: UNKNOWN_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/status', status: 200, contentType: 'text/plain', body: UNKNOWN_STATUS },
    { method: 'GET', path: '/api/status', status: 200, contentType: 'application/json', body: UNKNOWN_API },
  ],
};

const UNKNOWN_NOISY_PAGE =
  '<!DOCTYPE html><html><head><title>Router</title></head><body></body></html>';

const NOISY_BODY = 'access denied or not found';

export const UNKNOWN_NOISY: MockRouterProfile = {
  id: 'unknown-noisy',
  vendor: 'Generic',
  model: 'UnknownNoisy',
  description: 'Unknown router with mixed status codes (403/404/500)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: UNKNOWN_NOISY_PAGE },
  ],
  endpoints: [
    { method: 'GET', path: '/admin', status: 403, contentType: 'text/plain', body: NOISY_BODY },
    { method: 'GET', path: '/old-api', status: 404, contentType: 'text/plain', body: NOISY_BODY },
    { method: 'GET', path: '/internal', status: 500, contentType: 'text/plain', body: NOISY_BODY },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// Malicious fixtures — unchanged from 5A
// ═══════════════════════════════════════════════════════════════════════

const FIXTURE_HOME =
  '<!DOCTYPE html><html><head><title>Fixture</title></head><body></body></html>';

export const SENSITIVE_VALUES_FIXTURE: MockRouterProfile = {
  id: 'sensitive-values-fixture',
  vendor: 'Test',
  model: 'SensitiveFixture',
  description: 'Contains sensitive values that must be filtered',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: FIXTURE_HOME },
  ],
  endpoints: [
    {
      method: 'GET',
      path: '/api/device/signal',
      status: 200,
      contentType: 'application/json',
      body: '{"rsrp":"-91","password":"SECRET_VALUE","token":"ABC123TOKEN","imei":"490154203237518","mac":"AA:BB:CC:DD:EE:FF","ssid":"HomeWiFi"}',
    },
  ],
};

export const REDIRECT_FIXTURE: MockRouterProfile = {
  id: 'redirect-fixture',
  vendor: 'Test',
  model: 'RedirectFixture',
  description: 'Returns 302 redirect to public host',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: FIXTURE_HOME },
  ],
  endpoints: [
    {
      method: 'GET',
      path: '/login.html',
      status: 302,
      contentType: 'text/plain',
      body: '',
      headers: { location: 'https://evil.example.com/steal' },
    },
  ],
};

export const WRITE_ENDPOINT_FIXTURE: MockRouterProfile = {
  id: 'write-endpoint-fixture',
  vendor: 'Test',
  model: 'WriteFixture',
  description: 'Has a write-like endpoint that must remain DENY',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: FIXTURE_HOME },
  ],
  endpoints: [
    {
      method: 'GET',
      path: '/goform/goform_set_cmd_process',
      status: 200,
      contentType: 'application/json',
      body: '{"result":"OK"}',
    },
  ],
};

export const AUTH_ENDPOINT_FIXTURE: MockRouterProfile = {
  id: 'auth-endpoint-fixture',
  vendor: 'Test',
  model: 'AuthFixture',
  description: 'Has an auth/token endpoint that must remain DENY',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: FIXTURE_HOME },
  ],
  endpoints: [
    {
      method: 'GET',
      path: '/api/webserver/SesTokInfo',
      status: 200,
      contentType: 'application/xml',
      body: '<?xml version="1.0"?><response><SesInfo>x</SesInfo><TokInfo>y</TokInfo></response>',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// Registry — 6 normal + 4 malicious (aliases are NOT listed)
// ═══════════════════════════════════════════════════════════════════════

export const NORMAL_PROFILES: readonly MockRouterProfile[] = [
  HUAWEI_GENERIC_V1,
  HUAWEI_GENERIC_V2,
  ZTE_GENERIC_V1,
  ZTE_GENERIC_V2,
  UNKNOWN_GENERIC,
  UNKNOWN_NOISY,
];

export const MALICIOUS_FIXTURES: readonly MockRouterProfile[] = [
  SENSITIVE_VALUES_FIXTURE,
  REDIRECT_FIXTURE,
  WRITE_ENDPOINT_FIXTURE,
  AUTH_ENDPOINT_FIXTURE,
];

export const ALL_PROFILES: readonly MockRouterProfile[] = [
  ...NORMAL_PROFILES,
  ...MALICIOUS_FIXTURES,
];

// ═══════════════════════════════════════════════════════════════════════
// Backward-compat aliases (exports only — NOT in any registry)
// ═══════════════════════════════════════════════════════════════════════

export const HUAWEI_GENERIC = HUAWEI_GENERIC_V1;
export const ZTE_GENERIC = ZTE_GENERIC_V1;
