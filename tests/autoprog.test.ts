import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fpPayload, parseVerdict, runTrial, signalFields } from '../src/utils/autoprogCore';
import { isReadMethod, isReadOnlyDriver, readOnlyDriver, READ_ONLY_MSG } from '../src/drivers/readOnly';
import { isNoChange } from '../src/drivers/noChange';
import type { RouterDriver, Signal } from '../src/drivers/types';

/** راوتر وهمي يسجّل كل دالة انّادت — عشان نتأكد إن ولا أمر كتابة وصله */
function fake(over: Partial<RouterDriver> & { sig?: Signal | (() => Signal); loginErr?: string } = {}) {
  const calls: string[] = [];
  const d: any = {
    id: 'zte', name: 'ZTE', capabilities: ['signal', 'bandLock', 'reboot', 'devices', 'sms', 'cells'],
    host: '',
    async detect() { calls.push('detect'); return true; },
    async login(h: string) { calls.push('login'); this.host = h; if (over.loginErr) throw new Error(over.loginErr); },
    async logout() { calls.push('logout'); },
    async getSignal() { calls.push('getSignal'); return typeof over.sig === 'function' ? over.sig() : (over.sig ?? { rsrp: -95, sinr: 12, band: '3', pci: '101' }); },
    async getDevices() { calls.push('getDevices'); return [{ mac: 'aa' }]; },
    async readLockState() { calls.push('readLockState'); return {}; },
    async setBand() { calls.push('setBand'); },
    async lockCell() { calls.push('lockCell'); },
    async reboot() { calls.push('reboot'); },
    async setNetworkMode() { calls.push('setNetworkMode'); },
    async restoreAll() { calls.push('restoreAll'); },
    async restoreLockState() { calls.push('restoreLockState'); },
    async sendSms() { calls.push('sendSms'); },
    async blockDevice() { calls.push('blockDevice'); },
    async reconnectData() { calls.push('reconnectData'); },
    async enableDeviceUsage() { calls.push('enableDeviceUsage'); },
    async setWifiChannel() { calls.push('setWifiChannel'); },
    // دالة داخلية (طلب للراوتر) — تنادى من جوا الدرايفر بس
    async post() { calls.push('post'); },
    async getTraffic() { await this.post(); calls.push('getTraffic'); return { downBytesPerSec: 1, upBytesPerSec: 1, connectedSecs: 1 }; },
    ...over,
  };
  return { d: d as RouterDriver, calls };
}

// ═══ الحكم على القراءة ═══

test('قراءة إشارة حقيقية ← نعرف وش انقرأ', () => {
  assert.deepEqual(signalFields({ rsrp: -95, sinr: 12, rsrq: -10, band: '3', pci: '101' }), ['rsrp', 'sinr', 'rsrq', 'band', 'pci']);
  assert.deepEqual(signalFields({ nrRsrp: -88, nrSinr: 20, nrBand: '78' }), ['nrRsrp', 'nrSinr', 'nrBand']);
  assert.deepEqual(signalFields({ rssi: -70 }), ['rssi']);
});

test('رد مو مفهوم (صفر، -1، NaN، نص بس) مو إشارة — الدرايفر الغلط ما ينحسب نجاح', () => {
  assert.deepEqual(signalFields({ rsrp: 0, sinr: 0 }), []);
  assert.deepEqual(signalFields({ rsrp: -1 }), []);
  assert.deepEqual(signalFields({ rsrp: NaN, nrRsrp: undefined }), []);
  assert.deepEqual(signalFields({ band: '3', pci: '5', sinr: 10 }), []);
  assert.deepEqual(signalFields({ rsrp: -999 }), []);
  assert.deepEqual(signalFields(null), []);
});

// ═══ التجربة على الراوتر ═══

test('التجربة: دخول ← إشارة ← خروج، وولا دالة ثانية', async () => {
  const { d, calls } = fake();
  const r = await runTrial(d, '192.168.0.1', 'admin', 'pw', 0);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'signal');
  assert.ok(r.got.includes('rsrp'));
  assert.deepEqual(calls, ['login', 'getSignal', 'logout']);
});

