"""
مجتمع Bandly — نتائج مجهولة الهوية لكل برج.

  POST /live-api/community/report   ← نتيجة فحص (برج + إعداد + درجة اللعب)
  POST /live-api/community/outage   ← انقطاع صار عند المستخدم (من / إلى)
  GET  /live-api/community/tower    ← أفضل إعداد على البرج + انقطاعات حديثة

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
    c.execute("CREATE INDEX IF NOT EXISTS i_tests ON tests(tower, op, at)")
    c.execute("CREATE INDEX IF NOT EXISTS i_out ON outages(tower, op, t_to)")
    return c


def _clean(v, n=40) -> str:
    return re.sub(r"[^\w؀-ۿ +.\-]", "", str(v or ""))[:n].strip()


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


@router.post("/report")
async def report(req: Request):
    b = await req.json()
    dev = _dev(b.get("device"))
    _limit(dev)
    tower, op = _clean(b.get("tower"), 24), _clean(b.get("operator"), 30)
    setup = _clean(b.get("setup"), 30)
    if not tower or not setup:
        raise HTTPException(400, "missing")
    row = (int(time.time()), tower, op, dev, setup, _clean(b.get("region"), 6),
           _int(b.get("score"), 0, 100), _int(b.get("ping"), 0, 5000),
           _int(b.get("jitter"), 0, 5000), _int(b.get("loss"), 0, 100))
    with _db() as c:
        c.execute("INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?)", row)
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
        q = "SELECT setup, AVG(score), AVG(ping), AVG(jitter), COUNT(*), COUNT(DISTINCT dev) FROM tests WHERE tower=? AND op=? AND at>=?"
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
