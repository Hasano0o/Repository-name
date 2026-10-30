/**
 * اختبارات أمان تثبيت الأبراج — بدون راوتر حقيقي (بيانات محاكاة فقط).
 * التشغيل: node tests/run.cjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noChange, markNoChange, isNoChange, safeToSkipRevert } from '../src/drivers/noChange';
import { runApply, trackWrites } from '../src/utils/applyGuard';
import {
  buildCellLockBody, buildUnlockBody, parseCellLocks, parseLockRaw, lockMatches, isSectionLocked, bandLockSection, buildChannelLockBody, channelMatches, lockKindOf,
} from '../src/drivers/huawei/cellLock';

// ─── علامة noChange ───

test('noChange: العلامة تنحفظ والرسالة ما تتغير', () => {
  const e = noChange('رسالة');
  assert.equal(e.message, 'رسالة');
  assert.ok(isNoChange(e));
  assert.ok(!isNoChange(new Error('عادي')));
  assert.ok(isNoChange(markNoChange(new Error('دخول فشل'))));
  assert.ok(!isNoChange(null));
});

test('تخطي الإرجاع: بس قبل أي استدعاء، أو استدعاء واحد معلّم', () => {
  assert.equal(safeToSkipRevert(new Error('دخول فشل'), 0), true);
  assert.equal(safeToSkipRevert(noChange('فحص'), 1), true);
  assert.equal(safeToSkipRevert(new Error('رفض'), 1), false);
  // طبقة الجلسات أعادت الأمر بعد طرد: الأولى ممكن أرسلت شي
  assert.equal(safeToSkipRevert(noChange('فحص'), 2), false);
});

// ─── خطوة التطبيق (safeApply) ───

/** محاكي طبقة الجلسات: يستدعي الدالة مرة، ولو طلب «طرد» يعيدها مرة ثانية مثل withSession */
const fakeSession = (kickFirst = false) => async (fn: (d: string) => Promise<void>) => {
  if (kickFirst) {
    try { await fn('d'); } catch { /* طرد — نعيد */ }
  }
  await fn('d');
};
const failingConnect = async () => { throw new Error('الراوتر ما رد — تأكد إنك متصل بشبكته'); };

test('١) فشل قراءة وضع الشبكة قبل أي أمر: ما نرجّع ولا نفك', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 1000, extraMs: 1000,
    apply: async () => { throw noChange('تعذر قراءة وضع الشبكة. لم ننفذ قفل البرج'); },
  });
  assert.equal(out.kind, 'failed');
  assert.equal(out.kind === 'failed' && out.skipRevert, true);
});

test('٢) قفل 5G والراوتر على 4G فقط: رفض مسبق بدون إرجاع', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 1000, extraMs: 1000,
    apply: async () => { throw noChange('تعذر تثبيت برج 5G لأن الراوتر مضبوط على 4G فقط'); },
  });
  assert.ok(out.kind === 'failed' && out.skipRevert);
});

test('الاتصال فشل قبل ما ندخل دالة التطبيق: ما تغيّر شي', async () => {
  const out = await runApply({ session: failingConnect, firstMs: 1000, extraMs: 1000, apply: async () => {} });
  assert.ok(out.kind === 'failed' && out.skipRevert);
});

test('٣) الراوتر رفض أمر القفل (بعد الإرسال): لازم نرجّع', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 1000, extraMs: 1000,
    apply: async () => { throw new Error('خطأ من الراوتر (112003)'); },
  });
  assert.ok(out.kind === 'failed' && !out.skipRevert);
});

test('٤) فشل القراءة بعد الإرسال: ما نفترض إن الراوتر ما تغيّر', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 1000, extraMs: 1000,
    apply: async () => { throw new Error('الراوتر قبل أمر التثبيت لكن ما قدرنا نتأكد من النتيجة'); },
  });
  assert.ok(out.kind === 'failed' && !out.skipRevert);
});

test('أُعيد الأمر بعد طرد ثم فشل الفحص: ما نثق بالعلامة ونرجّع', async () => {
  let n = 0;
  const out = await runApply({
    session: fakeSession(true), firstMs: 1000, extraMs: 1000,
    apply: async () => { n++; throw n === 1 ? new Error('انتهت الجلسة') : noChange('فحص'); },
  });
  assert.ok(out.kind === 'failed' && !out.skipRevert);
});

test('أمر طويل (ZTE يعيد التشغيل): ننتظره يخلص بدل ما نتدخّل في النص', async () => {
  let long = false;
  const out = await runApply({
    session: fakeSession(), firstMs: 30, extraMs: 300, onLong: () => { long = true; },
    apply: () => new Promise(r => setTimeout(r, 100)),
  });
  assert.equal(long, true);
  assert.equal(out.kind, 'done');
});

test('أمر علق حتى بعد الانتظار الإضافي: حالته غير معروفة (مو نجاح)', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 20, extraMs: 20,
    apply: () => new Promise(r => setTimeout(r, 200)),
  });
  assert.equal(out.kind, 'stillRunning');
});

