"""
إحصائيات استخدام Bandly — كم جهاز فتح التطبيق، ومن أي مدينة، وأي جوالات وراوترات.

  POST /live-api/stats/ping      ← التطبيق يرسلها مرة باليوم
  GET  /live-api/stats/summary   ← ملخص (يحتاج x-hub-secret)
  GET  /live-api/stats/report    ← نفس الملخص كنص جاهز (أمر /stats في البوت)

ما نستقبل اسم ولا رقم ولا موقع GPS، والآي بي ما ينحفظ (نطلع منه الدولة بس): معرّف عشوائي للتطبيق + المدينة اللي اختارها
المستخدم بنفسه + نوع الجوال ونوع النظام ونسخته ونسخة التطبيق + نوع الراوتر.
وكل يوم الساعة ١١:٥٠ مساءً (توقيت الرياض) يوصل للمالك ملخص اليوم في البوت.
"""
import asyncio
import json
import re
import subprocess
from functools import lru_cache
import time
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

DATA = Path(__file__).resolve().parent / "data"
ST = DATA / "stats"
DAYS = ST / "days"
DEVICES = ST / "devices.json"
RIYADH = timezone(timedelta(hours=3))
KEEP_DAYS = 120

router = APIRouter(prefix="/live-api/stats")
_hits: dict[str, list[float]] = {}
_lock = asyncio.Lock()


def _today() -> str:
    return datetime.now(RIYADH).strftime("%Y-%m-%d")


def _load(p: Path, default):
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return default


def _save(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), "utf-8")
    tmp.replace(p)


def _clean(v, n: int = 40) -> str:
    """نص قصير بدون رموز تحكم أو HTML."""
    s = re.sub(r"[\x00-\x1f<>]", "", str(v or "")).strip()
    return s[:n]


def _ip(req: Request) -> str:
    # نثق فقط بعنوان X-Real-IP الذي يضعه Nginx من $remote_addr.
    # لا نستخدم X-Forwarded-For لأن العميل يستطيع إرساله بنفسه.
    real = (req.headers.get("x-real-ip") or "").strip()
    if real:
        return real
    return req.client.host if req.client else "?"


COUNTRY_AR = {
    "SA": "السعودية", "AE": "الإمارات", "KW": "الكويت", "QA": "قطر", "BH": "البحرين",
    "OM": "عُمان", "YE": "اليمن", "EG": "مصر", "JO": "الأردن", "IQ": "العراق",
    "SY": "سوريا", "LB": "لبنان", "SD": "السودان", "MA": "المغرب", "DZ": "الجزائر",
    "TN": "تونس", "LY": "ليبيا", "US": "أمريكا", "GB": "بريطانيا", "DE": "ألمانيا",
    "FR": "فرنسا", "NL": "هولندا", "IE": "أيرلندا", "TR": "تركيا", "IN": "الهند", "PK": "باكستان",
}


@lru_cache(maxsize=4096)
def _country(ip: str) -> str:
    """الدولة فقط من الآي بي (قاعدة محلية، بدون اتصال خارجي). الآي بي نفسه ما ينحفظ."""
    if not ip or ip == "?" or ip.startswith(("127.", "10.", "192.168.")) or ip == "::1":
        return ""
    try:
        cmd = ["geoiplookup6" if ":" in ip else "geoiplookup", ip]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
        m = re.search(r":\s*([A-Z]{2}),\s*([^\n]+)", out)
        if not m:
            return ""
        return COUNTRY_AR.get(m.group(1), m.group(2).strip()[:24])
    except Exception:
        return ""


