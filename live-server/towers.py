"""
قاعدة أبراج Bandly من الأعضاء (٢ نوفمبر ٢٠٢٦).

ليش: OpenCelliD ما يعرف ولا برج 4G/5G لزين في شرورة (برج 3G واحد بقراءة وحدة). فنبني قاعدتنا:
كل عضو وافق يرسل «أنا على البرج الفلاني، وموقعي التقريبي كذا، وقوة الإشارة كذا»، ونقدّر موقع البرج
من أماكن الأعضاء اللي يشبكون عليه (متوسط موزون بقوة الإشارة — الأقرب أقوى).

الخصوصية:
  • الموقع ينقرّب في الجوال قبل الإرسال (٣ خانات عشرية ≈ ١١٠ م) وهنا مرة ثانية.
  • رقم الجهاز ما ينحفظ — ينحفظ hash منه بس (عشان العضو الواحد ينحسب مرة).
  • ما نرجّع موقع برج إلا لو فيه ٣ أعضاء مختلفين على الأقل، وفي أماكن مختلفة — عشان ما يطلع موقع بيت عضو.
  • ما فيه أي طريقة تجيب نقاط الأعضاء نفسها.

الربط بـ app.py الحي (بدون نسخ app.py من المستودع):
    from towers import router as _towers; app.include_router(_towers)
"""
import hashlib
import math
import re
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
DB_PATH = Path(__file__).resolve().parent / "data" / "towers.db"
_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
MIN_MEMBERS = 3          # أقل عدد أعضاء مختلفين عشان نرجّع موقع
MIN_SPREAD_M = 150       # ونقاطهم مو كلها نفس المكان


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("""CREATE TABLE IF NOT EXISTS obs (
        cell TEXT NOT NULL, dev TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
        rsrp REAL, tech TEXT, band INTEGER, at INTEGER NOT NULL,
        PRIMARY KEY (cell, dev, lat, lon))""")
    return c


def _limit(ip: str, n: int, per: float) -> bool:
    now = time.time()
    h = [t for t in _hits.get(ip, []) if now - t < per]
    if len(h) >= n:
        _hits[ip] = h
        return False
    h.append(now)
    _hits[ip] = h
    return True


def _cell_key(mcc, mnc, tac, eci) -> str:
    parts = [re.sub(r"\D", "", str(x or "")) for x in (mcc, mnc, tac, eci)]
    if not all(parts) or len(parts[0]) != 3 or len(parts[3]) > 12 or len(parts[2]) > 8:
        raise HTTPException(400, "bad cell")
    return f"{parts[0]}-{int(parts[1])}-{int(parts[2])}-{int(parts[3])}"


def _dist_m(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def estimate(rows: list[tuple[str, float, float, float | None]]) -> dict | None:
    """rows = [(dev, lat, lon, rsrp)] ← موقع تقريبي للبرج أو None لو البيانات ما تكفي"""
    per_dev: dict[str, list[tuple[float, float, float | None]]] = {}
    for dev, lat, lon, rsrp in rows:
        per_dev.setdefault(dev, []).append((lat, lon, rsrp))
    if len(per_dev) < MIN_MEMBERS:
        return None
    pts = []
    for v in per_dev.values():  # كل عضو نقطة وحدة (متوسط أماكنه وإشارته)
        lat = sum(x[0] for x in v) / len(v)
        lon = sum(x[1] for x in v) / len(v)
        rs = [x[2] for x in v if x[2] is not None]
        pts.append((lat, lon, sum(rs) / len(rs) if rs else None))
    # الأقوى إشارة أقرب للبرج ← وزنه أكبر (كل 10 dB = ضعف الوزن تقريباً)
    w = [10 ** ((max(-125.0, min(-50.0, p[2])) + 125) / 33) if p[2] is not None else 1.0 for p in pts]
    sw = sum(w)
    lat = sum(p[0] * wi for p, wi in zip(pts, w)) / sw
    lon = sum(p[1] * wi for p, wi in zip(pts, w)) / sw
    spread = max(_dist_m(lat, lon, p[0], p[1]) for p in pts)
    if spread < MIN_SPREAD_M:  # كلهم بنفس المكان ← الموقع يكشف مكانهم، ما نرجّعه
        return None
    # الدقة التقريبية: نص متوسط بعد الأعضاء عن المركز (تقل مع كثرة الأعضاء)
    mean_d = sum(_dist_m(lat, lon, p[0], p[1]) for p in pts) / len(pts)
    acc = max(150, int(mean_d / math.sqrt(len(pts))))
    return {"lat": round(lat, 4), "lon": round(lon, 4), "members": len(pts), "accuracy_m": acc}


@router.post("/live-api/app/cellobs")
async def cell_obs(req: Request):
    ip = req.headers.get("x-real-ip") or (req.client.host if req.client else "?")
    if not _limit(ip, 60, 3600):
        raise HTTPException(429, "كثير")
    try:
        b = await req.json()
    except Exception:
        raise HTTPException(400, "bad json")
    if not isinstance(b, dict):
        raise HTTPException(400, "bad json")
    cell = _cell_key(b.get("mcc"), b.get("mnc"), b.get("tac"), b.get("eci"))
    try:
        lat, lon = float(b.get("lat")), float(b.get("lon"))
    except Exception:
        raise HTTPException(400, "bad location")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (abs(lat) < 0.01 and abs(lon) < 0.01):
        raise HTTPException(400, "bad location")
    acc = b.get("acc")
    if isinstance(acc, (int, float)) and acc > 2000:  # موقع تقريبي جداً ما يفيد
        return {"ok": True, "skipped": "accuracy"}
    dev_raw = str(b.get("device") or "")
    if len(dev_raw) < 8:
        raise HTTPException(400, "bad device")
    dev = hashlib.sha256(("bandly-towers|" + dev_raw).encode()).hexdigest()[:16]
    rsrp = b.get("rsrp")
    rsrp = float(rsrp) if isinstance(rsrp, (int, float)) and -160 < rsrp < -20 else None
    band = b.get("band")
    band = int(band) if isinstance(band, (int, float)) and 0 < band < 300 else None
    tech = "NR" if str(b.get("tech")) == "NR" else "LTE"
    with _lock, _db() as c:
        c.execute("INSERT OR REPLACE INTO obs VALUES (?,?,?,?,?,?,?,?)",
                  (cell, dev, round(lat, 3), round(lon, 3), rsrp, tech, band, int(time.time())))
    return {"ok": True}


@router.get("/live-api/app/cellpos")
async def cell_pos(req: Request, mcc: str = "", mnc: str = "", tac: str = "", eci: str = ""):
    ip = req.headers.get("x-real-ip") or (req.client.host if req.client else "?")
    if not _limit(ip, 120, 3600):
        raise HTTPException(429, "كثير")
    cell = _cell_key(mcc, mnc, tac, eci)
    with _lock, _db() as c:
        rows = c.execute("SELECT dev, lat, lon, rsrp FROM obs WHERE cell=? AND at>?",
                         (cell, int(time.time()) - 180 * 86400)).fetchall()
        members = len({r[0] for r in rows})
    est = estimate(rows)
    if not est:
        return {"ok": True, "found": False, "members": members, "need": MIN_MEMBERS}
    return {"ok": True, "found": True, **est}
