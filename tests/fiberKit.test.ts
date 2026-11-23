import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePlan, wifiWeak, complaintText, linkScore, roomScore, roomLevel, speedRef, roomsAdvice, upsertRoom, RoomRead } from '../src/utils/fiberKit';

const goodWifi = { median: 3, jitter: 1, lossPct: 0, samples: 10 };
const badWifi = { median: 40, jitter: 20, lossPct: 10, samples: 10 };

test('سرعتك مقابل باقتك: ٨٠٪ وفوق = تمام', () => {
  const r = judgePlan(100, 85, goodWifi);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.pct, 85);
});

test('سرعتك مقابل باقتك: واي فاي ضعيف ← المشكلة من الواي فاي', () => {
  assert.equal(wifiWeak(badWifi), true);
  assert.equal(judgePlan(300, 60, badWifi).verdict, 'wifi');
});

test('سرعتك مقابل باقتك: باقة ٥٠٠+ والجوال يجيب ٣٠٠ ← حد الجوال', () => {
  assert.equal(judgePlan(1000, 350, goodWifi).verdict, 'phone');
});

test('سرعتك مقابل باقتك: واي فاي سليم والسرعة قليلة ← الشركة', () => {
  assert.equal(judgePlan(200, 60, goodWifi).verdict, 'isp');
});

test('سرعتك مقابل باقتك: بدون قياس واي فاي ← ما نعرف', () => {
  assert.equal(judgePlan(200, 60, null).verdict, 'unknown');
  assert.equal(judgePlan(200, 60, { ...goodWifi, samples: 0 }).verdict, 'unknown');
});

test('نص الشكوى فيه الباقة وأحدث القياسات أول', () => {
  const t = complaintText(500, [
    { at: new Date(2026, 10, 20, 21, 5).getTime(), plan: 500, down: 120, up: 40, ping: 9, verdict: 'isp' },
    { at: new Date(2026, 10, 22, 22, 0).getTime(), plan: 500, down: 100, up: 38, ping: 11, verdict: 'isp' },
  ]);
  assert.match(t, /500 ميقا/);
  assert.ok(t.indexOf('2026-11-22') < t.indexOf('2026-11-20'));
  assert.match(t, /20٪ من الباقة/);
});

const room = (name: string, mbps: number, wifiMs: number, jitter = 1, lossPct = 0): RoomRead => ({ name, at: 1, mbps, wifiMs, jitter, lossPct });

test('الغرف: درجة الاتصال تنزل مع البنق والفقد', () => {
  assert.equal(linkScore({ wifiMs: 3, jitter: 0, lossPct: 0 }), 100);
  assert.ok(linkScore({ wifiMs: 30, jitter: 5, lossPct: 0 }) < 60);
  assert.equal(linkScore({ wifiMs: 80, jitter: 30, lossPct: 20 }), 0);
});

test('الغرف: المرجع أفضل غرفة، وغرفة وحدة ← الباقة بحد ٤٠٠', () => {
  assert.equal(speedRef([room('أ', 200, 3), room('ب', 50, 20)]), 200);
  assert.equal(speedRef([room('أ', 200, 3)], 1000), 400);
  assert.equal(speedRef([room('أ', 200, 3)]), 100);
});

test('الغرف: الأقوى ممتاز والبعيدة ضعيفة + نصيحة مقوّي', () => {
  const rooms = [room('الصالة', 300, 3), room('المجلس', 20, 45, 15, 8)];
  const ref = speedRef(rooms);
  assert.equal(roomLevel(roomScore(rooms[0], ref)), 'excellent');
  assert.equal(roomLevel(roomScore(rooms[1], ref)), 'poor');
  const adv = roomsAdvice(rooms);
  assert.ok(adv.some(a => a.includes('ضعيف في: المجلس')));
  assert.ok(adv.some(a => a.includes('مقوّي')));
});

test('الغرف: كل البيت زين', () => {
  assert.deepEqual(roomsAdvice([room('أ', 300, 3), room('ب', 280, 5)]), ['الواي فاي يغطي البيت كله زين 👌']);
});

test('الغرف: قياس جديد لنفس الغرفة يستبدل القديم', () => {
  const r = upsertRoom([room('أ', 10, 50)], room('أ', 200, 3));
  assert.equal(r.length, 1);
  assert.equal(r[0].mbps, 200);
});
