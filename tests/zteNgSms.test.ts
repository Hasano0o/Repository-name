/**
 * ZTE الجيل الجديد (MU5250) — «الراوتر رفض … Access denied (-32002)» في مُحسّن الألعاب (٦ نوفمبر):
 *  1. web_login يرجّع ubus_rpc_session حتى لو رفض الدخول (result ≠ 0) — جلسة بدون صلاحيات.
 *     القديم يحسبها دخول ناجح ← كل كتابة Access denied. الجديد: رسالة دخول واضحة وما يرسل أوامر.
 *  2. ويب zwrt أحياناً يرد Access denied على أمر مسموح (الصفحة تعيده بنفس الجلسة) —
 *     القديم يعيد مرة وحدة بس بعد دخول جديد ← يفشل.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'expo-crypto') return { getRandomBytes: (n: number) => Uint8Array.from(require('crypto').randomBytes(n)) };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};

/**
 * رسائل ZTE الجيل الجديد (zwrt_wms) — شكاوى أعضاء ٢١ نوفمبر «الرسائل غير مدعومة في راوتر ZTE».
 * الصيغة من service_rpc.js في FULL ١٨ و٢٠ نوفمبر.
 */
const nc = require('node:crypto');
const sha = (s: string) => nc.createHash('sha256').update(s).digest('hex').toUpperCase();
const PW = 'Admin#5250';
const SALT = 'a1b2c3d4';
const hex = (t: string) => Array.from(t).map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

function router(opts: { sendFail?: boolean } = {}) {
  const good = new Set<string>();
  const calls: { method: string; p: any }[] = [];
  let msgs = [
    { id: '7', number: '966512345678', content: hex('رصيدك ٥٠ ريال'), date: '26,11,21,14,30,05,+12', tag: '1' },
    { id: '5', number: '1500', content: hex('Hello'), date: '26,11,20,09,05,00,+12', tag: '0' },
    { id: '6', number: '0500000000', content: hex('مرسلة'), date: '26,11,20,10,00,00,+12', tag: '2' },
  ];
  let pending = 0;
  const res = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (_u: string, init?: any) => {
    const [{ params: [sess, obj, method, p] }] = JSON.parse(String(init.body));
    calls.push({ method: `${obj}.${method}`, p });
    const ok = (o: unknown) => res([{ jsonrpc: '2.0', id: 1, result: [0, o] }]);
    if (method === 'web_login_info') return ok({ zte_web_sault: SALT });
    if (method === 'web_login') {
      const s = nc.randomBytes(16).toString('hex');
      if (p.password === sha(sha(PW) + SALT)) { good.add(s); return ok({ result: 0, ubus_rpc_session: s }); }
      return ok({ result: 1, ubus_rpc_session: s });
    }
    if (!good.has(sess)) return res([{ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } }]);
    if (method === 'zte_libwms_get_sms_data') return ok({ messages: msgs });
    if (method === 'zwrt_wms_modify_tag') { msgs = msgs.map(m => (p.id.split(';').includes(m.id) ? { ...m, tag: '0' } : m)); return ok({ result: 'success' }); }
    if (method === 'zwrt_wms_delete_sms') { msgs = msgs.filter(m => !p.id.split(';').includes(m.id)); pending = 1; return ok({ result: 'success' }); }
    if (method === 'zte_libwms_send_sms') { pending = 1; return ok({ result: 'success' }); }
    if (method === 'zwrt_wms_get_cmd_status') {
      if (pending-- > 0) return ok({ sms_cmd: String(p.sms_cmd), sms_cmd_status_result: '1' });
      return ok({ sms_cmd: String(p.sms_cmd), sms_cmd_status_result: opts.sendFail ? '2' : '3' });
    }
    return ok({});
  };
  return { calls, msgs: () => msgs };
}

const { ZteNgDriver } = require('../src/drivers/zteng/index');
const sms = require('../src/drivers/zteng/sms');

test('zte-ng رسائل: الوارد بالنص العربي والتاريخ، والرقم ما يتخرّب', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.50.1', 'admin', PW);
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox.map((m: any) => m.index), ['7', '5']);
  assert.equal(inbox[0].content, 'رصيدك ٥٠ ريال');
  assert.equal(inbox[0].phone, '966512345678');
  assert.equal(inbox[0].date, '2026-11-21 14:30');
  assert.equal(inbox[0].unread, true);
  const q = r.calls.find(c => c.method === 'zwrt_wms.zte_libwms_get_sms_data')!.p;
  assert.deepEqual(q, { page: 0, data_per_page: 200, mem_store: 1, tags: 10, order_by: 'order by id desc' });
  const sent = await d.listSms('sent');
  assert.deepEqual(sent.map((m: any) => m.content), ['مرسلة']);
});

test('zte-ng رسائل: مقروءة + حذف بصيغة الصفحة "7;"', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.50.2', 'admin', PW);
  await d.markSmsRead('7');
  assert.deepEqual(r.calls.find(c => c.method.endsWith('zwrt_wms_modify_tag'))!.p, { id: '7;', tag: 0 });
  await d.deleteSms('5');
  assert.deepEqual(r.calls.find(c => c.method.endsWith('zwrt_wms_delete_sms'))!.p, { id: '5;' });
  assert.ok(r.calls.some(c => c.method.endsWith('zwrt_wms_get_cmd_status') && c.p.sms_cmd === 6));
  assert.ok(!r.msgs().some(m => m.id === '5'));
});

test('zte-ng رسائل: الإرسال UNICODE + ينتظر الحالة، ومرة وحدة بس', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.50.3', 'admin', PW);
  await d.sendSms(' 1500 ', 'سلام');
  const s = r.calls.filter(c => c.method.endsWith('zte_libwms_send_sms'));
  assert.equal(s.length, 1);
  assert.equal(s[0].p.number, '1500');
  assert.equal(s[0].p.message_body, hex('سلام'));
  assert.equal(s[0].p.encode_type, 'UNICODE');
  assert.equal(s[0].p.id, '-1');
  assert.match(s[0].p.sms_time, /^\d\d;\d\d;\d\d;\d\d;\d\d;\d\d;[+-]\d+$/);
  assert.ok(r.calls.some(c => c.method.endsWith('zwrt_wms_get_cmd_status') && c.p.sms_cmd === 4));
});

test('zte-ng رسائل: الراوتر يقول فشل (2) ← خطأ واضح بدون إعادة إرسال', async () => {
  const r = router({ sendFail: true });
  const d = new ZteNgDriver();
  await d.login('192.168.50.4', 'admin', PW);
  await assert.rejects(d.sendSms('1500', 'x'), /ما قدر يرسل/);
  assert.equal(r.calls.filter(c => c.method.endsWith('zte_libwms_send_sms')).length, 1);
});

test('zte-ng: ميزة الرسائل ظاهرة (listSms/sendSms موجودة)', () => {
  const d = new ZteNgDriver();
  assert.ok(d.capabilities.includes('sms'));
  assert.equal(typeof d.listSms, 'function');
  assert.equal(typeof d.sendSms, 'function');
});

test('sms helpers', () => {
  assert.equal(sms.ngSmsDate('26;01;05;07;08;09;+12'), '2026-01-05 07:08');
  assert.equal(sms.ngSmsDate('bad'), 'bad');
  assert.equal(sms.idList(['1', '', '2']), '1;2;');
  assert.equal(sms.cmdState({ sms_cmd_status_result: 3 }), 'ok');
  assert.equal(sms.cmdState({ sms_cmd_status_result: '2' }), 'fail');
  assert.equal(sms.cmdState({}), 'wait');
});
