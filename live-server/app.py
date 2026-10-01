"""
Bandly Live — وضع الفني
يوصل جوال العميل (ينشر قراءات الإشارة) بالفني (يشوفها حيّة ويرسل تعليمات/أوامر).

  POST /live-api/session            ← العميل يفتح جلسة → {code, token, url}
  WS   /live-api/pub/{code}?token=  ← العميل ينشر القراءات ويستقبل التعليمات والأوامر
  WS   /live-api/sub/{code}?key=    ← الفني يشاهد ويرسل التعليمات والأوامر
  GET  /live-api/report/{code}      ← تقرير الجلسة
  GET  /live-api/techs              ← دليل الفنيين
  GET  /live-api/config             ← هل مفتاح الفني مطلوب
  POST /live-api/rate/{code}        ← العميل يقيّم الفني بعد الجلسة
  GET  /live-api/tech/sessions?key= ← سجل جلسات الفني
  GET  /live/ , /live/{code}        ← صفحة الفني (تنفتح من الواتساب)

الجلسات في الذاكرة فقط (تنتهي بعد ٣٠ دقيقة خمول، وحد أقصى ساعتين).
كلمة مرور الراوتر ما تمر من هنا أبداً — أرقام الإشارة فقط.
"""
import asyncio
import json
import os
import secrets
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
VOICE = DATA / "voice"
VOICE.mkdir(exist_ok=True)
FFMPEG = shutil.which("ffmpeg")
MAX_VOICE_BYTES = 1_500_000
MAX_VOICES = 80
CONFIG_FILE = DATA / "config.json"
TECHS_FILE = DATA / "techs.json"
RATINGS_FILE = DATA / "ratings.json"
TECH_LOG = DATA / "tech_log"
TECH_LOG.mkdir(exist_ok=True)
PUBLIC_URL = os.environ.get("BANDLY_PUBLIC_URL", "https://has-host.com")

IDLE_TTL = 30 * 60          # تنتهي الجلسة بعد نص ساعة بدون قراءات
MAX_TTL = 2 * 60 * 60       # حد أقصى ساعتين
HISTORY = 300               # آخر ٣٠٠ قراءة (١٠ دقائق تقريباً)
MAX_SESSIONS_PER_IP = 15    # بالساعة
MAX_BAD_JOINS_PER_IP = 20   # محاولات كود خاطئ بالساعة
SAY_ALLOWED = {
    "right": "لف يمين شوي",
    "left": "لف يسار شوي",
    "up": "ارفع الهوائي",
    "down": "نزّل الهوائي",
    "slow": "ببطء… خلك تتحرك ببطء",
    "stop": "وقف! ثبّت هنا",
    "back": "ارجع للمكان اللي قبل",
    "wait": "انتظر شوي خلّ القراءة تستقر",
    "more": "كمّل بنفس الاتجاه",
}
CMD_ALLOWED = {"lock_current", "lock_best", "unlock"}