test('أمر طويل فشل بعد المهلة الأولى: يرجع فشل عادي (نرجّع)', async () => {
  const out = await runApply({
    session: fakeSession(), firstMs: 20, extraMs: 300,
    apply: () => new Promise((_, j) => setTimeout(() => j(new Error('رفض')), 60)),
  });
  assert.ok(out.kind === 'failed' && !out.skipRevert);
});

// ─── هواوي: صيغة الطلب وقراءة القفل ───

const lteLocked = '<lock_mode>2</lock_mode><freq_infos><freq_info><band>3</band><freq>1300</freq><pci>101</pci></freq_info></freq_infos><all_bands>3</all_bands>';
const nrLocked = '<lock_mode>2</lock_mode><freq_infos><freq_info><band>78</band><freq>636666</freq><pci>55</pci></freq_info></freq_infos><all_bands>78</all_bands>';
const free = '<lock_mode>0</lock_mode><freq_infos></freq_infos><all_bands></all_bands>';

test('٥) تثبيت 5G مع وجود قفل 4G: قفل 4G ينرسل كما هو (ما ينمسح)', () => {
  const body = buildCellLockBody({
    tech: 'NR', pci: '77', arfcn: '640000', band: 78, mode: '2',
    current: { lte: lteLocked, nr: free }, netMode: '0803',
  });
  assert.ok(body.includes('<lte_info>' + lteLocked + '</lte_info>'), 'قفل 4G محفوظ');
  assert.ok(body.includes('<nr_info><lock_mode>2</lock_mode>'), 'قسم 5G الجديد');
  assert.ok(body.includes('<pci>77</pci>'));
});

test('تثبيت 4G بدون قفل 5G: قسم 5G تلقائي (مثل قبل)', () => {
  const body = buildCellLockBody({
    tech: 'LTE', pci: '9', arfcn: '1300', band: 3, mode: '2', current: { lte: free, nr: free }, netMode: '00',
  });
  assert.ok(body.includes('<nr_info><lock_mode>0</lock_mode>'));
  assert.ok(body.startsWith('<lte_info><lock_mode>2</lock_mode>'));
});

test('وضع 4G فقط ما يرسل قسم 5G، و5G فقط ما يرسل قسم 4G', () => {
  const b4 = buildCellLockBody({ tech: 'LTE', pci: '9', arfcn: '1300', mode: '2', current: { lte: free, nr: nrLocked }, netMode: '03' });
  assert.ok(!b4.includes('nr_info'));
  const b5 = buildCellLockBody({ tech: 'NR', pci: '9', arfcn: '640000', band: 78, mode: '2', current: { lte: lteLocked, nr: free }, netMode: '08' });
  assert.ok(!b5.includes('lte_info'));
});

test('فك تقنية وحدة ما يلمس الثانية', () => {
  assert.ok(!buildUnlockBody('LTE').includes('nr_info'));
  assert.ok(!buildUnlockBody('NR').includes('lte_info'));
  const all = buildUnlockBody();
  assert.ok(all.includes('lte_info') && all.includes('nr_info'));
});

test('قراءة الأقفال من رد الراوتر', () => {
  const xml = `<response><lte_info>${lteLocked}</lte_info><nr_info>${nrLocked}</nr_info></response>`;
  const locks = parseCellLocks(parseLockRaw(xml));
  assert.deepEqual(locks, [
    { tech: 'LTE', pci: '101', band: 3, arfcn: '1300' },
    { tech: 'NR', pci: '55', band: 78, arfcn: '636666' },
  ]);
  assert.equal(isSectionLocked(free), false);
  assert.deepEqual(parseCellLocks(parseLockRaw('<response></response>')), []);
});

test('قراءة عدة خلايا: كل PCI مرتبط بتردده ونطاقه داخل freq_info نفسه', () => {
  const multi = '<lock_mode>2</lock_mode><freq_infos>' +
    '<freq_info><band>3</band><freq>1300</freq><pci>101</pci></freq_info>' +
    '<freq_info><band>7</band><freq>2850</freq><pci>202</pci></freq_info>' +
    '</freq_infos><all_bands>3,7</all_bands>';
  const locks = parseCellLocks({ lte: multi, nr: free });
  assert.deepEqual(locks, [
    { tech: 'LTE', pci: '101', band: 3, arfcn: '1300' },
    { tech: 'LTE', pci: '202', band: 7, arfcn: '2850' },
  ]);
  assert.equal(lockMatches(locks, 'LTE', '202', '2850'), true);
  assert.equal(lockMatches(locks, 'LTE', '202', '1300'), false);
  assert.equal(lockMatches(locks, 'LTE', '999', '2850'), false);
});

