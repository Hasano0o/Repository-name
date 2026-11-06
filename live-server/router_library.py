#!/usr/bin/env python3
"""
مكتبة ملفات الراوترات (٦ نوفمبر ٢٠٢٦) — أرشيف مرتب من كل ملفات الأعضاء.

ليش: ملفات zip تتكدس في dumps/ والأرشيف بأسماء عشوائية، ونفس ملف الصفحة يتكرر في عشرات zip.
لما نبي «عندنا net_select.js لأي ZTE؟» كنا نفتح كل zip بأمر طويل. هنا:

  data/library/
    blobs/ab/abcdef…         ← كل ملف مرة وحدة (بصمة sha1) — بدون تكرار
    models/<الماركة>/<الموديل>/
      tree/<مسار الملف>       ← رابط للنسخة (تقدر ls / grep -R فيها)
      zips.tsv               ← كل zip وصل لهالموديل: الوقت · النوع · الجهاز · الفيرموير
      commands.txt           ← الأوامر اللي في كود الصفحة (goformId · ubus · /api/ · ajaxmethod · cgi)
    INDEX.md                 ← جدول كل الموديلات
    index.json               ← نفس الشي للبحث
    seen.json                ← الـ zip اللي انقرت (ما نعيدها)

قراءة بس من dumps/ والأرشيف — ما يحذف ولا ينقل أي zip. المكتبة برا مجلد الويب.
الملفات أصلاً بدون أسرار (التطبيق يمسحها قبل الإرسال).

التشغيل:
  python3 router_library.py                 ← يحدّث المكتبة (الجديد بس)
  python3 router_library.py --rebuild       ← يبنيها من الصفر
  python3 router_library.py --find REGEX    ← وين يطلع النص (أي موديل · أي ملف)
  python3 router_library.py --has PATH      ← مين عنده ملف بهالمسار (مثل auth/network/net_select)
  python3 router_library.py --model NAME    ← ملخص موديل واحد
  python3 router_library.py --unknown       ← الأجهزة المجهولة مجمّعة ببصمة الصفحة (وش هي؟)
"""
import hashlib
import json
import os
import re
import shutil
import sys
import time
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DIRS = [DATA / "dumps", Path("/root/bandly-archive/dumps")]
LIB = Path(os.environ.get("BANDLY_LIBRARY", str(DATA / "library")))
TEXT_EXT = {".js", ".html", ".htm", ".txt", ".json", ".xml", ".css", ".asp", ".lua", ".cgi", ".tmpl", ".properties", ""}
MAX_FILE = 8 * 1024 * 1024

# ─── التعرّف على الموديل والماركة ───

BRANDS = [
    ("Huawei", r"huawei|hirouter|\bh1[0-9]{2}\b|b535|e5785|brovi|gm14"),
    ("ZTE", r"\bzte\b|mu5\d{3}|mc8\d{2}|mc801|u30|u60|u10s|zwrt|g5c?\b"),
    ("FiberHome", r"fiberhome|lg6\d{3}"),
    ("Zyxel", r"zyxel|nr5103|nr7101|fwa505"),
    ("Nokia", r"nokia|fastmile"),
    ("OPPO", r"oppo|t1a"),
    ("GreenPacket", r"green ?packet|قرين باكيت"),
    ("TP-Link", r"tp-?link|archer|mr600|nx\d{3}|m8550"),
    ("D-Link", r"d-?link|dwr-"),
    ("Tenda", r"tenda"),
    ("TOTOLINK", r"toto ?link"),
    ("Inseego", r"inseego|mifi"),
    ("OpenWrt", r"openwrt|pro7|luci"),
    ("COMFAST", r"comfast"),
]
DRIVER_BRAND = {"huawei": "Huawei", "zte": "ZTE", "zteng": "ZTE", "zte-ng": "ZTE", "zteufi": "ZTE", "fiberhome": "FiberHome",
                "zyxel": "Zyxel", "nokia": "Nokia", "nokia-fwa": "Nokia", "oppo": "OPPO", "greenpacket": "GreenPacket", "luci": "OpenWrt"}


def kind_of(name: str) -> str:
    n = name.lower()
    if "-auth" in n:
        return "AUTH"
    if "-ful" in n:
        return "FULL"
    if "add-error" in n:
        return "add-error"
    if "partial" in n:
        return "PARTIAL"
    return "newdevice"


