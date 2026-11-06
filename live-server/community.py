"""
مجتمع Bandly — نتائج مجهولة الهوية لكل برج.

  POST /live-api/community/report   ← نتيجة فحص (برج + إعداد + درجة اللعب)
  POST /live-api/community/outage   ← انقطاع صار عند المستخدم (من / إلى)
  GET  /live-api/community/tower    ← أفضل إعداد على البرج + انقطاعات حديثة
  POST /live-api/community/obs      ← قراءة: البرج + تجميعة الترددات + الإشارة + البنق (٧ نوفمبر)
  GET  /live-api/community/combos   ← وش أفضل تجميعة على هالبرج عند الأعضاء (بدون GPS)

ما نستقبل أي موقع أو رقم جوال أو اسم — فقط رقم البرج والمشغّل ومعرّف عشوائي
للتطبيق (نخزن بصمته فقط) عشان ما يحسب نفس الجهاز مرتين.
"""
import hashlib
import re
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

DB = Path(__file__).resolve().parent / "data" / "community.db"
router = APIRouter(prefix="/live-api/community")

KEEP_DAYS = 45
OBS_KEEP_DAYS = 120
# أقل عدد أعضاء مختلفين على نفس التجميعة عشان نقول «أعضاء حصّلوا كذا»
MIN_USERS = 3
MAX_PER_DEVICE_HOUR = 60
_hits: dict[str, list[float]] = {}


