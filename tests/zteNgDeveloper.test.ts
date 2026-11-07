/**
 * ZTE MU5250 / MC8830 — تثبيت الترددات «Access denied (-32002)» حتى بعد دخول ناجح (FULL ٦ نوفمبر ٩:٤٤ م):
 * أوامر الترددات (nwinfo_set_lte_ext_band · nwinfo_set_nrbandlock) ما لها مكان إلا في «خيارات المطوّر»
 * (#developer_options ← #developer_options_login لو developer_option_loginfo ≠ 1). الدخول:
 * zwrt_web.web_developer_option_login {password: sha(sha(كلمة)+salt)} بنفس الجلسة.
 * القديم: يدخل admin من جديد ويرجع نفس الرفض. الجديد: يدخل خيارات المطوّر بكلمة admin مرة وحدة ويعيد.
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
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 100 ? 1 : ms);

const nc = require('node:crypto');
const sha = (s: string) => nc.createHash('sha256').update(s).digest('hex').toUpperCase();
const PW = 'Admin#5250';
const SALT = 'a1b2c3d4';
const { publicKey } = nc.generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
const DEV_ONLY = /nwinfo_set_(lte_ext_band|nrbandlock)$/;

/** devPw: كلمة خيارات المطوّر (الافتراضي = كلمة الدخول) · ACL: الترددات تبي جلسة دخلت خيارات المطوّر، وgwl_bandlock مو موجود */
function router(opts: { devPw?: string; httpsOnly?: boolean; model?: string; gwlInvalid?: boolean } = {}) {
  const good = new Set<string>();
  const dev = new Set<string>();
  const log: string[] = [];
  let lte = '', nr = '', netSelect = 'WL_AND_5G';
  const devPw = opts.devPw ?? PW;
  const res = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const https = url.startsWith('https://');
    const [{ params: [sess, , method, p] }] = JSON.parse(String(init.body));
    log.push(method);
    if (https) log.push('https');
    const ok = (o: unknown) => res([{ jsonrpc: '2.0', id: 1, result: [0, o] }]);
    const denied = () => res([{ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } }]);
    if (method === 'web_login_info') return ok({ zte_web_sault: SALT });
    if (method === 'web_login') {
      const s = nc.randomBytes(16).toString('hex');
      if (p.password === sha(sha(PW) + SALT)) { good.add(s); return ok({ result: 0, ubus_rpc_session: s }); }
      return ok({ result: 1, ubus_rpc_session: s });
    }
    if (method === 'nwinfo_get_netinfo') return ok({ network_type: 'LTE', lte_rsrp: '-90', net_select: netSelect, nr5g_sa_band_lock: nr });
    if (method === 'web_info') return ok({ developer_option_loginfo: dev.has(sess) ? '1' : '0', model: opts.model ?? 'MU5250' });
    if (!good.has(sess)) return denied();
    if (method === 'web_crt_get') return ok({ result: publicKey });
    if (method === 'web_http_enstr_set') return ok({ result: 'success' });
    if (method === 'web_developer_option_login') {
      if (p.password === sha(sha(devPw) + SALT)) { dev.add(sess); return ok({ result: '0' }); }
      return ok({ result: '1' });
    }
    if (method === 'nwinfo_set_gwl_bandlock') return opts.gwlInvalid ? res([{ jsonrpc: '2.0', id: 1, result: [2] }]) : denied();
    // httpsOnly: الكتابة على http مرفوضة كلها (مثل MU5250 ٧ نوفمبر: GET / على http = 405)
    if (opts.httpsOnly && /set_/.test(method) && !https) return denied();
    if (opts.httpsOnly && https && /set_/.test(method)) {
      if (method === 'nwinfo_set_lte_ext_band') { lte = p.lte_band_mask; return ok({ result: 'success' }); }
      if (method === 'nwinfo_set_netselect') { netSelect = p.net_select; return ok({ result: 'success' }); }
    }
    if (DEV_ONLY.test(method) && !dev.has(sess)) return denied();
    if (method === 'nwinfo_set_lte_ext_band') { lte = p.lte_band_mask; return ok({ result: 'success' }); }
    if (method === 'nwinfo_set_nrbandlock') { nr = p.nr5g_band; return ok({ result: 'success' }); }
    if (method === 'nwinfo_set_netselect') { netSelect = p.net_select; return ok({ result: 'success' }); }
    return ok({});
  };
  return { log, lte: () => lte, nr: () => nr, mode: () => netSelect };
}

