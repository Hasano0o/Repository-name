import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRouterIdentity } from '../src/store/routerIdentityCore';

test('ينظف المسافات حول معلومات هوية الراوتر', () => {
  assert.deepEqual(
    cleanRouterIdentity({
      manufacturer: ' Huawei ',
      model: ' H158-381 ',
      softwareVersion: ' 4.0.0.5 ',
    }),
    {
      manufacturer: 'Huawei',
      model: 'H158-381',
      softwareVersion: '4.0.0.5',
    },
  );
});

test('يتجاهل القيم الفارغة والمسافات فقط', () => {
  assert.deepEqual(
    cleanRouterIdentity({
      manufacturer: '  ',
      model: '',
      softwareVersion: '  ',
      hardwareVersion: ' HW1 ',
    }),
    { hardwareVersion: 'HW1' },
  );
});

test('لا يضيف حقولًا غير معروفة إلى الهوية', () => {
  assert.deepEqual(
    cleanRouterIdentity({ model: ' ZTE ' }),
    { model: 'ZTE' },
  );
});

test('لا يغيّر كائن الإدخال الأصلي', () => {
  const input = { model: ' Huawei ' };
  cleanRouterIdentity(input);
  assert.deepEqual(input, { model: ' Huawei ' });
});