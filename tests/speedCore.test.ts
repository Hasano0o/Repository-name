/** حساب سرعة الاختبار من القطع */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowMbps, finalMbps, wantStreams, Chunk } from '../src/utils/speedCore';

const MB = 1_000_000;

test('النافذة: الحجم يتوزّع على مدة القطعة', () => {
  const c: Chunk[] = [{ t0: 0, t1: 1000, bytes: 10 * MB }]; // 80 ميقابت
  assert.equal(Math.round(windowMbps(c, 0, 1000)), 80);
  assert.equal(Math.round(windowMbps(c, 0, 500)), 80); // نص القطعة بنص الوقت
  assert.equal(windowMbps(c, 1000, 2000), 0);
});

test('خط ثابت: النتيجة = سرعته', () => {
  const c: Chunk[] = [];
  for (let s = 0; s < 4; s++) for (let t = 0; t < 8000; t += 700) c.push({ t0: t, t1: t + 700, bytes: 3.5 * MB }); // 40 لكل اتصال
  assert.equal(Math.round(finalMbps(c, 0, { warmupMs: 1000 })), 160);
});

test('بداية بطيئة وتذبذب: الرقم يتجاهلها وما يتعدّى أسرع لحظة', () => {
  const c: Chunk[] = [];
  for (let t = 0; t < 8000; t += 500) {
    const mbps = t < 2000 ? 20 : (t / 500) % 2 ? 90 : 110; // بطيء أول ثانيتين ثم ٩٠/١١٠
    c.push({ t0: t, t1: t + 500, bytes: (mbps * 1e6 / 8) * 0.5 });
  }
  const r = finalMbps(c, 0, { warmupMs: 1000 });
  const avg = windowMbps(c, 1000, 8000);
  assert.ok(r >= avg, `${r} >= ${avg}`);
  assert.ok(r > 95 && r <= 110, String(r));
});

test('قياس قصير جداً: متوسط', () => {
  const c: Chunk[] = [{ t0: 0, t1: 1500, bytes: 3 * MB }];
  assert.equal(Math.round(finalMbps(c, 0, { warmupMs: 1000 })), 16);
  assert.equal(finalMbps([], 0, { warmupMs: 1000 }), 0);
});

test('عدد الاتصالات يزيد مع السرعة بس', () => {
  assert.equal(wantStreams(4, 30, 'down'), 4);
  assert.equal(wantStreams(4, 200, 'down'), 6);
  assert.equal(wantStreams(6, 200, 'down'), 8);
  assert.equal(wantStreams(8, 900, 'down'), 8);
  assert.equal(wantStreams(4, 30, 'up'), 6);
  assert.equal(wantStreams(6, 90, 'up'), 6);
});
