/** ZTE TopFlow MU5252 — مركز التحكم من صفحة الجهاز (FULL ٩ نوفمبر): power_supply.js · system_setting.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const T = require('../src/drivers/zteng/topflow');

test('الكهرباء المباشرة: direct_power_mode_get', () => {
  assert.equal(T.parseDirectPower({ enable: '1' }), true);
  assert.equal(T.parseDirectPower({ enable: '0' }), false);
  assert.equal(T.parseDirectPower({}), undefined);
  assert.equal(T.parseDirectPower(null), undefined);
});

test('إعادة التشغيل المجدولة: القراءة والعرض وجسم الصفحة (نبدّل التشغيل بس)', () => {
  const r = T.parseRebootSchedule({ reboot_schedule_enable: '0', reboot_schedule_mode: '2', reboot_hour1: '3', reboot_min1: '0', reboot_hour2: '4', reboot_min2: '30', reboot_timeframe_hours1: '0', reboot_timeframe_hours2: '0', reboot_dow: '1', reboot_dod: '1' });
  assert.ok(T.rebootReady(r));
  assert.deepEqual(T.rebootView(r), { on: false, everyDays: 1, from: 270, to: 270 });
  const b = T.rebootBody(r, true);
  assert.equal(b.reboot_schedule_enable, '1');
  assert.equal(b.reboot_schedule_mode, '2');
  assert.equal(b.reboot_hour2, '4'); assert.equal(b.reboot_min2, '30'); assert.equal(b.reboot_dod, '1');
  assert.equal(Object.keys(b).length, 10);
  const w = T.parseRebootSchedule({ reboot_schedule_enable: '1', reboot_schedule_mode: '1', reboot_hour1: '2', reboot_min1: '15', reboot_dow: '5' });
  assert.deepEqual(T.rebootView(w), { on: true, everyDays: 7, from: 135, to: 135 });
  // ما انضبط قبل ← ما نخترع وقت
  assert.equal(T.rebootReady(T.parseRebootSchedule({ reboot_schedule_enable: '0', reboot_schedule_mode: '' })), false);
  assert.equal(T.parseRebootSchedule({}), null);
});

test('مراقبة الاتصال: الإطفاء {enable:0} بس · التشغيل بالرابط والمرات كما هي', () => {
  const w = T.parseWatchdog({ enable: '0', url: 'www.google.com', url2: '', ping_times: '3', time_gap: '60' });
  assert.equal(w.on, false);
  assert.ok(T.watchdogReady(w));
  assert.deepEqual(T.watchdogBody(w, false), { enable: 0 });
  assert.deepEqual(T.watchdogBody(w, true), { enable: 1, url: 'www.google.com', url2: '', ping_times: 3, time_gap: 60 });
  assert.equal(T.watchdogReady(T.parseWatchdog({ enable: '0', url: '' })), false);
  assert.equal(T.parseWatchdog({}), null);
});