const { ZteNgDriver } = require('../src/drivers/zteng/index');
const count = (log: string[], m: string) => log.filter(x => x === m).length;

test('MU5250: تثبيت 4G يحتاج خيارات المطوّر ← ندخلها بكلمة admin وينجح (كان: Access denied)', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.11', 'admin', PW);
  await d.setBand([1, 3], undefined);
  assert.equal(r.lte(), '0x0000000000000005');
  assert.equal(count(r.log, 'web_developer_option_login'), 1);
});

test('MU5250: تثبيت 5G بعد خيارات المطوّر بنفس الجلسة ← بدون دخول ثاني', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.12', 'admin', PW);
  await d.identify();
  await d.setBand([3], undefined);
  const logins = count(r.log, 'web_login');
  await d.setBand('keep', [78]);
  assert.equal(r.nr(), '78');
  assert.equal(count(r.log, 'web_login'), logins);
  assert.equal(count(r.log, 'web_developer_option_login'), 1);
});

test('MU5250: كلمة المطوّر غير كلمة الدخول ← رسالة واضحة، وما نعيد المحاولة لحالنا', async () => {
  const r = router({ devPw: 'SuperSecret' });
  const d = new ZteNgDriver();
  await d.login('192.168.0.13', 'admin', PW);
  await assert.rejects(d.setBand([3], undefined), (e: any) => /خيارات المطوّر/.test(e.message));
  const n = count(r.log, 'web_developer_option_login');
  assert.ok(n >= 1 && n <= 2, `محاولات كلمة المطوّر: ${n} (مرة لكل أصل http/https)`);
  const d2 = new ZteNgDriver();
  await d2.login('192.168.0.13', 'admin', PW);
  await assert.rejects(d2.setBand([3], undefined), (e: any) => /خيارات المطوّر/.test(e.message));
  assert.equal(count(r.log, 'web_developer_option_login'), n, 'ما جرّبنا الكلمة المرفوضة مرة ثانية');
});

test('MU5250: وضع الشبكة (صفحة عادية) ← بدون خيارات المطوّر', async () => {
  const r = router();
  const d = new ZteNgDriver();
  await d.login('192.168.0.14', 'admin', PW);
  await d.setNetworkMode('03');
  assert.equal(count(r.log, 'web_developer_option_login'), 0);
  assert.ok(r.mode() !== 'WL_AND_5G', r.mode());
});

test('MU5250: الكتابة على http مرفوضة كلها ← نكمّل على https (أصل الصفحة) وننجح، والمرة الجاية مباشرة', async () => {
  const r = router({ httpsOnly: true, devPw: 'other' });
  const d = new ZteNgDriver();
  await d.login('192.168.0.15', 'admin', PW);
  await d.setNetworkMode('03');
  assert.ok(r.mode() !== 'WL_AND_5G', r.mode());
  assert.ok(r.log.includes('https'), 'رحنا https');
  const before = r.log.length;
  await d.setNetworkMode('0803');
  const after = r.log.slice(before);
  assert.ok(!after.includes('web_login'), after.join(' | '));
});

test('MU5252 «TOPFLOW»: gwl_bandlock يرد [2] (خانات غلط) ← lte_ext_band وينجح (كان: «ما يقبل هذا التردد — [2]» على كل تردد)', async () => {
  const r = router({ gwlInvalid: true, model: 'MU5252' });
  const d = new ZteNgDriver();
  await d.login('192.168.0.21', 'admin', PW);
  await d.setBand([3], undefined);
  assert.equal(r.lte(), '0x0000000000000004');
});

test('MU5252: يتعرّف كموديل لحاله (غير مؤكد ← كرت FULL) ويروح lte_ext_band مباشرة بدون gwl', async () => {
  const r = router({ gwlInvalid: true, model: 'ZTE TOPFLOW MU5252' });
  const d = new ZteNgDriver();
  await d.login('192.168.0.22', 'admin', PW);
  const p = await d.identify();
  assert.equal(p.id, 'mu5252');
  assert.ok(!p.verified);
  await d.setBand([1, 3], undefined);
  assert.equal(count(r.log, 'nwinfo_set_gwl_bandlock'), 0);
  assert.equal(r.lte(), '0x0000000000000005');
});
