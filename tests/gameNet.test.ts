/**
 * «تعزيز اللعب» — Bufferbloat (ساعة وهمية + بنق محاكى) · NAT/CGNAT · وضع المباراة (حماية جوالك).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pingStats, bloatGrade, runBloat, BloatCancelled, bloatAdvice, ipKind, natVerdict, sameLan,
  pickLanIp, matchTargets, matchExpired, matchLeft,
} from '../src/utils/gameNet';

/* ── Bufferbloat ── */

test('pingStats: الوسيط والفقد', () => {
  const s = pingStats([30, null, 40, 50, null]);
  assert.equal(s.median, 40);
  assert.equal(s.lossPct, 40);
  assert.equal(s.n, 3);
  assert.equal(pingStats([]).lossPct, 100);
});

test('bloatGrade: السلّم + الفقد ينزّل درجة', () => {
  assert.equal(bloatGrade(3), 'A+');
  assert.equal(bloatGrade(20), 'A');
  assert.equal(bloatGrade(45), 'B');
  assert.equal(bloatGrade(150), 'C');
  assert.equal(bloatGrade(300), 'D');
  assert.equal(bloatGrade(800), 'F');
  assert.equal(bloatGrade(20, 25), 'B');
  assert.equal(bloatGrade(800, 50), 'F');
});

function fakeDeps(ms: { idle: number; down: number | null; up: number | null }) {
  let t = 0;
  let phase: 'idle' | 'down' | 'up' = 'idle';
  const loads: string[] = [];
  let stopped = 0;
  return {
    loads, get stopped() { return stopped; },
    deps: {
      now: () => t,
      sleep: async (x: number) => { t += x; },
      ping: async () => { t += 20; return ms[phase]; },
      startLoad: (k: 'down' | 'up') => {
        phase = k; loads.push(k);
        const at = t;
        return { stop: async () => { stopped++; phase = 'idle'; return Math.round(((t - at) / 1000) * 5_000_000); } };
      },
    },
  };
}

test('runBloat: الرفع يرفع البنق ← الدرجة من الأسوأ + السرعة', async () => {
  const f = fakeDeps({ idle: 40, down: 70, up: 340 });
  const r = await runBloat(f.deps, { gapMs: 200 });
  assert.equal(r.idle.median, 40);
  assert.equal(r.down.addedMs, 30);
  assert.equal(r.down.grade, 'B');
  assert.equal(r.up.addedMs, 300);
  assert.equal(r.up.grade, 'D');
  assert.equal(r.grade, 'D');
  assert.equal(r.worst, 'up');
  assert.deepEqual(f.loads, ['down', 'up']);
  assert.equal(f.stopped, 2);
  assert.ok(r.down.mbps > 30 && r.down.mbps < 50, `mbps ${r.down.mbps}`);
  assert.ok(bloatAdvice(r).some(l => l.includes('وضع المباراة')));
});

test('runBloat: كل البنق يضيع تحت الحمل ← F (مو ممتاز)', async () => {
  const f = fakeDeps({ idle: 40, down: null, up: 45 });
  const r = await runBloat(f.deps);
  assert.equal(r.down.grade, 'F');
  assert.equal(r.grade, 'F');
});

test('runBloat: خط ممتاز ← A+ وما ننصح بشي', async () => {
  const f = fakeDeps({ idle: 40, down: 42, up: 43 });
  const r = await runBloat(f.deps);
  assert.equal(r.grade, 'A+');
  assert.equal(bloatAdvice(r).length, 1);
});

test('runBloat: الإلغاء وقت الحمل يوقف التحميل دايماً', async () => {
  const f = fakeDeps({ idle: 40, down: 60, up: 60 });
  let n = 0;
  await assert.rejects(runBloat({ ...f.deps, cancelled: () => ++n > 20 }), (e: any) => e instanceof BloatCancelled);
  assert.equal(f.stopped, f.loads.length);
  assert.ok(f.loads.length >= 1);
});

test('runBloat: السيرفر ما يرد والخط فاضي ← خطأ واضح بدون تحميل', async () => {
  const f = fakeDeps({ idle: null as any, down: 50, up: 50 });
  await assert.rejects(runBloat(f.deps), /ما رد/);
  assert.equal(f.loads.length, 0);
});

/* ── NAT ── */

test('ipKind', () => {
  assert.equal(ipKind('192.168.8.1'), 'private');
  assert.equal(ipKind('10.45.3.2'), 'private');
  assert.equal(ipKind('172.20.0.1'), 'private');
  assert.equal(ipKind('100.70.1.1'), 'cgnat');
  assert.equal(ipKind('100.128.0.1'), 'public');
  assert.equal(ipKind('37.106.1.1'), 'public');
  assert.equal(ipKind('2a02:cb80::1'), 'v6');
  assert.equal(ipKind('999.1.1.1'), 'invalid');
  assert.equal(ipKind(''), 'invalid');
});