test('٦) نجاح القفل يتأكد بالتقنية + PCI + القناة، مو بأي قفل', () => {
  const locks = parseCellLocks({ lte: lteLocked, nr: nrLocked });
  assert.equal(lockMatches(locks, 'NR', '55', '636666'), true);
  // قفل 4G فيه PCI ثاني — ما نحسبه نجاح لقفل 5G
  assert.equal(lockMatches(locks, 'NR', '101', ''), false);
  assert.equal(lockMatches(locks, 'NR', '55', '999'), false);
  assert.equal(lockMatches([{ tech: 'NR', pci: '55' }], 'NR', '55', '636666'), false);
  assert.equal(lockMatches([{ tech: 'NR', pci: '55' }], 'NR', '55', ''), true);
  assert.equal(lockMatches([], 'LTE', '101', '1300'), false);
});

// ─── تطبيق من خطوتين ───

test('خطوة أولى غيّرت (وضع الشبكة) والثانية قالت «ما غيّرنا»: لازم نرجّع', async () => {
  let wrote = false;
  const driver = {
    async setNetworkMode() {},
    async setBand() { throw noChange('راوترك ما يسمح نثبّت ترددات 5G'); },
    async getSignal() { return {}; },
  };
  const out = await runApply<typeof driver>({
    session: async fn => fn(trackWrites(driver, () => { wrote = true; })),
    apply: async d => { await d.setNetworkMode(); await d.setBand(); },
    changed: () => wrote,
    firstMs: 1000, extraMs: 1000,
  });
  assert.ok(out.kind === 'failed' && !out.skipRevert);
});

test('قراءات قبل الرفض ما تنحسب تغيير: نتخطى الإرجاع', async () => {
  let wrote = false;
  const driver = {
    async getBandConfig() { return {}; },
    async setBand() { throw noChange('ما يدعم'); },
  };
  const out = await runApply<typeof driver>({
    session: async fn => fn(trackWrites(driver, () => { wrote = true; })),
    apply: async d => { await d.getBandConfig(); await d.setBand(); },
    changed: () => wrote,
    firstMs: 1000, extraMs: 1000,
  });
  assert.ok(out.kind === 'failed' && out.skipRevert);
});

// ─── هواوي: قفل الترددات بالأدوار (مثل صفحة «تحديد النطاق») ───

test('قفل ترددات: الأساسي في freq_infos والثانوي بس في all_bands فقط', () => {
  const x = bandLockSection('lte_info', [1, 3, 20], [3, 20]);
  assert.equal(x, '<lte_info><lock_mode>3</lock_mode><freq_infos><freq_info><band>1</band></freq_info></freq_infos><all_bands>1,3,20</all_bands></lte_info>');
});

test('بدون أدوار = كلها أساسي + ثانوي (نفس طلب صفحة الراوتر حرفياً)', () => {
  assert.equal(
    bandLockSection('lte_info', [1, 3, 20]) + bandLockSection('nr_info', []),
    '<lte_info><lock_mode>3</lock_mode><freq_infos><freq_info><band>1</band></freq_info><freq_info><band>3</band></freq_info><freq_info><band>20</band></freq_info></freq_infos><all_bands>1,3,20</all_bands></lte_info><nr_info><lock_mode>0</lock_mode><freq_infos></freq_infos><all_bands></all_bands></nr_info>',
  );
});

test('لازم يبقى تردد واحد أساسي على الأقل (شرط الراوتر)', () => {
  const x = bandLockSection('nr_info', [78], [78]);
  assert.ok(x.includes('<freq_info><band>78</band></freq_info>'));
});

// ─── قفل القناة ونوع القفل ───

test('قفل قناة: lock_mode 1 + رقم القناة بدون خلية، وقفل 4G الحالي محفوظ', () => {
  const body = buildChannelLockBody({ tech: 'NR', band: 78, arfcn: '636666', current: { lte: lteLocked, nr: free }, netMode: '00' });
  assert.ok(body.includes('<lte_info>' + lteLocked + '</lte_info>'));
  assert.ok(body.includes('<nr_info><lock_mode>1</lock_mode><freq_infos><freq_info><band>78</band><freq>636666</freq><pci></pci></freq_info></freq_infos><all_bands>78</all_bands></nr_info>'));
});

test('نوع القفل من رد الراوتر + التحقق من قفل القناة', () => {
  assert.equal(lockKindOf(free), 'none');
  assert.equal(lockKindOf(lteLocked), 'cell');
  assert.equal(lockKindOf('<lock_mode>3</lock_mode>'), 'band');
  const ch = '<lock_mode>1</lock_mode><freq_infos><freq_info><band>3</band><freq>1650</freq><pci></pci></freq_info></freq_infos><all_bands>3</all_bands>';
  assert.equal(channelMatches({ lte: ch, nr: free }, 'LTE', '1650'), true);
  assert.equal(channelMatches({ lte: ch, nr: free }, 'LTE', '124'), false);
  assert.equal(channelMatches({ lte: lteLocked, nr: free }, 'LTE', '1300'), false);
});
