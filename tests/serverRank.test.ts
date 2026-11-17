/** «أي سيرفر أقرب لك؟» — src/utils/serverRank.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { quality, bestRegion, groupResults, barPct, inGameName, shaky } = require('../src/utils/serverRank');

const R = (median: number, lossPct = 0, jitter = 5, samples = 8) => ({ median, jitter, lossPct, samples });

test('الوصف من البنق والفقد', () => {
  assert.equal(quality(R(40)), 'great');
  assert.equal(quality(R(94)), 'good');
  assert.equal(quality(R(123)), 'ok');
  assert.equal(quality(R(250)), 'far');
  assert.equal(quality(R(60, 13)), 'drops');
  assert.equal(quality(R(0, 100, 0, 0)), 'none');
  assert.equal(quality(undefined), 'none');
});

test('الأنسب: أقل بنق بدون تقطيع، و Cloudflare وسيرفرنا ما ينحسبون', () => {
  const res = { 'sa-jed': R(94), sa: R(80, 13), cf: R(20), 'bandly:ruh': R(10), fr: R(120) };
  assert.equal(bestRegion(res), 'sa-jed');
  assert.equal(bestRegion({ cf: R(20) }), null);
});

test('التجميع: الأقرب أول والمقارنة آخر شي', () => {
  const g = groupResults({ fr: R(120), 'sa-jed': R(94), 'sa-ruh': R(243), cf: R(208), us: R(259), sa: R(193, 13) });
  assert.deepEqual(g.map((x: any) => x.id), ['me', 'eu', 'am', 'ref']);
  assert.deepEqual(g[0].ids, ['sa-jed', 'sa-ruh', 'sa']);
  assert.equal(g[0].best, 94);
});

test('الشريط والأسماء داخل اللعبة', () => {
  assert.equal(barPct(R(94), 94), 100);
  assert.equal(barPct(R(188), 94), 50);
  assert.equal(barPct(R(5000), 94), 6);
  assert.equal(barPct(R(0, 100, 0, 0), 94), 0);
  assert.equal(inGameName('sa-jed'), 'الشرق الأوسط');
  assert.equal(inGameName('kr'), 'كوريا واليابان');
  assert.equal(shaky(R(90, 0, 60)), true);
  assert.equal(shaky(R(90, 0, 10)), false);
});
