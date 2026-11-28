/** بنق هواوي من الراوتر — جسم صفحة diagnosis-vue (تقرير page-diagnosis ٢٨ نوفمبر) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const M = require('../src/drivers/huawei/more');

test('ServiceName مثل الصفحة', () => {
  assert.equal(M.pingServiceName(null), 'INTERNET');
  assert.equal(M.pingServiceName('<response><service_name>INTERNET</service_name></response>'), 'INTERNET');
  assert.equal(M.pingServiceName('<response><service_name>INTERNET,VOIP</service_name></response>'), 'INTERNET');
  assert.equal(M.pingServiceName('<response><service_name>4G_INTERNET,TR069</service_name></response>'), '4G_INTERNET');
});

test('نتيجة البنق: Requested ينتظر · Result 0 + المتوسط', () => {
  assert.equal(M.parsePingResult('<response><DiagnosticsState>Requested</DiagnosticsState></response>'), 'wait');
  const r = M.parsePingResult('<response><DiagnosticsState>Complete</DiagnosticsState><Host>8.8.8.8</Host><SuccessCount>4</SuccessCount><FailureCount>0</FailureCount><MinimumResponseTime>30</MinimumResponseTime><AverageResponseTime>42</AverageResponseTime><MaximumResponseTime>60</MaximumResponseTime><Result>0</Result></response>');
  assert.equal(r.ok, true); assert.equal(r.ms, 42);
  const f = M.parsePingResult('<response><DiagnosticsState>Complete</DiagnosticsState><SuccessCount>0</SuccessCount><FailureCount>4</FailureCount><Result>1</Result></response>');
  assert.equal(f.ok, false);
});

test('الإرسال فيه ServiceName', async () => {
  const posts: string[] = []; let n = 0;
  const io = {
    get: async (p: string) => p.includes('get-wan-service-name') ? '<response><service_name>INTERNET</service_name></response>'
      : (n++ ? '<response><SuccessCount>3</SuccessCount><AverageResponseTime>55</AverageResponseTime><Result>0</Result></response>' : '<response><DiagnosticsState>Requested</DiagnosticsState></response>'),
    post: async (_p: string, b: string) => { posts.push(b); return '<response>OK</response>'; },
  };
  const r = await M.routerPing(io, '8.8.8.8');
  assert.equal(r.ms, 55);
  assert.match(posts[0], /^<ServiceName>INTERNET<\/ServiceName><Host>8\.8\.8\.8<\/Host><Timeout>4000<\/Timeout>$/);
});
