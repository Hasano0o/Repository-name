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
const STATUS = { statusData: {
  statusBarSignalBars: 4, statusBarTechnology: '4G LTE', statusBarTechnologyText: '4G LTE', statusBarNetwork: 'Libyana',
  statusBarConnectionState: 'Connected', statusBarBatteryPercent: 76, statusBarBatteryChargingState: 'Charging', statusBarWiFiClientListSize: 2,
} };

function router(o: { password?: string; stat?: boolean; title?: string; loginPage?: string; lock?: boolean } = {}) {
  const st = { sec: '6e1f0c2a9b7d43e8', g: 'efdbef4ddc037c4ae30bca3cd49fec16a5f3a007', logged: false, posts: [] as string[], fails: 0 };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    if (m === 'POST') st.posts.push(u.pathname);
    switch (u.pathname) {
      case '/': return res(200, `<!DOCTYPE HTML><html><head><title>${o.title ?? 'MiFi 8000'}</title></head><body><script src="/06240220/script/notifications.js"></script></body></html>`);
      case '/srv/status': return res(200, JSON.stringify(STATUS));
      case '/login/': return res(200, o.loginPage ?? `<html><script>var secToken = "${st.sec}";</script><form><input type="hidden" name="gSecureToken" value="${st.g}" /></form></html>`);
      case '/submitLogin/': {
        if (o.lock) return res(429, '');
        const p = new URLSearchParams(init.body);
        if (p.get('gSecureToken') !== st.g || p.get('shaPassword') !== sha1((o.password ?? 'admin123') + st.sec)) {
          st.fails++;
          return res(500, JSON.stringify({ authError: 'Incorrect password.<br>Try again.' }));
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
