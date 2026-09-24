/**
 * Router Lab — Profiles — PHASE 5A
 *
 * 3 profiles نظيفة (Huawei / ZTE / Unknown)
 * + 4 fixtures خبيثة (Sensitive / Redirect / Write / Auth)
 *
 * كل المحتوى deterministic — لا Date.now، لا Math.random.
 * Normal profiles لا تحتوي أي بيانات حساسة.
 */

import { MockRouterProfile } from './types';

// ═══════════════════════════════════════════════════════════════════════
// 1. Huawei Generic — clean
// ═══════════════════════════════════════════════════════════════════════

const HUAWEI_HOME =
  '<!DOCTYPE html><html><head><title>Huawei Router</title></head><body></body></html>';

const HUAWEI_DEVICE_INFO =
  '<?xml version="1.0"?><response><DeviceName>Huawei CPE</DeviceName><SoftwareVersion>1.0.0</SoftwareVersion><HardwareVersion>B535</HardwareVersion></response>';

const HUAWEI_STATUS =
  '<?xml version="1.0"?><response><ConnectionStatus>901</ConnectionStatus><CurrentNetworkType>19</CurrentNetworkType></response>';

const HUAWEI_TRAFFIC =
  '<?xml version="1.0"?><response><CurrentDownloadRate>125000</CurrentDownloadRate><CurrentUploadRate>5000</CurrentUploadRate><CurrentConnectTime>3600</CurrentConnectTime></response>';

export const HUAWEI_GENERIC: MockRouterProfile = {
  id: 'huawei-generic',
  vendor: 'Huawei',
  model: 'B535',
  description: 'Huawei LTE CPE (generic, clean)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
    { method: 'GET', path: '/html/home.html', status: 200, contentType: 'text/html', body: HUAWEI_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/information', status: 200, contentType: 'application/xml', body: HUAWEI_DEVICE_INFO },
    { method: 'GET', path: '/api/monitoring/status', status: 200, contentType: 'application/xml', body: HUAWEI_STATUS },
    { method: 'GET', path: '/api/monitoring/traffic-statistics', status: 200, contentType: 'application/xml', body: HUAWEI_TRAFFIC },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// 2. ZTE Generic — clean
// ═══════════════════════════════════════════════════════════════════════

const ZTE_HOME =
  '<!DOCTYPE html><html><head><title>ZTE Router</title></head><body></body></html>';

const ZTE_SIGNAL_JSON =
  '{"rsrp":"-91","rsrq":"-10","sinr":"18","pci":"123","lte_band":"3","lte_ca_pcell_band":"3","lte_ca_pcell_freq":"1300","network_type":"LTE","wa_inner_version":"ZTE_GENERIC_V1"}';

export const ZTE_GENERIC: MockRouterProfile = {
  id: 'zte-generic',
  vendor: 'ZTE',
  model: 'MC801A',
  description: 'ZTE LTE/5G CPE (generic, clean)',
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html', body: ZTE_HOME },
    { method: 'GET', path: '/index.html', status: 200, contentType: 'text/html', body: ZTE_HOME },
  ],
  endpoints: [
    { method: 'GET', path: '/goform/goform_get_cmd_process', status: 200, contentType: 'application/json', body: ZTE_SIGNAL_JSON },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// 3. Unknown Generic — clean, minimal
// ═══════════════════════════════════════════════════════════════════════

const UNKNOWN_HOME =
  '<!DOCTYPE html><html><head><title>Router</title></head><body><form action="/login" method="post"><input type="password" name="pw"></form></body></html>';

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

// ═══════════════════════════════════════════════════════════════════════
// 4. Malicious fixtures (للاختبار فقط)
// ═══════════════════════════════════════════════════════════════════════

const FIXTURE_HOME =
  '<!DOCTYPE html><html><head><title>Fixture</title></head><body></body></html>';

/**
 * يحتوي قيمًا حساسة يجب أن تُفلتر.
 * Sanitization يجب أن يزيلها قبل الوصول إلى Evidence.
 */
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
      path: '/api/status',
      status: 200,
      contentType: 'application/json',
      body: '{"rsrp":"-91","password":"SECRET_VALUE","token":"ABC123TOKEN","imei":"490154203237518","mac":"AA:BB:CC:DD:EE:FF","ssid":"HomeWiFi"}',
    },
  ],
};

/** يُرجع 302 إلى host عام — Discovery يجب أن يرفض النتيجة */
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
      path: '/api/status',
      status: 302,
      contentType: 'text/plain',
      body: '',
      headers: { location: 'https://evil.example.com/steal' },
    },
  ],
};

/** يحتوي write endpoint — policy يجب أن يرفضه */
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

/** يحتوي auth endpoint — policy يجب أن يرفضه */
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
// 5. Registry
// ═══════════════════════════════════════════════════════════════════════

export const NORMAL_PROFILES: readonly MockRouterProfile[] = [
  HUAWEI_GENERIC,
  ZTE_GENERIC,
  UNKNOWN_GENERIC,
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
