/**
 * جيب M2A-77 (MiFi) — محاكى بنفس API صفحاته (ملفات «جهاز جديد» ٨ نوفمبر):
 * ipaddr.js ← "192.168.43.1:8882" · POST :8882/{query,set,info} {cmd, logon_pwd} ← {code}
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSetTimeout = setTimeout;
(globalThis as any).setTimeout = (f: any, ms?: number) => realSetTimeout(f, Math.min(ms ?? 0, 5));

const PW = 'secret1';
function router() {
  const st = {
    calls: [] as any[],
    bands: {
      GSM: { support: ['GSM900'], enable: [1] }, UMTS: { support: ['B1', 'B8'], enable: [1, 1] },
      LTE: { support: ['B1', 'B3', 'B7', 'B8', 'B20', 'B28'], enable: [1, 1, 1, 1, 1, 1] },
      CDMA: { support: [], enable: [] }, NR: { support: [], enable: [] },
    } as any,
    devs: [{ mac: 'aa:bb:cc:00:00:01', ipv: '192.168.43.100', name: 'iPhone', iface: 'ap0', forbid: 0 }],
    mode: 0, simnwoff: 0, offs: 0,
    lock: { lock: 0, rat: 7, gsm1900: 0, arfcn: 0, cellid: 0, lock_mode: -1 } as any,
    sms: [{ _id: 7, id: 0, phonenumber: '0912345678', time: '2026-11-08 17:00', txt: Buffer.from('مرحبا', 'utf8').toString('base64'), type: 1, read: 0 },
          { _id: 8, id: 1, phonenumber: '0912345678', time: '2026-11-08 17:01', txt: Buffer.from('hi', 'utf8').toString('base64'), type: 2, read: 1 }] as any[],
    sent: [] as any[],
  };
  const res = (status: number, body: string) => ({ ok: status < 400, status, url: '', headers: { get: () => null }, text: async () => body } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.port === '' && u.pathname === '/ipaddr.js') return res(200, 'var postaddr = "192.168.43.1:8882";\n// var postaddr = "127.0.0.1:7001";');
    if (u.port !== '8882') return res(404, 'nf');
    const b = JSON.parse(String(init?.body ?? '{}'));
    st.calls.push({ path: u.pathname, ...b });
    if (b.logon_pwd !== PW && !b.logon_pwd_ignore) return res(200, JSON.stringify({ code: 400 }));
    if (b.cmd === 1) return res(200, JSON.stringify({ code: 200, logontm: 1 }));
    if (b.cmd === 100) return res(200, JSON.stringify({ code: 200, networkselection: st.mode, internet_conn: 1, band: 3, earfcn: 1401, rsrp: -84, sinr: 12, pci: 148, cellid: 283930, ss_rsrp: 2147483647, device_model: 'M2A-77', wan_ipv4: '10.163.25.244', imei: '861666060042534' }));
    if (b.cmd === 215) return res(200, JSON.stringify({ code: 200, conn_dev: st.devs, conn_dev_offline: [] }));
    if (b.cmd === 102 || b.cmd === 103) { for (const d of st.devs) if (d.mac === b.info[0].mac.toLowerCase() || d.mac.toUpperCase() === b.info[0].mac) d.forbid = b.cmd === 102 ? 1 : 0; return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 115) { st.mode = b.networkselection; return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 116) { st.simnwoff = b.simnwoff; if (b.simnwoff === 1) st.offs++; return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 176) return res(200, JSON.stringify({ code: 200, ...st.lock }));
    if (b.cmd === 175) { st.lock = { lock: b.lock, rat: b.rat, gsm1900: b.gsm1900, arfcn: b.arfcn, cellid: b.cellid, lock_mode: b.lock_mode }; return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 210) return res(200, JSON.stringify({ code: 200, sms_rev: st.sms }));
    if (b.cmd === 126) { for (const m of st.sms) if (m._id === b._id) m.read = 1; return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 212) { st.sent.push(b.sms_send); return res(200, JSON.stringify({ code: 200 })); }
    if (b.cmd === 181) return res(200, JSON.stringify({ code: 200, ...st.bands }));
    if (b.cmd === 182) { for (const g of ['GSM', 'UMTS', 'LTE', 'CDMA', 'NR']) st.bands[g] = b[g]; return res(200, JSON.stringify({ code: 200 })); }
    return res(200, JSON.stringify({ code: 200 }));
  };
  return st;
}
async function drv() { const { M2aDriver } = require('../src/drivers/m2a/index'); return new M2aDriver(); }

test('M2A: التعرّف من ipaddr.js (منفذ الأوامر 8882) · الدخول cmd 1 بس (بدون 114 اللي يغيّر اللغة)', async () => {
  const st = router();
  const d = await drv();
  assert.equal(await d.detect('192.168.43.1'), true);
  await d.login('192.168.43.1', '', PW);
  assert.ok(st.calls.some(c => c.cmd === 1 && c.path === '/set'));
  assert.ok(!st.calls.some(c => c.cmd === 114));
  await assert.rejects(d.login('192.168.43.1', '', 'wrong'), /كلمة المرور غلط/);
});

test('M2A: الإشارة من cmd 100 (4G: rsrp/sinr/band) · 2147483647 = فاضي · الأجهزة من 215 · الحظر 102', async () => {
  router();
  const d = await drv();
  await d.login('192.168.43.1', '', PW);
  const s = await d.getSignal();
  assert.equal(s.band, 'B3'); assert.equal(s.rsrp, -84); assert.equal(s.sinr, 12); assert.equal(s.pci, '148'); assert.equal(s.nrRsrp, undefined);
  const l = await d.getDevices();
  assert.deepEqual(l[0], { mac: 'AA:BB:CC:00:00:01', ip: '192.168.43.100', name: 'iPhone', blocked: false });
  await d.blockDevice('AA:BB:CC:00:00:01', true);
  assert.equal((await d.getDevices())[0].blocked, true);
  assert.equal((await d.getDeviceDetails()).wanIp, '10.163.25.244');
});

test('M2A: الترددات 181/182 بنفس صفحتهم — تثبيت B3+B20 يغيّر LTE بس ويتأكد · [] = الكل · تردد مو موجود = noChange', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.43.1', '', PW);
  assert.deepEqual((await d.getBandConfig()).locked, []);
  await d.setBand([3, 20]);
  assert.deepEqual(st.bands.LTE.enable, [0, 1, 0, 0, 1, 0]);
  assert.deepEqual(st.bands.UMTS.enable, [1, 1], 'باقي المجموعات كما هي');
  assert.deepEqual((await d.getBandConfig()).locked, [3, 20]);
  await d.setBand([]);
  assert.deepEqual(st.bands.LTE.enable, [1, 1, 1, 1, 1, 1]);
  await assert.rejects(d.setBand([41]), (e: any) => e.noChange === true);
});

test('M2A: وضع الشبكة 115 (4G بس = 5) + تأكد · آي بي جديد 116 (طفّ ثم شغّل)', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.43.1', '', PW);
  assert.equal((await d.getBandConfig()).mode, '0');
  await d.setNetworkMode('5');
  assert.equal(st.mode, 5);
  await d.reconnectData({ holdSecs: 1 });
  assert.equal(st.offs, 1); assert.equal(st.simnwoff, 0);
});

test('M2A: قفل البرج 175/176 (4G: rat 7، cellid = PCI، lock_mode 3) + فك', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.43.1', '', PW);
  assert.equal(await d.getCellLock(), null);
  await d.lockCell({ tech: 'LTE', arfcn: '1401', pci: '148' });
  assert.deepEqual(st.lock, { lock: 1, rat: 7, gsm1900: 0, arfcn: 1401, cellid: 148, lock_mode: 3 });
  assert.deepEqual(await d.getCellLock(), { pci: '148', arfcn: '1401', tech: 'LTE' });
  await d.unlockCell();
  assert.equal(st.lock.lock, 0);
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '148' }), (e: any) => e.noChange === true);
});

test('M2A: الرسائل 210 (base64 عربي، الوارد type 1) · مقروءة 126 · إرسال 212 بنص base64', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.43.1', '', PW);
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox, [{ index: '7', phone: '0912345678', content: 'مرحبا', date: '2026-11-08 17:00', unread: true }]);
  assert.equal((await d.listSms('sent'))[0].content, 'hi');
  await d.markSmsRead('7');
  assert.equal(st.sms[0].read, 1);
  await d.sendSms('091 234 5678', 'أهلاً');
  assert.equal(st.sent[0].phonenumber, '0912345678');
  assert.equal(Buffer.from(st.sent[0].txt, 'base64').toString('utf8'), 'أهلاً');
});
