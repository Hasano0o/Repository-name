"""
help_fixes.py — «حلول المشاكل» في بوت Bandly (@NetGuide1_bot) + الرد التلقائي في قروب الدعم.

  • زر «🛠 حلول المشاكل» في قائمة البوت ← قائمة المشاكل ← الحل خطوة بخطوة
  • روابط مباشرة من التطبيق: t.me/NetGuide1_bot?start=fix_login (أو start=help للقائمة)
  • في قروب الدعم: لو أحد سأل عن مشكلة معروفة، البوت يرد بملخص الحل + زر «الحل كامل»
    (لازم البوت يكون مشرف في القروب عشان يشوف الرسائل)

يُستدعى من hub.py:
    import help_fixes
    help_fixes.register(bot)               ← داخل hub.register
    help_fixes.handle_start(bot, msg, arg) ← داخل public_start (يرجع True لو تعامل معه)
"""
import json
import os
import re
import threading
import time

from telebot import types

BOT = "NetGuide1_bot"
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "help_group.json")
GROUP_USERNAME = "BandlyHelp"  # القروب عام: نعرف رقمه من المعرّف (يتغير الرقم لما يصير سوبر قروب)
DEFAULT_GROUP = -5462203499
COOLDOWN = 15 * 60            # نفس الحل ما يتكرر في القروب قبل ربع ساعة

