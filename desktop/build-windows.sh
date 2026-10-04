#!/bin/bash
# يبني نسخة الويندوز من Bandly (Bandly-Setup.exe) على السيرفر وينزّلها في رابط التحميل.
# الاستخدام:  bash desktop/build-windows.sh
# يشتغل بأولوية منخفضة عشان ما يبطّئ البوتات.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEST=${DEST:-/var/www/has-host.com/dl}

renice -n 19 -p $$ >/dev/null 2>&1 || true

echo "▸ 1/4 أدوات الويندوز (wine)"
if ! command -v wine >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  dpkg --add-architecture i386
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends wine wine32:i386 wine64 >/dev/null
fi

echo "▸ 2/4 نسخة الويب من التطبيق"
[ -d node_modules ] || npm ci --no-audit --no-fund
rm -rf desktop/web
BANDLY_DESKTOP=1 npx expo export --platform web --output-dir desktop/web >/tmp/bandly-desktop-export.log 2>&1 \
  || { tail -30 /tmp/bandly-desktop-export.log; echo "✗ فشل تجميع الواجهة"; exit 1; }

echo "▸ 3/4 برنامج الويندوز"
cd "$ROOT/desktop"
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null
rm -rf out
npm run dist >/tmp/bandly-desktop-build.log 2>&1 \
  || { grep -E "⨯|Error" /tmp/bandly-desktop-build.log | tail -20; echo "✗ فشل البناء"; exit 1; }

echo "▸ 4/4 رفع الملف للتحميل"
mkdir -p "$DEST"
cp -f out/Bandly-Setup.exe "$DEST/Bandly-Setup.exe"
SIZE=$(du -h "$DEST/Bandly-Setup.exe" | cut -f1)
echo "✓ جاهز ($SIZE): https://has-host.com/dl/Bandly-Setup.exe"