def clean_model(m: str) -> str:
    m = re.sub(r"-(FULL?|AUTH|add-error|PARTIAL)$", "", (m or "").strip(), flags=re.I)
    m = re.sub(r"\s*\((OpenWrt)\)\s*$", "", m, flags=re.I)
    m = re.sub(r"\s+-\s+.*$", "", m)
    return m.strip()


def model_key(name: str) -> str:
    """مفتاح التجميع: بدون الماركة والزوائد والرموز — «FiberHome 5G CPE Pro LG6851F» = «lg6851f»"""
    k = re.sub(r"[^a-z0-9\u0600-\u06ff]", "", name.lower())
    k = re.sub(r"^(zte|huawei|fiberhome|zyxel|nokia|oppo|greenpacket|tplink|dlink|tenda|totolink|inseego)", "", k)
    k = re.sub(r"^(5gcpepro|5gcpe|4gcpe|cpe)", "", k)
    m = re.search(r"(lg6\d{3}[a-z]?|mc8\d{2,3}[a-z]?|mu5\d{3}|mf\d{3}[a-z]*|nr5103e?v?2?|h1\d{2}-?\d{3}|dwr-?\d{4}m?)", k)
    return m.group(1).replace("-", "") if m else (k or "_")


def slug(s: str) -> str:
    s = re.sub(r"[^\w.+-]+", "-", s.strip(), flags=re.U).strip("-")
    return s[:60] or "unknown"


def read_meta(zf: zipfile.ZipFile, zname: str) -> dict:
    def rd(p):
        try:
            return zf.read(p).decode("utf-8", "replace")
        except Exception:
            return ""
    readme, router, live, diag = rd("README.txt"), rd("_bandly/router.txt"), rd("_bandly/live.txt"), rd("_bandly/diag.txt")
    meta = {"zip": zname, "kind": kind_of(zname)}
    m = re.search(r"^الموديل:\s*(.+)$", readme, re.M)
    model = clean_model(m.group(1)) if m else ""
    if not model or model in ("—", "?", "؟"):
        mm = re.match(r"router-(.+?)(?:-FULL?|-AUTH|-add-error|-PARTIAL)?-\d{4}-\d{4,6}\.zip$", zname, re.I)
        model = clean_model(mm.group(1)) if mm else ""
    meta["model"] = model or "unknown"
    for k in ("driver", "profile", "fingerprint"):
        mm = re.search(rf"^{k}:\s*(.*)$", router, re.M)
        if mm:
            meta[k] = mm.group(1).strip()
    mm = re.search(r"^العنوان:\s*(\S+)", readme, re.M) or re.search(r"http://([\d.]+)", live)
    if mm:
        meta["host"] = mm.group(1)
    mm = re.search(r"^الجهاز:\s*(.+)$", diag, re.M)
    if mm:
        meta["device"] = mm.group(1).strip()
    mm = re.search(r"^النسخة:\s*(.+)$", diag, re.M)
    if mm:
        meta["app"] = mm.group(1).strip()
    # الفيرموير/المنصة من الصفحة نفسها (ZTE: js/config/cpe/<موديل>/)
    idxh = rd("index.html")
    mm = re.search(r"<title>\s*([^<]{1,60})", idxh or live, re.I)
    if mm and mm.group(1).strip():
        meta["title"] = re.sub(r"\s+", " ", mm.group(1)).strip()
    blob = "\n".join(rd(n)[:400000] for n in zf.namelist()
                     if Path(n).suffix.lower() in (".js", ".html", ".htm") and not n.startswith("_bandly/"))  # live.txt/README فيها فحوص كل الماركات
    meta["hints"] = ",".join(h for h, rx in HINTS if re.search(rx, blob, re.I))
    plats = sorted({p.split("/")[3] for p in zf.namelist() if p.startswith("js/config/cpe/") and p.count("/") >= 4})
    if plats:
        meta["platform"] = ",".join(plats)
    return meta


def brand_of(meta: dict, cmds: set = frozenset()) -> str:
    d = (meta.get("driver") or "").lower()
    if d in DRIVER_BRAND:
        return DRIVER_BRAND[d]
    hay = f"{meta.get('model', '')} {meta.get('zip', '')} {meta.get('platform', '')}".lower()
    for b, rx in BRANDS:
        if re.search(rx, hay):
            return b
    hints = (meta.get("hints") or "").split(",")
    for h in hints:
        hb = {"ZTE-goform": "ZTE", "ZTE-ubus": "ZTE", "Huawei-api": "Huawei", "OpenWrt-LuCI": "OpenWrt", "FiberHome": "FiberHome",
              "Zyxel": "Zyxel", "Nokia": "Nokia", "Tenda": "Tenda", "TOTOLINK": "TOTOLINK", "TP-Link": "TP-Link", "D-Link": "D-Link",
              "Inseego": "Inseego", "ZLT": "ZLT", "GreenPacket": "GreenPacket"}.get(h)
        if hb:
            return hb
    # الاسم ما يقول شي («http://192.168.8.1/#/login») ← من أوامر الصفحة نفسها
    kinds = {c.split(":", 1)[0] for c in cmds}
    if "huawei-api" in kinds and sum(c.startswith("huawei-api") for c in cmds) > 20:
        return "Huawei"
    if "ubus" in kinds or "goform" in kinds:
        return "ZTE"
    if "fiberhome" in kinds:
        return "FiberHome"
    return "Other"