test('كلمة المرور غلط ← password (مو عيب البرمجة) وما نقرأ ولا نكتب', async () => {
  const { d, calls } = fake({ loginErr: 'كلمة المرور غلط — باقي 4 محاولات' });
  const r = await runTrial(d, '192.168.0.1', 'admin', 'x', 0);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'password');
  assert.deepEqual(calls, ['login']);
});

test('الدخول فشل بسبب ثاني (الدرايفر مو لهالراوتر) ← login', async () => {
  const { d } = fake({ loginErr: 'الراوتر رد 404 على /goform/goform_set_cmd_process' });
  const r = await runTrial(d, '192.168.0.1', 'admin', 'x', 0);
  assert.equal(r.stage, 'login');
  assert.match(r.err, /404/);
});

test('دخل بس القراءة فاضية ← signal، ونخرج', async () => {
  const { d, calls } = fake({ sig: { rsrp: 0 } });
  const r = await runTrial(d, '192.168.0.1', 'admin', 'pw', 0);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'signal');
  assert.deepEqual(calls, ['login', 'getSignal', 'getSignal', 'logout']);
});

test('أول قراءة فاضية والثانية تمام ← نجاح', async () => {
  let n = 0;
  const { d } = fake({ sig: () => (n++ ? { rsrp: -101 } : {}) });
  assert.equal((await runTrial(d, '192.168.0.1', 'admin', 'pw', 0)).ok, true);
});

test('القراءة ترمي خطأ ← signal مع نص الخطأ (بدون ما يطيح)', async () => {
  const { d, calls } = fake({ sig: () => { throw new Error('رد مو JSON'); } });
  const r = await runTrial(d, '192.168.0.1', 'admin', 'pw', 0);
  assert.equal(r.stage, 'signal');
  assert.match(r.err, /JSON/);
  assert.equal(calls[calls.length - 1], 'logout');
});

test('درايفر بدون getSignal ← ناخذ من getSnapshot', async () => {
  const { d } = fake();
  (d as any).getSignal = undefined;
  (d as any).getSnapshot = async () => ({ lte: { rsrp: -90, band: 3 }, source: { driverId: 'x', driverName: 'x', at: 0 } });
  const r = await runTrial(d, '192.168.0.1', 'admin', 'pw', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.got, ['rsrp', 'band']);
});

// ═══ رد الرسيفر ═══

test('حكم الرسيفر: لازم رقم حالة ودرايفر موجود في هالنسخة', () => {
  const have = ['zte', 'huawei-lte'];
  assert.deepEqual(parseVerdict({ status: 'match', id: 'a1b2c3d4e5f6a7b8', driver: 'zte', label: 'ZTE' }, have),
    { status: 'match', id: 'a1b2c3d4e5f6a7b8', driver: 'zte', label: 'ZTE' });
  assert.equal(parseVerdict({ status: 'known', id: 'a1b2c3d4e5f6a7b8', driver: 'huawei-lte' }, have).status, 'known');
  // درايفر مو عندنا (نسخة قديمة) / درايفر الاحتياطي / رد ناقص / سيرفر قديم ← none
  assert.equal(parseVerdict({ status: 'match', id: 'a1b2c3d4e5f6a7b8', driver: 'tplink' }, have).status, 'none');
  assert.equal(parseVerdict({ status: 'match', id: 'a1b2c3d4e5f6a7b8', driver: 'unknown' }, have).status, 'none');
  assert.equal(parseVerdict({ status: 'match', driver: 'zte' }, have).status, 'none');
  assert.equal(parseVerdict({ status: 'match', id: '../x', driver: 'zte' }, have).status, 'none');
  assert.equal(parseVerdict({ status: 'none' }, have).status, 'none');
  assert.equal(parseVerdict(null, have).status, 'none');
  assert.equal(parseVerdict('<html>404</html>', have).status, 'none');
});

