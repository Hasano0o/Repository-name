#!/bin/bash
# بناء نسخة الويندوز تلقائياً لما يتغيّر التطبيق (٢٧ نوفمبر).
# السبب: «bandly-update.sh» يحدّث الجوالات بس — برنامج الويندوز واجهته داخل المثبّت، فما يتحدّث إلا ببناء جديد.
# كل نص ساعة (cron): يسحب main، ولو فيه تغيير في التطبيق من آخر بناء ويندوز ← يبني (build-windows.sh)
# والبرامج المثبتة تشوف «حدّث الحين» من نفسها.
#
#   التركيب مرة وحدة:   bash desktop/auto-build.sh --install   (يضيف cron ويبدأ بناء الحين بالخلفية)
#   الإيقاف:            bash desktop/auto-build.sh --uninstall
#   الحالة:             bash desktop/auto-build.sh --status
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
LAST=${BANDLY_DESKTOP_LAST:-/root/bandly-desktop.last}
LOG=${BANDLY_DESKTOP_LOG:-/root/bandly-win.log}
LOCK=/tmp/bandly-desktop-auto.lock
BUILD=${BANDLY_DESKTOP_BUILD:-"bash $ROOT/desktop/build-windows.sh"}
# الملفات اللي تغيّر شكل/ميزات البرنامج
WATCH=(app src desktop assets app.config.js app.json package.json package-lock.json)
TAG='# bandly-desktop-auto'

case "${1:-}" in
  --install)
    ( crontab -l 2>/dev/null | grep -v "$TAG"; echo "*/30 * * * * bash $ROOT/desktop/auto-build.sh >/dev/null 2>&1 $TAG" ) | crontab -
    echo "✓ البناء التلقائي للويندوز شغال (كل نص ساعة)"
    rm -f "$LAST" "$LAST.fail"   # أول مرة نبني على طول
    nohup bash "$ROOT/desktop/auto-build.sh" >/dev/null 2>&1 &
    echo "✓ بدأ بناء الحين بالخلفية (~١٠–٢٠ دقيقة). المتابعة: bash $ROOT/desktop/auto-build.sh --status"
    exit 0 ;;
  --uninstall)
    crontab -l 2>/dev/null | grep -v "$TAG" | crontab -
    echo "✓ وقّفنا البناء التلقائي"; exit 0 ;;
  --status)
    crontab -l 2>/dev/null | grep -q "$TAG" && echo "التلقائي: شغال" || echo "التلقائي: موقف"
    echo "آخر بناء من: $(cat "$LAST" 2>/dev/null | cut -c1-9 || echo '—')  ·  المستودع: $(git rev-parse --short HEAD)"
    pgrep -f build-windows.sh >/dev/null && echo "⏳ فيه بناء شغال الحين"
    tail -3 "$LOG" 2>/dev/null
    exit 0 ;;
esac

# بناء واحد بس في نفس الوقت
exec 9>"$LOCK"
flock -n 9 || exit 0
# بناء الأندرويد شغال ← لا نلمس الملفات تحته، نجرّب الدورة الجاية
pgrep -f build-bandly.sh >/dev/null && exit 0

git fetch -q origin main 2>/dev/null || exit 0
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git checkout -- package-lock.json 2>/dev/null
  git pull -q --ff-only origin main || { echo "$(date '+%d/%m %H:%M') ✗ ما قدرنا نسحب (تعديلات محلية؟)" >> "$LOG"; exit 1; }
fi
HEAD=$(git rev-parse HEAD)
PREV=$(cat "$LAST" 2>/dev/null || true)
[ "$HEAD" = "$PREV" ] && exit 0
# نفس النسخة فشلت قبل ← ما نعيد كل نص ساعة (ننتظر commit جديد)
[ "$HEAD" = "$(cat "$LAST.fail" 2>/dev/null)" ] && exit 0
# ما تغيّر شي يخص البرنامج (سيرفر/وثائق بس) ← نسجّل ونطلع
if [ -n "$PREV" ] && git cat-file -e "$PREV" 2>/dev/null && [ -z "$(git diff --name-only "$PREV" "$HEAD" -- "${WATCH[@]}")" ]; then
  echo "$HEAD" > "$LAST"; exit 0
fi
# ملاحظات التحديث = عناوين الـ commits من آخر بناء (آخر ٣)
if [ -n "$PREV" ] && git cat-file -e "$PREV" 2>/dev/null; then
  NOTES=$(git log --format='• %s' -3 "$PREV..$HEAD" -- "${WATCH[@]}" | cut -c1-160)
else
  NOTES=$(git log -1 --format='• %s' | cut -c1-160)
fi
echo "$(date '+%d/%m %H:%M') ▸ بناء تلقائي من $(git rev-parse --short HEAD)" > "$LOG"
if BANDLY_NOTES="$NOTES" $BUILD >> "$LOG" 2>&1; then
  echo "$HEAD" > "$LAST"
else
  echo "$HEAD" > "$LAST.fail"
  echo "$(date '+%d/%m %H:%M') ✗ فشل البناء — نجرّب مع التعديل الجاي" >> "$LOG"
  exit 1
fi
