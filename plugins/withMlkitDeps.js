/**
 * Config plugin: نطلب من خدمات Google تنزيل نماذج ML Kit وقت التثبيت.
 * expo-camera يعلن «barcode_ui» في مكتبته، وإحنا نحتاج «ocr» (قراءة نص ملصق الراوتر) —
 * إعلانين مختلفين بنفس الاسم يكسرون دمج الـ Manifest، فنكتب القيمة المدموجة في التطبيق
 * مع tools:replace عشان تغلب.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';
const VALUE = 'barcode_ui,ocr';

module.exports = function withMlkitDeps(config) {
  return withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['meta-data'] = (app['meta-data'] || []).filter(m => m.$['android:name'] !== NAME);
    app['meta-data'].push({ $: { 'android:name': NAME, 'android:value': VALUE, 'tools:replace': 'android:value' } });
    return cfg;
  });
};
