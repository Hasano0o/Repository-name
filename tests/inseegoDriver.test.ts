/**
 * Inseego MiFi 8000 / 8800L (Verizon Jetpack) — راوتر محاكى بنفس ردود الصفحة (ملفات ٣ أعضاء، ليبيانا):
 * /srv/status بدون دخول · /login/ (secToken + gSecureToken) ← /submitLogin/ sha1(كلمة+secToken) · signalstat.cgi (تعديل Band Manager بس).
 * sha1 هنا من node:crypto (مستقل عن الدرايفر).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const sha1 = (s: string) => (ncrypto as any).createHash('sha1').update(s, 'utf8').digest('hex');
// من FULL حقيقي (٧ نوفمبر ٦:٠٦، المدار — ليبيا)
const REAL = {"loginStatus":1,"statusData":{"statusBarAirplaneMode":"AirplaneModeOff","statusBarBatteryChargingSource":"ChargingSourceNone","statusBarBatteryChargingState":"false","statusBarBatteryDetection":"Present","statusBarBatteryPercent":"96","statusBarBytesReceived":"181331420","statusBarBytesTotal":"203241872","statusBarBytesTransmitted":"21910452","statusBarClientListSize":"2","statusBarConnectionDuration":"3302","statusBarConnectionState":"Connected","statusBarNetwork":"ALMADAR","statusBarNetworkID":"606^\u0002","statusBarSignalBars":"4","statusBarSimStatus":"Ready","statusBarTechnology":"LTE+","statusBarTechnologyText":"","statusBarWiFiClientListSize":"2","statusBarWiFiEnabled":1}};
const STATUS = { statusData: {
  statusBarSignalBars: 4, statusBarTechnology: '4G LTE', statusBarTechnologyText: '4G LTE', statusBarNetwork: 'Libyana',
  statusBarConnectionState: 'Connected', statusBarBatteryPercent: 76, statusBarBatteryChargingState: 'Charging', statusBarWiFiClientListSize: 2,
} };

function router(o: { password?: string; stat?: boolean; title?: string; loginPage?: string; lock?: boolean; dropSubmit?: number; authError?: string; dropStatus?: number } = {}) {
  const st = { sec: '6e1f0c2a9b7d43e8', g: 'efdbef4ddc037c4ae30bca3cd49fec16a5f3a007', logged: false, posts: [] as string[], fails: 0, inflight: 0, maxInflight: 0, n: 0 };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  const inner = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    if (m === 'POST') st.posts.push(u.pathname);
    switch (u.pathname) {
      case '/': return res(200, `<!DOCTYPE HTML><html><head><title>${o.title ?? 'MiFi 8000'}</title></head><body><script src="/06240220/script/notifications.js"></script></body></html>`);
      case '/srv/status': if (o.dropStatus && o.dropStatus-- > 0) throw new Error('The request timed out.'); return res(200, JSON.stringify(STATUS));
      case '/login/': return res(200, o.loginPage ?? `<html><script>var secToken = "${st.sec}";</script><form><input type="hidden" name="gSecureToken" value="${st.g}" /></form></html>`);
      case '/submitLogin/': {
        if (o.dropSubmit && o.dropSubmit-- > 0) throw new Error('The request timed out.');
        if (o.lock) return res(429, '');
        if (o.authError) return res(500, JSON.stringify({ authError: o.authError }));
        const p = new URLSearchParams(init.body);
        if (p.get('gSecureToken') !== st.g || p.get('shaPassword') !== sha1((o.password ?? 'admin123') + st.sec)) {
          st.fails++;
          return res(500, JSON.stringify({ authError: 'Incorrect password.<br>Try again.', noOfRemainingLoginAttempts: 5 - st.fails }));
        }
        st.logged = true;
        return res(200, '{}');
      }
      case '/cgi/signalstat.cgi':
        if (!o.stat) return res(404, '<html>404 Not Found</html>');
        return res(200, JSON.stringify({ ok: true, rssi: '-61', rsrp: '-94', rsrq: '-11', snr: '9.4', tech: 'LTE', bars: '4', oper: 'Libyana', cell: '22113281', band: '3', batt: 76, ca: 0 }));
      case '/logout/': st.logged = false; return res(200, '');
      default: return res(404, 'Not Found');
    }
  };
  // نعدّ الطلبات المتداخلة (الجهاز الحقيقي يعلق معها)
  (globalThis as any).fetch = async (url: string, init?: any) => {
    st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
    try { await new Promise(r => setTimeout(r, 2)); return await inner(url, init); } finally { st.inflight--; }
  };
  return st;
}
const driver = () => { const { InseegoDriver } = require('../src/drivers/inseego/index'); return new InseegoDriver(); };

test('inseego: التعرّف من /srv/status + الموديل من <title>', async () => {
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  const p = await d.identify();
  assert.equal(p.brand, 'inseego');
  assert.equal(p.id, 'inseego-mifi-8000');
  assert.equal(p.tech, '4G');
  assert.equal(p.writeUnverified, true);
  assert.ok(p.verified !== true);
});

test('inseego: M2000 = 5G', async () => {
  router({ title: 'M2000' });
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  assert.equal((await d.identify()).tech, '5G');
});

test('inseego: راوتر ثاني (بدون /srv/status) ← لا', async () => {
  (globalThis as any).fetch = async () => ({ ok: false, status: 404, url: '', headers: { get: () => null }, text: async () => '<html>NETGEAR</html>' });
  assert.equal(await driver().detect('192.168.1.1'), false);
});

test('inseego: الدخول sha1(كلمة + secToken) مع gSecureToken', async () => {
  const st = router({ password: 'Pw!2026' });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'Pw!2026');
  assert.equal(st.logged, true);
  assert.deepEqual(st.posts, ['/submitLogin/']);
});

test('inseego: كلمة غلط (500 authError) ← رسالة واضحة، محاولة وحدة', async () => {
  const st = router({ password: 'right' });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'wrong'), /كلمة المرور غلط/);
  assert.equal(st.fails, 1);
});

test('inseego: 429 ← وقّف الدخول', async () => {
  router({ lock: true });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'x'), /محاولات كثيرة/);
});

test('inseego: صفحة دخول بدون secToken ← ما نرسل شي', async () => {
  const st = router({ loginPage: '<html><form></form></html>' });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'x'), /مختلفة/);
  assert.equal(st.posts.length, 0);
});

test('inseego: فيرموير أصلي ← نوع الشبكة والشركة والبطارية بس (بدون أرقام مخترعة)', async () => {
  router();
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'admin123');
  const s = await d.getSignal();
  assert.equal(s.network, 'LTE');
  assert.equal(s.rsrp, undefined);
  assert.equal(s.sinr, undefined);
  const n = await d.getNetworkInfo();
  assert.equal(n.operator, 'Libyana');
  assert.equal(n.connected, true);
  const x = await d.getExtras();
  assert.deepEqual(x.health, { battery: 76, charging: true });
  assert.deepEqual(await d.getCells(), []);
});

test('inseego: تعديل Band Manager (signalstat.cgi) ← الأرقام والتردد والبرج', async () => {
  router({ stat: true });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'admin123');
  const s = await d.getSignal();
  assert.equal(s.rsrp, -94);
  assert.equal(s.rsrq, -11);
  assert.equal(s.sinr, 9.4);
  assert.equal(s.band, '3');
  assert.equal(s.cellId, '22113281');
  const c = await d.getCells();
  assert.equal(c.length, 1);
  assert.equal(c[0].band, 3);
});

test('inseego: الدرايفر ما فيه أي أمر كتابة', () => {
  const d = driver();
  for (const k of ['setBand', 'lockCell', 'unlockCell', 'setNetworkMode', 'reboot', 'blockDevice', 'restoreAll']) assert.equal(typeof d[k], 'undefined', k);
  assert.ok(!d.afterLoginPages().some((p: string) => /logout|restart|reboot|reset/i.test(p)));
});

test('inseego: طلب واحد بالمرة — القراءات المتوازية ما تتداخل عند الجهاز', async () => {
  const st = router({ stat: true });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'admin123');
  await Promise.all([d.getSignal(), d.getNetworkInfo(), d.getExtras(), d.getCells(), d.isConnected()]);
  assert.equal(st.maxInflight, 1);
});

test('inseego: submitLogin علق مرة ← نعيد برموز جديدة وننجح', async () => {
  const st = router({ dropSubmit: 1 });
  await driver().login('192.168.1.1', 'admin', 'admin123');
  assert.equal(st.logged, true);
  assert.deepEqual(st.posts, ['/submitLogin/', '/submitLogin/']);
});

test('inseego: علق مرتين ← رسالة «ما رد» (مو «كلمة غلط»)', async () => {
  router({ dropSubmit: 2 });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'admin123'), /ما رد على الدخول/);
});

test('inseego: رفض بسبب ثاني (مو كلمة) ← نعرض نص الجهاز', async () => {
  router({ authError: 'Session expired.<br>Please reload the page.' });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'x'), /Session expired\. Please reload/);
});

test('inseego: صفحة الدخول الأصلية (gSecureToken داخل $.ajax والـ input مخفي القيمة) ← ندخل', async () => {
  const st = router({ loginPage: '<script>var secToken = "6e1f0c2a9b7d43e8";\n$.ajax({ url : "/submitLogin/", data : { shaPassword: x, gSecureToken : "efdbef4ddc037c4ae30bca3cd49fec16a5f3a007" } });</script>' });
  await driver().login('192.168.1.1', 'admin', 'admin123');
  assert.equal(st.logged, true);
});

test('inseego: كلمة غلط ← نقول كم محاولة باقية', async () => {
  router({ password: 'right' });
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'wrong'), /باقي 4 محاولات/);
});

test('inseego: /srv/status انقطع مرة (اتصال قديم) ← نعيد ونقرأ', async () => {
  router({ dropStatus: 1 });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'admin123');
  assert.equal((await d.getNetworkInfo()).operator, 'Libyana');
});

test('inseego: رد /srv/status الحقيقي (المدار) ← LTE+ والشركة والبطارية والاستهلاك', () => {
  const { statusFrom, signalFrom, networkFrom, healthFrom, usageFrom } = require('../src/drivers/inseego/parse');
  const st = statusFrom(REAL);
  assert.equal(signalFrom(st, null).network, 'LTE+');
  assert.equal(signalFrom(st, null).rsrp, undefined);
  const n = networkFrom(st, null, 'MiFi 8000');
  assert.equal(n.operator, 'ALMADAR');
  assert.equal(n.connected, true);
  assert.equal(n.supports5g, false);
  assert.deepEqual(healthFrom(st, null), { battery: 96, charging: false });
  assert.deepEqual(usageFrom(st), { downloadBytes: 181331420, uploadBytes: 21910452 });
});
