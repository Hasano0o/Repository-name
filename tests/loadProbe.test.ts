import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrierMbps, expectedMbps, judgeProbe } from '../src/utils/loadProbe';

test('carrierMbps: إشارة نظيفة أعلى بكثير من المشوشة، و TDD أقل', () => {
  const clean = carrierMbps(20, 20, false);
  const noisy = carrierMbps(20, 2, false);
  assert.ok(clean > 150 && clean <= 200, String(clean));
  assert.ok(noisy > 10 && noisy < 30, String(noisy));
  assert.ok(carrierMbps(20, 20, true) < clean);
  assert.equal(carrierMbps(20, undefined, false), 0);
});

test('expectedMbps: من النواقل، وبدونها من الخلية الأساسية + 5G', () => {
  const sig = { sinr: 2, band: 'B3', dlBandwidth: '20MHz', nrSinr: 11, nrRsrp: -88, nrBand: 'n40' } as any;
  const noCa = expectedMbps(sig)!;
  assert.ok(noCa > 50, String(noCa));
  const ca = expectedMbps(sig, [{ tech: 'LTE', band: 3, role: 'PCC', bandwidth: 20 }] as any)!;
  assert.ok(ca < noCa);
  assert.equal(expectedMbps({} as any), undefined);
});

test('judgeProbe: المستويات', () => {
  assert.equal(judgeProbe(80, 100)!.level, 'free');
  assert.equal(judgeProbe(45, 100)!.level, 'normal');
  assert.equal(judgeProbe(20, 100)!.level, 'busy');
  assert.equal(judgeProbe(5, 100)!.level, 'packed');
  assert.equal(judgeProbe(3, 4)!.level, 'weak');
  assert.equal(judgeProbe(10, undefined), undefined);
  assert.equal(judgeProbe(200, 100)!.load, 0);
});
