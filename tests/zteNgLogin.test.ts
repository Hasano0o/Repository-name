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
(globalThis as any).__DEV__ = false;

const nc = require('node:crypto');
const sha = (s: string) => nc.createHash('sha256').update(s).digest('hex').toUpperCase();
const PW = 'Admin#5250';
const SALT = 'a1b2c3d4';

/** راوتر محاكى. flaky = كم مرة يرد Access denied على أمر مسموح قبل ما يقبله */
function router(opts: { flaky?: number } = {}) {
  const good = new Set<string>();
  const log: string[] = [];
  let flaky = opts.flaky ?? 0;
  let netSelect = 'WL_AND_5G';
  const res = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => body, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (_url: string, init?: any) => {
    const [{ params: [sess, obj, method, p] }] = JSON.parse(String(init.body));
    log.push(`${obj}.${method}`);
    const ok = (o: unknown) => res([{ jsonrpc: '2.0', id: 1, result: [0, o] }]);
    const denied = () => res([{ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } }]);
    if (method === 'web_login_info') return ok({ zte_web_sault: SALT });
    if (method === 'web_login') {
      const s = nc.randomBytes(16).toString('hex');
      if (p.password === sha(sha(PW) + SALT)) { good.add(s); return ok({ result: 0, ubus_rpc_session: s }); }
      return ok({ result: 1, ubus_rpc_session: s });       // جلسة بدون صلاحيات
    }
    if (method === 'nwinfo_get_netinfo') return ok({ network_type: 'LTE', lte_rsrp: '-90', net_select: netSelect });
    if (!good.has(sess)) return denied();
    if (flaky > 0) { flaky--; return denied(); }
    if (method === 'nwinfo_set_netselect') { netSelect = p.net_select; return ok({ result: 'success' }); }
    return ok({});
  };
  return { log, mode: () => netSelect };
}

const { ZteNgDriver } = require('../src/drivers/zteng/index');

test('MU5250: كلمة غلط (result=1 مع جلسة) ← رسالة دخول، بدون أوامر كتابة', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.1', 'admin', 'wrong-pass');
  await assert.rejects((d as any).write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: 'Only_LTE' }) as Promise<unknown>,
    (e: any) => /رفض الدخول/.test(e.message) && /رمز 1/.test(e.message));
  assert.equal(r.log.filter(x => x.endsWith('nwinfo_set_netselect')).length, 0);
});

test('MU5250: كلمة غلط ← المحاولة الثانية بالخلفية ما ترسل دخول', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.2', 'admin', 'wrong-pass');
  await assert.rejects((d as any).write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: 'Only_LTE' }) as Promise<unknown>);
  const n = r.log.filter(x => x.endsWith('web_login')).length;
  await assert.rejects((d as any).write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: 'Only_LTE' }) as Promise<unknown>);
  assert.equal(r.log.filter(x => x.endsWith('web_login')).length, n);
});

test('MU5250: Access denied عابر ← نعيد بنفس الجلسة وينجح', async () => {
  const r = router({ flaky: 3 });
  const d = new ZteNgDriver();
  await d.login('192.168.0.3', 'admin', PW);
  await (d as any).write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: 'Only_LTE' });
  assert.equal(r.mode(), 'Only_LTE');
});

test('MU5250: الكلمة الصحيحة ← الكتابة تنجح من أول مرة', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.4', 'admin', PW);
  await (d as any).write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: 'Only_LTE' });
  assert.equal(r.mode(), 'Only_LTE');
  assert.equal(r.log.filter(x => x.endsWith('web_login')).length, 1);
});
