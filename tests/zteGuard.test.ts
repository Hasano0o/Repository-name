/**
 * درايفر ZTE كامل على راوتر محاكى — نتأكد بالطلبات الفعلية (مو بالكلام):
 *  ١. U30 Pro: ولا أمر تغيير يطلع للراوتر (ترددات، 5G، وضع الشبكة، إعادة التشغيل، الواي فاي)، والخطأ «ما تغيّر شي»
 *  ٢. MU5001 (موديل ثاني): نفس الأمر يوصل للراوتر عادي — يعني القفل ما يمس غير U30 Pro
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// بدائل react-native قبل تحميل الدرايفر
declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  // المكتبات من node_modules المشروع (الاختبارات تنبني في مجلد مؤقت)
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const VERS: Record<string, Record<string, string>> = {
  u30: { wa_inner_version: 'U30Pro_GEN_MEASV1.0.0B07', cr_version: 'MU5358_GEN_MEASV1.0.0B07', web_version: 'U30Pro_GEN_MEASV1.0.0B07' },
  mu5001: { wa_inner_version: 'BD_STCMU5001V1.0.2B04', cr_version: '', web_version: '' },
};

function router(kind: 'u30' | 'mu5001') {
  const posts: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    let body = '{}';
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const id = /goformId=([A-Za-z0-9_]+)/.exec(String(init?.body ?? ''))?.[1] ?? '?';
      posts.push(id);
      body = id === 'LOGIN' ? '{"result":"0"}' : kind === 'u30' ? '{}' : '{"result":"success"}';
    } else {
      const keys = (u.searchParams.get('cmd') ?? '').split(',');
      // نفس شكل رد U30 Pro الحقيقي (٢٥ أكتوبر): شريحة ٢٫٤ مطفية و٥ شغالة
      if (keys[0] === 'queryAccessPointInfo') {
        const ap = (c: string, on: string) => ({ ChipIndex: c, AccessPointIndex: '0', AccessPointSwitchStatus: on, SSID: 'x', QrImageShow: '' });
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ResponseList: [ap('0', '0'), ap('1', '1')] }) } as any;
      }
      const o: Record<string, string> = {};
      for (const k of keys) o[k] = VERS[kind][k] ?? (k === 'RD' ? 'abc123' : k === 'loginfo' ? 'ok' : k === 'LD' ? 'LD1' : k === 'net_select' ? 'Only_LTE' : '');
      body = JSON.stringify(o);
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body } as any;
  };
  return posts;
}

async function driver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.0.1';
  (d as any).password = 'x';
  (d as any).loggedIn = true;
  (d as any).ensure = async () => {};
  return d;
}

const WRITES: [string, (d: any) => Promise<unknown>][] = [
  ['ترددات 4G', d => d.setBand([3])],
  ['ترددات 5G', d => d.setBand('keep', [78])],
  ['وضع الشبكة', d => d.setNetworkMode('WL_AND_5G')],
  ['إعادة التشغيل', d => d.reboot()],
  ['تشغيل الواي فاي', d => d.setBandOn('2.4', true)],
];

for (const [name, fn] of WRITES) {
  test(`U30 Pro: «${name}» ما يرسل أي أمر تغيير، والخطأ noChange`, async () => {
    const posts = router('u30');
    const d = await driver();
    let err: any;
    try { await fn(d); } catch (e) { err = e; }
    assert.ok(err, 'المفروض يوقف');
    assert.equal(err.noChange, true, 'لازم «ما تغيّر شي» عشان ما يصير إرجاع ولا فك');
    const changes = posts.filter(p => !['LOGIN', 'LOGOUT', 'GOFORM_LOGOUT'].includes(p));
    assert.deepEqual(changes, [], `انرسل: ${changes.join(',')}`);
  });
}

test('MU5001: نفس أمر الترددات يوصل للراوتر (القفل ما يمس موديل ثاني)', async () => {
  const posts = router('mu5001');
  const d = await driver();
  try { await d.setBand([3]); } catch {}
  assert.ok(posts.includes('BAND_SELECT'), `ما انرسل BAND_SELECT: ${posts.join(',')}`);
});

test('safeApply: أمر انمنع قبل الإرسال ← ما فيه «رجّع إعدادك» ولا فك تثبيتات', async () => {
  const { runApply } = require('../src/utils/applyGuard');
  const posts = router('u30');
  const d = await driver();
  let wrote = false;
  const out = await runApply({
    session: (fn: (x: any) => Promise<void>) => fn(d),
    apply: (x: any) => x.setBand([3]),
    changed: () => wrote,
    firstMs: 5000, extraMs: 5000,
  });
  assert.equal(out.kind, 'failed');
  assert.equal(out.skipRevert, true, 'لازم يتخطى الإرجاع والفك — ما انرسل شي');
  assert.deepEqual(posts.filter(p => !['LOGIN', 'LOGOUT', 'GOFORM_LOGOUT'].includes(p)), []);
});
