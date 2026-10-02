// يقرأ app.json كما هو. ولو البناء من بروفايل preview-arm64 (BANDLY_ARM64=1):
// نسخة صغيرة arm64 فقط + ضغط المكتبات الأصلية — عشان تنرسل كملف من بوت تيليجرام (حد البوت 50 ميقا)
module.exports = ({ config }) => {
  if (process.env.BANDLY_ARM64 !== '1') return config;
  config.plugins = (config.plugins || []).map(p => {
    if (!Array.isArray(p) || p[0] !== 'expo-build-properties') return p;
    const opts = p[1] || {};
    return [p[0], { ...opts, android: { ...(opts.android || {}), buildArchs: ['arm64-v8a'], useLegacyPackaging: true } }];
  });
  return config;
};