# ═══ الحلول ═══
# k: الكلمات اللي نتعرف فيها على المشكلة (بعد توحيد الحروف). نحتاج كلمتين على الأقل من القائمة،
#    أو عبارة كاملة من «p» — عشان ما يرد البوت على أي كلام عادي.
FIXES = {
    "login": {
        "t": "🔐 ما قدرت أدخل الراوتر",
        "s": "تأكد إنك متصل بواي فاي الراوتر نفسه، وجرّب كلمة مرور الإدارة اللي على الملصق.",
        "b": (
            "١) <b>اتصل بواي فاي الراوتر</b> — مو بيانات الجوال ولا واي فاي ثاني.\n"
            "٢) عنوان الراوتر غالباً:\n"
            "   • هواوي: <code>192.168.8.1</code>\n"
            "   • ZTE: <code>192.168.0.1</code>\n"
            "٣) <b>كلمة المرور</b>: كلمة مرور الإدارة (Admin) اللي على الملصق تحت الراوتر — مو كلمة الواي فاي. "
            "بعض الرواترات تستخدم <code>admin</code>.\n"
            "٤) أسهل طريقة: في Bandly اضغط «+ راوتر» ثم <b>«امسح ملصق الراوتر»</b> — نعبّي البيانات لحالها.\n"
            "٥) لو طلع «جلسة أخرى» أو «مستخدم ثاني»: اقفل صفحة الراوتر من المتصفح أو أي تطبيق ثاني، وانتظر دقيقة."
        ),
        "k": ["ادخل", "دخول", "كلمه المرور", "كلمه السر", "باسورد", "الراوتر", "يرفض", "خطا", "ما يقبل"],
        "p": ["ما قدرت ادخل", "ما يدخل الراوتر", "كلمه المرور غلط", "كلمه السر غلط"],
    },
    "noservice": {
        "t": "📵 النت فصل بعد التثبيت",
        "s": "ادخل صفحة الراوتر في Bandly واضغط «رجّع الإشارة» — يفك التثبيت والراوتر يلقط أقوى برج.",
        "b": (
            "صار «بلا شبكة» بعد ما ثبّت برج أو تردد؟\n\n"
            "١) <b>انتظر شوي</b>: هواوي يحتاج لين دقيقتين، و ZTE لين ٤ دقايق، ويرجع لحاله غالباً.\n"
            "٢) ما رجع؟ افتح صفحة الراوتر في Bandly واضغط <b>«رجّع الإشارة»</b> — يفك كل التثبيتات.\n"
            "٣) تبي إعدادك اللي قبل؟ استخدم <b>«رجّع إعدادي السابق»</b> بعد ما يرجع النت.\n"
            "٤) لو ما قدرت توصل للراوتر أبد: طفّه ٣٠ ثانية وشغّله.\n"
            "٥) آخر حل: ضبط المصنع (زر Reset ١٠ ثواني) — بعدها تحتاج تدخل بيانات الشريحة من جديد."
        ),
        "k": ["فصل", "انقطع", "بلا شبكه", "مافي شبكه", "ما فيه نت", "ثبت", "تثبيت", "برج", "طاح"],
        "p": ["بلا شبكه", "no service", "النت فصل", "ما فيه خدمه"],
    },
    "ping": {
        "t": "🎮 البنق عالي واللعب يقطّع",
        "s": "افتح «مُحسّن الألعاب» واضغط «جهّزني للعب» قبل المباراة، وشغّل «كاشف اللاق» وأنت تلعب يعرف السبب.",
        "b": (
            "١) <b>«جاهز للعب؟»</b> في مُحسّن الألعاب: يقول لك المشكلة من الواي فاي ولا من الشبكة.\n"
            "٢) <b>«كاشف اللاق»</b>: شغّله وأنت تلعب — يكتشف وش يقطّع (تغيّر البرج، 5G، الواي فاي، جهاز يحمّل...).\n"
            "٣) <b>«مُحسّن اللعبة»</b>: يجرب الترددات ويثبّت الأقل بنق لسيرفر لعبتك.\n"
            "٤) <b>«جهّزني للعب»</b>: ضغطة قبل المباراة تطبّق العلاج المناسب لك — وبعد اللعب «رجّع إعدادي».\n"
            "٥) اختر دولة سيرفر لعبتك الصح من الأعلام فوق — الفرق كبير."
        ),
        "k": ["بنق", "لاق", "لاج", "تقطيع", "يقطع", "ببجي", "فورت", "كود", "العاب", "اللعب", "ping"],
        "p": ["البنق عالي", "البنق يرتفع", "اللعب يقطع", "عندي لاق"],
    },
    "slow": {
        "t": "🐢 النت بطيء",
        "s": "جرّب «التوجيه» يلقّط أقوى إشارة، وبعدها «أفضل تردد» يختار الأسرع.",
        "b": (
            "١) <b>التوجيه</b>: حرّك الراوتر أو الأنتنا وأنت تسمع الصوت — يعلّمك أقوى اتجاه.\n"
            "٢) <b>الأبراج</b>: شوف هل فيه برج أقوى من برجك الحالي.\n"
            "٣) <b>أفضل تردد</b>: يجرب الترددات ويختار الأسرع.\n"
            "٤) <b>السرعة</b>: قِس قبل وبعد عشان تتأكد.\n"
            "٥) لو الإشارة ضعيفة جداً: <b>مستشار الأنتنا</b> يقول لك تحتاج أنتنا خارجية ولا لا."
        ),
        "k": ["بطيء", "بطي", "ثقيل", "سرعه", "السرعه", "ضعيف", "الاشاره", "تحميل"],
        "p": ["النت بطيء", "النت ثقيل", "السرعه ضعيفه", "الاشاره ضعيفه"],
    },
    "wifi": {
        "t": "📶 الواي فاي ضعيف",
        "s": "قرّب من الراوتر واستخدم شبكة 5GHz، وجرّب «قناة الواي فاي» في Bandly.",
        "b": (
            "١) لو المشكلة بس بعيد عن الراوتر: الإشارة من الراوتر للجوال ضعيفة — مو من البرج.\n"
            "٢) استخدم شبكة <b>5GHz</b> لو قريب (أسرع)، و 2.4GHz للمسافات البعيدة.\n"
            "٣) <b>قناة الواي فاي</b> في Bandly: يختار قناة أقل زحمة من جيرانك.\n"
            "٤) حط الراوتر في مكان عالي ومفتوح، بعيد عن الجدران والمعادن.\n"
            "٥) للألعاب: كيبل LAN أفضل شي."
        ),
        "k": ["واي فاي", "وايفاي", "wifi", "الوايفاي", "ضعيف", "يفصل", "الغرفه"],
        "p": ["الواي فاي ضعيف", "الوايفاي ضعيف", "الواي فاي يفصل"],
    },
    "fiveg": {
        "t": "⚡ 5G يطلع ويختفي",
        "s": "شغّل «حارس 5G»، أو جرّب «4G فقط» من مُحسّن اللعبة لو تبي ثبات.",
        "b": (
            "١) هذا طبيعي لو إشارة 5G عندك على الحد — الراوتر ينقل بين 4G و 5G.\n"
            "٢) <b>مرساة 5G</b>: تثبّت 5G على أفضل تردد له.\n"
            "٣) <b>حارس 5G</b>: لو ثبّتت ترددات وطاح النت أو اختفى 5G، يرجّع التلقائي بنفسه.\n"
            "٤) للألعاب: <b>«4G فقط»</b> غالباً أثبت من 5G المتقطع.\n"
            "٥) وجّه الأنتنا لأبراج 5G من «التوجيه»."
        ),
        "k": ["5g", "فايف جي", "الفايف", "يختفي", "يطلع", "ينقطع", "4g"],
        "p": ["5g يختفي", "5g يطلع ويختفي", "الفايف جي يختفي"],
    },
    "add": {
        "t": "➕ كيف أضيف راوتري",
        "s": "اضغط «+ راوتر» ثم «امسح ملصق الراوتر» — نعبّي البيانات لحالها.",
        "b": (
            "١) اتصل بواي فاي الراوتر.\n"
            "٢) في Bandly اضغط <b>«+ راوتر»</b> فوق.\n"
            "٣) اضغط <b>«امسح ملصق الراوتر»</b> وصوّر الملصق اللي تحت الراوتر — العنوان وكلمة المرور تتعبى لحالها.\n"
            "٤) اضغط حفظ ثم «دخول للراوتر».\n\n"
            "ما عندك راوتر الحين؟ جرّب <b>«الراوتر التجريبي»</b> وشوف كل المزايا."
        ),
        "k": ["اضيف", "اضافه", "كيف", "اربط", "الراوتر", "اوصل"],
        "p": ["كيف اضيف", "كيف اربط الراوتر", "كيف اضيف راوتر"],
    },
    "unsupported": {
        "t": "❓ راوتري مو مدعوم",
        "s": "استخدم «استكشف» في الصفحة الرئيسية — يقرأ صفحة راوترك ويرسل لنا بصمته عشان ندعمه.",
        "b": (
            "Bandly يدعم الحين هواوي و ZTE (وأجهزة OpenWrt).\n\n"
            "راوترك نوع ثاني؟\n"
            "١) في الصفحة الرئيسية اضغط <b>«استكشف»</b>.\n"
            "٢) يقرأ صفحة راوترك ويرسل لنا بصمته (بدون كلمات سر).\n"
            "٣) اكتب نوع راوترك هنا في القروب — الأكثر طلباً ندعمه أول."
        ),
        "k": ["مدعوم", "يدعم", "نوع", "موديل", "تي بي لينك", "tp-link", "نوكيا", "مو موجود"],
        "p": ["مو مدعوم", "غير مدعوم", "راوتري مو موجود", "ما يدعم راوتري"],
    },
    "update": {
        "t": "🔄 التطبيق ما تحدّث",
        "s": "اقفل التطبيق وافتحه مرتين — التحديث ينزل بالخلفية ويتطبّق بالفتحة الثانية.",
        "b": (
            "١) <b>اقفل التطبيق وافتحه مرتين</b> — التحديث ينزل بالخلفية أول مرة، ويتطبّق بالمرة الثانية.\n"
            "٢) في الصفحة الرئيسية تحت: <b>«نسخة التطبيق» ← «تحقق»</b>.\n"
            "٣) بعض المزايا الجديدة تحتاج تحميل التطبيق من جديد — من App Store أو رابط الأندرويد في البوت."
        ),
        "k": ["تحديث", "يتحدث", "التحديث", "نسخه", "الجديد"],
        "p": ["ما تحدث", "ما يتحدث", "التحديث ما نزل"],
    },
}