def _db() -> sqlite3.Connection:
    DB.parent.mkdir(exist_ok=True)
    c = sqlite3.connect(DB, timeout=5)
    c.execute("""CREATE TABLE IF NOT EXISTS tests(
        at INTEGER, tower TEXT, op TEXT, dev TEXT, setup TEXT, region TEXT,
        score INTEGER, ping INTEGER, jitter INTEGER, loss INTEGER)""")
    c.execute("""CREATE TABLE IF NOT EXISTS outages(
        at INTEGER, tower TEXT, op TEXT, dev TEXT, t_from INTEGER, t_to INTEGER)""")
    cols = {r[1] for r in c.execute("PRAGMA table_info(tests)")}
    if "area" not in cols:
        c.execute("ALTER TABLE tests ADD COLUMN area TEXT DEFAULT ''")
    c.execute("CREATE INDEX IF NOT EXISTS i_tests ON tests(tower, op, at)")
    c.execute("CREATE INDEX IF NOT EXISTS i_area ON tests(area, at)")
    c.execute("CREATE INDEX IF NOT EXISTS i_out ON outages(tower, op, t_to)")
    # ٧ نوفمبر — مستشار البرج: كل قراءة = تجميعة الترددات اللي شغالة + جودتها + البنق
    c.execute("""CREATE TABLE IF NOT EXISTS obs(
        at INTEGER, tower TEXT, op TEXT, dev TEXT, model TEXT, combo TEXT, carriers INTEGER,
        rsrp INTEGER, sinr INTEGER, nr_rsrp INTEGER, ping INTEGER, jitter INTEGER, score INTEGER,
        hour INTEGER, src TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS i_obs ON obs(tower, op, at)")
    return c


def _clean(v, n=40) -> str:
    return re.sub(r"[^\w؀-ۿ +.\-]", "", str(v or ""))[:n].strip()


def _area(v) -> str:
    """«شرورة - حي الفيصلية» ← «شرورة/الفيصلية» — عشان نفس الحي ينكتب بأكثر من شكل"""
    t = re.sub(r"[^\w؀-ۿ /\-]", "", str(v or "")).strip()
    t = re.sub(r"\bحي\s+", "", t)
    parts = [re.sub(r"\s+", " ", x).strip() for x in re.split(r"[/\-،,]", t) if x.strip()]
    return "/".join(parts)[:60]


def _op(v) -> str:
    """أسماء المشغّل تختلف بين الراوترات — نوحّدها"""
    t = str(v or "").lower()
    if "stc" in t or "saudi telecom" in t or "aljawal" in t or "الاتصالات" in t:
        return "STC"
    if "mobily" in t or "etisalat" in t or "موبايلي" in t:
        return "موبايلي"
    if "zain" in t or "زين" in t:
        return "زين"
    if "salam" in t or "سلام" in t:
        return "سلام"
    if "virgin" in t or "فيرجن" in t:
        return "فيرجن"
    if "lebara" in t or "ليبارا" in t:
        return "ليبارا"
    return _clean(v, 30) or "غير معروف"


def _dev(v) -> str:
    raw = _clean(v, 64)
    if len(raw) < 8:
        raise HTTPException(400, "bad device")
    return hashlib.sha256(("bandly:" + raw).encode()).hexdigest()[:20]


def _limit(dev: str):
    now = time.time()
    lst = [t for t in _hits.get(dev, []) if now - t < 3600]
    if len(lst) >= MAX_PER_DEVICE_HOUR:
        raise HTTPException(429, "too many")
    lst.append(now)
    _hits[dev] = lst


def _int(v, lo, hi):
    try:
        x = int(round(float(v)))
    except Exception:
        raise HTTPException(400, "bad number")
    return max(lo, min(hi, x))


def _prune(c: sqlite3.Connection):
    cut = int(time.time()) - KEEP_DAYS * 86400
    c.execute("DELETE FROM tests WHERE at < ?", (cut,))
    c.execute("DELETE FROM outages WHERE at < ?", (cut,))
    c.execute("DELETE FROM obs WHERE at < ?", (int(time.time()) - OBS_KEEP_DAYS * 86400,))


@router.post("/report")
async def report(req: Request):
    b = await req.json()
    dev = _dev(b.get("device"))
    _limit(dev)
    tower, op = _clean(b.get("tower"), 24), _clean(b.get("operator"), 30)
    setup = _clean(b.get("setup"), 30)
    area = _area(b.get("area"))
    if not setup or not (tower or area):
        raise HTTPException(400, "missing")
    row = (int(time.time()), tower or "-", op, dev, setup, _clean(b.get("region"), 6),
           _int(b.get("score"), 0, 100), _int(b.get("ping"), 0, 5000),
           _int(b.get("jitter"), 0, 5000), _int(b.get("loss"), 0, 100), area)
    with _db() as c:
        c.execute("INSERT INTO tests(at,tower,op,dev,setup,region,score,ping,jitter,loss,area) VALUES (?,?,?,?,?,?,?,?,?,?,?)", row)
        if int(time.time()) % 20 == 0:
            _prune(c)
    return {"ok": True}


@router.post("/outage")
async def outage(req: Request):
    b = await req.json()
    dev = _dev(b.get("device"))
    _limit(dev)
    tower, op = _clean(b.get("tower"), 24), _clean(b.get("operator"), 30)
    now = int(time.time())
    try:
        t_from = _int(float(b.get("from")) / 1000, now - 86400, now)
        t_to = _int(float(b.get("to") or now * 1000) / 1000, t_from, now)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "bad time")
    if not tower or t_to - t_from < 20:
        raise HTTPException(400, "missing")
    with _db() as c:
        c.execute("INSERT INTO outages VALUES (?,?,?,?,?,?)", (now, tower, op, dev, t_from, t_to))
    return {"ok": True}


@router.get("/tower")
async def tower_info(tower: str, operator: str = "", region: str = "", device: str = ""):
    tw, op = _clean(tower, 24), _clean(operator, 30)
    if not tw:
        raise HTTPException(400, "missing")
    me = _dev(device) if device else ""
    now = int(time.time())
    since = now - 30 * 86400
    with _db() as c:
        q = "SELECT setup, AVG(score), AVG(ping), AVG(jitter), COUNT(*), COUNT(DISTINCT dev) FROM tests WHERE tower=? AND op=? AND at>=? AND setup NOT LIKE '\\_%' ESCAPE '\\'"
        args: list = [tw, op, since]
        if region:
            q += " AND region=?"
            args.append(_clean(region, 6))
        q += " GROUP BY setup ORDER BY AVG(score) DESC"
        rows = c.execute(q, args).fetchall()
        users = c.execute("SELECT COUNT(DISTINCT dev) FROM tests WHERE tower=? AND op=? AND at>=?", (tw, op, since)).fetchone()[0]
        outs = c.execute(
            "SELECT t_from, t_to, dev FROM outages WHERE tower=? AND op=? AND t_to>=? ORDER BY t_from",
            (tw, op, now - 6 * 3600),
        ).fetchall()

    # نجمع الانقطاعات المتداخلة من أجهزة مختلفة
    groups: list[dict] = []
    for f, t, d in outs:
        g = next((g for g in groups if f <= g["to"] + 300 and t >= g["from"] - 300), None)
        if g:
            g["from"], g["to"] = min(g["from"], f), max(g["to"], t)
            g["devs"].add(d)
        else:
            groups.append({"from": f, "to": t, "devs": {d}})
    outages = [
        {"from": g["from"] * 1000, "to": g["to"] * 1000, "users": len(g["devs"]), "mine": me in g["devs"]}
        for g in groups if len(g["devs"] - {me}) >= 1
    ]

    best = [
        {"setup": s, "score": round(a), "ping": round(p), "jitter": round(j), "tests": n, "users": u}
        for s, a, p, j, n, u in rows if u >= 1
    ][:6]
    return {"tower": tw, "users": users, "best": best, "outages": outages[-5:]}


@router.get("/area")
async def area_info(area: str, region: str = "", device: str = ""):
    """أي شريحة أفضل في الحي: متوسط فحوصات «جاهز للعب؟» لكل مشغّل"""
    ar = _area(area)
    if not ar:
        raise HTTPException(400, "missing")
    me = _dev(device) if device else ""
    since = int(time.time()) - 30 * 86400
    q = "SELECT op, score, ping, jitter, dev FROM tests WHERE area=? AND at>=? AND setup='_check'"
    args: list = [ar, since]
    if region:
        q += " AND region=?"
        args.append(_clean(region, 6))
    with _db() as c:
        rows = c.execute(q, args).fetchall()
    ops: dict[str, dict] = {}
    for op, sc, pg, jt, dv in rows:
        o = ops.setdefault(_op(op), {"s": [], "p": [], "j": [], "d": set(), "mine": False})
        o["s"].append(sc); o["p"].append(pg); o["j"].append(jt); o["d"].add(dv)
        if dv == me:
            o["mine"] = True
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else None
    out = [
        {"operator": k, "score": avg(v["s"]), "ping": avg(v["p"]), "jitter": avg(v["j"]),
         "tests": len(v["s"]), "users": len(v["d"]), "mine": v["mine"]}
        for k, v in ops.items()
    ]
    out.sort(key=lambda x: -(x["score"] or 0))
    return {"area": ar, "operators": out}


# ═══ مستشار البرج (٧ نوفمبر) — بدون موقع: رقم البرج نفسه هو المكان ═══
_COMBO = re.compile(r"^(?:[Bn]\d{1,3})(?:\+[Bn]\d{1,3}){0,7}$")


def _combo(v) -> str:
    """«B3 + B1 + n78» ← «B1+B3+n78» (4G أول بالترتيب، بعدها 5G) — نفس التجميعة تنكتب بشكل واحد"""
    parts = [x.strip() for x in str(v or "").replace(" ", "").split("+") if x.strip()]
    lte = sorted({int(x[1:]) for x in parts if re.fullmatch(r"[Bb]\d{1,3}", x)})
    nr = sorted({int(x[1:]) for x in parts if re.fullmatch(r"[Nn]\d{1,3}", x)})
    out = "+".join([f"B{b}" for b in lte] + [f"n{b}" for b in nr])
    return out if _COMBO.match(out or "-") else ""


def _opt(v, lo, hi):
    try:
        x = int(round(float(v)))
    except Exception:
        return None
    return x if lo <= x <= hi else None


@router.post("/obs")
async def obs(req: Request):
    b = await req.json()
    dev = _dev(b.get("device"))
    _limit(dev)
    tower, op = _clean(b.get("tower"), 24), _op(b.get("operator"))
    combo = _combo(b.get("combo"))
    if not tower or not combo:
        raise HTTPException(400, "missing")
    src = _clean(b.get("src"), 10) or "scan"
    hour = time.localtime().tm_hour
    row = (int(time.time()), tower, op, dev, _clean(b.get("model"), 30), combo,
           _opt(b.get("carriers"), 1, 10) or combo.count("+") + 1,
           _opt(b.get("rsrp"), -160, -20), _opt(b.get("sinr"), -30, 50), _opt(b.get("nrRsrp"), -160, -20),
           _opt(b.get("ping"), 1, 3000), _opt(b.get("jitter"), 0, 3000), _opt(b.get("score"), 0, 100),
           hour, src)
    with _db() as c:
        # نفس الجهاز ونفس التجميعة خلال ١٠ دقايق = قراءة وحدة (نحدّثها)
        c.execute("DELETE FROM obs WHERE dev=? AND tower=? AND combo=? AND at>?", (dev, tower, combo, row[0] - 600))
        c.execute("INSERT INTO obs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
        if row[0] % 20 == 0:
            _prune(c)
    return {"ok": True}


def _med(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else round((xs[n // 2 - 1] + xs[n // 2]) / 2)


def summarize(rows, me: str = "", min_users: int = MIN_USERS) -> dict:
    """rows = [(dev, combo, rsrp, sinr, ping, jitter, score, hour)] ← ملخص لكل تجميعة.
    كل جهاز ينحسب مرة لكل تجميعة (وسيط قراءاته) — عشان عضو واحد كثير الفحص ما يغلب الباقي."""
    per: dict[str, dict[str, list]] = {}
    for dev, combo, rsrp, sinr, ping, jitter, score, hour in rows:
        d = per.setdefault(combo, {}).setdefault(dev, [])
        d.append((rsrp, sinr, ping, jitter, score, hour))
    combos = []
    for combo, devs in per.items():
        pts = {k: [] for k in ("rsrp", "sinr", "ping", "jitter", "score")}
        night, day = [], []
        for dv, xs in devs.items():
            for i, k in enumerate(("rsrp", "sinr", "ping", "jitter", "score")):
                v = _med([x[i] for x in xs])
                if v is not None:
                    pts[k].append(v)
            for x in xs:
                if x[2] is not None:
                    (night if x[5] >= 20 or x[5] < 1 else day).append(x[2])
        users = len(devs)
        combos.append({
            "combo": combo, "users": users, "tests": sum(len(v) for v in devs.values()),
            "mine": me in devs, "enough": users >= min_users,
            **{k: _med(v) for k, v in pts.items()},
            # الزحمة: بنق الليل (٨م–١ص) مقابل باقي اليوم — بس لو فيه قراءات كافية للاثنين
            "night_ping": _med(night) if len(night) >= 3 and len(day) >= 3 else None,
            "day_ping": _med(day) if len(night) >= 3 and len(day) >= 3 else None,
        })
    combos.sort(key=lambda x: (not x["enough"], -(x["score"] or 0), x["ping"] or 9999))
    users = len({dev for devs in per.values() for dev in devs})
    return {"users": users, "combos": combos[:8], "min_users": min_users}


@router.get("/combos")
async def combos(tower: str, operator: str = "", device: str = ""):
    tw, op = _clean(tower, 24), _op(operator)
    if not tw:
        raise HTTPException(400, "missing")
    me = _dev(device) if device else ""
    with _db() as c:
        rows = c.execute(
            "SELECT dev, combo, rsrp, sinr, ping, jitter, score, hour FROM obs WHERE tower=? AND op=? AND at>=?",
            (tw, op, int(time.time()) - 60 * 86400),
        ).fetchall()
    return {"tower": tw, "operator": op, **summarize(rows, me)}
