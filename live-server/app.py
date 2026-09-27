"""
Bandly Live — وضع الفني
يوصل جوال العميل (ينشر قراءات الإشارة) بالفني (يشوفها حيّة ويرسل تعليمات/أوامر).

  POST /live-api/session            ← العميل يفتح جلسة → {code, token, url}
  WS   /live-api/pub/{code}?token=  ← العميل ينشر القراءات ويستقبل التعليمات والأوامر
  WS   /live-api/sub/{code}?key=    ← الفني يشاهد ويرسل التعليمات والأوامر
  GET  /live-api/report/{code}      ← تقرير الجلسة
  GET  /live-api/techs              ← دليل الفنيين
  GET  /live-api/config             ← هل مفتاح الفني مطلوب
  GET  /live/ , /live/{code}        ← صفحة الفني (تنفتح من الواتساب)

الجلسات في الذاكرة فقط (تنتهي بعد ٣٠ دقيقة خمول، وحد أقصى ساعتين).
كلمة مرور الراوتر ما تمر من هنا أبداً — أرقام الإشارة فقط.
"""
import asyncio
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
CONFIG_FILE = DATA / "config.json"
TECHS_FILE = DATA / "techs.json"
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
        }


SESSIONS: dict[str, Session] = {}
IP_HITS: dict[str, list[float]] = {}
IP_BAD: dict[str, list[float]] = {}


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
    await to_subs(s, {"t": "end", "why": why, "report": rep})
    await send(s.pub, {"t": "end", "why": why, "report": rep})


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


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
    asyncio.create_task(loop())


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


@app.get("/live-api/report/{code}")
async def get_report(code: str):
    s = SESSIONS.get(code)
    if not s:
        raise HTTPException(404, "الجلسة غير موجودة")
    return s.report()


@app.get("/live-api/techs")
async def list_techs(city: str | None = None):
    out = []
    for t in techs().values():
        if not t.get("listed", True) or not t.get("active", True):
            continue
        if t.get("expires") and t["expires"] < time.time():
            continue
        if city and city not in (t.get("city") or ""):
            continue
        out.append({k: t.get(k) for k in ("name", "city", "phone", "note")})
    return {"techs": out}


@app.get("/live-api/tech/check")
async def tech_check(key: str):
    t = tech_ok(key)
    if not t:
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
            if len(raw) > 4000:
                continue
            try:
                m = json.loads(raw)
            except Exception:
                continue
            kind = m.get("t")
            if kind == "r":
                r = {k: m.get(k) for k in ("rsrp", "sinr", "band", "pci", "tech", "level", "score", "best", "pinned")}
                r["ts"] = int(time.time() * 1000)
                s.add(r)
                await to_subs(s, {"t": "r", **r})
            elif kind == "cmd_result":
                ev = {"at": int(time.time()), "e": "cmd_result", "id": m.get("id"),
                      "ok": bool(m.get("ok")), "msg": str(m.get("msg") or "")[:200]}
                s.events.append(ev)
                await to_subs(s, {"t": "cmd_result", **ev})
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
    s.subs.add(ws)
    s.tech_names[ws] = tech_name
    s.events.append({"at": int(time.time()), "e": "join", "who": tech_name})
    await send(ws, {
        "t": "hello", "label": s.label, "customer": s.pub is not None,
        "history": s.readings[-60:], "ended": s.ended, "report": s.report() if s.ended else None,
        "say": SAY_ALLOWED,
    })
    await send(s.pub, {"t": "viewers", "n": len(s.subs), "names": list(s.tech_names.values())})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 1000 or s.ended:
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
            elif kind == "ping":
                await send(ws, {"t": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        s.subs.discard(ws)
        s.tech_names.pop(ws, None)
        await send(s.pub, {"t": "viewers", "n": len(s.subs), "names": list(s.tech_names.values())})


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
