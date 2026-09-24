/**
 * Unknown CPE Realistic Fixture — PHASE 5F
 *
 * راوتر مجهول ببنية واقعية.
 * الأدلة لا تكفي لاستنتاج vendor/model.
 * يوجد حقل signal غير معروف (signal_strength_percent) — لن يُستخرج.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <title>Router Login</title>',
  '</head>',
  '<body>',
  '  <div class="login-container">',
  '    <h1>Router Login</h1>',
  '    <form action="/login" method="post">',
  '      <input type="password" name="pw" placeholder="Password">',
  '      <button type="submit">Sign in</button>',
  '    </form>',
  '  </div>',
  '</body>',
  '</html>',
].join('\n');

const INFO_JSON = JSON.stringify({
  device_name: 'Generic CPE',
  firmware_version: 'unknown-1.0',
  uptime_seconds: 3600,
});

const STATUS_JSON = JSON.stringify({
  signal_strength_percent: 72,
  network_state: 'connected',
  lan_status: 'up',
});

export const UNKNOWN_CPE_REALISTIC: MockRouterProfile = {
  id: 'unknown-cpe-realistic',
  vendor: 'Generic',
  model: 'UnknownCPE',
  description: 'Unknown CPE — realistic structure, no vendor inference',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
  ],
  endpoints: [
    { method: 'GET', path: '/status', status: 200, contentType: 'text/plain; charset=utf-8', body: 'OK' },
    { method: 'GET', path: '/api/status', status: 200, contentType: 'application/json', body: STATUS_JSON },
  ],
};