@router.post("/ping")
async def ping(req: Request):
    # إحصائية صغيرة جدًا؛ لا يوجد سبب لقبول body كبير.
    # نرفض قبل req.json() لتجنب قراءة payload ضخم إلى الذاكرة.
    MAX_BODY = 64 * 1024
    raw_len = (req.headers.get("content-length") or "").strip()
    if raw_len:
        try:
            if int(raw_len) > MAX_BODY:
                raise HTTPException(413, "الطلب كبير جدًا")
        except ValueError:
            raise HTTPException(400, "حجم طلب غير صالح")

    ip = _ip(req)
    now = time.time()
    lst = [t for t in _hits.get(ip, []) if now - t < 3600]
    if len(lst) >= 30:
        raise HTTPException(429)
    lst.append(now)
    _hits[ip] = lst
    try:
        b = await req.json()
    except Exception:
        raise HTTPException(400)
    did = _clean(b.get("id"), 32)
    if not re.fullmatch(r"[a-z0-9]{12,32}", did):
        raise HTTPException(400)
    routers = [_clean(x, 24) for x in (b.get("routers") or [])[:6] if isinstance(x, str)]
    logins = [_clean(x, 24) for x in (b.get("logins") or [])[:6] if isinstance(x, str)]
    screens: dict[str, int] = {}
    raw_sc = b.get("screens")
    if isinstance(raw_sc, dict):
        for k, v in list(raw_sc.items())[:60]:
            name = _clean(k, 30)
            if name and isinstance(v, (int, float)) and v > 0:
                screens[name] = min(int(v), 500)
    country = await asyncio.to_thread(_country, ip)
    rec = {
        "country": country,
        "city": _clean(b.get("city"), 30),
        "brand": _clean(b.get("brand"), 24),
        "model": _clean(b.get("model"), 40),
        "android": _clean(b.get("android"), 10),
        "os": _clean(b.get("os"), 8).lower(),
        "app": _clean(b.get("app"), 16),
        "update": _clean(b.get("update"), 24),
        "routers": routers,
        "logins": logins,
        "login_ever": bool(b.get("loginEver")),
        "new_app": "logins" in b,
        "screens": screens,
        "blocker": _clean(b.get("blocker"), 16),
        "blocker_note": _clean(b.get("blockerNote"), 40),
        "at": int(now),
    }
    day = _today()
    async with _lock:
        dp = DAYS / f"{day}.json"
        d = _load(dp, {})
        # لو الجهاز أرسل مرتين بنفس اليوم نجمع العدادات بدل ما نمسح الأولى
        prev = (d.get(did) or {}).get("screens") or {}
        for k, v in prev.items():
            rec["screens"][k] = min(rec["screens"].get(k, 0) + int(v), 1000)
        d[did] = rec
        _save(dp, d)
        devs = _load(DEVICES, {})
        old = devs.get(did) or {}
        devs[did] = {"first": old.get("first") or day, "last": day, "city": rec["city"] or old.get("city", "")}
        _save(DEVICES, devs)
    return {"ok": True}


def _os(r: dict) -> str:
    """آيفون ولا أندرويد — النسخ القديمة من التطبيق ما ترسل النوع، فنستنتجه:
    الآيفون يرسل الشركة فاضية ونسخة فيها نقطة (18.3.1 / 26.5)."""
    o = (r.get("os") or "").lower()
    if o in ("ios", "android"):
        return o
    v = r.get("android") or ""
    return "ios" if not r.get("brand") and "." in v else "android"


def build_summary(day: str | None = None) -> dict:
    day = day or _today()
    d = _load(DAYS / f"{day}.json", {})
    devs = _load(DEVICES, {})
    week_ago = (datetime.now(RIYADH) - timedelta(days=6)).strftime("%Y-%m-%d")
    week = set()
    blockers: dict[str, tuple[str, str]] = {}
    opens: Counter = Counter()
    users: dict[str, set] = {}
    for p in DAYS.glob("*.json"):
        if p.stem >= week_ago:
            wd = _load(p, {})
            week |= set(wd.keys())
            for did_, r in wd.items():
                if r.get("blocker"):
                    blockers[did_] = (r["blocker"], r.get("blocker_note") or "")
                for k, v in (r.get("screens") or {}).items():
                    opens[k] += int(v)
                    users.setdefault(k, set()).add(did_)
    recs = list(d.values())
    for r in recs:
        r["os"] = _os(r)
        if r["os"] == "ios" and not r.get("brand"):
            r["brand"] = "Apple"
    top = lambda key, n=6, rs=None: Counter((r.get(key) or "غير محدد") for r in (recs if rs is None else rs)).most_common(n)
    ios = [r for r in recs if r["os"] == "ios"]
    andr = [r for r in recs if r["os"] != "ios"]
    return {
        "day": day,
        "active_today": len(d),
        "new_today": sum(1 for v in devs.values() if v.get("first") == day),
        "active_7d": len(week),
        "total_devices": len(devs),
        "countries": top("country", 8),
        "cities": top("city", 8),
        "brands": top("brand"),
        "os": {"ios": len(ios), "android": len(andr)},
        "ios_ver": top("android", 6, ios),
        "android": top("android", 6, andr),
        "app": top("update", 4),
        "routers": Counter(x for r in recs for x in (r.get("routers") or [])).most_common(6),
        "funnel": _funnel(recs),
        "screens": [(k, v, len(users.get(k, ()))) for k, v in opens.most_common(25)],
        "blockers": Counter(b for b, _ in blockers.values()).most_common(),
        "blocker_notes": Counter(n for b, n in blockers.values() if n).most_common(8),
        "history": _history(day, devs),
    }