test('natVerdict: آي بي الراوتر 100.64/10 ← CGNAT وفتح المنافذ ما يفيد', () => {
  const v = natVerdict({ wan: '100.88.4.2', pub: '37.106.5.9' });
  assert.equal(v.kind, 'cgnat');
  assert.equal(v.portsHelp, false);
});

test('natVerdict: آي بي الراوتر 10.x (شبكات الجوال) ← CGNAT', () => {
  assert.equal(natVerdict({ wan: '10.12.0.7', pub: '37.106.5.9' }).kind, 'cgnat');
});

test('natVerdict: عام بس غير اللي يطلع للإنترنت ← CGNAT', () => {
  assert.equal(natVerdict({ wan: '37.106.1.1', pub: '37.106.5.9' }).kind, 'cgnat');
});

test('natVerdict: نفس الآي بي العام ← NAT مفتوح ممكن + UPnP/DMZ تفيد', () => {
  const v = natVerdict({ wan: '37.106.5.9', pub: '37.106.5.9' });
  assert.equal(v.kind, 'public');
  assert.equal(v.portsHelp, true);
});

test('natVerdict: IPv6 ينذكر · الجوال مو على الواي فاي · ما نعرف', () => {
  assert.equal(natVerdict({ wan: '10.1.1.1', pub: '1.2.3.4', v6: '2a02:cb80::5' }).v6, true);
  assert.equal(natVerdict({ wan: '37.1.1.1', pub: '37.1.1.1', onWifi: false }).kind, 'offwifi');
  assert.equal(natVerdict({ pub: '37.1.1.1' }).kind, 'unknown');
});

/* ── آي بي جوالك ── */

test('sameLan + pickLanIp: ناخذ عنوان الواي فاي مو عنوان الشريحة', () => {
  assert.equal(sameLan('192.168.8.100', '192.168.8.1'), true);
  assert.equal(sameLan('10.20.1.5', 'http://192.168.8.1/'), false);
  const c = [
    'candidate:1 1 udp 2122260223 10.20.1.5 50000 typ host generation 0',
    'a=candidate:2 1 udp 2122194687 192.168.8.104 50001 typ host generation 0',
    'candidate:3 1 udp 1686052607 37.106.5.9 50001 typ srflx raddr 192.168.8.104 rport 50001',
    'candidate:4 1 udp 2122129151 abcd-1234.local 50002 typ host',
  ];
  assert.equal(pickLanIp(c, '192.168.8.1'), '192.168.8.104');
  assert.equal(pickLanIp(c.slice(0, 1), '192.168.8.1'), undefined);
});

/* ── وضع المباراة ── */

const devs = [
  { mac: 'aa-bb-cc-00-00-01', ip: '192.168.8.104', name: 'جوالي' },
  { mac: 'AA:BB:CC:00:00:02', ip: '192.168.8.105', name: 'TV' },
  { mac: 'AA:BB:CC:00:00:03', ip: '192.168.8.106', name: 'آيباد' },
  { mac: 'AA:BB:CC:00:00:04', ip: '192.168.8.107', name: 'قديم', blocked: true },
];
const all = devs.map(d => d.mac);

test('matchTargets: جوالك ما ينوقف أبداً حتى لو اخترته', () => {
  const t = matchTargets(devs, all, '192.168.8.104');
  assert.deepEqual(t.map(d => d.name), ['TV', 'آيباد']);
});

test('matchTargets: ما عرفنا جوالك ← ما نوقف شي', () => {
  assert.equal(matchTargets(devs, all, undefined).length, 0);
});

test('matchTargets: المحظور من قبل ما يدخل (ما نفك حظره بعد المباراة)', () => {
  const t = matchTargets(devs, all, '192.168.8.104', ['aa:bb:cc:00:00:03']);
  assert.deepEqual(t.map(d => d.name), ['TV']);
});

test('matchExpired / matchLeft', () => {
  const s = { routerId: 'r', devices: [], at: 0, until: 90 * 60000 };
  assert.equal(matchExpired(s, 60000), false);
  assert.equal(matchExpired(s, 90 * 60000), true);
  assert.equal(matchExpired(null, 1), false);
  assert.equal(matchLeft(s, 0), 'ساعة و30 دقيقة');
  assert.equal(matchLeft(s, 70 * 60000), '20 دقيقة');
});
