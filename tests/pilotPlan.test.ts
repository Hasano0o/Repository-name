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
