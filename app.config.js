// يقرأ app.json كما هو. ولو البناء من بروفايل preview-arm64 (BANDLY_ARM64=1):
// نسخة صغيرة arm64 فقط + ضغط المكتبات الأصلية — عشان تنرسل كملف من بوت تيليجرام (حد البوت 50 ميقا)
// ولو BANDLY_DESKTOP=1: نسخة ويب صفحة واحدة (SPA) تنلف داخل برنامج الويندوز (desktop/)
module.exports = ({ config }) => {
  if (process.env.BANDLY_DESKTOP === '1') {
    config.web = { ...(config.web || {}), output: 'single' };
    return config;
  }
  // الجوال بس — بدونها «eas update --platform all» يحاول يصدّر نسخة ويب ويفشل
  config.platforms = ['ios', 'android'];
  if (process.env.BANDLY_ARM64 !== '1') return config;
  config.plugins = (config.plugins || []).map(p => {
    if (!Array.isArray(p) || p[0] !== 'expo-build-properties') return p;
    const opts = p[1] || {};
    return [p[0], { ...opts, android: { ...(opts.android || {}), buildArchs: ['arm64-v8a'], useLegacyPackaging: true } }];
  });
  return config;
};
