/**
 * الوضع الداكن (٧ نوفمبر — صورة حسن من نافذة التقدّم): عنوان التركيبة #1d3f9e وتحذير «لا تطلع» #9a3412
 * كانت تبقى غامقة على الكرت الكحلي ← ما تنقرى. وعنوان «B3 + B1 + B20 + أي 5G» ينعرض «5 أيG».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { adaptColor, contrast, rtlLine, DARK_CARD } = require('../src/ui/colorAdapt');

test('الألوان المشبعة الغامقة تنقرى على الكرت الداكن', () => {
  for (const c of ['#1d3f9e', '#9a3412', '#b45309', '#be123c', '#1e3a8a', '#4b2aa8', '#0e7d93']) {
    const out = adaptColor(c, 'fg', true);
    assert.ok(contrast(out, DARK_CARD) >= 4.5, `${c} → ${out} تباين ${contrast(out, DARK_CARD).toFixed(2)}`);
  }
});

test('اللون يبقى بنفس درجته (أزرق يبقى أزرق، برتقالي يبقى برتقالي)', () => {
  const blue = adaptColor('#1d3f9e', 'fg', true);
  const b = parseInt(blue.slice(5, 7), 16), r = parseInt(blue.slice(1, 3), 16);
  assert.ok(b > r, blue);
  const orange = adaptColor('#9a3412', 'fg', true);
  assert.ok(parseInt(orange.slice(1, 3), 16) > parseInt(orange.slice(5, 7), 16), orange);
});

test('الألوان الزاهية اللي تنقرى أصلاً ما تتغيّر', () => {
  for (const c of ['#2f6bff', '#12b76a', '#e5484d', '#7a51e0', '#f97316', '#16a34a']) {
    assert.equal(adaptColor(c, 'fg', true), c);
  }
  assert.equal(adaptColor('#2f6bff', 'fg', true), '#2f6bff');
});

test('الفاتح ما يتغيّر أبداً، والخلفيات زي قبل', () => {
  assert.equal(adaptColor('#1d3f9e', 'fg', false), '#1d3f9e');
  assert.equal(adaptColor('#fff7ed', 'bg', false), '#fff7ed');
  const bg = adaptColor('#eef3ff', 'bg', true);
  assert.ok(contrast(bg, '#000000') < 2, bg); // صار داكن
  assert.equal(adaptColor('#2f6bff', 'bg', true), '#2f6bff');
});

test('سطر يبدأ بلاتيني وفيه عربي ← علامة RLM في أوله', () => {
  assert.equal(rtlLine('B3 + B1 + B20 + أي 5G'), '‏B3 + B1 + B20 + أي 5G');
  assert.equal(rtlLine('‏B3 + أي 5G'), '‏B3 + أي 5G');
  assert.equal(rtlLine('B3 + B1 + any 5G'), 'B3 + B1 + any 5G');
  assert.equal(rtlLine(''), '');
});
