/** «حارس التثبيت» — شكوى عضو ٢٨ نوفمبر: التثبيت ممتاز وقت الضبط، وبعد ساعات يثقل. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchVerdict, watchStep, SETTLE_MS, type WatchState } from '../src/utils/lockWatchCore';

const base = { rsrp: -88, sinr: 18, pci: '214' };

test('حارس التثبيت: تذبذب عادي ما يعتبر أسوأ', () => {
  assert.equal(watchVerdict(base, { rsrp: -92, sinr: 14 }, true).kind, 'ok');
  assert.equal(watchVerdict(base, { rsrp: -91, sinr: 11 }, true).kind, 'ok');
});

test('حارس التثبيت: SINR نزل بوضوح أو RSRP أو النت طاح ← أسوأ', () => {
  const v = watchVerdict(base, { rsrp: -90, sinr: 6 }, true);
  assert.equal(v.kind, 'worse');
  assert.match((v as any).reason, /SINR نزلت من 18 إلى 6/);
  assert.equal(watchVerdict(base, { rsrp: -99, sinr: 15 }, true).kind, 'worse');
  assert.equal(watchVerdict(base, null, false).kind, 'down');
  // ما فيه قراءة والنت شغال ← ما نحكم
  assert.equal(watchVerdict(base, null, true).kind, 'ok');
});

test('حارس التثبيت: ينتظر يستقر، ويحتاج فحصين، ومرتين باليوم بالكثير', () => {
  const now = 10_000_000_000;
  const worse = { kind: 'worse' as const, reason: 'x' };
  let w: WatchState = { at: now - 5 * 60_000, label: 'ثبّت B3', base, prev: null };
  assert.equal(watchStep(w, worse, now, 'd1', 'S').do, 'none'); // أول ٢٠ دقيقة
  w = { ...w, at: now - SETTLE_MS - 1 };
  let st = watchStep(w, worse, now, 'd1', 'S');
  assert.equal(st.do, 'none');
  st = watchStep((st as any).state, worse, now, 'd1', 'S');
  assert.equal(st.do, 'act');
  // فحص زين يصفّر العدّاد
  const ok = watchStep({ ...w, bad: 1 }, { kind: 'ok' }, now, 'd1', 'S');
  assert.equal((ok as any).state.bad, 0);
  // حد اليوم
  assert.equal(watchStep({ ...w, bad: 5, acts: 2, day: 'd1' }, worse, now, 'd1', 'S').do, 'none');
  // يوم جديد يصفّر
  assert.equal(watchStep({ ...w, bad: 5, acts: 2, day: 'd0' }, worse, now, 'd1', 'S').do, 'act');
});

test('حارس التثبيت: العضو غيّر الإعداد بنفسه ← ننسى بدون ما نلمس شي', () => {
  const w: WatchState = { at: 0, label: 'x', base, prev: null, applied: '4G: B3' };
  assert.equal(watchStep(w, { kind: 'worse', reason: 'x' }, 1e12, 'd', '4G: تلقائي').do, 'forget');
});
