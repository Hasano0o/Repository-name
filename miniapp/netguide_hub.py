"""
hub.py — واجهة المستخدمين في بوت Bandly (@NetGuide1_bot) + قرارات الطلبات للمالك.
يُستدعى من bot.py:
    import hub
    ... داخل start():  if not is_owner(msg): hub.public_start(bot, msg); return
    ... قبل التشغيل:   hub.register(bot, is_owner=is_owner, api_post=api_post)
"""
import json
import os
import re
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from telebot import types

APP = "https://has-host.com/bandly-app/"
DEV = "https://t.me/hasa_n20"
LIVE_DIR = "/root/bandly-live"
STORE_PATH = ""   # يعبّيه سكربت التثبيت تلقائياً من bot.py (مسار إنشاء إعلان)

WELCOME = (
    "📶 <b>Bandly — اطلع أقوى إشارة من راوترك</b>\n\n"
    "وجّه الهوائي، ثبّت أفضل برج، وكلّم فني يشوفك بالكاميرا ويساعدك عن بُعد 📹👇"
)


def _port() -> int:
    try:
        txt = open("/etc/systemd/system/bandly-live.service", encoding="utf-8").read()
        m = re.search(r"--port (\d+)", txt)
        return int(m.group(1)) if m else 8098
    except Exception:
        return 8098


def _secret() -> str:
    try:
        return open(os.path.join(LIVE_DIR, "data", "hub_secret"), encoding="utf-8").read().strip()
    except Exception:
        return ""


def _api(method: str, path: str, body: dict | None = None) -> dict:
    url = f"http://127.0.0.1:{_port()}/live-api/hub/{path}"
    data = json.dumps(body or {}).encode() if method == "POST" else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"x-hub-secret": _secret(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


APK = "https://has-host.com/dl/bandly.apk"
USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")
BROADCAST_EVERY = 3 * 86400          # كل ٣ أيام
BROADCAST_HOURS = range(18, 22)      # بين ٦ و ١٠ مساءً بتوقيت الرياض
RIYADH = timezone(timedelta(hours=3))

PROMO = (
    "📶 <b>Bandly</b> — لقّط أقوى إشارة لراوترك\n\n"
    "التطبيق متوفر الحين لأجهزة <b>أندرويد</b> كملف APK مباشر من الزر تحت 👇\n"
    "🍎 وقريباً على <b>App Store</b> و ▶️ <b>Google Play</b>\n\n"
    "⚠️ لو طلع لك تحذير وقت التثبيت، اضغط <b>«التثبيت على أي حال»</b> — لأن التطبيق من برا المتجر."
)

# ═══ قائمة المستخدمين (البوت ما كان يحفظهم) — تنبني من الحين ═══
_ulock = threading.Lock()


def _users() -> dict:
    try:
        with open(USERS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"users": {}, "last_broadcast": 0}


def _save_users(d: dict) -> None:
    tmp = USERS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, USERS_FILE)


def remember(user) -> None:
    """نحفظ أي مستخدم يكلّم البوت (خاص فقط)."""
    if not user or getattr(user, "is_bot", False):
        return
    uid = str(user.id)
    with _ulock:
        d = _users()
        u = d["users"].get(uid)
        if u and u.get("active", True):
            return
        d["users"][uid] = {"since": int(time.time()), "name": (user.first_name or "")[:40], "active": True}
        _save_users(d)


def promo_kb() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup()
    kb.row(types.InlineKeyboardButton("📥 تحميل التطبيق (أندرويد)", url=APK))
    return kb


def broadcast(bot, owner_id: int = 0) -> tuple[int, int]:
    """يرسل رسالة التعريف لكل المستخدمين النشطين. اللي حظروا البوت ينشالون من القائمة."""
    with _ulock:
        d = _users()
        ids = [k for k, v in d["users"].items() if v.get("active", True) and k != str(owner_id)]
    ok = gone = 0
    for uid in ids:
        try:
            bot.send_message(int(uid), PROMO, parse_mode="HTML", reply_markup=promo_kb(), disable_web_page_preview=True)
            ok += 1
        except Exception as e:
            code = getattr(getattr(e, "result", None), "status_code", 0) or getattr(e, "error_code", 0)
            if code in (400, 403) or "blocked" in str(e) or "deactivated" in str(e) or "chat not found" in str(e):
                gone += 1
                with _ulock:
                    d2 = _users()
                    if uid in d2["users"]:
                        d2["users"][uid]["active"] = False
                        _save_users(d2)
        time.sleep(0.06)   # تحت حد تليجرام (٣٠ رسالة بالثانية)
    with _ulock:
        d = _users()
        d["last_broadcast"] = int(time.time())
        _save_users(d)
    return ok, gone


def _scheduler(bot, owner_id: int) -> None:
    while True:
        time.sleep(600)
        try:
            now = datetime.now(RIYADH)
            if now.hour not in BROADCAST_HOURS:
                continue
            if time.time() - int(_users().get("last_broadcast", 0)) < BROADCAST_EVERY:
                continue
            ok, gone = broadcast(bot, owner_id)
            if owner_id:
                bot.send_message(owner_id, f"📣 انرسلت رسالة التعريف لـ {ok} مستخدم" + (f" · {gone} حاظرين البوت" if gone else ""))
        except Exception:
            pass


def keyboard() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup()
    wa = lambda text, page="": types.InlineKeyboardButton(text, web_app=types.WebAppInfo(APP + (f"#{page}" if page else "")))
    kb.row(wa("📱 افتح تطبيق Bandly"))
    kb.row(wa("🛠️ سجّل كفني", "tech"), wa("📢 اطلب إعلان", "ad"))
    kb.row(wa("🔌 أضف جهازك", "device"), wa("💬 ملاحظاتك", "feedback"))
    kb.row(wa("👷 الفنيين", "techs"), types.InlineKeyboardButton("👨‍💻 المبرمج", url=DEV))
    return kb


