/**
 * Partial Fixture — PHASE 5F
 *
 * بعض endpoints تعمل، بعضها فاشل (403/404/500).
 * الغرض: اختبار Harness مع responses مختلطة.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="UTF-8"><title>Partial Router</title></head>',
  '<body><div id="app">Partial</div></body>',
  '</html>',
].join('\n');

const SIGNAL_XML = [
  '<?xml version="1.0"?>',
  '<response>',
  '  <rsrp>-95</rsrp>',
  '  <rsrq>-12</rsrq>',
  '  <sinr>12</sinr>',
  '  <pci>321</pci>',
  '</response>',
].join('\n');

export const PARTIAL_FIXTURE: MockRouterProfile = {
  id: 'partial-fixture',
  vendor: 'Generic',
  model: 'PartialFixture',
  description: 'Partial responses — 200/403/404/500 mix',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/signal', status: 200, contentType: 'application/xml', body: SIGNAL_XML },
    { method: 'GET', path: '/api/monitoring/status', status: 500, contentType: 'text/plain', body: 'Internal Server Error' },
    { method: 'GET', path: '/api/monitoring/traffic-statistics', status: 403, contentType: 'text/plain', body: 'Forbidden' },
    { method: 'GET', path: '/api/net/current-plmn', status: 404, contentType: 'text/plain', body: 'Not Found' },
  ],
};
