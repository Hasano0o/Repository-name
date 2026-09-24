/**
 * Malformed Fixture — PHASE 5F
 *
 * ردود مكسورة تُستخدم لاختبار أن safeDiscoveryFetch + evidenceCollector
 * لا تنكسر، وأن المخرجات تبقى آمنة.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

// HTML مقطوع (بدون </body> أو </html>)
const HOME_TRUNCATED = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8"><title>Truncated</title></head>',
  '<body><div id="app">',
].join('\n');

// XML غير مكتمل (بدون </response>)
const INFO_XML_TRUNCATED = [
  '<?xml version="1.0"?>',
  '<response>',
  '  <DeviceName>Truncated Device</DeviceName>',
  '  <SoftwareVersion>1.0.0</SoftwareVersion>',
].join('\n');

// JSON غير صالح
const STATUS_JSON_BROKEN = '{"ConnectionStatus": 90';

// XML بقيمة غير رقمية
const SIGNAL_XML_BADVALUE = [
  '<?xml version="1.0"?>',
  '<response>',
  '  <rsrp>NaN</rsrp>',
  '  <sinr></sinr>',
  '  <pci>not-a-number</pci>',
  '</response>',
].join('\n');

export const MALFORMED_FIXTURE: MockRouterProfile = {
  id: 'malformed-fixture',
  vendor: 'Generic',
  model: 'MalformedFixture',
  description: 'Malformed responses — tests resilience',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_TRUNCATED },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/information', status: 200, contentType: 'application/xml', body: INFO_XML_TRUNCATED },
    { method: 'GET', path: '/api/monitoring/status', status: 200, contentType: 'application/json', body: STATUS_JSON_BROKEN },
    { method: 'GET', path: '/api/device/signal', status: 200, contentType: 'application/xml', body: SIGNAL_XML_BADVALUE },
  ],
};
