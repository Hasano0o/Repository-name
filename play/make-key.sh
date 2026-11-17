#!/bin/bash
# مفتاح الرفع لقوقل بلاي (مرة وحدة بس). قوقل يوقّع النسخة النهائية بمفتاحه (Play App Signing)،
# فلو ضاع هالمفتاح نطلب من قوقل نغيّره — بس احفظ نسخة منه بعيد عن السيرفر.
set -e
K=/root/bandly-play
mkdir -p $K && chmod 700 $K
if [ -f $K/upload.jks ]; then echo "✓ المفتاح موجود من قبل: $K/upload.jks"; exit 0; fi
KT=$(command -v keytool || ls /usr/lib/jvm/*/bin/keytool 2>/dev/null | head -1)
[ -n "$KT" ] || { echo "✗ ما لقيت keytool (Java)"; exit 1; }
P=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
"$KT" -genkeypair -keystore $K/upload.jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$P" -keypass "$P" -dname "CN=Hassan Alshehri, O=Bandly, L=Sharurah, C=SA" >/dev/null 2>&1
echo "STORE_PASS=$P" > $K/key.env && chmod 600 $K/key.env $K/upload.jks
mkdir -p /root/backups && tar czf /root/backups/bandly-play-key-$(date +%Y%m%d).tgz -C /root bandly-play
"$KT" -list -keystore $K/upload.jks -storepass "$P" | grep -i "fingerprint\|upload" | head -3
echo "✓ المفتاح جاهز: $K/upload.jks — ونسخة في /root/backups/bandly-play-key-$(date +%Y%m%d).tgz"
