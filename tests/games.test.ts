/** «وش بتلعب؟» — الألعاب ومناطقها (src/utils/games.ts) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, gameById, regionForGame, preferOrder, pingWord } from '../src/utils/games';
declare const require: any;
const fs = require('fs');
const path = require('path');

const latency = fs.readFileSync(path.join(process.cwd(), 'src/utils/latency.ts'), 'utf8');
const REGION_IDS = [...latency.matchAll(/\{ id: '([a-z-]+)', name:/g)].map((m: any) => m[1]);

test('كل مناطق الألعاب موجودة في REGIONS، وبدون البحرين', () => {
  assert.ok(REGION_IDS.length >= 10);
  for (const g of GAMES) for (const r of g.regions) {
    assert.ok(REGION_IDS.includes(r), `${g.id}: ${r}`);
    assert.ok(r !== 'bh');
  }
});

test('المعرّفات فريدة', () => {
  assert.equal(new Set(GAMES.map(g => g.id)).size, GAMES.length);
  assert.equal(gameById('pubg')?.name, 'ببجي موبايل');
  assert.equal(gameById('xx'), undefined);
});

test('اختيار اللعبة يغيّر المنطقة بس لو مو من مناطقها', () => {
  const pubg = gameById('pubg')!;
  assert.equal(regionForGame(pubg, 'ae'), 'ae');
  assert.equal(regionForGame(pubg, 'br'), 'sa-ruh');
  assert.equal(regionForGame(gameById('strategy'), 'br'), 'br');
  assert.equal(regionForGame(undefined, 'br'), 'br');
});

test('ترتيب أول ٣: الأقرب من مناطق اللعبة أول', () => {
  const fn = gameById('fortnite')!;
  assert.deepEqual((preferOrder(fn, ['br', 'eu', 'ae']) ?? []).slice(0, 3), ['eu', 'ae', 'sa-ruh']);
  assert.deepEqual(preferOrder(gameById('other'), ['br']), ['br']);
});

test('حكم البنق حسب اللعبة', () => {
  const pubg = gameById('pubg')!;
  assert.equal(pingWord(pubg, 50), 'great');
  assert.equal(pingWord(pubg, 100), 'ok');
  assert.equal(pingWord(pubg, 150), 'bad');
  assert.equal(pingWord(gameById('strategy')!, 150), 'great');
});
