/**
 * درايفر FiberHome كامل على راوتر محاكى يرد بنفس بروتوكول صفحة الراوتر الحقيقية
 * (AES-128-CBC بمفتاح من sessionid، /api/tmp/FHAPIS، /api/sign/DO_WEB_LOGIN، get_xmlnode_js_file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';
import { FH_IV } from '../src/drivers/fiberhome/crypto';

declare const require: any;
declare const Buffer: any;
(globalThis as any).__DEV__ = false;

const NODES = `var x_NetworkSettings_obj="IGD.X_FH_MobileNetwork.NetworkSettings.";
var x_NetworkSet_LTELockBAND="LTELockBAND",x_NetworkSet_NRLockBAND="NRLockBAND",x_NetworkSet_LockBandEnable="LockBandEnable";
var x_NetworkSet_NetworkMode="NetworkMode";var x_NetworkSet_ENDC="ENDC";
var x_RadioSignalParameter_obj="IGD.X_FH_MobileNetwork.RadioSignalParameter.";
var x_RadioSignal_WorkMode="WorkMode",x_RadioSignal_RSRP="RSRP",x_RadioSignal_SINR="SINR",x_RadioSignal_BAND="BAND",x_RadioSignal_PCI="PCI";
var x_RadioSignal_SSB_RSRP="SSB_RSRP",x_RadioSignal_NR_Band="NR_Band",x_RadioSignal_NR_PCI="NR_PCI";
var x_LockCellList_obj="IGD.X_FH_MobileNetwork.LockCellList.";var x_LockCellList_LockCell="LockCell.";var x_LockCellList_LockEnable="Enable";
var x_LockCellList_act="act",x_LockCellList_arfcn="arfcn",x_LockCellList_pci="pci";`;

function router(opts: { password?: string; ignoreWrites?: boolean } = {}) {
  const db: Record<string, string> = {
    'IGD.X_FH_MobileNetwork.NetworkSettings.LTELockBAND': '', 'IGD.X_FH_MobileNetwork.NetworkSettings.NRLockBAND': '',
    'IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable': '0', 'IGD.X_FH_MobileNetwork.NetworkSettings.NetworkMode': '3',
    'IGD.X_FH_MobileNetwork.NetworkSettings.ENDC': '2', 'IGD.X_FH_MobileNetwork.LockCellList.Enable': '0',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.WorkMode': 'NSA', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.RSRP': '-97',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.SINR': '11', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.BAND': '3',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.PCI': '214', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.SSB_RSRP': '-85',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_Band': '78', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_PCI': '41',
  };
  const cells: { act: string; arfcn: string; pci: string }[] = [];
  let sid = '';
  let logged = false;
  const writes: string[] = [];
  const aes = (mode: 'enc' | 'dec', key: string, data: string) => {
    const c = mode === 'enc' ? (ncrypto as any).createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(FH_IV)) : (ncrypto as any).createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(FH_IV));
    return Buffer.concat([c.update(Buffer.from(data, mode === 'enc' ? 'utf8' : 'hex')), c.final()]).toString(mode === 'enc' ? 'hex' : 'utf8');
  };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.8.1/', headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (init?.method !== 'POST') {
      const m = u.searchParams.get('ajaxmethod');
      if (m === 'is_encrypt') return res(200, '{"enable":1}');
      if (m === 'get_refresh_sessionid') { sid = Math.random().toString(36).slice(2).padEnd(20, 'x'); return res(200, JSON.stringify({ sessionid: sid })); }
      if (m === 'set_developer_mode') return res(200, '{}');
      return res(404, '');
    }
    const key = sid.slice(0, 16);
    const body = JSON.parse(aes('dec', key, init.body));
    assert.equal(body.sessionid, sid, 'كل طلب لازم يحمل sessionid الجديد');
    if (u.pathname === '/api/sign/DO_WEB_LOGIN') {
      const ok = body.dataObj.password === (opts.password ?? 'pw') && body.dataObj.username === 'admin';
      logged = ok;
      return res(200, ok ? '0|' : '4|');
    }
    const api = u.pathname.split('/').pop();
    if (api === 'FHAPIS' && !logged) return res(418, '');
    const m = body.ajaxmethod, d = body.dataObj;
    let out: any = {};
    if (m === 'get_device_info') out = { model_name: 'LG6121F', operator_name: 'SA_STC' };
    else if (m === 'get_xmlnode_js_file') out = { xml: NODES };
    else if (m === 'get_value_by_xmlnode') for (const [k, p] of Object.entries(d)) out[k] = db[p as string] ?? '';
    else if (m === 'set_value_by_xmlnode') { writes.push(JSON.stringify(d.value)); if (!opts.ignoreWrites) for (const k of Object.keys(d.url)) db[d.url[k]] = String(d.value[k]); out = { success: 'true' }; }
    else if (m === 'get_xml_childnode_value') out = { data: cells.map((c, i) => ({ ...c, child_node_idx: String(i + 1) })) };
    else if (m === 'add_set_xmlnode') { writes.push('add'); cells.push({ act: String(d.setNode.value.act), arfcn: String(d.setNode.value.arfcn), pci: String(d.setNode.value.pci) }); }
    else if (m === 'del_xmlnode') { writes.push('del'); cells.splice(Number(d.index) - 1, 1); }
    return res(200, aes('enc', key, JSON.stringify(out)));
  };
  return { db, cells, writes };
}

async function driver() {
  const { FiberhomeDriver } = require('../src/drivers/fiberhome/index');
  return new FiberhomeDriver();
}
// الدرايفر ينتظر ٣ ث بعد كل تغيير (مثل الصفحة) — نسرّعها في الاختبار
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

test('FiberHome: يتعرف عليه، ويدخل، ويقرأ الإشارة (4G + 5G NSA)', async () => {
  router();
  const d = await driver();
  assert.equal(await d.detect('192.168.8.1'), true);
  const m = await d.identify();
  assert.equal(m.label, 'FiberHome LG6121F');
  await d.login('192.168.8.1', '', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3'); assert.equal(s.rsrp, -97); assert.equal(s.pci, '214');
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrRsrp, -85);
});

test('FiberHome: كلمة مرور غلط ← رسالة واضحة فيها «كلمة المرور»', async () => {
  router({ password: 'right' });
  const d = await driver();
  await assert.rejects(d.login('192.168.8.1', 'admin', 'wrong'), /كلمة المرور/);
});

test('FiberHome: تثبيت الترددات + التحقق، وفك التثبيت', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setBand([3, 1], [78]);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LTELockBAND'], '1,3');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.NRLockBAND'], '78');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '1');
  const c = await d.getBandConfig();
  assert.deepEqual(c.locked, [1, 3]); assert.deepEqual(c.nrLocked, [78]);
  await d.setBand([], []);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '0');
});

test('FiberHome: الراوتر يقول نجح وما تغيّر ← نقول الحقيقة', async () => {
  router({ ignoreWrites: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.setBand([3]), /القراءة بعده مختلفة/);
});

test('FiberHome: B32 لحاله ما ينرسل (noChange)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.setBand([32]), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, 0);
});

test('FiberHome: وضع الشبكة 4G فقط ← 0 مع إبقاء ENDC', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setNetworkMode('03');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.NetworkMode'], '0');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.ENDC'], '2');
  assert.equal((await d.getBandConfig()).mode, '03');
});

test('FiberHome: لقطة ← تثبيت برج وترددات ← إرجاع بالضبط (والبرج المضاف ينشال)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const snap = await d.readLockState();
  await d.setBand([3]);
  await d.lockCell({ tech: 'LTE', pci: '214', arfcn: '1300' });
  assert.equal(r.cells.length, 1);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '1');
  await d.restoreLockState(snap);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '0');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '0');
  assert.equal(r.cells.length, 0);
});

test('FiberHome: تثبيت برج بدون رقم قناة ← يوقف قبل أي أمر', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '214' }), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, 0);
});
