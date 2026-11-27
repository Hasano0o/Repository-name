/** بطارية ZTE الجيل الجديد (MU5252 TopFlow) — من صفحة الجهاز (FULL ٩ نوفمبر) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { zteBattery } = require('../src/drivers/zteng/battery');

test('MU5252: البطارية من get_device_info', () => {
  assert.deepEqual(zteBattery({ bat_online: '1', bat_percent: '64', bat_charger_connect: '0', bat_charger_status: '0', bat_temperature: '37' }),
    { percent: 64, plugged: false, charging: false, tempC: 37 });
  assert.deepEqual(zteBattery({ bat_percent: '80', bat_charger_connect: '1', bat_charger_status: '1', bat_temperature: '41' }),
    { percent: 80, plugged: true, charging: true, tempC: 41 });
  // مليانة وعلى الشاحن ← مو «يشحن»
  assert.equal(zteBattery({ bat_percent: '100', bat_charger_connect: '1', bat_charger_status: '1' })!.charging, false);
});

test('راوتر بدون بطارية (MU5250) ← null', () => {
  assert.equal(zteBattery({}), null);
  assert.equal(zteBattery({ bat_online: '0', bat_percent: '0' }), null);
  assert.equal(zteBattery({ bat_percent: '' }), null);
  assert.equal(zteBattery({ bat_percent: '250' }), null);
  assert.equal(zteBattery(null), null);
  assert.equal(zteBattery({ bat_percent: '50', bat_temperature: '' })!.tempC, undefined);
});
