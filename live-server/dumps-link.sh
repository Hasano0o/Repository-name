#!/bin/bash
# يجمع ملفات أعضاء (zip أو مجلدات تقارير) في zip واحد برابط مؤقت — عشان جلسة Claude تاخذها (حسن يحمّلها ويرفقها بالمحادثة).
# الاستخدام:  bash /root/router-manager/mobile/live-server/dumps-link.sh zlt x300        (أو تاريخ اليوم بصيغة الاسم: 1122 = كل ملفات ٢٢ نوفمبر)
#             bash /root/router-manager/mobile/live-server/dumps-link.sh zlt x300        (كلمات من اسم الملف أو محتوى المجلد، بدون حساسية حروف)
#             bash /root/router-manager/mobile/live-server/dumps-link.sh mwqpc8524zk9yg  (اسم ملف/مجلد بالضبط)
# الرابط ينحذف لحاله بعد ساعة، وأي رابط أقدم من ساعة ينحذف كل تشغيل.
set -e
[ $# -gt 0 ] || { echo "اكتب كلمة وحدة على الأقل (مثل: zlt)"; exit 1; }
DL=/var/www/has-host.com/dl
find "$DL" -maxdepth 1 -name 'z-*.zip' -mmin +60 -delete 2>/dev/null || true
T=$(mktemp -d)
for d in /root/bandly-live/data/dumps /root/bandly-archive/dumps; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    n=$(basename "$f")
    for k in "$@"; do
      # الاسم · محتوى المجلد · router.txt داخل الـ zip (اسم الملف ممكن ما فيه الموديل — مثل router-ZLT-FULL-…)
      if echo "$n" | grep -qi -- "$k" || { [ -d "$f" ] && grep -rlqi -- "$k" "$f" 2>/dev/null; } \
         || { [ "${f##*.}" = zip ] && unzip -p "$f" '*_bandly/router.txt' 2>/dev/null | grep -qi -- "$k"; }; then
        if [ -d "$f" ]; then (cd "$d" && zip -qr "$T/$n.zip" "$n"); else cp "$f" "$T/"; fi
        break
      fi
    done
  done
done
# تقارير الدعم (قناة الواي فاي، أخطاء الإضافة…) — آخر ١٤ يوم، بالاسم أو المحتوى
RP=/root/bandly-live/data/reports
if [ -d "$RP" ]; then
  find "$RP" -maxdepth 1 -type f -mtime -14 | while read -r f; do
    n=$(basename "$f")
    for k in "$@"; do
      if echo "$n" | grep -qi -- "$k" || grep -qi -- "$k" "$f" 2>/dev/null; then
        mkdir -p "$T/reports" && cp "$f" "$T/reports/"; break
      fi
    done
  done
fi
c=$(find "$T" -type f | wc -l)
[ "$c" -gt 0 ] || { echo "ما لقيت ملفات تطابق: $*"; rm -rf "$T"; exit 1; }
R=$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')
(cd "$T" && zip -q -0 -r "$DL/z-$R.zip" .)
rm -rf "$T"
nohup bash -c "sleep 3600; rm -f $DL/z-$R.zip" >/dev/null 2>&1 &
echo "✓ $c ملف · $(du -h "$DL/z-$R.zip" | cut -f1) — حمّله وأرفقه بالمحادثة (ينحذف بعد ساعة):"
echo "https://has-host.com/dl/z-$R.zip"