def public_start(bot, msg):
    remember(msg.from_user)
    bot.send_message(msg.chat.id, WELCOME, parse_mode="HTML", reply_markup=keyboard(), disable_web_page_preview=True)


def register(bot, is_owner, api_post=None, owner_id: int = 0):
    # نحفظ كل اللي يراسل البوت بدون ما نأثر على باقي المعالجات
    def _listen(messages):
        for m in messages:
            if getattr(m.chat, "type", "") == "private":
                remember(m.from_user)
    bot.set_update_listener(_listen)

    # أول تشغيل: القائمة تبدأ من الحين، ونضيف اللي سبق وأرسلوا طلبات من التطبيق المصغر.
    # وأول رسالة تعريف بعد ٣ أيام عشان القائمة تكبر قبلها.
    if not os.path.exists(USERS_FILE):
        d = {"users": {}, "last_broadcast": int(time.time())}
        try:
            import glob
            for f in glob.glob(os.path.join(LIVE_DIR, "data", "hub", "*.json")):
                u = (json.load(open(f, encoding="utf-8")).get("user") or {})
                if u.get("id"):
                    d["users"][str(u["id"])] = {"since": int(time.time()), "name": str(u.get("name") or "")[:40], "active": True}
        except Exception:
            pass
        _save_users(d)

    if not owner_id:
        try:
            import __main__
            owner_id = int(getattr(__main__, "OWNER_ID", 0) or 0)
        except Exception:
            owner_id = 0
    threading.Thread(target=_scheduler, args=(bot, owner_id), daemon=True).start()

    _n0 = len(bot.message_handlers)

    @bot.message_handler(commands=["users"])
    def _count(msg):
        if not is_owner(msg):
            return
        d = _users()
        act = sum(1 for v in d["users"].values() if v.get("active", True))
        last = d.get("last_broadcast") or 0
        when = datetime.fromtimestamp(last, RIYADH).strftime("%Y-%m-%d %H:%M") if last else "ما انرسلت للحين"
        nxt = datetime.fromtimestamp(last + BROADCAST_EVERY, RIYADH).strftime("%Y-%m-%d") if last else "خلال أول ساعات المساء"
        bot.reply_to(msg, f"👥 مستخدمين البوت: {act}\n📣 آخر رسالة تعريف: {when}\n🗓️ الجاية: {nxt}")

    @bot.message_handler(commands=["promo"])
    def _promo_preview(msg):
        if not is_owner(msg):
            return
        bot.send_message(msg.chat.id, PROMO, parse_mode="HTML", reply_markup=promo_kb(), disable_web_page_preview=True)
        bot.send_message(msg.chat.id, "☝️ هذي معاينة. للإرسال للكل الحين: /broadcast_now")

    @bot.message_handler(commands=["broadcast_now"])
    def _bc_now(msg):
        if not is_owner(msg):
            return
        bot.reply_to(msg, "⏳ نرسل...")
        ok, gone = broadcast(bot, msg.from_user.id)
        bot.send_message(msg.chat.id, f"✅ انرسلت لـ {ok}" + (f" · {gone} حاظرين البوت" if gone else ""))

    # أوامرنا أول القائمة: لو bot.py فيه معالج عام للمالك (يلقط أي رسالة) ما يبلعها
    mine = bot.message_handlers[_n0:]
    del bot.message_handlers[_n0:]
    bot.message_handlers[:0] = mine

    @bot.message_handler(commands=["user", "app"])
    def _preview(msg):
        public_start(bot, msg)

    @bot.callback_query_handler(func=lambda c: (c.data or "").startswith("hub:"))
    def _decide(call):
        if not is_owner(call):
            bot.answer_callback_query(call.id, "للمالك فقط")
            return
        _, action, rid = call.data.split(":", 2)
        try:
            res = _api("POST", f"decide/{rid}", {"action": action, "days": 30})
        except Exception as e:
            bot.answer_callback_query(call.id, f"خطأ: {e}", show_alert=True)
            return
        rec = res.get("rec") or {}
        note = res.get("msg") or ""
        if not res.get("ok"):
            bot.answer_callback_query(call.id, note or "ما تم", show_alert=True)
            return

        # إعلان مقبول → نضيفه لنظام الإعلانات (غير مفعّل) عشان تراجعه وتفعّله من اللوحة
        if action == "ok" and rec.get("type") == "ad":
            f = rec.get("fields", {})
            img = (rec.get("images") or [{}])[0].get("url", "")
            added = False
            if api_post and STORE_PATH:
                try:
                    api_post(STORE_PATH, {"name": f.get("shop", "إعلان"), "image_url": img,
                                          "location_url": f.get("location", ""), "whatsapp": f.get("whatsapp", ""),
                                          "active": False})
                    added = True
                except Exception:
                    added = False
            note = ("انضاف للإعلانات (غير مفعّل) — فعّله من «إدارة الإعلانات» بعد الدفع"
                    if added else f"أضفه يدوياً من «إدارة الإعلانات»: {f.get('shop','')} · {f.get('whatsapp','')} · الصورة: {img}")

        label = {"ok": "✅ مقبول", "no": "❌ مرفوض", "seen": "👁️ تم الاطلاع"}.get(action, action)
        try:
            bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=None)
            bot.send_message(call.message.chat.id, f"{label}\n{note}".strip(), reply_to_message_id=call.message.message_id)
        except Exception:
            pass
        bot.answer_callback_query(call.id, label)
