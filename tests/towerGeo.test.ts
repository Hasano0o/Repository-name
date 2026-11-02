/** «بعد البرج عنك»: هوية البرج من قراءة هواوي + المسافة والاتجاه (حسن ٢ نوفمبر: TAC 607 · Cell ID 173634354 · زين 42004) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellOf, cellKey, distanceM, bearingDeg, dirAr, distLabel, roundLoc } from '../src/services/towerGeo';

test('هوية البرج: PLMN + TAC + Cell ID ← 420-4-607-173634354 · ناقص ← null', () => {
  const c = cellOf({ plmn: '42004', tac: '607', cellId: '173634354', band: '15MHz@124(B1)', rsrp: -92 })!;
  assert.equal(cellKey(c), '420-4-607-173634354');
  assert.equal(c.band, 1);
  assert.equal(cellOf({ tac: '607', cellId: '173634354' }), null, 'بدون الشركة');
  assert.equal(cellOf({ plmn: '42004', cellId: '173634354' }), null, 'بدون TAC');
  assert.equal(cellOf({ plmn: '42004', tac: '0', cellId: '1' }), null);
});

test('المسافة والاتجاه: برج شمال شرق على بعد ~1.5 كم', () => {
  const me = [17.47, 47.11] as const;
  const t = [17.4795, 47.12] as const;
  const m = distanceM(me[0], me[1], t[0], t[1]);
  assert.ok(m > 1300 && m < 1600, String(m));
  const d = bearingDeg(me[0], me[1], t[0], t[1]);
  assert.ok(d > 30 && d < 60, String(d));
  assert.equal(dirAr(d), 'شمال شرق');
  assert.equal(dirAr(359), 'شمال');
  assert.equal(distLabel(1450, 400), 'حوالي 1.5 كم');
  assert.equal(distLabel(250, 500), 'قريب جداً منك', 'أقل من الدقة ← ما نوهم برقم');
  assert.equal(distLabel(720, 200), 'حوالي 700 م');
});

test('الموقع ينقرّب قبل ما يطلع من الجوال (3 خانات)', () => {
  assert.equal(roundLoc(17.476543), 17.477);
  assert.equal(roundLoc(47.10949), 47.109);
});