# ─── الأوامر من كود الصفحة ───

CMD_RX = [
    ("goform", re.compile(r"goformId[\"']?\s*[:=]\s*[\"']([A-Za-z0-9_]{3,})")),
    ("goform-get", re.compile(r"[?&]cmd=([A-Za-z0-9_,%]{3,})")),
    ("ubus", re.compile(r"[\"']((?:zte_|zwrt_)[\w.]+)[\"']\s*,\s*[\"']([a-z][\w]{2,})[\"']")),
    ("huawei-api", re.compile(r"[\"'/]api/([a-z][\w\-]*/[\w\-/]+)")),
    ("fiberhome", re.compile(r"ajaxmethod[\"']?\s*[:=]\s*[\"']?([A-Za-z_]{3,})")),
    ("cgi", re.compile(r"(/cgi-bin/[\w./\-]+)")),
    ("luci", re.compile(r"(admin/(?:modem|status|network|system)/[\w/]+)")),
    # صفحات حديثة (React/Vue — D-Link/Tenda/TP-Link…): روابط الطلبات نفسها
    ("endpoint", re.compile(r"[\"'`](/(?:api|cgi-bin|goform|action|boaform|web|webapi|rest|jrd|login|reqproc|cgi)/[\w/\-.]{2,60})[\"'`?]")),
    ("endpoint", re.compile(r"(?:url|fetch|post|get|ajax)\s*[:(]\s*[\"'`](/[\w/\-.]{3,60})[\"'`?]")),
    ("jsonrpc", re.compile(r"[\"']method[\"']\s*:\s*[\"']([A-Za-z][\w.]{3,50})[\"']")),
]

# بصمات الصفحة: وش نوع الجهاز (حتى لو العضو ما كتب الموديل)
HINTS = [
    ("ZTE-goform", r"goform_(?:get|set)_cmd_process"), ("ZTE-ubus", r"zte_nwinfo_api|zwrt_web"),
    ("Huawei-api", r"/api/webserver/(?:SesTokInfo|token)"), ("OpenWrt-LuCI", r"cgi-bin/luci"),
    ("FiberHome", r"fh_api|FHNCAPIS|fiberhome"), ("Zyxel", r"zyxel|DAL\?oid="), ("Nokia", r"fastmile|web_whw"),
    ("Tenda", r"\btenda\b"), ("TOTOLINK", r"totolink|cstecgi"), ("TP-Link", r"\btp-?link\b|tplinkwifi"), ("D-Link", r"\bd-link\b|\bdlink\b"),
    ("Inseego", r"inseego|novatel|mifi"), ("ZLT", r"\bzlt\b|zlt_"), ("Quectel", r"quectel|AT\+QENG"), ("Sunmi/MiFi-CN", r"jrd/webapi"),
    ("Tozed", r"tozed"), ("GreenPacket", r"greenpacket|/web/v1/"), ("OPPO", r"\boppo\b"),
    ("FIBER/ONT", r"\bgpon\b|\bont\b|optix|\bpon\b|epon|orange fiber"),
    ("LTE-data", r"rsrp|sinr|\bearfcn\b|lte_band|band_?lock"),
]


def commands_in(text: str) -> set:
    out = set()
    for tag, rx in CMD_RX:
        for m in rx.finditer(text):
            v = ".".join(g for g in m.groups() if g) if tag == "ubus" else m.group(1)
            if len(v) < 80:
                out.add(f"{tag}: {v}")
    return out


# ─── البناء ───

def load_json(p: Path, default):
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return default


def zips():
    seen = set()
    for d in DIRS:
        if d.exists():
            for z in sorted(d.glob("*.zip")):
                if z.name not in seen:
                    seen.add(z.name)
                    yield z


def store_blob(data: bytes) -> str:
    h = hashlib.sha1(data).hexdigest()
    p = LIB / "blobs" / h[:2] / h
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)
    return h