ORDER = ["login", "noservice", "ping", "slow", "wifi", "fiveg", "add", "unsupported", "update"]

_AR = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي"})


def _norm(s: str) -> str:
    s = re.sub(r"[ً-ْـ]", "", (s or "").lower())  # تشكيل وتطويل
    return re.sub(r"\s+", " ", s.translate(_AR)).strip()


def match(text: str) -> str | None:
    """أنسب حل للرسالة — أو None لو ما فيه تطابق واضح"""
    t = _norm(text)
    if len(t) < 8:
        return None
    best, best_score = None, 0
    for key, f in FIXES.items():
        score = 0
        if any(_norm(p) in t for p in f["p"]):
            score += 3
        score += sum(1 for k in f["k"] if _norm(k) in t)
        if score > best_score:
            best, best_score = key, score
    return best if best_score >= 2 else None


# ═══ إعداد القروب ═══
_lock = threading.Lock()


def _cfg() -> dict:
    try:
        with open(CFG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cfg(d: dict) -> None:
    with _lock:
        tmp = CFG + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        os.replace(tmp, CFG)


def group_id() -> int:
    return int(_cfg().get("group") or DEFAULT_GROUP)


def group_link() -> str:
    return _cfg().get("link") or f"https://t.me/{GROUP_USERNAME}"


def _refresh_link(bot) -> None:
    """رابط القروب: المعرّف العام لو موجود، وإلا رابط دعوة (يحتاج البوت مشرف بصلاحية الدعوة)"""
    d = _cfg()
    try:
        ch = bot.get_chat(f"@{GROUP_USERNAME}")
    except Exception:
        ch = None
    gid = ch.id if ch else int(d.get("group") or DEFAULT_GROUP)
    try:
        ch = ch or bot.get_chat(gid)
        if getattr(ch, "username", None):
            d["link"] = f"https://t.me/{ch.username}"
        elif getattr(ch, "invite_link", None):
            d["link"] = ch.invite_link
        else:
            d["link"] = bot.export_chat_invite_link(gid)
        d["group"] = gid
        _save_cfg(d)
    except Exception as e:
        print("[help] group link:", e)


# ═══ الواجهة ═══
def menu_kb() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup()
    keys = ORDER
    for i in range(0, len(keys), 2):
        kb.row(*[types.InlineKeyboardButton(FIXES[k]["t"], callback_data=f"hlp:{k}") for k in keys[i:i + 2]])
    if group_link():
        kb.row(types.InlineKeyboardButton("💬 اسأل في قروب الدعم", url=group_link()))
    return kb


MENU_TEXT = "🛠 <b>حلول المشاكل</b>\n\nاختر مشكلتك وتجيك الخطوات 👇"


def fix_text(key: str) -> str:
    f = FIXES[key]
    return f"<b>{f['t']}</b>\n\n{f['b']}"


def fix_kb() -> types.InlineKeyboardMarkup:
    kb = types.InlineKeyboardMarkup()
    if group_link():
        kb.row(types.InlineKeyboardButton("💬 ما انحلت؟ اسأل في القروب", url=group_link()))
    kb.row(types.InlineKeyboardButton("↩️ كل الحلول", callback_data="hlp:menu"))
    return kb


def handle_start(bot, msg, arg: str) -> bool:
    """start=help أو start=fix_KEY — يرجع True لو تعامل معه"""
    a = (arg or "").lower()
    if a == "help":
        bot.send_message(msg.chat.id, MENU_TEXT, parse_mode="HTML", reply_markup=menu_kb())
        return True
    if a.startswith("fix_") and a[4:] in FIXES:
        bot.send_message(msg.chat.id, fix_text(a[4:]), parse_mode="HTML", reply_markup=fix_kb(), disable_web_page_preview=True)
        return True
    return False


_last: dict[tuple[int, str], float] = {}


def register(bot) -> None:
    @bot.callback_query_handler(func=lambda c: (c.data or "").startswith("hlp"))
    def _cb(call):
        key = (call.data or "").split(":", 1)[1] if ":" in (call.data or "") else "menu"
        try:
            bot.answer_callback_query(call.id)
        except Exception:
            pass
        if key == "menu" or key not in FIXES:
            bot.send_message(call.message.chat.id, MENU_TEXT, parse_mode="HTML", reply_markup=menu_kb())
        else:
            bot.send_message(call.message.chat.id, fix_text(key), parse_mode="HTML", reply_markup=fix_kb(), disable_web_page_preview=True)

    # الرد التلقائي في القروب — كـ listener عشان يشوف الرسائل حتى لو فيه معالجات ثانية في bot.py
    def _group_listener(messages):
        for m in messages:
            try:
                chat = m.chat
                if getattr(chat, "type", "") not in ("group", "supergroup"):
                    continue
                # القروب تحوّل لسوبر قروب ← رقمه تغيّر
                new_id = getattr(m, "migrate_to_chat_id", None)
                if new_id and chat.id == group_id():
                    d = _cfg(); d["group"] = int(new_id); _save_cfg(d)
                    threading.Thread(target=_refresh_link, args=(bot,), daemon=True).start()
                    continue
                if chat.id != group_id() or not m.text or m.text.startswith("/"):
                    continue
                if getattr(m.from_user, "is_bot", False):
                    continue
                key = match(m.text)
                if not key:
                    continue
                now = time.time()
                if now - _last.get((chat.id, key), 0) < COOLDOWN:
                    continue
                _last[(chat.id, key)] = now
                f = FIXES[key]
                kb = types.InlineKeyboardMarkup()
                kb.row(types.InlineKeyboardButton("📖 الحل كامل", url=f"https://t.me/{BOT}?start=fix_{key}"))
                bot.reply_to(m, f"💡 <b>{f['t']}</b>\n{f['s']}", parse_mode="HTML", reply_markup=kb)
            except Exception as e:
                print("[help] group:", e)

    bot.set_update_listener(_group_listener)
    threading.Thread(target=_refresh_link, args=(bot,), daemon=True).start()
