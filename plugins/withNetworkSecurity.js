/**
 * Config plugin لتوليد network_security_config.xml تلقائياً
 * عند prebuild. يسمح بـ HTTP للشبكات المحلية فقط.
 *
 * يُستخدم في app.json تحت plugins:
 *   "./plugins/withNetworkSecurity"
 */
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETWORK_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Bandly: HTTP مسموح على مستوى النظام لأن الراوترات عناوينها متنوعة
  (192.168.0.1 / 192.168.31.1 / 10.0.0.138 ...) وأندرويد ما يدعم نطاقات CIDR هنا.
  الحماية الفعلية: isLanHost() في src/drivers/http.ts يرفض أي عنوان خارج الشبكة المحلية،
  وكل الاتصالات الخارجية (Cloudflare) HTTPS.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withNetworkSecurity(config) {
  // 1) نضيف networkSecurityConfig إلى <application>
  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

  // 2) نكتب الملف الفعلي
  config = withDangerousMod(config, ['android', async (cfg) => {
    const root = cfg.modRequest.platformProjectRoot;
    const dir = path.join(root, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'network_security_config.xml'), NETWORK_CONFIG_XML);
    return cfg;
  }]);

  return config;
}

module.exports = withNetworkSecurity;