def safe_rel(name: str) -> str | None:
    parts = [x for x in name.replace("\\", "/").split("/") if x not in ("", ".")]
    if not parts or any(x == ".." for x in parts):
        return None
    return "/".join(parts)


def ingest(z: Path, idx: dict) -> bool:
    try:
        zf = zipfile.ZipFile(z)
    except Exception:
        return False
    with zf:
        meta = read_meta(zf, z.name)
        meta["at"] = int(z.stat().st_mtime)
        files = []
        cmds = set()
        for info in zf.infolist():
            if info.is_dir() or info.file_size > MAX_FILE:
                continue
            rel = safe_rel(info.filename)
            if not rel:
                continue
            data = zf.read(info)
            files.append((rel, data, info.file_size))
            if Path(rel).suffix.lower() in TEXT_EXT and not rel.startswith("_bandly/"):
                cmds |= commands_in(data.decode("utf-8", "replace"))
        brand = brand_of(meta, cmds)
        # نفس الجهاز بكتابات مختلفة («FiberHome-LG6851F» = «Fiberhome LG6851F» = «5G CPE Pro LG6851F») ← مجلد واحد
        mk = model_key(meta["model"])
        mkey = f"{brand}/" + idx.setdefault("names", {}).setdefault(f"{brand}/{mk}", slug(meta["model"]))
        mdir = LIB / "models" / mkey
        nfiles = 0
        for rel, data, fsize in files:
            h = store_blob(data)
            nfiles += 1
            # tree: أحدث نسخة لكل مسار (_bandly لكل zip لحاله)
            trel = f"_bandly/{z.stem}/{rel[len('_bandly/'):]}" if rel.startswith("_bandly/") else rel
            link = mdir / "tree" / trel
            link.parent.mkdir(parents=True, exist_ok=True)
            target = os.path.relpath(LIB / "blobs" / h[:2] / h, link.parent)
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(target)
            ent = idx["files"].setdefault(h, {"size": fsize, "paths": []})
            pp = f"{mkey}:{rel}"
            if pp not in ent["paths"]:
                ent["paths"].append(pp)
        m = idx["models"].setdefault(mkey, {"brand": brand, "model": meta["model"], "zips": [], "commands": []})
        meta["files"] = nfiles
        m["zips"] = [x for x in m["zips"] if x["zip"] != z.name] + [meta]
        m["commands"] = sorted(set(m["commands"]) | cmds)
        mdir.mkdir(parents=True, exist_ok=True)
        (mdir / "commands.txt").write_text("\n".join(m["commands"]) + "\n", "utf-8")
        rows = ["at\tkind\tzip\tdevice\tapp\tdriver\tprofile\tfingerprint\tplatform\tfiles\ttitle\thints"]
        for x in sorted(m["zips"], key=lambda x: x["at"]):
            rows.append("\t".join(str(v) for v in [time.strftime("%Y-%m-%d %H:%M", time.localtime(x["at"])), x["kind"], x["zip"],
                                                    x.get("device", ""), x.get("app", ""), x.get("driver", ""), x.get("profile", ""),
                                                    x.get("fingerprint", ""), x.get("platform", ""), x.get("files", ""),
                                                    x.get("title", ""), x.get("hints", "")]))
        (mdir / "zips.tsv").write_text("\n".join(rows) + "\n", "utf-8")
    return True


