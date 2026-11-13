/**
 * «الراوتر ما رد وقت القياس» (تقارير nrprimary ١٢ نوفمبر هواوي و١٣ نوفمبر MC801A، آيفون 1.1.2):
 *   الراوتر رد كل القراءات خلال ١١ ثانية، والقياس علّق لين مهلة الـ ٦٠ ثانية — اللي علّق هو التحميل (trafficBurst):
 *   الـ abort ما وقّف arrayBuffer اللي بدأ، فالعامل ما يرجع أبداً.
 * الحين: كل طلب ينتهي بانتهاء وقته حتى لو الـ fetch نفسه علّق، والتحميل كله له حد نهائي (المدة + ٣ ث).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const nrprobe = require('../src/utils/nrprobe');

const realFetch = (globalThis as any).fetch;

test('fetch يعلّق ويتجاهل الإلغاء ← التحميل يرجع بالوقت', async () => {
  (globalThis as any).fetch = () => Promise.resolve({ arrayBuffer: () => new Promise(() => {}) });
  try {
    const t0 = Date.now();
    const before = nrprobe.burstStuck;
    const n = await nrprobe.trafficBurst(300, 1_000_000);
    const took = Date.now() - t0;
    assert.equal(n, 0);
    assert.ok(took < 2000, `أخذ ${took}ms`);
    assert.equal(nrprobe.burstStuck, before);
  } finally { (globalThis as any).fetch = realFetch; }
});

test('fetch نفسه ما يرد أبداً ← نفس الشي', async () => {
  (globalThis as any).fetch = () => new Promise(() => {});
  try {
    const t0 = Date.now();
    await nrprobe.trafficBurst(300, 1_000_000);
    assert.ok(Date.now() - t0 < 2000);
  } finally { (globalThis as any).fetch = realFetch; }
});

test('تحميل طبيعي ← نحسب البايتات ونوقف عند السقف', async () => {
  (globalThis as any).fetch = () => new Promise(r => setTimeout(() => r({ arrayBuffer: async () => new ArrayBuffer(1000) }), 10));
  try {
    const n = await nrprobe.trafficBurst(2000, 5000);
    assert.ok(n >= 5000 && n <= 7000, `n=${n}`);
  } finally { (globalThis as any).fetch = realFetch; }
});
