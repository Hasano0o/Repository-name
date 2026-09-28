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
import urllib.request

from telebot import types

APP = "https://has-host.com/bandly-app/"
DEV = "https://t.me/hasa_n20"
LIVE_DIR = "/root/bandly-live"
STORE_PATH = ""   # يعبّيه سكربت التثبيت تلقائياً من bot.py (مسار إنشاء إعلان)

WELCOME = (
    "📶 <b>Bandly — اطلع أقوى إشارة من راوترك</b>\n\n"
    "وجّه الهوائي، ثبّت أفضل برج، وكلّم فني يساعدك عن بُعد 📞👇"
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


def keyboard() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup()
    wa = lambda text, page="": types.InlineKeyboardButton(text, web_app=types.WebAppInfo(APP + (f"#{page}" if page else "")))
    kb.row(wa("📱 افتح تطبيق Bandly"))
    kb.row(wa("🛠️ سجّل كفني", "tech"), wa("📢 اطلب إعلان", "ad"))
    kb.row(wa("🔌 أضف جهازك", "device"), wa("💬 ملاحظاتك", "feedback"))
    kb.row(wa("👷 الفنيين", "techs"), types.InlineKeyboardButton("👨‍💻 المبرمج", url=DEV))
    return kb


def public_start(bot, msg):
    bot.send_message(msg.chat.id, WELCOME, parse_mode="HTML", reply_markup=keyboard(), disable_web_page_preview=True)


def register(bot, is_owner, api_post=None):
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
