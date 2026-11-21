/** صحة الوصلة: 5G + كشف «الإشارة نظيفة بس البرج يعطيك ترميز منخفض» (من صورة HManager — H112-370) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkHealth, starved, parseDlMcs, parseTxPower, parseUlMcs } from '../src/utils/linkHealth';
import type { Signal } from '../src/drivers/types';

// قراءات الصورة: 4G CQI 15 · MCS 21 · Tx -1 | 5G RSRP -73 · SINR 25 · MCS 3 · Tx 18 · تحميل ~٧ ميقابايت/ث
const sig = {
  rsrp: -66, sinr: 25, rsrq: -4, cqi: 15, dlMcs: 21, txPower: -1, dlStreams: 2,
  nrRsrp: -73, nrSinr: 25, nrRsrq: -10, nrCqi: 15, nrDlMcs: 3, nrTxPower: 18,
} as Signal;

test('starved: يحتاج CQI عالي + MCS منخفض + تحميل فعلي', () => {
  assert.equal(starved(15, 3, 7_000_000), true);
  assert.equal(starved(15, 3, 0), false);        // بدون تحميل: MCS منخفض طبيعي
  assert.equal(starved(8, 3, 7_000_000), false); // الاستقبال نفسه ضعيف — مو زحمة
  assert.equal(starved(15, 21, 7_000_000), false);
  assert.equal(starved(15, 8, 7_000_000), false);  // فرق بسيط — ما نجزم
  assert.equal(starved(11, 3, 7_000_000), false);
  assert.equal(starved(undefined, 3, 7_000_000), false);
});

test('5G: الكفاءة «متوسط» وقت التحميل، والإرسال 18 = يجهد', () => {
  const nr = linkHealth(sig, 'NR', 7_273_361);
  const eff = nr.find(h => h.key === 'efficiency')!;
  assert.equal(eff.level, 'fair');
  assert.match(eff.note, /أقل من المتوقع/);
  assert.ok(!/مزحوم/.test(eff.note)); // ما نجزم بالزحمة من الترميز
  assert.equal(nr.find(h => h.key === 'uplink')!.level, 'fair');
  // بدون تحميل يرجع على CQI
  assert.equal(linkHealth(sig, 'NR').find(h => h.key === 'efficiency')!.level, 'excellent');
});

test('4G ما تأثر، وراوتر بدون 5G ما يطلع له شي', () => {
  const lte = linkHealth(sig, 'LTE', 7_273_361);
  assert.equal(lte.find(h => h.key === 'efficiency')!.level, 'excellent');
  assert.equal(lte.find(h => h.key === 'uplink')!.level, 'excellent');
  assert.deepEqual(linkHealth({ rsrp: -90, sinr: 10, cqi: 12 } as Signal, 'NR'), []);
});

test('صيغ هواوي الخام', () => {
  assert.deepEqual(parseDlMcs('mcsDownCarrier1Code0:3 mcsDownCarrier1Code1:0'), { mcs: 2, streams: 2 });
  assert.equal(parseTxPower('PPusch:18dBm PPucch:15dBm PSrs:0dBm PPrach:0dBm'), 18);
  assert.equal(parseUlMcs('mcsUpCarrier1:25'), 25);
});
