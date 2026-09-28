#!/usr/bin/env bash
# تثبيت/تحديث مركز Bandly: التطبيق المصغر + نماذج الطلبات + أزرار البوت الجديدة. آمن للتكرار.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOT_DIR=/root/netguide
LIVE=/root/bandly-live
WEB=/var/www/has-host.com/bandly-app
ok(){ echo "  ✓ $*"; }
die(){ echo "  ✗ $*"; exit 1; }

echo "🛰️  خدمة Bandly Live (فيها نماذج الطلبات)..."
bash "$REPO/live-server/install.sh" >/tmp/bandly-live-install.log 2>&1 || { tail -20 /tmp/bandly-live-install.log; die "تثبيت الخدمة فشل"; }
ok "الخدمة محدّثة"

echo "🔑 التوكن والسر والمالك..."
python3 - "$BOT_DIR" "$LIVE" << 'PY'
import re, sys, os, glob, json, secrets
bot_dir, live = sys.argv[1], sys.argv[2]
tok = None
for f in [os.path.join(bot_dir, x) for x in (".env", "config.py", "bot.py")] + glob.glob(bot_dir + "/*.py"):
    if os.path.isfile(f):
        m = re.search(r"\b(\d{8,11}:[A-Za-z0-9_-]{35})\b", open(f, encoding="utf-8", errors="ignore").read())
        if m: tok = m.group(1); break
if not tok: sys.exit("✗ ما لقيت توكن البوت")
d = os.path.join(live, "data"); os.makedirs(d, exist_ok=True)
def w(name, val):
    p = os.path.join(d, name); open(p, "w").write(val); os.chmod(p, 0o600)
w("bot_token", tok)
if not os.path.exists(os.path.join(d, "hub_secret")): w("hub_secret", secrets.token_hex(24))
src = open(os.path.join(bot_dir, "bot.py"), encoding="utf-8").read()
m = re.search(r"OWNER_ID\s*=\s*(\d+)", src)
cfg_p = os.path.join(d, "config.json")
cfg = json.load(open(cfg_p)) if os.path.exists(cfg_p) else {}
if m: cfg["owner_id"] = int(m.group(1))
json.dump(cfg, open(cfg_p, "w"), ensure_ascii=False, indent=1)
print("  ✓ جاهز (المالك:", cfg.get("owner_id"), ")")
PY
systemctl restart bandly-live && sleep 2 && systemctl is-active -q bandly-live && ok "أعدنا تشغيل الخدمة"

echo "📱 التطبيق المصغر..."
mkdir -p "$WEB" /var/www/has-host.com/netguide-images/hub
cp "$REPO/miniapp/index.html" "$WEB/index.html"
ok "https://has-host.com/bandly-app/"

echo "🤖 أزرار البوت..."
BK="$BOT_DIR/bot.py.bak-hub-$(date +%s)"
cp "$BOT_DIR/bot.py" "$BK"
cp "$REPO/miniapp/netguide_hub.py" "$BOT_DIR/hub.py"
python3 - "$BOT_DIR" << 'PY'
import re, sys
d = sys.argv[1]
p = f"{d}/bot.py"; s = open(p, encoding="utf-8").read()
# مسار إنشاء إعلان من كود البوت نفسه
m = re.search(r"""api_post\(\s*f?["']([^"'{]*stores[^"'{]*)["']""", s)
hub = open(f"{d}/hub.py", encoding="utf-8").read()
hub = re.sub(r'^STORE_PATH = ".*?"', f'STORE_PATH = "{m.group(1) if m else ""}"', hub, flags=re.M)
open(f"{d}/hub.py", "w", encoding="utf-8").write(hub)
print("  ✓ مسار الإعلانات:", m.group(1) if m else "غير موجود (القبول يرسل لك التفاصيل تضيفها يدوي)")
if "import hub" not in s:
    s = s.replace("from telebot import types", "from telebot import types\nimport hub", 1)
# /start لغير المالك → الواجهة الجديدة
start = re.search(r"def start\(msg\):\s*\n(\s*)if not is_owner\(msg\):\s*\n\s*bot\.reply_to\([^\n]*\)\s*\n\s*return", s)
if start:
    ind = start.group(1)
    s = s[:start.start()] + f"def start(msg):\n{ind}if not is_owner(msg):\n{ind}    hub.public_start(bot, msg)\n{ind}    return" + s[start.end():]
elif "hub.public_start" not in s:
    sys.exit("✗ ما لقيت شرط المالك داخل start()")
# تسجيل معالجات hub قبل التشغيل
if "hub.register(" not in s:
    m2 = re.search(r"^(\s*)(bot\.(infinity_polling|polling)\()", s, flags=re.M)
    if not m2: sys.exit("✗ ما لقيت سطر تشغيل البوت")
    s = s[:m2.start()] + f"{m2.group(1)}hub.register(bot, is_owner=is_owner, api_post=api_post)\n" + s[m2.start():]
open(p, "w", encoding="utf-8").write(s)
print("  ✓ عدّلنا bot.py")
PY
if ! "$BOT_DIR/venv/bin/python" -m py_compile "$BOT_DIR/bot.py" "$BOT_DIR/hub.py" 2>/tmp/hub-compile.log; then
  cp "$BK" "$BOT_DIR/bot.py"; cat /tmp/hub-compile.log; die "خطأ بالكود — رجّعنا bot.py الأصلي"
fi
systemctl restart netguide; sleep 5
if ! systemctl is-active -q netguide; then
  cp "$BK" "$BOT_DIR/bot.py"; systemctl restart netguide
  journalctl -u netguide -n 15 --no-pager; die "البوت ما اشتغل — رجّعنا النسخة الأصلية"
fi
ok "البوت شغال (نسخة احتياطية: $BK)"

echo "📝 وصف البوت وزر القائمة..."
python3 - "$LIVE" << 'PY'
import json, sys, urllib.request, urllib.parse
tok = open(f"{sys.argv[1]}/data/bot_token").read().strip()
def api(m, **p):
    data = urllib.parse.urlencode({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in p.items()}).encode()
    return json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/{m}", data=data, timeout=15))
r1 = api("setMyDescription", description=
  "📶 Bandly — اطلع أقوى إشارة من راوترك\n\n"
  "🎯 وجّه الهوائي بالصوت والاهتزاز\n📊 كل أرقام 4G و 5G قدامك\n🗼 ثبّت أفضل برج وتردد\n📞 مكالمة مع فني يشوف إشارتك حيّة\n\n"
  "اضغط «ابدأ» وحمّل التطبيق 👇")
r2 = api("setMyShortDescription", short_description="اطلع أقوى إشارة من راوترك — وجّه الهوائي وثبّت أفضل برج 📶")
r3 = api("setChatMenuButton", menu_button={"type": "web_app", "text": "📱 Bandly", "web_app": {"url": "https://has-host.com/bandly-app/"}})
r4 = api("setMyCommands", commands=[{"command": "start", "description": "القائمة الرئيسية"}])
print("  ✓ الوصف" if r1.get("ok") and r2.get("ok") else f"  ✗ الوصف {r1} {r2}")
print("  ✓ زر القائمة" if r3.get("ok") else f"  ✗ زر القائمة {r3}")
PY

echo
echo "════════════════════════════════════════"
echo "✅ جاهز — افتح @NetGuide1_bot وأرسل /start"
echo "   (أنت تشوف لوحة التحكم، و /user يوريك واجهة المستخدمين)"
echo "════════════════════════════════════════"
