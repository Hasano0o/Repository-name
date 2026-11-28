/** ZTE USSD — من service.js حق الصفحة (USSD_PROCESS + ussd_write_flag + ussd_data_info) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const U = require('../src/drivers/zte/ussd');

test('حالات ussd_write_flag مثل الصفحة', () => {
  assert.equal(U.ussdFlag('15'), 'wait');
  assert.equal(U.ussdFlag('16'), 'ready');
  assert.ok(U.ussdFlag('99').error);
  assert.ok(U.ussdFlag('4').error);
  assert.ok(U.ussdFlag('1').error);
});

test('فك الرد UCS2 hex والنص العادي', () => {
  assert.equal(U.decodeUssd('0631063506490020003100300030'), 'رصى 100');
  assert.equal(U.decodeUssd('Balance 10 SAR'), 'Balance 10 SAR');
  assert.equal(U.decodeUssd(''), '');
});

test('الإرسال بنفس جسم الصفحة + انتظار ١٦ + قراءة ussd_data_info', async () => {
  const sent: any[] = []; let n = 0;
  const io = {
    act: async (b: any) => { sent.push(b); return '{"result":"success"}'; },
    get: async () => ({ ussd_write_flag: n++ < 1 ? '15' : '16' }),
    getRaw: async (f: string) => (f === 'ussd_data_info' ? { ussd_data: '00420061006C', ussd_action: '0', ussd_dcs: '72' } : null),
  };
  const r = await U.zteUssd(io, '*166#', 10000);
  assert.equal(r, 'Bal');
  assert.deepEqual(sent[0], { goformId: 'USSD_PROCESS', USSD_operator: 'ussd_send', USSD_send_number: '*166#', notCallback: 'true' });
  assert.equal(sent.length, 1);
  await assert.rejects(U.zteUssd(io, 'abc'));
});