DEMO_NAMES = {"راوتر تجريبي", "Demo", "demo"}


def _funnel(recs: list[dict]) -> dict:
    """الدخول الحقيقي للراوتر — بس من الأجهزة اللي عندها النسخة الجديدة (ترسل logins)."""
    rs = [r for r in recs if r.get("new_app")]
    real = lambda r: [x for x in (r.get("routers") or []) if x not in DEMO_NAMES]
    logged_today = [r for r in rs if r.get("logins")]
    return {
        "tracked": len(rs),
        "logged_today": len(logged_today),
        "logged_ever": sum(1 for r in rs if r.get("login_ever")),
        "by_router": Counter(x for r in logged_today for x in r["logins"]).most_common(6),
        "added_no_login": sum(1 for r in rs if real(r) and not r.get("login_ever")),
        "demo_only": sum(1 for r in rs if (r.get("routers") or []) and not real(r)),
        "none": sum(1 for r in rs if not (r.get("routers") or [])),
    }


WD_AR = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]


def _history(day: str, devs: dict, n: int = 7) -> list[dict]:
    """الأيام اللي قبل اليوم (الأحدث أول): كم نشط وكم جديد في كل يوم."""
    base = datetime.strptime(day, "%Y-%m-%d")
    firsts = Counter(v.get("first") for v in devs.values())
    out = []
    for i in range(1, n + 1):
        dt = base - timedelta(days=i)
        k = dt.strftime("%Y-%m-%d")
        p = DAYS / f"{k}.json"
        if not p.exists():
            continue
        out.append({"day": k, "wd": WD_AR[dt.weekday()], "active": len(_load(p, {})), "new": firsts.get(k, 0)})
    return out


def _secret(name: str) -> str:
    p = DATA / name
    return p.read_text().strip() if p.exists() else ""


@router.get("/summary")
async def summary(req: Request, day: str | None = None):
    sec = _secret("hub_secret")
    import secrets as _s
    if not sec or not _s.compare_digest(req.headers.get("x-hub-secret", ""), sec):
        raise HTTPException(403)
    if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400)
    return build_summary(day)


