/**
 * تقرير «اضبط لي كل شي» قبل أي تغيير — بيانات ثابتة (محاكاة).
 * الهدف: ما ننصح بتجربة نعرف إنها ما بتفيد (تقطع النت عالفاضي)، ونقول كم بينقطع.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, bandCandidates, planSecs, PlanInput, SECS_BAND } from '../src/assistant/pilotPlan';

const NOW = 1_800_000_000_000;
const DAY = 86400_000;
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW,
  sig: { rsrp: -98, sinr: 6, band: '3' },
  carriers: [{ tech: 'LTE', band: 3 }],
  bandCfg: { supported: [1, 3, 8, 20, 28], locked: [] },
  cells: [
    { kind: 'serving', tech: 'LTE', band: 3, pci: '100', arfcn: '1300', rsrp: -98 },
    { kind: 'neighbor', tech: 'LTE', band: 1, pci: '200', arfcn: '100', rsrp: -95 },
    { kind: 'neighbor', tech: 'LTE', band: 20, pci: '300', arfcn: '6300', rsrp: -90 },
  ],
  opLte: [1, 3, 8, 20],
  trials: [],
  caps: { band: true, tower: true, wifi: true },
  towerTargets: [{ tech: 'LTE', band: 20, arfcn: '6300', pci: '300', name: 'برج 300', rsrp: -90 }],
  ...over,
});

test('المرشحين: اللي له برج حولك أول (الأقوى)، وبعدها ترددات الشبكة', () => {
  const b = bandCandidates(base().cells, [1, 3, 8, 20, 28], [1, 3, 8, 20]);
  assert.deepEqual(b, [20, 1, 3, 8]);
});

test('إشارة متوسطة بدون دمج ← ننصح بالترددات والأبراج + المدة', () => {
  const p = buildPlan(base());
  assert.equal(p.level, 'ok');
  const band = p.items.find(i => i.key === 'band')!;
  assert.equal(band.on, true);
  assert.deepEqual(band.bands, [20, 1, 3, 8]);
  assert.equal(band.secs, (4 + 2) * SECS_BAND);
  assert.equal(p.items.find(i => i.key === 'tower')!.on, true);
  assert.ok(p.facts.some(f => f.includes('بدون دمج')));
  assert.ok(p.tips.some(t => t.includes('بيانات الجوال')));
  assert.ok(planSecs(p.items) > 0);
});

test('مدموج والإشارة ممتازة ← ما ننصح بتجربة الترددات (تقطع النت عالفاضي)', () => {
  const p = buildPlan(base({
    sig: { rsrp: -82, sinr: 18, band: '3', nrRsrp: -90, nrBand: '78' },
    carriers: [{ tech: 'LTE', band: 3 }, { tech: 'LTE', band: 1 }, { tech: 'NR', band: 78 }],
  }));
  assert.equal(p.level, 'good');
  assert.equal(p.items.find(i => i.key === 'band')!.on, false);
});

test('تثبيت 4G يطفي 5G (H158) و5G شغال ← ما ننصح', () => {
  const p = buildPlan(base({
    sig: { rsrp: -98, sinr: 6, band: '3', nrRsrp: -100 },
    bandCfg: { supported: [1, 3, 8, 20], locked: [], lteLockKills5g: true },
  }));
  const band = p.items.find(i => i.key === 'band')!;
  assert.equal(band.on, false);
  assert.match(band.why, /5G/);
});

test('جرّبناها قبل يومين وما فرقت ← ما ننصح نعيدها', () => {
  const p = buildPlan(base({
    trials: [
      { key: 'pilot:band:20', verdict: 'same', at: NOW - 2 * DAY },
      { key: 'pilot:cell:LTE:300', verdict: 'worse', at: NOW - 1 * DAY },
    ],
  }));
  assert.equal(p.items.find(i => i.key === 'band')!.on, false);
  assert.equal(p.items.find(i => i.key === 'tower')!.on, false);
});

test('تجربة قديمة (أكثر من أسبوع) ما توقفنا', () => {
  const p = buildPlan(base({ trials: [{ key: 'pilot:band:20', verdict: 'same', at: NOW - 10 * DAY }] }));
  assert.equal(p.items.find(i => i.key === 'band')!.on, true);
});

test('الأبراج الثانية أضعف بوضوح ← ما ننصح بتجربة الأبراج', () => {
  const p = buildPlan(base({ towerTargets: [{ tech: 'LTE', band: 1, arfcn: '100', pci: '200', name: 'برج 200', rsrp: -112 }] }));
  const t = p.items.find(i => i.key === 'tower')!;
  assert.equal(t.on, false);
  assert.match(t.why, /أضعف/);
});

test('ZTE (cellLockRisk) ← الأبراج في «ما بنجرّبها» مع السبب', () => {
  const p = buildPlan(base({ caps: { band: true, tower: true, towerRisk: 'يطيح', wifi: false } }));
  assert.ok(!p.items.some(i => i.key === 'tower'));
  assert.ok(p.skipped.some(k => k.key === 'tower'));
  assert.ok(p.skipped.some(k => k.key === 'wifi'));
});

test('راوتر بدون أي كتابة ← كل شي في «ما بنجرّبها» وما فيه نصايح انقطاع', () => {
  const p = buildPlan(base({ caps: { band: false, tower: false, wifi: false }, bandCfg: null }));
  assert.equal(p.items.length, 0);
  assert.equal(p.skipped.length, 3);
  assert.equal(p.tips.length, 0);
});

test('5G SA بس (بدون 4G) ← المستوى من قراءة 5G', () => {
  const p = buildPlan(base({ sig: { nrRsrp: -85, nrSinr: 16, nrBand: '78' }, carriers: [] }));
  assert.equal(p.level, 'good');
  assert.ok(p.facts.some(f => f.startsWith('5G n78')));
});

// ═══ أعضاء برجك (٧ نوفمبر) ═══
import { communityAdvice, parseCombo, comboOf } from '../src/assistant/pilotPlan';

const cc = (combo: string, users: number, ping: number | null, score: number | null = null, extra: object = {}) =>
  ({ combo, users, enough: users >= 3, ping, score, ...extra });

test('شكل التجميعة: نفس ترتيب السيرفر', () => {
  assert.equal(comboOf([{ tech: 'NR', band: 78 }, { tech: 'LTE', band: 3 }, { tech: 'LTE', band: 1 }]), 'B1+B3+n78');
  assert.deepEqual(parseCombo('B1+B3+n78'), { lte: [1, 3], nr: [78] });
});

test('تجميعة أعضاء برجك أفضل بوضوح ← تنحط أول ونجرّبها كدمج', () => {
  const p = buildPlan(base({
    sig: { rsrp: -82, sinr: 18, band: '3' },
    carriers: [{ tech: 'LTE', band: 3 }, { tech: 'LTE', band: 20 }],
    ping: { median: 70, jitter: 10 },
    community: { users: 6, combos: [cc('B1+B3', 4, 40), cc('B3+B20', 3, 72)] },
  }));
  const band = p.items.find(i => i.key === 'band')!;
  // مدموج وجيد كان «ما ننصح» — الحين ننصح لأن أعضاء برجه حصّلوا أفضل
  assert.equal(band.on, true);
  assert.deepEqual(band.bands!.slice(0, 2), [1, 3]);
  assert.deepEqual(band.prefer, [1, 3]);
  assert.match(band.why, /أعضاء على نفس برجك/);
  assert.ok(p.facts.some(f => f.includes('6 أعضاء')));
});

test('أقل من ٣ أعضاء ← ما نوصي (ولو بنقهم أحسن)', () => {
  const a = communityAdvice('B3', 70, { users: 2, combos: [cc('B1+B3', 2, 30)] });
  assert.equal(a.best, undefined);
  assert.match(a.facts[0], /لسا ما فيه تجميعة/);
});

test('الفرق صغير (أقل من ٢٠٪) ← ما نوصي', () => {
  const a = communityAdvice('B3', 50, { users: 5, combos: [cc('B1+B3', 4, 45)] });
  assert.equal(a.best, undefined);
});

test('الفرق بس في 5G ← معلومة، مو تغيير ترددات 4G', () => {
  const a = communityAdvice('B1+B3', 70, { users: 5, combos: [cc('B1+B3+n78', 4, 35)] });
  assert.equal(a.nrOnly, true);
  assert.equal(a.lte, undefined);
});

test('تثبيت 4G يطفي 5G ← حتى لو أعضاء برجه أفضل، ما ننصح', () => {
  const p = buildPlan(base({
    sig: { rsrp: -98, sinr: 6, band: '3', nrRsrp: -100 },
    bandCfg: { supported: [1, 3, 8, 20], locked: [], lteLockKills5g: true },
    ping: { median: 80, jitter: 10 },
    community: { users: 5, combos: [cc('B1+B3', 4, 40)] },
  }));
  assert.equal(p.items.find(i => i.key === 'band')!.on, false);
});

test('برجك يزحم بالليل ← نقولها', () => {
  const a = communityAdvice('B3', 60, { users: 4, combos: [cc('B3', 4, 60, null, { night_ping: 95, day_ping: 40 })] });
  assert.ok(a.facts.some(f => f.includes('يزحم بالليل')));
});

test('ما فيه أحد على برجك ← نقول بصراحة', () => {
  const a = communityAdvice('B3', 60, { users: 0, combos: [] });
  assert.match(a.facts[0], /ما عندنا قراءات/);
});

// ═══ «تحسّن» بس لو الأرقام ما ساءت (صورة حسن ٧ نوفمبر) ═══
import { worseAfter } from '../src/assistant/pilotPlan';

test('صورة حسن: البنق ١٥٨←٢١٧ والتذبذب ٢٥←٩٨ والدرجة ٣٧←٠ ← أسوأ', () => {
  const w = worseAfter({ ping: 158, jitter: 25, game: 37 }, { ping: 217, jitter: 98, game: 0 });
  assert.ok(w);
  assert.match(w!, /البنق 158←217/);
  assert.match(w!, /درجة اللعب 37←0/);
});

test('تذبذب طبيعي صغير ← مو أسوأ', () => {
  assert.equal(worseAfter({ ping: 40, jitter: 6, game: 80 }, { ping: 46, jitter: 9, game: 74 }), null);
});

test('أحسن ← مو أسوأ · بدون قياس ← null', () => {
  assert.equal(worseAfter({ ping: 90, jitter: 30, game: 40 }, { ping: 50, jitter: 8, game: 75 }), null);
  assert.equal(worseAfter(undefined, { ping: 50 }), null);
});
