import { test } from 'node:test';
import assert from 'node:assert/strict';
import { antennaVerdict, portsFrom } from '../src/utils/antennaPorts';

test('٤ منافذ متقاربة ← 4×4 سليمة', () => {
  const v = antennaVerdict({ tech: 'LTE', ports: portsFrom([-82, -84, -85, -83]) })!;
  assert.equal(v.mimo, '4×4');
  assert.equal(v.worst, 'ok');
});

test('منفذ أضعف بـ ١٢ dB أو أكثر ← ضعيف ونقول وين', () => {
  const v = antennaVerdict({ tech: 'LTE', ports: portsFrom([-81, -123, -82, -84]) })!;
  assert.equal(v.ports[1].state, 'weak');
  assert.equal(v.ports[1].behind, 42);
  assert.match(v.msg, /^RX1 ضعيف/);
});

test('منفذ بدون قراءة وسط المنافذ ← ما يستقبل (dead) وما ينحسب في MIMO', () => {
  const v = antennaVerdict({ tech: 'NR', ports: portsFrom([-90, '', -92, -91]) })!;
  assert.equal(v.ports[1].state, 'dead');
  assert.equal(v.mimo, '3×3');
});

test('الخانات الفاضية في الآخر = راوتر 2×2، مو منافذ خربانة', () => {
  const v = antennaVerdict({ tech: 'LTE', ports: portsFrom(['-80', '-82', '0', '']) })!;
  assert.equal(v.mimo, '2×2');
  assert.equal(v.worst, 'ok');
});

test('فرق ٦–١١ dB ← أضعف شوي (مو تنبيه كيبل)', () => {
  const v = antennaVerdict({ tech: 'LTE', ports: portsFrom([-80, -88]) })!;
  assert.equal(v.worst, 'low');
});

test('منفذ واحد أو بدون قراءات ← ما نعرض', () => {
  assert.equal(antennaVerdict({ tech: 'LTE', ports: portsFrom([-80]) }), null);
  assert.equal(antennaVerdict({ tech: 'LTE', ports: [{ idx: 0 }, { idx: 1 }] }), null);
});
