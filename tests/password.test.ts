import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPassword, passwordJunk } from '../src/utils/password';

test('كلمة المرور: مسافة الكيبورد وعلامات الاتجاه تنشال (Soyealink: ١٢ حرف وصل ١٣ ← 108006)', () => {
  assert.equal(cleanPassword('B-2704197900 '), 'B-2704197900');
  assert.equal(cleanPassword('‏CPE@outdoor‎'), 'CPE@outdoor');
  assert.equal(cleanPassword(' LTE@Endusr '), 'LTE@Endusr');
  assert.equal(cleanPassword('ab​cd'), 'abcd');
  assert.equal(passwordJunk('B-2704197900 '), 1);
});

test('كلمة المرور: المسافة داخل الكلمة تبقى، والكلمة النظيفة ما تتغيّر', () => {
  assert.equal(cleanPassword('my pass 1'), 'my pass 1');
  assert.equal(cleanPassword('Admin@123'), 'Admin@123');
  assert.equal(passwordJunk('Admin@123'), 0);
});

test('passwordShape: يكشف الحرف الزايد بدون الكلمة (Soyealink: ١٢ ← ١٣)', async () => {
  const { passwordShape } = await import('../src/utils/password');
  assert.equal(passwordShape('B-2704197900'), 'A-9999999999');
  assert.equal(passwordShape('LTE@Endusr'), 'AAA@Aaaaaa');
  assert.equal(passwordShape('B–2704197900'), 'A<U+2013>9999999999');
  assert.equal(passwordShape('B-270419790 0'), 'A-999999999␠9');
});