def write_index(idx: dict):
    lines = ["# مكتبة ملفات الراوترات", "",
             f"آخر تحديث: {time.strftime('%Y-%m-%d %H:%M')} · {len(idx['models'])} موديل · {len(idx['files'])} ملف فريد", "",
             "| الماركة | الموديل | zip | FULL | AUTH | جهاز جديد | خطأ إضافة | المنصة/الفيرموير | أوامر | بصمات الصفحة | آخر ملف |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for key, m in sorted(idx["models"].items(), key=lambda kv: (kv[1]["brand"], -len(kv[1]["zips"]))):
        z = m["zips"]
        c = lambda k: sum(1 for x in z if x["kind"] == k)
        fw = sorted({x.get("platform") or (x.get("fingerprint") or "").split("|")[-1] for x in z} - {""})
        last = time.strftime("%m-%d", time.localtime(max(x["at"] for x in z)))
        lines.append(f"| {m['brand']} | `{key.split('/', 1)[1]}` | {len(z)} | {c('FULL')} | {c('AUTH')} | {c('newdevice')} | {c('add-error')} | "
                     f"{' · '.join(fw)[:60]} | {len(m['commands'])} | {' '.join(sorted({h for x in z for h in (x.get('hints') or '').split(',') if h}))[:70]} | {last} |")
    (LIB / "INDEX.md").write_text("\n".join(lines) + "\n", "utf-8")
    tmp = LIB / "index.json.tmp"
    tmp.write_text(json.dumps(idx, ensure_ascii=False), "utf-8")
    tmp.replace(LIB / "index.json")


def build(rebuild=False):
    if rebuild and LIB.exists():
        shutil.rmtree(LIB / "models", ignore_errors=True)
        for p in ("index.json", "seen.json"):
            (LIB / p).unlink(missing_ok=True)
    LIB.mkdir(parents=True, exist_ok=True)
    idx = load_json(LIB / "index.json", {"models": {}, "files": {}})
    seen = load_json(LIB / "seen.json", {})
    added = 0
    for z in zips():
        sig = f"{z.stat().st_size}:{int(z.stat().st_mtime)}"
        if seen.get(z.name) == sig:
            continue
        if ingest(z, idx):
            seen[z.name] = sig
            added += 1
    write_index(idx)
    (LIB / "seen.json").write_text(json.dumps(seen), "utf-8")
    print(f"✓ المكتبة: {added} zip جديد · {len(idx['models'])} موديل · {len(idx['files'])} ملف فريد → {LIB}/INDEX.md")


# ─── البحث ───

def find(pattern: str):
    rx = re.compile(pattern, re.I)
    idx = load_json(LIB / "index.json", {"files": {}})
    hits = 0
    for h, ent in idx["files"].items():
        p = LIB / "blobs" / h[:2] / h
        try:
            t = p.read_text("utf-8", "replace")
        except Exception:
            continue
        m = rx.search(t)
        if not m:
            continue
        hits += 1
        s = max(0, m.start() - 60)
        print(f"■ {ent['size']:>9,}  {' | '.join(ent['paths'][:4])}{' …' if len(ent['paths']) > 4 else ''}")
        print("    " + t[s:m.end() + 100].replace("\n", " ")[:220])
        if hits >= 40:
            print("… (أول ٤٠)")
            break
    if not hits:
        print("ما لقينا شي")


def has(path: str):
    idx = load_json(LIB / "index.json", {"files": {}})
    rows = []
    for ent in idx["files"].values():
        for p in ent["paths"]:
            if path.lower() in p.lower():
                rows.append((ent["size"], p))
    for size, p in sorted(rows, key=lambda r: -r[0])[:60]:
        print(f"{size:>9,}  {p}")
    if not rows:
        print("ما لقينا شي")


def model(name: str):
    idx = load_json(LIB / "index.json", {"models": {}})
    for key, m in idx["models"].items():
        if name.lower() in key.lower():
            print(f"######## {key}  ({len(m['zips'])} zip · {len(m['commands'])} أمر)")
            for x in sorted(m["zips"], key=lambda x: x["at"])[-8:]:
                print(f"  {time.strftime('%m-%d %H:%M', time.localtime(x['at']))}  {x['kind']:<9} {x.get('device', ''):<24} {x.get('platform') or x.get('fingerprint', '')}  {x['zip']}")
            print("  أوامر: " + " · ".join(m["commands"][:30]) + (" …" if len(m["commands"]) > 30 else ""))
            print(f"  الملفات: {LIB}/models/{key}/tree/")


def unknown():
    """كل zip ماركته «Other» (أو موديله مجهول): العنوان · بصمات الصفحة · عدد الأوامر — مجمّعة بالبصمة"""
    idx = load_json(LIB / "index.json", {"models": {}})
    groups = {}
    for key, m in idx["models"].items():
        if m["brand"] != "Other" and not re.search(r"unknown|غير-معروف|partial|^_$", key.split("/", 1)[1]):
            continue
        for x in m["zips"]:
            g = (x.get("hints") or "—", x.get("title") or "—", x.get("host") or "?")
            groups.setdefault(g, []).append(x["zip"])
    for (h, t, host), zs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"{len(zs):>3} · {host:<15} · {t[:28]:<28} · {h[:70]}")
        print(f"      مثال: {zs[-1]}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--find"] and len(a) > 1:
        find(a[1])
    elif a[:1] == ["--has"] and len(a) > 1:
        has(a[1])
    elif a[:1] == ["--model"] and len(a) > 1:
        model(a[1])
    elif a[:1] == ["--unknown"]:
        unknown()
    else:
        build(rebuild="--rebuild" in a)
