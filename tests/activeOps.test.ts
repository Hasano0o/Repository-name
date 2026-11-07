/**
 * «العملية الحالية» (اقتراح عضو ٧ نوفمبر): العملية تكمّل بالخلفية لما يطلع من الشاشة أو تقفل ←
 * زر يرجّعه لها · نتيجتها تبقى لين يشوفها · وانقطاعها (التطبيق انقفل/تحدّث) ينعرف عند الإقلاع.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActiveOps, pillFor, RESULT_TTL } from '../src/store/activeOpsCore';

const mem = () => { const m = new Map<string, string>(); return { m, store: { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); }, remove: async (k: string) => { m.delete(k); } } }; };

test('شغالة وهو بشاشة ثانية ← «ارجع لها» · بشاشتها ← ما يطلع', () => {
  const { store } = mem();
  const ops = createActiveOps(store);
  ops.setRoute('/combo/r1');
  const end = ops.begin('تجربة التركيبات');
  assert.equal(pillFor(ops, '/combo/r1'), null);
  assert.equal(pillFor(ops, '/')?.kind, 'running');
  assert.equal(pillFor(ops, '/')?.op.route, '/combo/r1');
  end({ ok: true });
  assert.equal(pillFor(ops, '/')?.kind, 'done');
  assert.equal(pillFor(ops, '/combo/r1'), null, 'بشاشتها يشوف النتيجة نفسها');
  ops.markSeen();
  assert.equal(pillFor(ops, '/'), null);
});

test('فشلت ← النص المختصر · النتيجة تنتهي بعد المدة', () => {
  let t = 1000;
  const { store } = mem();
  const ops = createActiveOps(store, () => t);
  ops.setRoute('/towers/r1');
  ops.begin('بحث الأبراج')({ ok: false, msg: 'الراوتر ما رد\n— تأكد' });
  const p = pillFor(ops, '/');
  assert.equal(p?.kind, 'failed');
  assert.equal((p?.op as any).msg, 'الراوتر ما رد — تأكد');
  t += RESULT_TTL + 1;
  assert.equal(pillFor(ops, '/'), null);
});

test('انقطعت: العلامة «شغالة» محفوظة عند الإقلاع (تحديث/قفل) ← «انقطعت — افتحها» حتى بشاشتها', async () => {
  const a = mem();
  const ops1 = createActiveOps(a.store);
  ops1.setRoute('/autopilot/r1');
  ops1.begin('اضبط لي كل شي');
  await new Promise<void>(r => setImmediate(() => r()));
  // تشغيل جديد للتطبيق (نفس التخزين)
  const ops2 = createActiveOps(a.store);
  await ops2.restore();
  const p = pillFor(ops2, '/autopilot/r1');
  assert.equal(p?.kind, 'interrupted');
  assert.equal(p?.op.label, 'اضبط لي كل شي');
  assert.equal(a.m.has('bandly.op.running'), false, 'العلامة انمسحت');
});