test('البصمة المرسلة: أسماء بس', () => {
  assert.equal(fpPayload(null), null);
  const p = fpPayload({ server: 'GoAhead', scripts: ['js/a.js'], loginFields: ['pw(password)'], loginCode: ['secret code'], apis: ['/x'] } as any);
  assert.deepEqual(p, { server: 'GoAhead', scripts: ['js/a.js'], loginFields: ['pw(password)'] });
});

// ═══ غلاف «قراءة بس» ═══

test('القائمة البيضاء: القراءة والدخول بس', () => {
  for (const m of ['login', 'logout', 'detect', 'getSignal', 'getSnapshot', 'getDevices', 'getBandConfig', 'isConnected', 'listSms', 'readLockState', 'readBaseline'])
    assert.ok(isReadMethod(m), m);
  for (const m of ['setBand', 'lockCell', 'lockChannel', 'unlockCell', 'reboot', 'setNetworkMode', 'setNetStandard', 'restoreAll', 'restoreLockState',
    'sendSms', 'deleteSms', 'markSmsRead', 'blockDevice', 'reconnectData', 'reattach', 'wakeRadio', 'setApn', 'selectApn', 'setDns', 'setWifiChannel',
    'setNat', 'setDataPlan', 'setModemPower', 'enableDeviceUsage', 'placeCheckStart', 'placeCheckCancel', 'get', 'post', 'call', 'getter'])
    assert.ok(!isReadMethod(m), m);
});

test('قراءة بس: كل أمر تغيير يوقف قبل ما يوصل الدرايفر، بعلامة noChange', async () => {
  const { d, calls } = fake();
  const ro = readOnlyDriver(d);
  for (const m of ['setBand', 'lockCell', 'reboot', 'setNetworkMode', 'restoreAll', 'restoreLockState', 'sendSms', 'blockDevice',
    'reconnectData', 'enableDeviceUsage', 'setWifiChannel', 'post']) {
    let err: unknown;
    try { await (ro as any)[m]([3], [78]); } catch (e) { err = e; }
    assert.ok(err, `${m} لازم يوقف`);
    assert.ok(isNoChange(err), `${m} noChange`);
    assert.equal((err as Error).message, READ_ONLY_MSG);
  }
  assert.deepEqual(calls, [], 'ولا أمر وصل الدرايفر');
});

test('قراءة بس: الدخول والقراءات تشتغل عادي — والدوال الداخلية للدرايفر ما تنحجب', async () => {
  const { d, calls } = fake();
  const ro = readOnlyDriver(d);
  await ro.login('192.168.0.1', 'admin', 'pw');
  assert.equal((d as any).host, '192.168.0.1', 'this = الدرايفر الأصلي');
  assert.equal((await ro.getSignal!()).rsrp, -95);
  assert.equal((await ro.getDevices!()).length, 1);
  await ro.getTraffic!(); // تنادي this.post من جوا
  await ro.readLockState!();
  await ro.logout();
  assert.deepEqual(calls, ['login', 'getSignal', 'getDevices', 'post', 'getTraffic', 'readLockState', 'logout']);
});

test('قراءة بس: القدرات الظاهرة قراءة، والعلامة موجودة، والتغليف مرتين ما يضر', () => {
  const { d } = fake();
  const ro = readOnlyDriver(d);
  assert.deepEqual(ro.capabilities, ['signal', 'devices', 'cells']);
  assert.equal(ro.id, 'zte');
  assert.ok(isReadOnlyDriver(ro));
  assert.ok(!isReadOnlyDriver(d));
  assert.equal(readOnlyDriver(ro), ro);
  // التعيين يوصل الأصل (الشاشات تحط host قبل identify)
  (ro as any).host = '10.0.0.1';
  assert.equal((d as any).host, '10.0.0.1');
});

test('التجربة على درايفر مغلّف «قراءة بس» تشتغل (نفس اللي يصير بعد الحفظ)', async () => {
  const { d, calls } = fake();
  const r = await runTrial(readOnlyDriver(d), '192.168.0.1', 'admin', 'pw', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['login', 'getSignal', 'logout']);
});
