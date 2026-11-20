/**
 * TP-Link 4G القديمة (TL-MR100) — راوتر محاكى بمفتاح RSA حقيقي: يفك التوقيع (nopadding) ويطلع مفتاح AES مثل الراوتر،
 * ويتأكد من h=md5(admin+كلمة) و s=seq+طول البيانات، ويرد بالصيغة القديمة مشفّرة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
declare const Buffer: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const P = require('../src/drivers/tpmr/parse');
const { TplinkMrDriver } = require('../src/drivers/tpmr/index');

const md5 = (s: string) => (ncrypto as any).createHash('md5').update(s, 'utf8').digest('hex');
const b64n = (s: string) => BigInt('0x' + Buffer.from(s, 'base64url').toString('hex'));
const { privateKey } = (ncrypto as any).generateKeyPairSync('rsa', { modulusLength: 512, publicExponent: 65537 });
const jwk = privateKey.export({ format: 'jwk' });
const N = b64n(jwk.n), D = b64n(jwk.d);
const nnHex = N.toString(16), eeHex = '010001';
function modPow(b: bigint, e: bigint, m: bigint) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
/** فك توقيع RSA بدون حشو (قطع ١٢٨ hex) ← النص */
function unsign(hex: string): string {
  let out = '';
  for (let i = 0; i < hex.length; i += 128) {
    const m = modPow(BigInt('0x' + hex.slice(i, i + 128)), D, N).toString(16).padStart(128, '0');
    out += Buffer.from(m, 'hex').toString('utf8').replace(/\0+$/, '');
  }
  return out;
}
const aesDec = (data: string, key: string, iv: string) => { const d = (ncrypto as any).createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv)); return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'); };
const aesEnc = (plain: string, key: string, iv: string) => { const c = (ncrypto as any).createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv)); return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString('base64'); };

const INDEX = `<html><head><script src="../js/jquery-1.8.3.min.js"></script><script src="../js/oid_str.js"></script><script src="../js/encrypt.js"></script><script src="../js/lib.js"></script>
<script>INCLUDE_MULTI_LANGUAGE?($.loadScript("../locale/language.js")):0,INCLUDE_LOGIN_GDPR_ENCRYPT&&($.loadScript("../js/cryptoJS.min.js"),$.loadScript("../js/tpEncrypt.js"))</script></head>
<body><script type="text/javascript">var us=1; var authTimes=0; var forbidTime=0; var modelName="TL-MR100"; var modelDesc="300Mbps Wireless N 4G LTE Router";</script></body></html>`;

