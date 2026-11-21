/**
 * شكاوى أعضاء ٢١ نوفمبر: «التحسين التلقائي يدمجلي B40 وشريحتي stc ومنطقتي ما فيها» ·
 * «يشبك على n28 وهو مو موجود عندي» (FiberHome، نسخة الكمبيوتر).
 * ١) المرشحين من اللي انشاف فعلاً بس — مو كل اللي يدعمه الراوتر.
 * ٢) بعد كل تجربة نتأكد إن الراوتر فعلاً انتقل للتردد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  return origLoad.call(this, req, ...rest);
};

const V = require('../src/utils/bandVerify');
const { buildCandidates } = require('../src/utils/optimize');
const { bandCandidates } = require('../src/assistant/pilotPlan');

test('الراوتر تجاهل التثبيت وبقى على B3 ← تجربة B40 ما تنحسب', () => {
  const v = V.verifyServing({ lte: [40] }, { lte: [3], nr: [] });
  assert.equal(v.ok, false);
  assert.match(v.why, /بقى على B3/);
  assert.match(v.why, /B40/);
});

test('انتقل فعلاً ← تنحسب', () => {
  assert.equal(V.verifyServing({ lte: [40] }, { lte: [40], nr: [] }).ok, true);
  assert.equal(V.verifyServing({ lte: [3, 1] }, { lte: [3, 1], nr: [78] }).ok, true);
});

test('دمج B3+B40 والبرج عطاه B3 بس ← ما نسميه دمج', () => {
  const v = V.verifyServing({ lte: [3, 40] }, { lte: [3], nr: [] });
  assert.equal(v.ok, false);
  assert.match(v.why, /ما دمجها/);
});

test('طلبنا n28 لحاله وهو متصل 4G بدون 5G ← ما فيه برج n28', () => {
  const v = V.verifyServing({ nr: [28] }, { lte: [3], nr: [] });
  assert.equal(v.ok, false);
  assert.match(v.why, /n28/);
  assert.equal(V.verifyServing({ nr: [28] }, { lte: [3], nr: [78] }).ok, false);
  assert.equal(V.verifyServing({ nr: [78] }, { lte: [3], nr: [78] }).ok, true);
});

test('الراوتر ما يعطي التردد أصلاً ← نقبلها زي قبل', () => {
  assert.equal(V.verifyServing({ lte: [40] }, { lte: [], nr: [] }).ok, true);
});

test('servingBands: من النواقل، وإلا من الإشارة', () => {
  assert.deepEqual(V.servingBands(null, [{ tech: 'LTE', band: 3, role: 'PCC' }, { tech: 'LTE', band: 1, role: 'SCC' }, { tech: 'NR', band: 78, role: 'SCC' }]), { lte: [3, 1], nr: [78] });
  assert.deepEqual(V.servingBands({ rsrp: -90, band: 'B3', nrRsrp: -95, nrBand: 'n78' }, []), { lte: [3], nr: [78] });
  assert.deepEqual(V.servingBands({ rsrp: -90, band: '3', nrBand: '28' }, []), { lte: [3], nr: [] });
});

test('المُحسّن: ما يكمّل من كل ترددات الراوتر (B40 · n28) — بس الأبراج + المعروفة', () => {
  const supported = [1, 3, 7, 8, 20, 28, 38, 40, 41];
  const nrSup = [1, 3, 28, 41, 78];
  // راوتر ZTE يعرض البرج المتصل بس (B3)، ومعروف عندنا B1 و n78
  const cs = buildCandidates([{ tech: 'LTE', band: 3 }], supported, nrSup, 6, { lte: [3, 1], nr: [78] });
  const names = cs.map((c: any) => (c.tech === 'NR' ? 'n' : 'B') + c.band);
  assert.deepEqual(names.sort(), ['B1', 'B3', 'n78']);
  assert.ok(!names.includes('B40') && !names.includes('n28'));
  // بدون معلومات ← الأبراج بس
  assert.deepEqual(buildCandidates([{ tech: 'LTE', band: 3 }], supported, nrSup, 6, null).map((c: any) => c.band), [3]);
});

test('التحسين التلقائي: بدون تكملة من القائمة الثابتة', () => {
  const cells = [{ tech: 'LTE', band: 3, rsrp: -90 }] as any;
  assert.deepEqual(bandCandidates(cells, [1, 3, 8, 40], []), [3]);
  assert.deepEqual(bandCandidates(cells, [1, 3, 8, 40], [1]), [3, 1]);
});

test('knownBands = المتصل + اللي انشاف (بدون تكرار)', () => {
  assert.deepEqual(V.knownBands({ lte: [3], nr: [78] }, { lte: [3, 1], nr: [] }), { lte: [3, 1], nr: [78] });
});
