"""
«الإصلاح الذاتي» للمزايا التجريبية (٢٨ نوفمبر — طلب حسن: «الرسيفر يصلحها بنفسه ويوصل العضو تم الإصلاح جرّب»).

الفكرة: كل ميزة تجريبية لها صيغ بديلة معروفة (الفاصل ; أو , · true أو 1 …) — كلها داخل التطبيق ومن كود صفحات الراوترات.
لو الصيغة الأولى فشلت عند عضو، التطبيق يجرّب البدائل ويتأكد بالقراءة، واللي ينجح يبلّغ فيه هنا.
بعدها أي عضو بنفس الدرايفر/الموديل ياخذ الصيغة الناجحة أول (بدون تحديث للتطبيق).

  POST /live-api/app/labfix  {driver, model, lab, variant}  ← صيغة نجحت (نعدّ كم عضو)
  GET  /live-api/app/labfix?driver=&model=                  ← {fixes: {lab: variant}} (الأكثر نجاحاً لهالموديل، وإلا للدرايفر)

التخزين: data/labfix/variants.json  {"driver|model|lab": {"variant": n, ...}}
إيقاف: touch data/labfix/off  (يرجع {fixes:{}} — التطبيق يجرّب بترتيبه العادي)
الحالة: python3 labfix.py --stats
"""
import json
import re
import sys
import threading
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
LF = DATA / "labfix"
STORE = LF / "variants.json"
_lock = threading.Lock()


def _cl(v, n: int) -> str:
    return re.sub(r"[^\w\-. :|]", "", str(v or ""), flags=re.UNICODE)[:n]


def load() -> dict:
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def record(driver: str, model: str, lab: str, variant: str) -> None:
    LF.mkdir(parents=True, exist_ok=True)
    with _lock:
        d = load()
        for key in (f"{driver}|{model}|{lab}", f"{driver}||{lab}"):
            row = d.setdefault(key, {})
            row[variant] = int(row.get(variant, 0)) + 1
            row["_at"] = int(time.time())
        tmp = STORE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(STORE)


def best(driver: str, model: str) -> dict:
    """لكل ميزة: الصيغة الأكثر نجاحاً لهالموديل، وإلا للدرايفر كله"""
    if (LF / "off").exists():
        return {}
    d = load()
    out: dict[str, str] = {}
    for want in ("", model):  # الدرايفر كله أول، وبعده الموديل يغلب
        for key, row in d.items():
            parts = key.split("|")
            if len(parts) != 3 or parts[0] != driver or parts[1] != want or not parts[2]:
                continue
            votes = {k: v for k, v in row.items() if not k.startswith("_")}
            if votes:
                out[parts[2]] = max(votes.items(), key=lambda kv: kv[1])[0]
        if not model:
            break
    return out


try:
    from fastapi import APIRouter, HTTPException, Request
except Exception:  # الاختبارات بدون fastapi
    APIRouter = None

if APIRouter:
    router = APIRouter()
    HITS: dict[str, list[float]] = {}

    @router.post("/live-api/app/labfix")
    async def labfix_post(req: Request):
        ip = req.headers.get("x-real-ip") or (req.client.host if req.client else "?")
        now = time.time()
        h = [t for t in HITS.get(ip, []) if now - t < 3600]
        if len(h) >= 30:
            return {"ok": True}
        HITS[ip] = h + [now]
        try:
            b = await req.json()
        except Exception:
            raise HTTPException(400, "bad json")
        drv, mdl, lab, var = _cl(b.get("driver"), 40), _cl(b.get("model"), 60), _cl(b.get("lab"), 60), _cl(b.get("variant"), 40)
        if not drv or not lab or not var:
            raise HTTPException(400, "missing")
        record(drv, mdl, lab, var)
        return {"ok": True}

    @router.get("/live-api/app/labfix")
    async def labfix_get(driver: str = "", model: str = ""):
        return {"fixes": best(_cl(driver, 40), _cl(model, 60))}


if __name__ == "__main__" and "--stats" in sys.argv:
    for k, row in sorted(load().items()):
        votes = ", ".join(f"{v}×{n}" for v, n in row.items() if not v.startswith("_"))
        print(f"{k}: {votes}")
