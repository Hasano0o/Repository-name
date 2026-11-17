#!/bin/bash
# بناء نسخة قوقل بلاي (ملف AAB) على الرسيفر — store.bandly.app، قناة preview، موقّع بمفتاح الرفع
# التشغيل: bash play/build-play.sh   (من /root/router-manager/mobile)
set -e
cd /root/router-manager/mobile
K=/root/bandly-play
[ -f $K/upload.jks ] || { echo "✗ ما فيه مفتاح — شغّل: bash play/make-key.sh"; exit 1; }
. $K/key.env
export ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk} ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-/opt/android-sdk}
cat > credentials.json << CRED
{ "android": { "keystore": { "keystorePath": "$K/upload.jks", "keystorePassword": "$STORE_PASS", "keyAlias": "upload", "keyPassword": "$STORE_PASS" } } }
CRED
trap 'rm -f /root/router-manager/mobile/credentials.json' EXIT
EAS=$(command -v eas || echo "npx --yes eas-cli")
rm -f $K/bandly.aab
$EAS build --local --platform android --profile play --non-interactive --output $K/bandly.aab
[ -s $K/bandly.aab ] || { echo "✗ ما طلع الملف"; exit 1; }
# رابط تحميل باسم عشوائي (عشان ترفعه من جوالك في Play Console)
[ -f $K/dlname ] || echo "play-$(head -c 9 /dev/urandom | base64 | tr -dc a-z0-9 | head -c 10).aab" > $K/dlname
cp -f $K/bandly.aab /var/www/has-host.com/dl/$(cat $K/dlname)
echo "✓ AAB جاهز: https://has-host.com/dl/$(cat $K/dlname)"