function router(o: { password?: string; netFields?: string } = {}) {
  const seq = 846253911;
  const st = { key: '', iv: '', hash: '', logged: false, fails: 0, posts: [] as string[], tokenSeen: '' };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    if (m === 'POST') st.posts.push(u.pathname);
    if (u.pathname === '/') return res(200, st.logged ? INDEX.replace('</body>', '<script>var token="tok123";</script></body>') : INDEX);
    if (u.pathname === '/js/lib.js') return res(200, 'var INCLUDE_LOGIN_GDPR_ENCRYPT=1,INCLUDE_X=0;');
    if (u.pathname === '/js/oid_str.js') return res(200, 'var LTE_NET_STATUS="LTE_NET_STATUS";');
    if (u.pathname === '/cgi/getParm') return res(200, `var ee="${eeHex}";\nvar nn="${nnHex}";\nvar seq="${seq}";\n$.ret=0;`);
    if (u.pathname === '/cgi/login') {
      const data = decodeURIComponent(u.searchParams.get('data') ?? '');
      const sign = unsign(u.searchParams.get('sign') ?? '');
      const sp = new URLSearchParams(sign);
      st.key = sp.get('key') ?? ''; st.iv = sp.get('iv') ?? '';
      assert.equal(Number(sp.get('s')), seq + data.length, 's = seq + طول البيانات');
      const plain = aesDec(data, st.key, st.iv);
      const [user, pwd] = plain.split('\n');
      assert.equal(user, 'admin');
      if (pwd !== (o.password ?? 'admin123') || sp.get('h') !== md5('admin' + pwd)) { st.fails++; return res(200, '$.ret=71233;'); }
      st.hash = sp.get('h')!; st.logged = true;
      return res(200, '$.ret=0;');
    }
    if (u.pathname === '/cgi_gdpr') {
      if (!st.logged) return res(403, '');
      st.tokenSeen = init?.headers?.TokenID ?? '';
      const body = String(init.body);
      const sign = unsign(/sign=([0-9a-f]+)/.exec(body)![1]);
      const data = /data=([^\r\n]+)/.exec(body)![1];
      assert.equal(new URLSearchParams(sign).get('h'), st.hash);
      const req = aesDec(data, st.key, st.iv);
      let out = '';
      const blocks = [...req.matchAll(/\[([A-Z0-9_]+)#([\d,]+)#[\d,]+\](\d+),\d+/g)];
      for (const b of blocks) {
        if (b[1] === 'LTE_NET_STATUS') out += `[${b[2]}]${b[3]}\r\n${o.netFields ?? 'nwType=3\r\nrfInfoRsrp=-97\r\nrfInfoRsrq=-11\r\nrfInfoSnr=125\r\nrfInfoRssi=-68\r\nrfInfoBand=3\r\nrfInfoChannel=1275\r\nispName=STC'}\r\n`;
        else if (b[1] === 'WAN_LTE_LINK_CFG') out += `[${b[2]}]${b[3]}\r\nenable=1\r\nconnectStatus=2\r\n`;
        else if (b[1] === 'IGD_DEV_INFO') out += `[${b[2]}]${b[3]}\r\nmodelName=TL-MR100\r\nsoftwareVersion=1.0.0 Build 220801\r\n`;
      }
      out += '[error]0';
      return res(200, aesEnc(out, st.key, st.iv));
    }
    return res(404, '');
  };
  return st;
}

test('MR: التعرّف — صفحة MR100 نعم، صفحة NX200 (gdprProxy) لا', () => {
  assert.equal(P.mrIsLoginPage(INDEX), true);
  assert.equal(P.mrIsLoginPage('<script src="js/oid_str.js"></script><script src="js/encrypt.js"></script><script src="js/lib.js"></script><script src="js/gdprProxy.js"></script>'), false);
  assert.equal(P.mrGdprFlag('a,INCLUDE_LOGIN_GDPR_ENCRYPT=1,b'), true);
  assert.equal(P.mrGdprFlag('INCLUDE_LOGIN_GDPR_ENCRYPT:!1'), false);
  assert.equal(P.mrGdprFlag('nothing'), null);
});

test('MR: صيغة الطلب والرد القديمة', () => {
  assert.equal(P.mrReq([{ type: 1, oid: 'LTE_NET_STATUS', stack: '2,1,0,0,0,0' }, { type: 1, oid: 'IGD_DEV_INFO', attrs: ['modelName'] }]),
    '1&1\r\n[LTE_NET_STATUS#2,1,0,0,0,0#0,0,0,0,0,0]0,0\r\n[IGD_DEV_INFO#0,0,0,0,0,0#0,0,0,0,0,0]1,1\r\nmodelName\r\n');
  const r = P.mrParse('[2,1,0,0,0,0]0\r\nrfInfoRsrp=-90\r\n[0,0,0,0,0,0]1\r\nmodelName=TL-MR100\r\n[error]0');
  assert.equal(r.error, 0); assert.equal(r.blocks.length, 2); assert.equal(r.blocks[0].f.rfInfoRsrp, '-90');
});

test('MR: الإشارة من الحقول — SNR بوحدة ٠٫١، الأصفار ما تنعرض', () => {
  const s = P.mrSignal({ rfInfoRsrp: '-97', rfInfoRsrq: '-11', rfInfoSnr: '125', rfInfoRssi: '-68', rfInfoBand: '3', rfInfoChannel: '1275' });
  assert.equal(s.rsrp, -97); assert.equal(s.sinr, 12.5); assert.equal(s.band, 'B3'); assert.equal(s.earfcn, '1275'); assert.equal(s.network, '4G');
  assert.deepEqual(P.mrSignal({ rfInfoRsrp: '0', rfInfoSnr: '0' }), {});
  assert.equal(P.mrOperator({ ispName: 'STC' }), 'STC');
});

test('MR: الدخول المشفّر (data+sign) ← TokenID ← القراءة على /cgi_gdpr', async () => {
  const st = router();
  const d = new TplinkMrDriver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await d.login('192.168.1.1', '', 'admin123');
  const s = await d.getSignal();
  assert.equal(s.rsrp, -97); assert.equal(s.band, 'B3'); assert.equal(s.sinr, 12.5);
  assert.equal(st.tokenSeen, 'tok123');
  const n = await d.getNetworkInfo();
  assert.equal(n.operator, 'STC'); assert.equal(n.connected, true); assert.equal(n.supports5g, false);
  assert.match(String((await d.getDeviceDetails()).software), /tpmr-pages-1$/);
});

test('MR: كلمة غلط (71233) ← رسالة واضحة، وما نعيدها بالخلفية', async () => {
  const st = router({ password: 'right' });
  const d = new TplinkMrDriver();
  await d.detect('192.168.1.1');
  await assert.rejects(d.login('192.168.1.1', '', 'wrong'), /غلط/);
  await assert.rejects(d.login('192.168.1.1', '', 'wrong'), /رفضها الراوتر قبل/);
  assert.equal(st.fails, 1);
});

test('MR: الجامع ما يفتح الخطر، وردود الأوامر تطلع', async () => {
  router();
  const d = new TplinkMrDriver();
  await d.detect('192.168.1.1');
  await d.login('192.168.1.1', '', 'admin123');
  const pages = d.afterLoginPages();
  assert.ok(pages.includes('/_bandly/oid/get/LTE_BAND_SEL/2-1-0-0-0-0.txt'));
  const r = await d.fetchAuthPage('/_bandly/oid/get/LTE_NET_STATUS/2-1-0-0-0-0.txt');
  assert.ok(r.text.includes('rfInfoRsrp=-97'));
  assert.equal((await d.fetchAuthPage('/cgi/reboot')).ok, false);
});
