/**
 * اختبارات لقطة الإعدادات والإرجاع المتحقق منه — بدون راوتر حقيقي (بيانات محاكاة فقط).
 * التشغيل: node tests/run.cjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNetModeFields, netModeBody, netModeDiff, normSection, lockDiff, lockDiffForMode, lockRestoreBody, huaweiSummary,
} from '../src/drivers/huawei/lockState';
import { parseLockRaw, sectionXml, bandLockSection } from '../src/drivers/huawei/cellLock';
import { zteDiff, checkComplete, lteCell, nrCell, nrBands, lteBands, zteSummary } from '../src/drivers/zte/lockState';
import { restoreMismatch, mismatchOf, settleMsFor } from '../src/drivers/lockSnapshot';
import { runApply } from '../src/utils/applyGuard';

const resp = (inner: string) => `<?xml version="1.0"?><response>${inner}</response>`;
const lockResp = (lte: string, nr: string) => resp(`<lte_info>${lte}</lte_info><nr_info>${nr}</nr_info>`);
const inner = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*)</${name}>`))![1];

// أقسام محاكاة
const lteBandsSec = inner(bandLockSection('lte_info', [1, 3, 28], [28]), 'lte_info'); // B28 «ثانوي بس»
const nrCellSec = '<lock_mode>2</lock_mode><freq_infos><freq_info><band>78</band><freq>636666</freq><pci>301</pci></freq_info></freq_infos><all_bands>78</all_bands>';
const lteChanSec = '<lock_mode>1</lock_mode><freq_infos><freq_info><band>3</band><freq>1650</freq><pci></pci></freq_info></freq_infos><all_bands>3</all_bands>';
const off = '<lock_mode>0</lock_mode><freq_infos></freq_infos><all_bands></all_bands>';

// ─── هواوي: المقارنة ───

test('هواوي: القفل الملغي = off مهما كان الباقي، والقسم الفاضي = off', () => {
  assert.equal(normSection(off), 'off');
  assert.equal(normSection(''), 'off');
  assert.equal(normSection('<lock_mode>0</lock_mode><all_bands>1,3</all_bands>'), 'off');
  assert.ok(normSection(lteBandsSec) !== 'off');
});

test('هواوي: الترتيب والمسافات ما تفرق — المحتوى يفرق', () => {
  const a = '<lock_mode>3</lock_mode><freq_infos><freq_info><band>3</band></freq_info><freq_info><band>1</band></freq_info></freq_infos><all_bands>3, 1</all_bands>';
  const b = '<lock_mode>3</lock_mode><freq_infos><freq_info><band>1</band></freq_info><freq_info><band>3</band></freq_info></freq_infos><all_bands>1,3</all_bands>';
  assert.equal(normSection(a), normSection(b));
  // «ثانوي بس» (all_bands أكثر من freq_infos) يفرق عن «أساسي + ثانوي» لكل الترددات
  assert.ok(normSection(lteBandsSec) !== normSection(inner(bandLockSection('lte_info', [1, 3, 28]), 'lte_info')));
  // قفل قناة ≠ قفل خلية على نفس القناة
  const cell = lteChanSec.replace('<lock_mode>1</lock_mode>', '<lock_mode>2</lock_mode>').replace('<pci></pci>', '<pci>12</pci>');
  assert.ok(normSection(lteChanSec) !== normSection(cell));
});

test('هواوي: تعديل 4G بس → الفرق في 4G بس، وقفل برج 5G باقي', () => {
  const snap = parseLockRaw(lockResp(lteBandsSec, nrCellSec));
  const cur = parseLockRaw(lockResp(inner(bandLockSection('lte_info', [7]), 'lte_info'), nrCellSec));
  assert.deepEqual(lockDiff(snap, cur), ['قفل 4G (ترددات/قناة/برج)']);
});

test('هواوي: جسم الإرجاع يرجّع الأقسام حرفياً (برج 5G + «ثانوي بس» + قناة)', () => {
  const snap = parseLockRaw(lockResp(lteBandsSec, nrCellSec));
  const body = lockRestoreBody(snap, '00');
  assert.ok(body.includes(`<lte_info>${lteBandsSec}</lte_info>`));
  assert.ok(body.includes(`<nr_info>${nrCellSec}</nr_info>`));
  // الراوتر يرجّع اللي انكتب ← القراءة تطابق اللقطة
  const back = parseLockRaw(resp(body));
  assert.deepEqual(lockDiff(snap, back), []);
  const chan = parseLockRaw(lockResp(lteChanSec, off));
  assert.deepEqual(lockDiff(chan, parseLockRaw(resp(lockRestoreBody(chan, '00')))), []);
});

test('هواوي: القسم الملغي ينرسل lock_mode 0 (فك صريح، مو قسم فاضي)', () => {
  const snap = parseLockRaw(lockResp(off, nrCellSec));
  const body = lockRestoreBody(snap, '00');
  assert.ok(body.startsWith(sectionXml('lte_info', '0', [], '')));
});

test('هواوي: وضع 4G فقط يرسل قسم 4G بس، ونحاسب عليه بس', () => {
  const snap = parseLockRaw(lockResp(lteBandsSec, nrCellSec));
  assert.ok(!lockRestoreBody(snap, '03').includes('nr_info'));
  assert.ok(!lockRestoreBody(snap, '08').includes('lte_info'));
  const cur = parseLockRaw(lockResp(lteBandsSec, off));
  assert.deepEqual(lockDiffForMode(snap, cur, '03'), []);
  assert.deepEqual(lockDiffForMode(snap, cur, '00'), ['قفل 5G (ترددات/قناة/برج)']);
});

test('هواوي: وضع الشبكة — الأقنعة بأصفار زايدة متطابقة، وتغيير الوضع ينكشف', () => {
  const snap = parseNetModeFields(resp('<NetworkMode>00</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7FFFFFFFFFFFFFFF</LTEBand><networkOption>0</networkOption>'));
  const same = parseNetModeFields(resp('<NetworkMode>00</NetworkMode><NetworkBand>3fffffff</NetworkBand><LTEBand>007FFFFFFFFFFFFFFF</LTEBand><networkOption>0</networkOption>'));
  assert.deepEqual(netModeDiff(snap, same), []);
  // التجربة حوّلته «4G فقط» وقفلت ترددات (المشكلة القديمة: الإرجاع ما كان يرجّع الوضع)
  const trial = parseNetModeFields(resp('<NetworkMode>03</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>4</LTEBand><networkOption>0</networkOption>'));
  assert.deepEqual(netModeDiff(snap, trial), ['وضع الشبكة', 'ترددات 4G (وضع الشبكة)']);
  // جسم الإرجاع = نفس الحقول ← القراءة بعده تطابق
  assert.deepEqual(netModeDiff(snap, parseNetModeFields(resp(netModeBody(snap)))), []);
  // lock-freq موجود: الراوتر يعيد كتابة LTEBand بعد إرجاع القفل — نتجاهله لو طلبنا
  const rewritten = parseNetModeFields(resp(netModeBody(snap).replace(/<LTEBand>[^<]*<\/LTEBand>/, '<LTEBand>80000C5</LTEBand>')));
  assert.deepEqual(netModeDiff(snap, rewritten), ['ترددات 4G (وضع الشبكة)']);
  assert.deepEqual(netModeDiff(snap, rewritten, ['LTEBand']), []);
});

test('هواوي: وصف اللقطة', () => {
  const t = huaweiSummary({
    netMode: [['NetworkMode', '00']],
    lockFreq: parseLockRaw(lockResp(lteBandsSec, nrCellSec)),
  });
  assert.ok(t.includes('B1+B3+B28'));
  assert.ok(t.includes('برج 301'));
  assert.ok(t.includes('تلقائي'));
});

// ─── ZTE ───

const zteBase = {
  lte_band_lock: '0x80800C5', nr5g_nsa_band_lock: '1,3,28,41,78', nr5g_sa_band_lock: '', nr5g_band_lock: '',
  net_select: 'LTE_AND_5G', lte_pci_lock: '', lte_earfcn_lock: '', nr5g_cell_lock: '',
};

test('ZTE: الفاضي والصفر = بدون قفل برج', () => {
  assert.equal(lteCell(zteBase), 'off');
  assert.equal(lteCell({ ...zteBase, lte_pci_lock: '0', lte_earfcn_lock: '0' }), 'off');
  assert.equal(nrCell({ ...zteBase, nr5g_cell_lock: '0,0,0,0' }), 'off');
  assert.equal(lteCell({ ...zteBase, lte_pci_lock: '12', lte_earfcn_lock: '1650' }), '12/1650');
  assert.equal(nrCell({ ...zteBase, nr5g_cell_lock: '301,636666,78,30' }), '301/636666/78');
});

test('ZTE: الفرق يحدد الأجزاء اللي تغيّرت بالضبط', () => {
  assert.deepEqual(zteDiff(zteBase, { ...zteBase }), []);
  assert.deepEqual(zteDiff(zteBase, { ...zteBase, lte_band_lock: '0x4' }), ['lte']);
  assert.deepEqual(zteDiff(zteBase, { ...zteBase, net_select: 'Only_LTE' }), ['mode']);
  assert.deepEqual(zteDiff(zteBase, { ...zteBase, nr5g_nsa_band_lock: '78' }), ['nr']);
  assert.deepEqual(zteDiff(zteBase, { ...zteBase, nr5g_cell_lock: '301,636666,78,30' }), ['nrCell']);
  assert.deepEqual(zteDiff(zteBase, { ...zteBase, lte_pci_lock: '12', lte_earfcn_lock: '1650' }), ['lteCell']);
  // نفس الترددات بصيغة قناع مختلفة = مطابق
  assert.deepEqual(lteBands({ lte_band_lock: '0x0080800C5' }), lteBands(zteBase));
  assert.deepEqual(nrBands({ nr5g_band_lock: '78,1,3,41,28' }), nrBands(zteBase));
});

test('ZTE: فيرموير ما يعطي قائمة 5G → ما نحاسب عليها', () => {
  const snap = { ...zteBase, nr5g_nsa_band_lock: '' };
  assert.deepEqual(zteDiff(snap, { ...zteBase }), []);
});

test('ZTE: القراءة الناقصة توقف التجربة', () => {
  const throws = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
  assert.ok(throws(() => checkComplete({ ...zteBase, lte_band_lock: '' })));
  assert.ok(throws(() => checkComplete({ ...zteBase, net_select: '' })));
  assert.ok(!throws(() => checkComplete(zteBase)));
  assert.ok(zteSummary(zteBase).includes('4G + 5G'));
});

// ─── خطأ «ما تطابق» والمهلات ───

test('خطأ الإرجاع الناقص يحمل قائمة اللي ما رجع', () => {
  const e = restoreMismatch(['وضع الشبكة', 'قفل 5G']);
  assert.deepEqual(mismatchOf(e), ['وضع الشبكة', 'قفل 5G']);
  assert.equal(mismatchOf(new Error('عادي')), null);
  assert.equal(mismatchOf(null), null);
});

// ZTE نزلت من ٤ دقائق لدقيقتين عمداً يوم ١٨ أكتوبر (dd9976b): MU5001 يعلق بدون خدمة، والانتظار الطويل كان يأخّر الإنقاذ
test('مهلة الخدمة بعد الإرجاع: هواوي دقيقتين، ZTE دقيقتين', () => {
  assert.equal(settleMsFor('huawei-lte'), 120_000);
  assert.equal(settleMsFor('zte'), 120_000);
});

test('انتهاء المهلة ≠ انتهاء الأمر: pending يخلص بس لما الأمر نفسه يخلص', async () => {
  let finish!: () => void;
  const apply = new Promise<void>(res => { finish = res; });
  const out = await runApply<object>({
    session: fn => fn({}),
    apply: () => apply,
    firstMs: 5,
    extraMs: 5,
  });
  assert.equal(out.kind, 'stillRunning');
  let done = false;
  if (out.kind === 'stillRunning') out.pending.then(() => { done = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(done, false);
  finish();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(done, true);
});