def load_json(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return default


def config() -> dict:
    c = load_json(CONFIG_FILE, {})
    c.setdefault("require_tech_key", False)
    return c


def techs() -> dict:
    return load_json(TECHS_FILE, {})


def tech_ok(key: str | None) -> dict | None:
    if not key:
        return None
    t = techs().get(key)
    if not t or not t.get("active", True):
        return None
    if t.get("expires") and t["expires"] < time.time():
        return None
    return t


class Session:
    def __init__(self, code: str, token: str, label: str):
        self.code = code
        self.token = token
        self.label = label[:40]
        self.created = time.time()
        self.last = time.time()
        self.readings: list[dict] = []
        self.first: dict | None = None
        self.best: dict | None = None
        self.pub: WebSocket | None = None
        self.subs: set[WebSocket] = set()
        self.tech_names: dict[WebSocket, str] = {}
        self.events: list[dict] = []
        self.ended = False
        self.cmd_seq = 0
        self.vtokens: dict[str, str] = {}   # توكن رفع الصوت لكل فني ← اسمه
        self.sid_ws: dict[str, WebSocket] = {}  # رقم الفني ← اتصاله (للمكالمات)
        self.ws_sid: dict[WebSocket, str] = {}
        self.voices = 0
        self.speed: dict = {}                   # before / after
        self.tech_keys: dict[str, str] = {}     # مفتاح الفني ← اسمه (للتقييم والسجل)
        self.rated = False
        self.stars: int | None = None

    def alive(self) -> bool:
        now = time.time()
        return not self.ended and now - self.last < IDLE_TTL and now - self.created < MAX_TTL

    def add(self, r: dict):
        self.readings.append(r)
        if len(self.readings) > HISTORY:
            self.readings = self.readings[-HISTORY:]
        if r.get("rsrp") is not None:
            if self.first is None:
                self.first = r
            if self.best is None or r["rsrp"] > self.best.get("rsrp", -999):
                self.best = r
        self.last = time.time()

    def report(self) -> dict:
        last = next((r for r in reversed(self.readings) if r.get("rsrp") is not None), None)
        gain = None
        if self.first and last:
            gain = round(last["rsrp"] - self.first["rsrp"])
        return {
            "code": self.code,
            "label": self.label,
            "started": int(self.created),
            "duration_sec": int((self.last if self.ended else time.time()) - self.created),
            "first": self.first,
            "best": self.best,
            "last": last,
            "gain_db": gain,
            "events": self.events[-50:],
            "ended": self.ended,
            "speed": self.speed,
            "techs": sorted(set(self.tech_keys.values())),
        }


SESSIONS: dict[str, Session] = {}
IP_HITS: dict[str, list[float]] = {}
IP_BAD: dict[str, list[float]] = {}
KEY_BAD: dict[str, list[float]] = {}
MAX_BAD_KEYS_PER_IP = 20   # مفاتيح فني أو أكواد تقرير خاطئة بالساعة


def client_ip(req_headers, fallback: str) -> str:
    return (req_headers.get("x-real-ip") or req_headers.get("x-forwarded-for", "").split(",")[0].strip() or fallback)


def hit(bucket: dict, ip: str, limit: int) -> bool:
    now = time.time()
    lst = [t for t in bucket.get(ip, []) if now - t < 3600]
    if len(lst) >= limit:
        bucket[ip] = lst
        return False
    lst.append(now)
    bucket[ip] = lst
    return True


def new_code() -> str:
    for _ in range(50):
        c = f"{secrets.randbelow(900000) + 100000}"
        if c not in SESSIONS:
            return c
    raise HTTPException(503, "busy")


async def send(ws: WebSocket | None, msg: dict):
    if ws is None:
        return
    try:
        await ws.send_text(json.dumps(msg, ensure_ascii=False))
    except Exception:
        pass


async def to_subs(s: Session, msg: dict):
    for w in list(s.subs):
        await send(w, msg)


async def end_session(s: Session, why: str):
    if s.ended:
        return
    s.ended = True
    s.events.append({"at": int(time.time()), "e": "end", "why": why})
    rep = s.report()
    try:
        log_session(s, rep)
    except Exception:
        pass
    await to_subs(s, {"t": "end", "why": why, "report": rep})
    await send(s.pub, {"t": "end", "why": why, "report": rep})


def _log_path(key: str) -> Path:
    return TECH_LOG / f"{''.join(c for c in key if c.isalnum())[:24]}.json"


def log_session(s: "Session", rep: dict):
    """نحفظ ملخص الجلسة في سجل كل فني معتمد دخلها (آخر ١٠٠ جلسة)."""
    if not s.tech_keys or not rep.get("first"):
        return
    last = rep.get("last") or {}
    entry = {
        "code": s.code, "label": s.label, "at": int(s.created), "dur": rep.get("duration_sec", 0),
        "gain": rep.get("gain_db"), "first": (rep.get("first") or {}).get("rsrp"),
        "best": (rep.get("best") or {}).get("rsrp"), "last": last.get("rsrp"), "band": last.get("band"),
        "speed": rep.get("speed") or {}, "stars": s.stars,
    }
    for key in s.tech_keys:
        p = _log_path(key)
        lst = load_json(p, [])
        lst = [x for x in lst if x.get("code") != s.code or x.get("at") != entry["at"]]
        lst.insert(0, entry)
        p.write_text(json.dumps(lst[:100], ensure_ascii=False), "utf-8")


def ratings() -> dict:
    return load_json(RATINGS_FILE, {})


def rating_of(key: str) -> tuple[float | None, int]:
    lst = ratings().get(key) or []
    if not lst:
        return None, 0
    return round(sum(x["stars"] for x in lst) / len(lst), 1), len(lst)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

from community import router as community_router  # noqa: E402
app.include_router(community_router)
from stats import router as stats_router, daily_loop as stats_daily  # noqa: E402
app.include_router(stats_router)


@app.on_event("startup")
async def _janitor():
    async def loop():
        while True:
            await asyncio.sleep(30)
            now = time.time()
            for code, s in list(SESSIONS.items()):
                if not s.ended and not s.alive():
                    await end_session(s, "expired")
                # نخلي التقرير متاح ساعة بعد النهاية ثم نحذف
                if s.ended and now - s.last > 3600:
                    SESSIONS.pop(code, None)
                    shutil.rmtree(VOICE / code, ignore_errors=True)
    asyncio.create_task(loop())
    asyncio.create_task(stats_daily())


@app.get("/live-api/config")
async def get_config():
    return {"require_tech_key": config()["require_tech_key"]}


@app.post("/live-api/session")
async def create_session(req: Request):
    ip = client_ip(req.headers, req.client.host if req.client else "?")
    if not hit(IP_HITS, ip, MAX_SESSIONS_PER_IP):
        raise HTTPException(429, "محاولات كثيرة، جرّب بعد شوي")
    try:
        body = await req.json()
    except Exception:
        body = {}
    code = new_code()
    token = secrets.token_hex(16)
    SESSIONS[code] = Session(code, token, str(body.get("label") or "")[:40])
    return {
        "code": code,
        "token": token,
        "url": f"{PUBLIC_URL}/live/{code}",
        "expires_in": IDLE_TTL,
    }


def _bad_try(req: Request):
    """نحسب المحاولات الخاطئة (مفتاح فني أو كود) لكل IP — بعد الحد نوقفه ساعة."""
    ip = client_ip(req.headers, req.client.host if req.client else "?")
    if not hit(KEY_BAD, ip, MAX_BAD_KEYS_PER_IP):
        raise HTTPException(429, "محاولات خاطئة كثيرة، جرّب بعد ساعة")


@app.get("/live-api/report/{code}")
async def get_report(code: str, req: Request):
    s = SESSIONS.get(code)
    if not s:
        _bad_try(req)
        raise HTTPException(404, "الجلسة غير موجودة")
    return s.report()


@app.get("/live-api/techs")
async def list_techs(city: str | None = None):
    out = []
    for key, t in techs().items():
        if not t.get("listed", True) or not t.get("active", True):
            continue
        if t.get("expires") and t["expires"] < time.time():
            continue
        if city and city not in (t.get("city") or ""):
            continue
        avg, n = rating_of(key)
        out.append({**{k: t.get(k) for k in ("name", "city", "phone", "note")}, "rating": avg, "rating_n": n})
    out.sort(key=lambda x: (-(x["rating"] or 0) * min(x["rating_n"], 5), x["name"] or ""))
    return {"techs": out}


@app.get("/live-api/tech/sessions")
async def tech_sessions(key: str, req: Request):
    if not tech_ok(key):
        _bad_try(req)
        raise HTTPException(403, "مفتاح الفني غير صالح")
    avg, n = rating_of(key)
    return {"sessions": load_json(_log_path(key), [])[:50], "rating": avg, "rating_n": n}


@app.post("/live-api/rate/{code}")
async def rate(code: str, req: Request):
    s = SESSIONS.get(code)
    if not s:
        raise HTTPException(404, "الجلسة غير موجودة")
    body = await req.json()
    if not secrets.compare_digest(s.token, str(body.get("token") or "")):
        raise HTTPException(403)
    if s.rated:
        return {"ok": True, "dup": True}
    try:
        stars = int(body.get("stars"))
    except Exception:
        raise HTTPException(400)
    if not 1 <= stars <= 5:
        raise HTTPException(400)
    s.rated = True
    s.stars = stars
    note = str(body.get("note") or "")[:300]
    r = ratings()
    for key in s.tech_keys:
        r.setdefault(key, []).append({"stars": stars, "at": int(time.time()), "code": code, "note": note})
        r[key] = r[key][-500:]
        p = _log_path(key)
        lst = load_json(p, [])
        for x in lst:
            if x.get("code") == code and x.get("at") == int(s.created):
                x["stars"] = stars
        p.write_text(json.dumps(lst, ensure_ascii=False), "utf-8")
    RATINGS_FILE.write_text(json.dumps(r, ensure_ascii=False), "utf-8")
    return {"ok": True}


@app.get("/live-api/tech/check")
async def tech_check(key: str, req: Request):
    t = tech_ok(key)
    if not t:
        _bad_try(req)
        return {"ok": False}
    return {"ok": True, "name": t.get("name"), "expires": t.get("expires")}


# ═══ العميل ═══
@app.websocket("/live-api/pub/{code}")
async def ws_pub(ws: WebSocket, code: str, token: str = ""):
    s = SESSIONS.get(code)
    if not s or not secrets.compare_digest(s.token, token) or not s.alive():
        await ws.accept()
        await ws.close(code=4404)
        return
    await ws.accept()
    if s.pub is not None:
        try:
            await s.pub.close(code=4409)
        except Exception:
            pass
    s.pub = ws
    s.last = time.time()
    await send(ws, {"t": "viewers", "n": len(s.subs), "names": list(s.tech_names.values())})
    await to_subs(s, {"t": "status", "customer": True})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 30000:
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            kind = m.get("t")
            if kind == "r":
                r = {k: m.get(k) for k in ("rsrp", "sinr", "band", "pci", "tech", "level", "score", "best", "pinned", "ping")}
                sig = m.get("sig")
                if isinstance(sig, dict) and len(sig) <= 25:
                    r["sig"] = {str(k)[:20]: v for k, v in sig.items()
                                if isinstance(v, (int, float)) or (isinstance(v, str) and len(v) <= 40)}
                r["ts"] = int(time.time() * 1000)
                s.add(r)
                await to_subs(s, {"t": "r", **r})
            elif kind == "cmd_result":
                ev = {"at": int(time.time()), "e": "cmd_result", "id": m.get("id"),
                      "ok": bool(m.get("ok")), "msg": str(m.get("msg") or "")[:200]}
                s.events.append(ev)
                await to_subs(s, {"t": "cmd_result", **ev})
            elif kind == "rtc":
                # إشارات المكالمة من العميل ← فني محدد (to) أو كل الفنيين
                fwd = {"t": "rtc", "kind": m.get("kind"), "data": m.get("data"), "from": "العميل"}
                to = m.get("to")
                if to and to in s.sid_ws:
                    await send(s.sid_ws[to], fwd)
                elif not to:
                    await to_subs(s, fwd)
                if m.get("kind") in ("call", "accept"):
                    s.events.append({"at": int(time.time()), "e": "call", "by": "customer"})
            elif kind == "speed" and m.get("phase") in ("before", "after"):
                try:
                    pt = {k: round(float(m.get(k) or 0), 1) for k in ("down", "up", "ping")}
                except Exception:
                    continue
                pt["at"] = int(time.time())
                s.speed[m["phase"]] = pt
                s.events.append({"at": pt["at"], "e": "speed", "phase": m["phase"], **pt})
                await to_subs(s, {"t": "speed", "speed": s.speed})
            elif kind == "ping":
                s.last = time.time()
                await send(ws, {"t": "pong"})
            elif kind == "end":
                await end_session(s, "customer")
                break
    except WebSocketDisconnect:
        pass
    finally:
        if s.pub is ws:
            s.pub = None
            await to_subs(s, {"t": "rtc", "kind": "gone"})
            await to_subs(s, {"t": "status", "customer": False})


# ═══ الفني ═══
@app.websocket("/live-api/sub/{code}")
async def ws_sub(ws: WebSocket, code: str, key: str = "", name: str = ""):
    ip = client_ip(ws.headers, ws.client.host if ws.client else "?")
    s = SESSIONS.get(code)
    await ws.accept()
    if not s:
        await ws.close(code=4404 if hit(IP_BAD, ip, MAX_BAD_JOINS_PER_IP) else 4429)
        return
    t = tech_ok(key)
    if config()["require_tech_key"] and not t:
        await ws.close(code=4401)
        return
    tech_name = (t or {}).get("name") or name[:30] or "الفني"
    if t:
        s.tech_keys[key] = tech_name
    vt = secrets.token_hex(12)
    s.vtokens[vt] = tech_name
    s.subs.add(ws)
    s.tech_names[ws] = tech_name
    sid = vt[:10]
    s.sid_ws[sid] = ws
    s.ws_sid[ws] = sid
    s.events.append({"at": int(time.time()), "e": "join", "who": tech_name})
    await send(ws, {
        "t": "hello", "label": s.label, "customer": s.pub is not None,
        "history": s.readings[-60:], "ended": s.ended, "report": s.report() if s.ended else None,
        "say": SAY_ALLOWED, "vt": vt, "voice": True, "sid": sid, "call": True, "video": True, "speed": s.speed,
    })
    await send(s.pub, {"t": "viewers", "n": len(s.subs), "names": list(s.tech_names.values())})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 30000 or s.ended:
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            kind = m.get("t")
            if kind == "say":
                k = m.get("k")
                text = SAY_ALLOWED.get(k) if k in SAY_ALLOWED else str(m.get("text") or "")[:80]
                if not text:
                    continue
                s.events.append({"at": int(time.time()), "e": "say", "text": text})
                await send(s.pub, {"t": "say", "k": k, "text": text, "from": tech_name})
            elif kind == "cmd" and m.get("action") in CMD_ALLOWED:
                s.cmd_seq += 1
                cid = s.cmd_seq
                s.events.append({"at": int(time.time()), "e": "cmd", "id": cid, "action": m["action"]})
                await send(s.pub, {"t": "cmd", "id": cid, "action": m["action"], "from": tech_name})
                await to_subs(s, {"t": "cmd_sent", "id": cid, "action": m["action"],
                                  "delivered": s.pub is not None})
            elif kind == "rtc":
                # إشارات المكالمة من الفني ← العميل (ومعها رقم الفني عشان العميل يرد عليه بالذات)
                await send(s.pub, {"t": "rtc", "kind": m.get("kind"), "data": m.get("data"),
                                   "sid": s.ws_sid.get(ws), "from": tech_name})
                if m.get("kind") == "accept":
                    # الفنيين الثانيين: المكالمة انأخذت
                    for w in list(s.subs):
                        if w is not ws:
                            await send(w, {"t": "rtc", "kind": "taken", "from": tech_name})
            elif kind == "ping":
                await send(ws, {"t": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        s.subs.discard(ws)
        s.tech_names.pop(ws, None)
        _sid = s.ws_sid.pop(ws, None)
        if _sid:
            s.sid_ws.pop(_sid, None)
            await send(s.pub, {"t": "rtc", "kind": "gone", "sid": _sid})
        await send(s.pub, {"t": "viewers", "n": len(s.subs), "names": list(s.tech_names.values())})


# ═══ المكالمات: خوادم ICE (STUN/TURN) ببيانات مؤقتة ═══
import base64 as _b64


@app.get("/live-api/ice/{code}")
async def ice(code: str, token: str = ""):
    s = SESSIONS.get(code)
    if not s or s.ended:
        raise HTTPException(404)
    if not (secrets.compare_digest(s.token, token) or token in s.vtokens):
        raise HTTPException(403)
    servers = [{"urls": ["stun:stun.l.google.com:19302"]}]
    sec = _secret("turn_secret")
    host = os.environ.get("BANDLY_TURN_HOST", "has-host.com")
    if sec:
        user = f"{int(time.time()) + 3 * 3600}:{code}"
        cred = _b64.b64encode(hmac.new(sec.encode(), user.encode(), hashlib.sha1).digest()).decode()
        servers.insert(0, {"urls": [f"stun:{host}:3478"]})
        servers.append({"urls": [f"turn:{host}:3478?transport=udp", f"turn:{host}:3478?transport=tcp"],
                        "username": user, "credential": cred})
    return {"iceServers": servers}


# ═══ الرسائل الصوتية ═══
def _transcode(src: Path, dst: Path) -> bool:
    """نحوّل أي تسجيل (webm/ogg/mp4/m4a/3gp) إلى m4a (AAC) يشتغل على أندرويد وآيفون والمتصفح."""
    if not FFMPEG:
        return False
    try:
        r = subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-t", "90",
             "-ac", "1", "-ar", "24000", "-c:a", "aac", "-b:a", "40k", "-movflags", "+faststart", str(dst)],
            timeout=25, capture_output=True)
        return r.returncode == 0 and dst.exists() and dst.stat().st_size > 200
    except Exception:
        return False


@app.post("/live-api/voice/{code}")
async def upload_voice(code: str, file: UploadFile = File(...), role: str = Form("cust"),
                       token: str = Form(""), dur: float = Form(0)):
    s = SESSIONS.get(code)
    if not s or s.ended:
        raise HTTPException(404, "الجلسة منتهية")
    if role == "cust":
        if not secrets.compare_digest(s.token, token):
            raise HTTPException(403, "غير مصرح")
        who = "العميل"
    else:
        who = s.vtokens.get(token)
        if not who:
            raise HTTPException(403, "غير مصرح")
    if s.voices >= MAX_VOICES:
        raise HTTPException(429, "وصلت الحد الأقصى للرسائل الصوتية في الجلسة")
    data = await file.read(MAX_VOICE_BYTES + 1)
    if len(data) > MAX_VOICE_BYTES or len(data) < 200:
        raise HTTPException(413, "التسجيل طويل أو فاضي")
    s.voices += 1
    d = VOICE / code
    d.mkdir(exist_ok=True)
    vid = f"{int(time.time()*1000)}{secrets.token_hex(3)}"
    ext = (Path(file.filename or "").suffix or ".bin").lower()[:6]
    raw = d / f"{vid}.src{ext}"
    raw.write_bytes(data)
    out = d / f"{vid}.m4a"
    ok = await asyncio.to_thread(_transcode, raw, out)
    if ok:
        raw.unlink(missing_ok=True)
        fname = out.name
    else:
        fname = raw.name   # بدون ffmpeg نرسل الملف كما هو
    url = f"{PUBLIC_URL}/live-api/voice/{code}/{fname}"
    msg = {"t": "voice", "url": url, "from": who, "role": role, "dur": round(float(dur or 0), 1)}
    s.events.append({"at": int(time.time()), "e": "voice", "from": who})
    s.last = time.time()
    if role == "cust":
        await to_subs(s, msg)
    else:
        await send(s.pub, msg)
        await to_subs(s, {**msg, "echo": True})
    return {"ok": True, "url": url}


@app.get("/live-api/voice/{code}/{fname}")
async def get_voice(code: str, fname: str):
    if "/" in fname or ".." in fname or not code.isdigit():
        raise HTTPException(404)
    p = VOICE / code / fname
    if not p.exists():
        raise HTTPException(404)
    mt = "audio/mp4" if fname.endswith(".m4a") else "application/octet-stream"
    return FileResponse(p, media_type=mt, headers={"Cache-Control": "private, max-age=3600"})


# ═══ مركز Bandly (التطبيق المصغر للبوت): فنيين · إعلانات · ملاحظات · أجهزة ═══
import hashlib, hmac
from urllib.parse import parse_qsl
import urllib.request as _ur

HUB = DATA / "hub"
HUB.mkdir(exist_ok=True)
HUB_IMG = Path(os.environ.get("BANDLY_HUB_IMG", "/var/www/has-host.com/netguide-images/hub"))
HUB_IMG_URL = os.environ.get("BANDLY_HUB_IMG_URL", "https://has-host.com/netguide-images/hub")
MAX_IMG = 4_000_000
HUB_TYPES = {
    "tech": "🛠️ طلب تسجيل فني",
    "ad": "📢 طلب إعلان",
    "feedback": "💬 ملاحظة على التطبيق",
    "device": "🔌 طلب إضافة جهاز",
}
FIELD_AR = {
    "name": "الاسم", "phone": "الجوال/واتساب", "city": "المدينة", "areas": "الأحياء", "years": "سنوات الخبرة",
    "services": "الخدمات", "shop": "اسم المحل", "activity": "النشاط", "whatsapp": "واتساب", "location": "الموقع",
    "plan": "المدة", "kind": "النوع", "text": "التفاصيل", "brand": "الشركة", "model": "الموديل", "carrier": "شركة الاتصال",
    "address": "عنوان الراوتر", "firmware": "نسخة البرنامج", "tester": "مستعد يجرب", "contact": "التواصل", "notes": "ملاحظات",
}


def _secret(name: str) -> str:
    p = DATA / name
    return p.read_text().strip() if p.exists() else ""


def _tg(method: str, data: dict | None = None, files: dict | None = None) -> dict:
    tok = _secret("bot_token")
    if not tok:
        return {"ok": False, "description": "no token"}
    url = f"https://api.telegram.org/bot{tok}/{method}"
    try:
        if files:
            boundary = "----bandly" + secrets.token_hex(8)
            body = b""
            for k, v in (data or {}).items():
                body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
            for k, (fname, content) in files.items():
                body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{fname}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n"
            body += f"--{boundary}--\r\n".encode()
            req = _ur.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        else:
            req = _ur.Request(url, data=json.dumps(data or {}, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"})
        with _ur.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception as e:
        return {"ok": False, "description": str(e)}


def _check_init(init_data: str) -> dict | None:
    """نتحقق إن الطلب جاي من داخل تليجرام فعلاً (توقيع initData بتوكن البوت)."""
    tok = _secret("bot_token")
    if not tok or not init_data:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        got = pairs.pop("hash", "")
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        key = hmac.new(b"WebAppData", tok.encode(), hashlib.sha256).digest()
        calc = hmac.new(key, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, got):
            return None
        if time.time() - int(pairs.get("auth_date", "0")) > 86400:
            return None
        return json.loads(pairs.get("user", "{}"))
    except Exception:
        return None


def _owner() -> int:
    return int(config().get("owner_id") or 0)


def _esc(t: str) -> str:
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


HUB_HITS: dict[str, list[float]] = {}


def _real_ext(data: bytes) -> str | None:
    """يتعرف على الملف من أول بايتات: JPEG / PNG / WEBP، أو نص UTF-8 عادي. غير كذا يرجع None."""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if b"\x00" in data:
        return None
    try:
        txt = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    head = txt.lstrip()[:200].lower()
    if head.startswith("<") or "<script" in head or "<html" in head or "<svg" in head:
        return None
    return ".txt"


@app.post("/live-api/hub/submit")
async def hub_submit(req: Request):
    form = await req.form()
    user = _check_init(str(form.get("initData") or ""))
    if not user:
        raise HTTPException(401, "افتح التطبيق من داخل البوت")
    kind = str(form.get("type") or "")
    if kind not in HUB_TYPES:
        raise HTTPException(400, "نوع غير معروف")
    uid = str(user.get("id"))
    if not hit(HUB_HITS, uid, 8):
        raise HTTPException(429, "أرسلت طلبات كثيرة، جرّب بعد ساعة")
    fields = {}
    for k in FIELD_AR:
        v = form.get(k)
        if isinstance(v, str) and v.strip():
            fields[k] = v.strip()[:1500]
    rid = f"{kind}-{int(time.time())}-{secrets.token_hex(3)}"
    images = []
    HUB_IMG.mkdir(parents=True, exist_ok=True)
    for i in range(4):
        f = form.get(f"img{i}")
        if f is None or not hasattr(f, "read"):
            continue
        data = await f.read(MAX_IMG + 1)
        if not data or len(data) > MAX_IMG:
            continue
        # النوع من محتوى الملف نفسه مو من اسمه — أي شي غير صورة أو نص عادي ما ينحفظ
        ext = _real_ext(data)
        if not ext:
            continue
        name = f"{rid}-{i}{ext}"
        (HUB_IMG / name).write_bytes(data)
        images.append({"file": name, "url": f"{HUB_IMG_URL}/{name}", "ext": ext})
    rec = {
        "id": rid, "type": kind, "at": int(time.time()), "status": "new", "fields": fields, "images": images,
        "user": {"id": user.get("id"), "name": " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x),
                 "username": user.get("username")},
    }
    (HUB / f"{rid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), "utf-8")

    # إشعار المالك في البوت مع أزرار القرار
    u = rec["user"]
    who = f'<a href="tg://user?id={u["id"]}">{_esc(u["name"] or "مستخدم")}</a>' + (f' (@{_esc(u["username"])})' if u.get("username") else "")
    lines = [f"<b>{HUB_TYPES[kind]}</b>", f"من: {who}", ""]
    lines += [f"• <b>{FIELD_AR[k]}:</b> {_esc(v)}" for k, v in fields.items()]
    text = "\n".join(lines)[:3900]
    if kind in ("tech", "ad"):
        kb = [[{"text": "✅ قبول", "callback_data": f"hub:ok:{rid}"}, {"text": "❌ رفض", "callback_data": f"hub:no:{rid}"}]]
    else:
        kb = [[{"text": "✅ تم الاطلاع", "callback_data": f"hub:seen:{rid}"}, {"text": "💬 رد عليه", "url": f"tg://user?id={u['id']}"}]]
    owner = _owner()
    if owner:
        _tg("sendMessage", {"chat_id": owner, "text": text, "parse_mode": "HTML", "reply_markup": {"inline_keyboard": kb},
                            "disable_web_page_preview": True})
        for im in images:
            if im["ext"] == ".txt":
                _tg("sendDocument", {"chat_id": owner, "caption": f"📎 {rid}"}, {"document": (im["file"], (HUB_IMG / im["file"]).read_bytes())})
            else:
                _tg("sendPhoto", {"chat_id": owner, "photo": im["url"], "caption": f"📎 {rid}"})
    return {"ok": True, "id": rid}


def _hub_auth(req: Request):
    sec = _secret("hub_secret")
    if not sec or not secrets.compare_digest(req.headers.get("x-hub-secret", ""), sec):
        raise HTTPException(403)


@app.get("/live-api/hub/item/{rid}")
async def hub_item(rid: str, req: Request):
    _hub_auth(req)
    p = HUB / f"{Path(rid).name}.json"
    if not p.exists():
        raise HTTPException(404)
    return json.loads(p.read_text("utf-8"))


@app.post("/live-api/hub/decide/{rid}")
async def hub_decide(rid: str, req: Request):
    """يستدعيه البوت لما يضغط المالك قبول/رفض. يرجع نتيجة القرار."""
    _hub_auth(req)
    body = await req.json()
    action = body.get("action")
    p = HUB / f"{Path(rid).name}.json"
    if not p.exists():
        raise HTTPException(404, "الطلب غير موجود")
    rec = json.loads(p.read_text("utf-8"))
    if rec["status"] not in ("new",) and action != "seen":
        return {"ok": False, "msg": f"الطلب {('مقبول' if rec['status'] == 'ok' else 'مرفوض')} من قبل", "rec": rec}
    uid = rec["user"]["id"]
    out = {"ok": True, "rec": rec}
    if action == "no":
        rec["status"] = "no"
        _tg("sendMessage", {"chat_id": uid, "text": "نعتذر، ما قدرنا نقبل طلبك الحين. تقدر تتواصل مع المبرمج للتفاصيل: @hasa_n20"})
    elif action == "seen":
        rec["status"] = "seen"
        _tg("sendMessage", {"chat_id": uid, "text": "شكراً لك 💙 وصلت رسالتك للمبرمج واطّلع عليها."})
    elif action == "ok" and rec["type"] == "tech":
        f = rec["fields"]
        t = techs()
        key = "T" + secrets.token_hex(4).upper()
        t[key] = {"name": f.get("name") or rec["user"]["name"], "phone": f.get("phone", ""), "city": f.get("city", ""),
                  "note": f.get("services", ""), "expires": int(time.time() + int(body.get("days") or 30) * 86400),
                  "active": True, "listed": True, "created": int(time.time()), "tg": uid}
        TECHS_FILE.write_text(json.dumps(t, ensure_ascii=False, indent=1), "utf-8")
        rec["status"] = "ok"; rec["tech_key"] = key
        _tg("sendMessage", {"chat_id": uid, "parse_mode": "HTML", "text":
            "🎉 <b>تم قبولك كفني معتمد في Bandly!</b>\n\n"
            f"مفتاح الفني حقك: <code>{key}</code>\n\n"
            "استخدمه في «وضع الفني» داخل التطبيق أو في صفحة الفني:\nhttps://has-host.com/live/\n\n"
            "واسمك صار يطلع للعملاء في دليل الفنيين."})
        out["msg"] = f"انضاف الفني وأُرسل له المفتاح {key}"
    elif action == "ok" and rec["type"] == "ad":
        rec["status"] = "ok"
        _tg("sendMessage", {"chat_id": uid, "text": "✅ تم قبول طلب إعلانك في Bandly! بنتواصل معك لتأكيد التفاصيل والدفع قبل النشر."})
        out["msg"] = "تم القبول — الإعلان انضاف للقائمة (غير مفعّل) وتقدر تفعّله من لوحة الإعلانات"
    else:
        rec["status"] = "ok"
    rec["decided_at"] = int(time.time())
    p.write_text(json.dumps(rec, ensure_ascii=False, indent=1), "utf-8")
    return out


@app.get("/live-api/hub/stats")
async def hub_stats(req: Request):
    _hub_auth(req)
    items = [json.loads(x.read_text("utf-8")) for x in HUB.glob("*.json")]
    out: dict = {}
    for it in items:
        out.setdefault(it["type"], {}).setdefault(it["status"], 0)
        out[it["type"]][it["status"]] += 1
    return out


# ═══ صفحة الفني (الويب) ═══
VIEWER = (BASE / "viewer.html").read_text("utf-8")


@app.get("/live/", response_class=HTMLResponse)
@app.get("/live", response_class=HTMLResponse)
async def viewer_home():
    return HTMLResponse(VIEWER, headers={"Cache-Control": "no-store"})


@app.get("/live/{code}", response_class=HTMLResponse)
async def viewer_code(code: str):
    return HTMLResponse(VIEWER, headers={"Cache-Control": "no-store"})


@app.get("/live-api/health")
async def health():
    return JSONResponse({"ok": True, "sessions": sum(1 for s in SESSIONS.values() if not s.ended)})
