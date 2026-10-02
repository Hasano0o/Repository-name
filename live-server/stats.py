"""
إحصائيات استخدام Bandly — كم جهاز فتح التطبيق، ومن أي مدينة، وأي جوالات وراوترات.

  POST /live-api/stats/ping      ← التطبيق يرسلها مرة باليوم
  GET  /live-api/stats/summary   ← ملخص (يحتاج x-hub-secret)

ما نستقبل اسم ولا رقم ولا موقع GPS: معرّف عشوائي للتطبيق + المدينة اللي اختارها
المستخدم بنفسه + نوع الجوال ونسخة أندرويد ونسخة التطبيق + نوع الراوتر.
وكل يوم الساعة ١١:٥٠ مساءً (توقيت الرياض) يوصل للمالك ملخص اليوم في البوت.
"""
import asyncio
import json
import re
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
    rec = {
        "city": _clean(b.get("city"), 30),
        "brand": _clean(b.get("brand"), 24),
        "model": _clean(b.get("model"), 40),
        "android": _clean(b.get("android"), 10),
        "app": _clean(b.get("app"), 16),
        "update": _clean(b.get("update"), 24),
        "routers": routers,
        "at": int(now),
    }
    day = _today()
    async with _lock:
        dp = DAYS / f"{day}.json"
        d = _load(dp, {})
        d[did] = rec
        _save(dp, d)
        devs = _load(DEVICES, {})
        old = devs.get(did) or {}
        devs[did] = {"first": old.get("first") or day, "last": day, "city": rec["city"] or old.get("city", "")}
        _save(DEVICES, devs)
    return {"ok": True}


def build_summary(day: str | None = None) -> dict:
    day = day or _today()
    d = _load(DAYS / f"{day}.json", {})
    devs = _load(DEVICES, {})
    week_ago = (datetime.now(RIYADH) - timedelta(days=6)).strftime("%Y-%m-%d")
    week = set()
    for p in DAYS.glob("*.json"):
        if p.stem >= week_ago:
            week |= set(_load(p, {}).keys())
    recs = list(d.values())
    top = lambda key, n=6: Counter((r.get(key) or "غير محدد") for r in recs).most_common(n)
    return {
        "day": day,
        "active_today": len(d),
        "new_today": sum(1 for v in devs.values() if v.get("first") == day),
        "active_7d": len(week),
        "total_devices": len(devs),
        "cities": top("city", 8),
        "brands": top("brand"),
        "android": top("android"),
        "app": top("update", 4),
        "routers": Counter(x for r in recs for x in (r.get("routers") or [])).most_common(6),
    }


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
    return (
        f"📊 <b>إحصائيات Bandly — {s['day']}</b>\n\n"
        f"👥 نشطين اليوم: <b>{s['active_today']}</b>\n"
        f"🆕 جدد اليوم: <b>{s['new_today']}</b>\n"
        f"📅 نشطين آخر ٧ أيام: <b>{s['active_7d']}</b>\n"
        f"📱 كل الأجهزة: <b>{s['total_devices']}</b>\n\n"
        f"🏙️ المدن:\n{lines(s['cities'])}\n\n"
        f"📶 الراوترات:\n{lines(s['routers'])}\n\n"
        f"📲 الجوالات:\n{lines(s['brands'])}\n\n"
        f"🤖 أندرويد:\n{lines(s['android'])}"
    )


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
