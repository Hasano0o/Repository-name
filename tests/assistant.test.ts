import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchIntent, normalize, effectiveMode, parseState, pauseFor, extractName, cleanName, ACTIONS, QUICK,
} from '../src/assistant/core';

const act = (s: string) => matchIntent(s)?.action ?? null;

test('توحيد الكتابة: همزات وتاء مربوطة وتشكيل', () => {
  assert.equal(normalize('إشارةٌ  قويّة!'), 'اشاره قويه');
  assert.equal(normalize('أعِدْ تـشـغيل'), 'اعد تشغيل');
  assert.equal(normalize('٥ دقايق'), '5 دقايق');
});

test('فهم الطلبات الأساسية', () => {
  assert.equal(act('افحص إشارتي'), 'check_signal');
  assert.equal(act('أبي أقل بنق ممكن'), 'open_ping');
  assert.equal(act('عندي لاق في ببجي'), 'open_ping');
  assert.equal(act('كم البنق عندي؟'), 'ping_now');
  assert.equal(act('أعد تشغيل الراوتر'), 'reboot');
  assert.equal(act('ريستارت'), 'reboot');
  assert.equal(act('وين أوجّه الأنتنا'), 'open_aim');
  assert.equal(act('اختبار السرعة'), 'open_speed');
  assert.equal(act('مين متصل على الشبكة'), 'open_devices');
  assert.equal(act('أبي أغيّر اسم الواي فاي'), 'open_control');
  assert.equal(act('وش تقدر تسوي'), 'help');
  assert.equal(act('اختار لي أفضل تردد'), 'best_band');
  assert.equal(act('أفضل برج'), 'best_tower');
  assert.equal(act('ابي اقوى برج حولي'), 'best_tower');
  assert.equal(act('الترددات'), 'open_bands');
  assert.equal(ACTIONS.best_band.auto, true);
});

test('الأوامر الخطرة ما تختلط بالعادية', () => {
  assert.equal(act('سو ضبط المصنع'), 'factory_reset');
  assert.equal(act('اطفي الراوتر'), 'power_off');
  // «أعد تشغيل» أطول من أي كلمة ثانية ← إعادة تشغيل، مو ضبط مصنع
  assert.equal(act('اعادة تشغيل الراوتر بس'), 'reboot');
  assert.equal(act('أعد تشغيل الراوتر'), 'reboot');
  assert.equal(act('شغّل الراوتر'), 'power_on');
  assert.equal(act('طفّي الراوتر'), 'power_off');
  // reboot_now داخلي — ما ينطلب بالكلام أبداً (لازم يمر على التأكيد)
  assert.ok(act('إيه، أعد التشغيل') !== 'reboot_now');
  assert.equal(ACTIONS.factory_reset.risk, 'danger');
  assert.equal(ACTIONS.reboot.risk, 'write');
  // ولا إجراء خطر في أزرار البداية
  assert.ok(QUICK.every(id => ACTIONS[id].risk !== 'danger'));
});

test('كلام ما نفهمه ← null (نسأل بدل ما نخمّن)', () => {
  assert.equal(act('السلام عليكم'), null);
  assert.equal(act('؟'), null);
  assert.equal(act(''), null);
});

test('الإيقاف المؤقت ينتهي لحاله، والكامل ما ينتهي أبداً', () => {
  const now = 1_000_000;
  const p = pauseFor(15, now);
  assert.equal(effectiveMode(p, now + 60_000), 'paused');
  assert.equal(effectiveMode(p, now + 15 * 60_000), 'enabled');
  assert.equal(effectiveMode(pauseFor(null, now), now + 10 ** 12), 'paused');
  assert.equal(effectiveMode({ mode: 'disabled', pausedUntil: null }, now + 10 ** 12), 'disabled');
});

test('الحالة المحفوظة: الإيقاف الكامل يبقى بعد إعادة فتح التطبيق', () => {
  const saved = JSON.stringify({ mode: 'disabled', pausedUntil: null });
  assert.deepEqual(parseState(saved), { mode: 'disabled', pausedUntil: null });
  assert.equal(parseState(null).mode, 'enabled');
  assert.equal(parseState('{"mode":"weird"}').mode, 'enabled');
  // ملف تالف فيه disabled ← نحترمه وما نشغّل المساعد
  assert.equal(parseState('{"mode":"disabled"').mode, 'disabled');
});

test('الاسم', () => {
  assert.equal(extractName('اسمي حسن'), 'حسن');
  assert.equal(extractName('أنا أبو محمد'), 'أبو محمد');
  assert.equal(extractName('افحص إشارتي'), null);
  assert.equal(cleanName('<b>x</b>'), 'bxb');
  assert.equal(cleanName('1'), null);
});
