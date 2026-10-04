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
# رقم نسخة جديد لكل بناء (البرامج المثبتة تقارنه وتعرض «فيه تحديث»)
BASEV=$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")
VERSION="$BASEV.$(date +%y%m%d%H%M)"
echo "   النسخة: $VERSION"
npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version="$VERSION" >/tmp/bandly-desktop-build.log 2>&1 \
  || { grep -E "⨯|Error" /tmp/bandly-desktop-build.log | tail -20; echo "✗ فشل البناء"; exit 1; }

echo "▸ 4/4 رفع الملف للتحميل"
mkdir -p "$DEST"
cp -f out/Bandly-Setup.exe "$DEST/Bandly-Setup.exe.tmp" && mv -f "$DEST/Bandly-Setup.exe.tmp" "$DEST/Bandly-Setup.exe"
# ملف التحديث — ينكتب بعد الملف عشان ما يأشّر على ملف ناقص
NOTES=${BANDLY_NOTES:-$(git -C "$ROOT" log -1 --format=%s 2>/dev/null)}
VERSION="$VERSION" NOTES="$NOTES" FILE="$DEST/Bandly-Setup.exe" node -e '
const fs=require("fs"),c=require("crypto");const f=process.env.FILE;const b=fs.readFileSync(f);
fs.writeFileSync(f.replace(/Bandly-Setup\.exe$/,"bandly-desktop.json.tmp"),JSON.stringify({
  version:process.env.VERSION,url:"https://has-host.com/dl/Bandly-Setup.exe?v="+process.env.VERSION,
  sha256:c.createHash("sha256").update(b).digest("hex"),size:b.length,notes:process.env.NOTES||"",
  date:new Date().toISOString()},null,1));'
mv -f "$DEST/bandly-desktop.json.tmp" "$DEST/bandly-desktop.json"
SIZE=$(du -h "$DEST/Bandly-Setup.exe" | cut -f1)
echo "✓ جاهز ($SIZE) — نسخة $VERSION: https://has-host.com/dl/Bandly-Setup.exe"
