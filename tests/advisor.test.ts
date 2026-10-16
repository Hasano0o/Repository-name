/**
 * اختبارات المستشار الذكي — بيانات ثابتة قابلة للتكرار (محاكاة، مو راوتر حقيقي).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, mergeCellSamples, CurrentState, Candidate, MIN_GAIN } from '../src/utils/advisor';
import { friendlyBand } from '../src/utils/bands';

const NOW = 1_800_000_000_000;
const ping = (median: number, jitter: number, score: number, ageMin = 10) =>
  ({ median, jitter, loss: 0, score, at: NOW - ageMin * 60_000 });

const cur: CurrentState = { tech: 'LTE', band: 3, pci: '100', rsrp: -100, rsrq: -12, sinr: 5, carriers: 2, samples: 3 };

test('الاسم المفهوم للتردد', () => {
  assert.equal(friendlyBand('LTE', 28), '700 · يوصل بعيد');
  assert.equal(friendlyBand('NR', 78), '3500 · سريع');
  assert.equal(friendlyBand('LTE', 3), '1800 · متوازن');
  assert.equal(friendlyBand('LTE', 99), 'B99');
});

test('ما فيه قراءة حالية ← غير حاسمة', () => {
  const v = advise(null, [], 'overall', NOW);
  assert.equal(v.kind, 'inconclusive');
  assert.ok(v.missing.includes('قراءة الإشارة الحالية'));
});

test('ما فيه أبراج ثانية ← غير حاسمة (مو «ابقَ»)', () => {
  const v = advise(cur, [], 'overall', NOW);
  assert.equal(v.kind, 'inconclusive');
});

test('برج أقوى بوضوح ← توصية، بس «متوقع» وثقة منخفضة لو قراءة وحدة', () => {
  const c: Candidate = { tech: 'LTE', band: 28, pci: '7', rsrp: -82, rsrq: -8, samples: 1 };
  const v = advise(cur, [c], 'overall', NOW);
  assert.equal(v.kind, 'switch');
  assert.equal(v.best?.c.pci, '7');
  assert.equal(v.best?.measured, false);
  assert.equal(v.confidence, 'low');
  assert.match(v.headline, /متوقع/);
  assert.ok(v.best!.reasons.some(r => /أقوى بـ 18 dB/.test(r)));
});

test('مقارنة عادلة: SINR الحالي ما يتقارن بـ RSRQ المرشح', () => {
  const c: Candidate = { tech: 'LTE', band: 1, pci: '8', rsrp: -95, rsrq: -10, samples: 3 };
  const v = advise(cur, [c], 'overall', NOW);
  // الأساس: قوة + جودة (RSRQ عند الطرفين) — مو SINR
  assert.deepEqual(v.ranked[0].basis, ['power', 'quality']);
});

test('فرق صغير (تذبذب قراءات) ← ابقَ على وضعك', () => {
  const cs: Candidate[] = [
    { tech: 'LTE', band: 1, pci: '8', rsrp: -99, rsrq: -12, samples: 3 },
    { tech: 'LTE', band: 20, pci: '9', rsrp: -104, rsrq: -13, samples: 3 },
  ];
  const v = advise(cur, cs, 'overall', NOW);
  assert.equal(v.kind, 'stay');
  assert.ok(v.ranked[0].gain < MIN_GAIN);
});

test('البرج الحالي والخلايا الشغالة ما تنحسب مرشحين', () => {
  const v = advise({ ...cur, serving: [{ tech: 'NR', pci: '55' }] }, [
    { tech: 'LTE', band: 3, pci: '100', rsrp: -60, samples: 3 },
    { tech: 'NR', band: 78, pci: '55', rsrp: -60, samples: 3 },
  ], 'overall', NOW);
  assert.equal(v.kind, 'inconclusive');
});

test('تجربة سابقة أسوأ أو ما اتصل ← مستبعد مع السبب', () => {
  const v = advise(cur, [
    { tech: 'LTE', band: 28, pci: '7', rsrp: -80, rsrq: -8, samples: 3, trial: { verdict: 'noconn', at: NOW - 86400_000 } },
    { tech: 'LTE', band: 8, pci: '6', rsrp: -80, rsrq: -8, samples: 3, onOperator: false },
  ], 'overall', NOW);
  assert.equal(v.kind, 'inconclusive');
  assert.deepEqual(v.excluded.map(e => e.reason), ['جربناه قبل وما اتصل الراوتر عليه', 'مو من ترددات شبكتك']);
});

test('تجربة سابقة قديمة (أكثر من أسبوعين) ما تستبعد', () => {
  const v = advise(cur, [
    { tech: 'LTE', band: 28, pci: '7', rsrp: -80, rsrq: -8, samples: 3, trial: { verdict: 'worse', at: NOW - 30 * 86400_000 } },
  ], 'overall', NOW);
  assert.equal(v.kind, 'switch');
});

test('للألعاب: بدون بنق مقاس ما نقول «أفضل للعب»', () => {
  const c: Candidate = { tech: 'LTE', band: 1, pci: '8', rsrp: -94, rsrq: -11, samples: 3 };
  const v = advise({ ...cur, ping: ping(60, 10, 70) }, [c], 'gaming', NOW);
  // فرق إشارة صغير وما فيه بنق للمرشح ← ما نوصي
  assert.equal(v.kind, 'stay');
  assert.match(v.headline, /ما عندنا بنق مقاس/);
});

test('للألعاب: البنق المقاس يغلب الإشارة', () => {
  const strongButLaggy: Candidate = { tech: 'LTE', band: 28, pci: '7', rsrp: -80, rsrq: -8, samples: 3, ping: ping(95, 30, 40) };
  const weakerButSmooth: Candidate = { tech: 'LTE', band: 1, pci: '8', rsrp: -98, rsrq: -11, samples: 3, ping: ping(45, 4, 92) };
  const base = { ...cur, ping: ping(70, 15, 65) };
  const g = advise(base, [strongButLaggy, weakerButSmooth], 'gaming', NOW);
  assert.equal(g.kind, 'switch');
  assert.equal(g.best?.c.pci, '8');
  assert.equal(g.best?.measured, true);
  assert.equal(g.confidence, 'high');
  // الأداء العام يفضّل الإشارة القوية — نفس البيانات، هدف مختلف
  const o = advise(base, [strongButLaggy, weakerButSmooth], 'overall', NOW);
  assert.equal(o.best?.c.pci, '7');
});

test('بنق قديم (أكثر من أسبوع) ما ينحسب', () => {
  const c: Candidate = { tech: 'LTE', band: 1, pci: '8', rsrp: -98, rsrq: -11, samples: 3, ping: ping(45, 4, 92, 8 * 24 * 60) };
  const v = advise({ ...cur, ping: ping(70, 15, 65) }, [c], 'gaming', NOW);
  assert.ok(!v.ranked[0].basis.includes('latency'));
});

test('نفس المدخلات ← نفس النتيجة (حتمي)', () => {
  const cs: Candidate[] = [
    { tech: 'LTE', band: 28, pci: '7', rsrp: -85, rsrq: -9, samples: 2 },
    { tech: 'NR', band: 78, pci: '20', rsrp: -90, rsrq: -10, samples: 3 },
  ];
  assert.deepEqual(advise(cur, cs, 'overall', NOW), advise(cur, cs, 'overall', NOW));
});

test('دمج القراءات: متوسط + عدد مرات الظهور', () => {
  const m = mergeCellSamples([
    [{ tech: 'LTE', band: 3, pci: '7', arfcn: '1300', rsrp: -90 }, { tech: 'LTE', pci: '7', arfcn: '1300', rsrp: -90 }],
    [{ tech: 'LTE', band: 3, pci: '7', arfcn: '1300', rsrp: -94, rsrq: -10 }],
    [{ tech: 'LTE', band: 3, pci: '' }],
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].samples, 2);
  assert.equal(Math.round(m[0].rsrp!), -91);
  assert.equal(m[0].rsrq, -10);
});
