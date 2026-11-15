import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrierOf, cleanCard, cardOk, cardFromLines, rechargeUssd, balanceUssd, rechargeSms, maskCard } from '../src/utils/recharge';

test('اشحن رصيدك: الشركة من اسم الشبكة', () => {
  assert.equal(carrierOf('STC'), 'stc');
  assert.equal(carrierOf('stc KSA'), 'stc');
  assert.equal(carrierOf('Zain SA'), 'zain');
  assert.equal(carrierOf('HAJJ EXPO Zain'), 'zain');
  assert.equal(carrierOf('Mobily'), 'mobily');
  assert.equal(carrierOf('42003'), 'mobily');
  assert.equal(carrierOf('Libyana'), null);
  assert.equal(carrierOf(''), null);
});

test('اشحن رصيدك: الأكواد لكل شركة', () => {
  assert.equal(rechargeUssd('stc', '1234567890123'), '*155*1234567890123#');
  assert.equal(rechargeUssd('zain', '1234567890123'), '*141*1234567890123#');
  assert.equal(rechargeUssd('mobily', '1234567890123'), '*1400*1234567890123#');
  assert.equal(rechargeUssd('mobily', '1234567890123', '1012345678'), '*1400*1234567890123*1012345678#');
  assert.equal(balanceUssd('stc'), '*166#');
  assert.equal(balanceUssd('zain'), '*142#');
  assert.equal(balanceUssd('mobily'), '*1411#');
  assert.deepEqual(rechargeSms('stc', '123'), { to: '1500', text: '155*123#' });
  assert.equal(rechargeSms('zain', '123'), null);
});

test('اشحن رصيدك: تنظيف رقم البطاقة وقراءته من الصورة', () => {
  assert.equal(cleanCard('١٢٣٤ ٥٦٧٨-9012 3456'), '1234567890123456');
  assert.ok(cardOk('1234567890123'));
  assert.ok(!cardOk('12345'));
  assert.equal(cardFromLines(['SAWA 30 SR', 'PIN: 1234 5678 9012 34', 'Serial 99887766']), '12345678901234');
  assert.equal(cardFromLines(['no digits']), null);
  assert.equal(maskCard('1234567890123456'), '••••••••3456');
});
