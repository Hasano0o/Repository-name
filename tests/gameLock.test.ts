import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameLockVerdict, gameLockLeft, GameLock } from '../src/utils/gameLockCore';

const H = 3600_000;
const g = (p: Partial<GameLock> = {}): GameLock => ({
  routerId: 'r', at: 0, until: 2 * H, label: 'B8 للألعاب', kind: 'band',
  applied: { lte: [8], nr: [] }, prev: { lte: [], nr: [], mode: '00' }, ...p,
});
const cfg = (locked: number[], nrLocked: number[] = [], mode = '00') => ({ locked, nrLocked, mode });

test('عضو MC801A: ثبّت B8 للعب ← قبل الساعتين والنت شغال ما نلمس شي', () => {
  assert.equal(gameLockVerdict(g(), H, cfg([8]), true), null);
});

test('خلصت الساعتين ← نرجّع إعداده (الدمج يرجع)', () => {
  assert.equal(gameLockVerdict(g(), 2 * H, cfg([8]), true), 'expired');
});

test('النت طاح وهو على B8 ← نرجّع على طول (حتى لو دائم)', () => {
  assert.equal(gameLockVerdict(g(), H, cfg([8]), false), 'down');
  assert.equal(gameLockVerdict(g({ until: null }), 99 * H, cfg([8]), false), 'down');
  assert.equal(gameLockVerdict(g({ until: null }), 99 * H, cfg([8]), true), null);
});

test('العضو غيّر الإعداد بنفسه ← ننسى بدون ما نكتب', () => {
  assert.equal(gameLockVerdict(g(), 3 * H, cfg([3, 8]), false), 'gone');
  assert.equal(gameLockVerdict(g(), 3 * H, cfg([]), true), 'gone');
});

test('4G فقط للعب: يرجع بالوضع', () => {
  const l = g({ kind: 'lteOnly', applied: { lte: [], nr: [], mode: '03' } });
  assert.equal(gameLockVerdict(l, 3 * H, cfg([], [], '03'), true), 'expired');
  assert.equal(gameLockVerdict(l, 3 * H, cfg([], [], '00'), true), 'gone');
});

test('ما وصلنا للراوتر (cfg فاضي) ← نقرر بالوقت بس', () => {
  assert.equal(gameLockVerdict(g(), 3 * H, null, undefined), 'expired');
  assert.equal(gameLockVerdict(g(), H, null, undefined), null);
});

test('الوقت الباقي', () => {
  assert.equal(gameLockLeft(g(), H + 30 * 60000), '30 د');
  assert.equal(gameLockLeft(g({ until: null }), 0), 'دائم');
});