def _fmt(s: dict) -> str:
    def lines(pairs):
        return "\n".join(f"  • {k}: {v}" for k, v in pairs) or "  —"
    hist = s.get("history") or []

    def diff(now: int, before: int | None) -> str:
        if before is None:
            return ""
        d = now - before
        return f" ({'↑' if d > 0 else '↓'}{abs(d)} عن أمس)" if d else " (نفس أمس)"

    y = hist[0] if hist and hist[0]["day"] == (datetime.strptime(s["day"], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d") else None
    past = ""
    if hist:
        top = max([s["active_today"]] + [h["active"] for h in hist]) or 1
        bar = lambda v: "▇" * max(1, round(v / top * 8)) if v else "·"
        rows = "\n".join(f"  {h['wd']} {h['day'][5:]}: {bar(h['active'])} {h['active']} نشط · {h['new']} جديد" for h in hist)
        avg = round(sum(h["active"] for h in hist) / len(hist))
        past = f"\n\n📈 <b>الأيام السابقة</b> (متوسط {avg} نشط باليوم):\n{rows}"
    fu = s.get("funnel") or {}
    fun = ""
    if fu.get("tracked"):
        fun = (
            f"🔐 <b>الدخول الحقيقي للراوتر</b> (من {fu['tracked']} جهاز على النسخة الجديدة):\n"
            f"  • دخلوا راوترهم اليوم: <b>{fu['logged_today']}</b>\n"
            + "".join(f"     – {k}: {v}\n" for k, v in fu.get("by_router") or [])
            + f"  • دخلوا ولو مرة: {fu['logged_ever']}\n"
            f"  • أضافوا راوتر حقيقي وما قدروا يدخلون: {fu['added_no_login']}\n"
            f"  • التجريبي بس: {fu['demo_only']}\n"
            f"  • ما أضافوا شي: {fu['none']}\n\n"
        )
    BL = {"none": "ما عنده راوتر الحين", "unsupported": "راوتره مو موجود", "howto": "ما عرف كيف يضيفه", "browsing": "يتفرج بس"}
    bl = s.get("blockers") or []
    blk = ""
    if bl:
        blk = "🚧 <b>ليش ما أضافوا راوتر؟</b> (آخر ٧ أيام):\n" + "\n".join(f"  • {BL.get(k, k)}: {v}" for k, v in bl)
        notes = s.get("blocker_notes") or []
        if notes:
            blk += "\n  راوترات طلبوها: " + "، ".join(f"{n} ({c})" for n, c in notes)
        blk += "\n\n"
    sc = s.get("screens") or []
    tools = ""
    if sc:
        tools = "🧭 <b>الأدوات الأكثر استخداماً</b> (آخر ٧ أيام · فتحات · أجهزة):\n" + "\n".join(
            f"  {i}. {k}: {v} · {u} جهاز" for i, (k, v, u) in enumerate(sc, 1)) + "\n\n"
    return (
        f"📊 <b>إحصائيات Bandly — {s['day']}</b>\n\n"
        f"👥 نشطين اليوم: <b>{s['active_today']}</b>{diff(s['active_today'], y['active'] if y else None)}\n"
        f"🆕 جدد اليوم: <b>{s['new_today']}</b>{diff(s['new_today'], y['new'] if y else None)}\n"
        f"📅 نشطين آخر ٧ أيام: <b>{s['active_7d']}</b>\n"
        f"📱 كل الأجهزة: <b>{s['total_devices']}</b>\n\n"
        f"🌍 الدول:\n{lines(s.get('countries') or [])}\n\n"
        f"🏙️ المدن:\n{lines(s['cities'])}\n\n"
        f"📶 الراوترات:\n{lines(s['routers'])}\n\n"
        f"{fun}"
        f"{blk}"
        f"{tools}"
        f"📲 الأنظمة:\n  • 🍎 آيفون: {s['os']['ios']}\n  • 🤖 أندرويد: {s['os']['android']}\n\n"
        f"🏷️ الجوالات:\n{lines(s['brands'])}\n\n"
        f"🍎 نسخ iOS:\n{lines(s['ios_ver'])}\n\n"
        f"🤖 نسخ أندرويد:\n{lines(s['android'])}"
        f"{past}"
    )


@router.get("/report")
async def report(req: Request, day: str | None = None):
    """التقرير جاهز كنص — يطلبه البوت بأمر /stats أي وقت."""
    sec = _secret("hub_secret")
    import secrets as _s
    if not sec or not _s.compare_digest(req.headers.get("x-hub-secret", ""), sec):
        raise HTTPException(403)
    if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400)
    return {"text": _fmt(build_summary(day))}


def _send_owner(text: str) -> None:
    tok = _secret("bot_token")
    owner = int((_load(DATA / "config.json", {}) or {}).get("owner_id") or 0)
    if not tok or not owner:
        return
    body = json.dumps({"chat_id": owner, "text": text, "parse_mode": "HTML"}).encode()
    rq = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage", body,
                                {"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(rq, timeout=15).read()
    except Exception:
        pass


def _prune() -> None:
    cut = (datetime.now(RIYADH) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for p in DAYS.glob("*.json"):
        if p.stem < cut:
            p.unlink(missing_ok=True)


async def daily_loop() -> None:
    """يرسل ملخص اليوم للمالك الساعة ١١:٥٠ مساءً بتوقيت الرياض."""
    sent = ""
    while True:
        await asyncio.sleep(60)
        now = datetime.now(RIYADH)
        day = now.strftime("%Y-%m-%d")
        if now.hour == 23 and now.minute >= 50 and sent != day:
            sent = day
            try:
                text = _fmt(build_summary(day))
                await asyncio.to_thread(_send_owner, text)
                await asyncio.to_thread(_prune)
            except Exception:
                pass
