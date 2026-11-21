/** اختبارات «وضع الشبكة» الدقيق في هواوي — مطابقة لكود صفحة الراوتر وطلبها الفعلي */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standardOf, standardBody, standardFullBody, NET_STANDARDS } from '../src/drivers/huawei/netStandard';

const resp = (mode: string, opt?: string, lteOpt = '0') =>
  `<response><NetworkMode>${mode}</NetworkMode><NetworkBand>0</NetworkBand><LTEBand>7E28A0E00D5</LTEBand>` +
  (opt === undefined ? '' : `<networkOption>${opt}</networkOption>`) + `<LTEBandOption>${lteOpt}</LTEBandOption></response>`;

test('الطلب الفعلي لصفحة الراوتر (NSA) يطابق اللي نبنيه', () => {
  assert.equal(standardBody('nsa'), '<NetworkMode>00</NetworkMode><networkOption>0</networkOption>');
});

test('قراءة الوضع من رد الراوتر', () => {
  assert.equal(standardOf(resp('00', '0')), 'nsa');
  assert.equal(standardOf(resp('00', '1')), 'sa');
  assert.equal(standardOf(resp('00', '2')), 'sa_nsa');
  assert.equal(standardOf(resp('03', '0', '0')), 'lte');
  assert.equal(standardOf(resp('03', '0', '1')), 'lte_fdd');
  assert.equal(standardOf(resp('03', '0', '2')), 'lte_tdd');
});

test('فيرموير بدون networkOption = غير مدعوم (null)، ووضع غريب = null', () => {
  assert.equal(standardOf(resp('00')), null);
  assert.equal(standardOf(resp('0803', '0')), null);
});

test('كل خيار: نكتبه ونقراه يرجع نفسه', () => {
  for (const s of NET_STANDARDS) {
    const b = standardBody(s);
    const mode = b.match(/<NetworkMode>(\d+)/)![1];
    const opt = b.match(/<networkOption>(\d)/)?.[1] ?? '0';
    const lte = b.match(/<LTEBandOption>(\d)/)?.[1] ?? '0';
    assert.equal(standardOf(resp(mode, opt, lte)), s);
  }
});

test('H155 (يرفض الحقلين بـ -1): الطلب الكامل يغيّر حقول الوضع بس ويخلي الترددات', () => {
  const fields: [string, string][] = [['NetworkMode', '03'], ['NetworkBand', '3FFFFFFF'], ['LTEBand', '7E28A0E00D5'], ['networkOption', '2'], ['LTEBandOption', '1'], ['NRBand', 'ABC']];
  const b = standardFullBody('nsa', fields);
  assert.equal(b, '<NetworkMode>00</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7E28A0E00D5</LTEBand><networkOption>0</networkOption><LTEBandOption>0</LTEBandOption><NRBand>ABC</NRBand>');
  for (const s of NET_STANDARDS) {
    const full = standardFullBody(s, fields);
    assert.equal(standardOf(`<response>${full}</response>`), s, s);
  }
  // 4G TDD: networkOption ما ينلمس
  assert.match(standardFullBody('lte_tdd', fields), /<networkOption>2<\/networkOption><LTEBandOption>2<\/LTEBandOption>/);
});
