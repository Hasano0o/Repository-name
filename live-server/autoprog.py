#!/usr/bin/env python3
"""
«برمج لي جهازي» (١٠ نوفمبر ٢٠٢٦) — مطابقة ملفات راوتر غير معروف مع العائلات اللي ندعمها.

الفكرة: التطبيق ما تعرّف على راوتر العضو ← يسحب ملفات صفحته (نفس «جهاز جديد») ← هذا السكربت يقرأ
كود الصفحة ويقول «هذا من عائلة كذا» ← التطبيق يجرّب درايفر العائلة على الراوتر نفسه (دخول + إشارة)
ويرجّع النتيجة:
  • نجح  ← الراوتر ينضاف للعضو **قراءة بس**، والبصمة تنحفظ: أي عضو بنفس الصفحة يتبرمج بدون رفع ملفات.
  • ما طابق / فشل ← تقرير جاهز للمبرمج في data/autoprog/escalate/ (العائلة الأقرب · وين وقف · الميزات اللي في صفحته).

القواعد:
  • الرسيفر ما يوصل راوتر العضو ولا عنده كلمة المرور — التأكيد دايماً من التطبيق.
  • القراءات كلها تنفتح، والتطبيق يكتشف وش يشتغل منها على الراوتر نفسه (اكتشاف الميزات).
  • أوامر التغيير (ترددات/وضع الشبكة/إعادة تشغيل…) تنفتح تلقائي **بس لو أمرها موجود في كود صفحة الراوتر نفسه**
    (جدول WRITES) — نفس قاعدتنا اليدوية «لا كتابة بدون دليل». تثبيت البرج ما ينفتح تلقائي أبداً.
  • ما يلمس app_dump ولا ملفات zip — يقرأ بس.
  • إيقاف فوري للكل:        touch data/autoprog/off          (يرجع: rm data/autoprog/off)
  • إيقاف أوامر التغيير بس:  touch data/autoprog/writes_off   (الراوترات المضافة ترجع قراءة بس خلال يوم)

الربط في app.py (سطرين):
    from autoprog import router as autoprog_router  # noqa: E402
    app.include_router(autoprog_router)

التشغيل اليدوي:
  python3 autoprog.py --scan           ← يفحص كل ملفات «جهاز جديد» الموجودة: كم واحد يطابق عائلة معروفة
  python3 autoprog.py --zip FILE.zip   ← تفاصيل ملف واحد (النقاط والأدلة)
  python3 autoprog.py --stats          ← وش صار: تبرمج تلقائي / تحوّل للمبرمج / البصمات المحفوظة
  python3 autoprog.py --block KEY METHOD    ← يقفل أمر تغيير على بصمة (مثل setBand) — يوصل الأعضاء خلال يوم
  python3 autoprog.py --unblock KEY METHOD
"""
import hashlib
import json
import re
import secrets
import sys
import time
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DUMP_DIRS = [DATA / "dumps", Path("/root/bandly-archive/dumps")]
AP = DATA / "autoprog"
OPEN = AP / "open"
ESC = AP / "escalate"
CASES = AP / "cases.jsonl"
PROFILES = AP / "profiles.json"
OFF = AP / "off"
WRITES_OFF = AP / "writes_off"
DISCOVERED = AP / "discovered.jsonl"

DAY = 86400
MAX_SCAN = 3_000_000
TEXT_EXT = {".js", ".html", ".htm", ".txt", ".json", ".xml", ".asp", ".lua", ".cgi", ".tmpl", ""}
# مكتبات عامة — ما فيها شي يخص الراوتر (وكبيرة)
LIBLIKE = re.compile(r"jquery(?!\.tp)|echarts|bootstrap|crypto-js|chunk-vendors|vue(\.runtime)?(\.min)?\.js$|react(-dom)?\.|lodash|moment|knockout", re.I)

# ─── بصمات العائلات ───
# (الدرايفر في التطبيق · الاسم للعضو · الحد الأدنى · [(نقاط، نمط في كود الصفحة، وصف)] · [(نقاط، نمط في الفحص الحي live.txt، وصف)])
# الأنماط من كود الدرايفرات نفسها (detect/login) — مو تخمين. النقاط السالبة = «هذي عائلة ثانية».
FAMILIES = [
    ("huawei-lte", "هواوي", 8, [
        (5, r"api/webserver/(?:SesTokInfo|token)", "رمز جلسة هواوي"),
        (3, r"api/user/(?:login|state-login|challenge_login|authentication_login)", "دخول هواوي"),
        (3, r"api/device/(?:signal|information|basic_information)", "قراءة الجهاز/الإشارة"),
        (2, r"__RequestVerificationToken", "رأس التحقق"),
    ], [
        (6, r"هواوي (?:SesTokInfo|token):[^\n]*→ 200[^\n]*<(?:SesInfo|TokInfo|token)>", "الراوتر رد برمز هواوي"),
    ]),
    ("zte", "ZTE", 8, [
        (5, r"goform_get_cmd_process", "قراءة goform"),
        (3, r"goform_set_cmd_process", "كتابة goform"),
        (3, r"wa_inner_version", "إصدار ZTE"),
        (2, r"goformId", "أوامر goformId"),
    ], [
        (6, r"ZTE إصدارات:[^\n]*\"wa_inner_version\":\"[^\"«]", "الراوتر رد بإصدار ZTE"),
        (-8, r"ZTE إصدارات:[^\n]*\"wa_inner_version\":\"\"", "بدون wa_inner_version (ZTE القديم)"),
    ]),
    ("zte-ufi", "ZTE 4G (الجيب)", 9, [
        (4, r"goform_get_cmd_process", "قراءة goform"),
        (3, r"lockband1|SET_BAND_LOCK", "تثبيت ترددات UFI"),
        (-6, r"wa_inner_version", "فيه wa_inner_version (ZTE الجديد)"),
    ], [
        (6, r"ZTE إصدارات:(?=[^\n]*\"wa_inner_version\":\"\")(?=[^\n]*\"cr_version\":\"[^\"«])", "cr_version بدون wa_inner_version"),
    ]),
    ("zte-ng", "ZTE (الجيل الجديد)", 8, [
        (5, r"zwrt_web", "ubus zwrt_web"),
        (4, r"zte_nwinfo_api", "ubus معلومات الشبكة"),
        (2, r"web_login_info|zte_web_sault", "دخول ZTE الجديد"),
    ], [
        (4, r"ZTE ubus:[^\n]*→ 200[^\n]*jsonrpc", "ubus يرد"),
    ]),
    ("zyxel", "Zyxel", 8, [
        (5, r"getBasicInformation", "معلومات زيكسل"),
        (3, r"cgi-bin/DAL\?oid=", "واجهة DAL"),
        (3, r"UserLogin", "دخول زيكسل"),
        (2, r"ZCFG_SUCCESS", "ردود ZCFG"),
    ], []),
    ("fiberhome", "FiberHome", 8, [
        (5, r"FHNCAPIS|FHAPIS", "واجهة FiberHome"),
        (4, r"DO_WEB_LOGIN", "دخول FiberHome"),
        (3, r"get_xmlnode_js_file", "أسماء الإعدادات"),
    ], [
        (4, r"FHNCAPIS is_encrypt → ok", "is_encrypt يرد"),
    ]),
    ("oppo", "OPPO 5G CPE", 8, [
        (6, r"webCgi/GetPemKey", "مفتاح التشفير"),
        (3, r"ommng/", "واجهة ommng"),
        (2, r"Access-Token", "رأس الجلسة"),
    ], []),
    ("greenpacket", "Green Packet", 8, [
        (6, r"startup/productinfo", "معلومات المنتج"),
        (3, r"/web/v1/", "واجهة /web/v1"),
        (3, r"startup/usersstate", "حالة الدخول"),
    ], []),
    ("nokia", "Nokia FastMile", 9, [
        (4, r"web_whw", "مجلد web_whw"),
        (4, r"main-es2015", "صفحة Angular 3.1"),
        (3, r"login_web_app\.cgi", "دخول Nokia"),
        (2, r"FastMile", "اسم FastMile"),
        (-6, r"service_function_web_app\.cgi", "واجهة 6.1"),
    ], []),
    ("nokia-fwa", "Nokia FastMile 6.1", 9, [
        (4, r"web_whw", "مجلد web_whw"),
        (5, r"service_function_web_app\.cgi", "واجهة 6.1"),
        (3, r"login_web_app\.cgi", "دخول Nokia"),
        (-6, r"main-es2015", "صفحة 3.1"),
    ], []),
    ("luci", "OpenWrt (LuCI)", 8, [
        (6, r"luci_password", "خانة دخول LuCI"),
        (3, r"cgi-bin/luci", "مسار LuCI"),
    ], []),
    ("dlink", "D-Link", 8, [
        (6, r"getProductModelInfo", "معلومات الموديل"),
        (4, r"/acfun/", "واجهة acfun"),
    ], []),
    ("inseego", "Inseego MiFi", 8, [
        (6, r"/srv/status", "حالة MiFi"),
        (2, r"inseego|novatel", "اسم Inseego"),
    ], []),
    ("hgont", "هواوي فايبر", 8, [
        (5, r"X_HW_Token", "رمز ONT"),
        (3, r"txt_Password", "خانة الدخول"),
        (2, r"login\.cgi", "دخول ONT"),
    ], []),
    ("fg360", "5G CPE (AW1000)", 8, [
        (5, r"system\.password\.status", "حالة كلمة المرور"),
        (4, r"cgi-bin/api\.cgi", "واجهة api.cgi"),
    ], []),
    ("m2a", "MiFi M2A", 8, [
        (5, r"var\s+postaddr\s*=", "منفذ الأوامر"),
        (3, r"ipaddr\.js", "ملف ipaddr.js"),
    ], []),
]
_FAM = [(d, n, mn, [(w, re.compile(rx), why) for w, rx, why in page], [(w, re.compile(rx), why) for w, rx, why in live])
        for d, n, mn, page, live in FAMILIES]
LABEL = {d: n for d, n, *_ in FAMILIES}
MARGIN = 3  # الأول لازم يسبق الثاني بكذا — وإلا «مو واضح» ويتحول للمبرمج

# ميزات الصفحة (للتقرير اللي يوصل المبرمج) — نفس أسماء router_library
FEATURES = [
    ("دخول", r"password|passwd|login|salt|nonce"),
    ("إشارة", r"\brsrp|\bsinr|\brsrq|signal_?strength|\brssi"),
    ("ترددات", r"band_?lock|bandlock|band_select|lte_band_mask|lteband|lock-freq|set_?\w*band|cellularbands|modem/band|lockband|nr5g_band"),
    ("وضع الشبكة", r"net_?select|networkmode|bearer_preference|network_?mode|netselect|workmode|rat_?mode|preferred_?mode|net_?mode"),
    ("أبراج", r"cell_?lock|lockcell|celllock|cellselect|lock_?pci|pci_?lock|earfcn_?lock|cell_?select"),
    ("إعادة تشغيل", r"reboot|restart_?device|device_?restart"),
    ("رسائل", r"\bsms|send_?message|wms_"),
    ("الأجهزة", r"station_?(?:info|list)|connected_?devices|dhcp_?(?:client|lease)|hostlist|lan_?hosts"),
    ("واي فاي", r"\bssid|wifi_?(?:main|setting|basic)|wlan"),
]
_FEAT = [(n, re.compile(rx)) for n, rx in FEATURES]


# ─── أوامر التغيير: تنفتح بس لو الأمر اللي يرسله درايفرنا موجود في كود صفحة الراوتر نفسه ───
# {الدرايفر: {دالة الدرايفر: [أسماء الأوامر اللي ترسلها — كلها لازم تكون في الصفحة]}}
# الأسماء من كود الدرايفرات (src/drivers/*) — مثال الدرس: U30 Pro صفحته ما فيها BAND_SELECT ← setBand ما ينفتح له.
# عائلة أو دالة مو هنا = تبقى مقفولة (نضيفها هنا بعد ما نتأكد من اسم أمرها — بدون تحديث للتطبيق).
WRITES = {
    "zte": {
        "setBand": ["BAND_SELECT"], "setNetworkMode": ["SET_BEARER_PREFERENCE"], "reboot": ["REBOOT_DEVICE"],
        "reconnectData": ["DISCONNECT_NETWORK", "CONNECT_NETWORK"], "reattach": ["WAN_OPERATE_MODE_SET"], "wakeRadio": ["WAN_OPERATE_MODE_SET"],
        "sendSms": ["SEND_SMS"], "deleteSms": ["DELETE_SMS"], "markSmsRead": ["SET_MSG_READ"],
    },
    "zte-ufi": {
        "setBand": ["SET_BAND_LOCK"], "reboot": ["REBOOT_DEVICE"],
        "reconnectData": ["DISCONNECT_NETWORK", "CONNECT_NETWORK"], "blockDevice": ["WIFI_MAC_FILTER"],
    },
    "zte-ng": {"setBand": ["nwinfo_set_gwl_bandlock"], "setNetworkMode": ["nwinfo_set_netselect"], "reboot": ["device_reboot"]},
    "huawei-lte": {
        "setBand": ["api/net/net-mode"], "setNetworkMode": ["api/net/net-mode"],
        "reboot": ["api/device/control"], "reconnectData": ["api/dialup/mobile-dataswitch"],
    },
    "zyxel": {"setBand": ["cellwan_band"], "setNetworkMode": ["cellwan_band"]},
    "nokia": {"reboot": ["reboot_web_app.cgi"]},
    "nokia-fwa": {"setBand": ["SetSupportedCellularBands"], "setNetworkMode": ["SetCellularAccessConfig"], "reboot": ["reboot_web_app.cgi"]},
    "fg360": {"setBand": ["network.bands.set"], "setNetworkMode": ["network.mode.set"], "reboot": ["system.reboot"]},
    "dlink": {"setBand": ["bandLockSetup"], "setNetworkMode": ["mobileNetworkBasicSetting"]},
}
# الإرجاع لازم يشتغل مع أي تغيير ترددات/وضع — لو انحجب يبقى الراوتر على إعداد غلط
RESTORE = ["restoreLockState", "restoreAll", "unlockCell"]
# ما تنفتح تلقائي أبداً — حتى لو أحد حطها في الجدول بالغلط (والتطبيق يحجبها كمان)
NEVER = {"lockCell", "lockChannel"}


def evidence_writes(driver: str, files: dict) -> list:
    """دوال التغيير اللي أمرها موجود في كود صفحة هالراوتر (كلمة كاملة، مو جزء من اسم أطول)"""
    table = WRITES.get(driver) or {}
    if not table:
        return []
    page = "\n".join(t for p, t in files.items() if not p.startswith("_bandly/") and p != "README.txt" and not LIBLIKE.search(p))
    out = []
    for method, tokens in table.items():
        if method in NEVER:
            continue
        if all(re.search(r"(?<![A-Za-z0-9_])" + re.escape(t) + r"(?![A-Za-z0-9_-])", page) for t in tokens):
            out.append(method)
    if "setBand" in out or "setNetworkMode" in out:
        out += RESTORE
    return sorted(out)


def live_writes(p: dict | None) -> list:
    """اللي مفتوح الحين لبصمة: دليل الصفحة ناقص اللي قفلناه — وفاضي لو أوامر التغيير موقوفة"""
    if WRITES_OFF.exists() or OFF.exists() or not p:
        return []
    blocked = set(p.get("blocked") or []) | NEVER
    return [m for m in (p.get("writes") or []) if m not in blocked]


# ─── القراءة والمطابقة (بدون شبكة ولا FastAPI — عليها اختبارات) ───

def read_zip(z: Path) -> dict:
    """ملفات zip كنصوص: {المسار: النص}. الملفات الكبيرة والمكتبات العامة تنتخطى."""
    out = {}
    with zipfile.ZipFile(z) as f:
        for i in f.infolist():
            if i.is_dir() or i.file_size > MAX_SCAN:
                continue
            if Path(i.filename).suffix.lower() not in TEXT_EXT:
                continue
            try:
                out[i.filename.lstrip("/")] = f.read(i).decode("utf-8", "replace")
            except Exception:
                continue
    return out


def classify(files: dict) -> dict:
    """
    files = {المسار: النص}. يرجّع:
      {status: 'match'|'none', driver, label, score, second: [driver, score], scores: [[driver, score, [أدلة]]…], features: […]}
    'match' بس لو العائلة الأولى عدّت حدها وسبقت الثانية بـ MARGIN.
    """
    live = "\n".join(t for p, t in files.items() if p.startswith("_bandly/"))
    page = [t for p, t in files.items() if not p.startswith("_bandly/") and p != "README.txt" and not LIBLIKE.search(p)]
    scores = []
    for drv, _name, minimum, page_rx, live_rx in _FAM:
        s, why = 0, []
        for w, rx, desc in page_rx:
            if any(rx.search(t) for t in page):
                s += w
                why.append(f"{'+' if w > 0 else ''}{w} {desc}")
        for w, rx, desc in live_rx:
            if rx.search(live):
                s += w
                why.append(f"{'+' if w > 0 else ''}{w} {desc} (حي)")
        if s > 0:
            scores.append([drv, s, why, minimum])
    scores.sort(key=lambda x: -x[1])
    low = "\n".join(page).lower()
    feats = [n for n, rx in _FEAT if rx.search(low)]
    res = {"status": "none", "driver": "", "label": "", "score": 0, "second": None,
           "scores": [[d, s, w] for d, s, w, _m in scores[:4]], "features": feats}
    if not scores:
        return res
    top = scores[0]
    second = scores[1] if len(scores) > 1 else None
    res["second"] = [second[0], second[1]] if second else None
    res["driver"], res["score"], res["label"] = top[0], top[1], LABEL[top[0]]
    if top[1] >= top[3] and (not second or top[1] - second[1] >= MARGIN):
        res["status"] = "match"
    return res


def fp_key(fp) -> str:
    """
    مفتاح بصمة الصفحة من اللي يحسبه التطبيق (fingerprint): سيرفر الراوتر + ملفات الصفحة + خانات الدخول.
    نفس الصفحة = نفس المفتاح عند كل الأعضاء. بصمة فقيرة (بدون ملفات ولا خانات) ← '' (ما نحفظها).
    """
    if not isinstance(fp, dict):
        return ""
    clean = lambda xs: sorted({str(x).strip().lower()[:80] for x in (xs or []) if str(x).strip()})[:20]  # noqa: E731
    scripts, fields = clean(fp.get("scripts")), clean(fp.get("loginFields"))
    if len(scripts) + len(fields) < 2:
        return ""
    raw = json.dumps([str(fp.get("server") or "").strip().lower()[:60], scripts, fields], ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9؀-ۿ]", "", str(s or "").lower())


def find_zip(model: str, host: str, now: float | None = None, max_age: float = 1200) -> Path | None:
    """آخر zip «جهاز جديد» بنفس الموديل والعنوان خلال ٢٠ دقيقة (التطبيق يسأل مباشرة بعد الرفع)"""
    now = now or time.time()
    best = None
    d = DUMP_DIRS[0]
    if not d.exists():
        return None
    for z in d.glob("router-*.zip"):
        if re.search(r"-(FULL?|AUTH|add-error|PARTIAL)-", z.name, re.I):
            continue
        mt = z.stat().st_mtime
        if now - mt > max_age or (best and mt <= best[0]):
            continue
        try:
            with zipfile.ZipFile(z) as f:
                readme = f.read("README.txt").decode("utf-8", "replace")
        except Exception:
            continue
        m = re.search(r"^الموديل:\s*(.*)$", readme, re.M)
        h = re.search(r"^العنوان:\s*(.*)$", readme, re.M)
        if not m or not h:
            continue
        if _norm(h.group(1)) != _norm(host) or _norm(m.group(1))[:40] != _norm(model)[:40]:
            continue
        best = (mt, z)
    return best[1] if best else None


# ─── التخزين ───

def _load(p: Path, default):
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return default


def _log(ev: dict):
    AP.mkdir(parents=True, exist_ok=True)
    with CASES.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": int(time.time()), **ev}, ensure_ascii=False) + "\n")


def _open_case(case: dict) -> str:
    OPEN.mkdir(parents=True, exist_ok=True)
    cid = secrets.token_hex(8)
    (OPEN / f"{cid}.json").write_text(json.dumps({**case, "t": int(time.time())}, ensure_ascii=False), "utf-8")
    for old in OPEN.glob("*.json"):  # حالات ما رجع لها التطبيق — يومين وتنمسح
        try:
            if time.time() - old.stat().st_mtime > 2 * DAY:
                old.unlink()
        except Exception:
            pass
    return cid


def profile_ok(p: dict) -> bool:
    """بصمة نثق فيها: نجحت عند عضو واحد على الأقل، والفشل ما زاد على النجاح"""
    return bool(p) and int(p.get("ok", 0)) >= 1 and int(p.get("fail", 0)) <= int(p.get("ok", 0))


def escalate(model: str, why: str, v: dict | None, extra: str = "") -> Path:
    """تقرير جاهز للمبرمج — ملف واحد لكل حالة"""
    ESC.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w؀-ۿ.+-]+", "-", model.strip())[:40].strip("-") or "unknown"
    p = ESC / f"{time.strftime('%m%d-%H%M%S')}-{name}-{secrets.token_hex(2)}.md"  # حالتين بنفس الثانية ما يكتبون على بعض
    lines = [f"# برمج لي جهازي — يحتاج المبرمج", f"- الموديل: {model or '—'}", f"- السبب: {why}", f"- الوقت: {time.strftime('%Y-%m-%d %H:%M')}"]
    if v:
        lines.append(f"- ميزات في كود صفحته: {'، '.join(v.get('features') or []) or '—'}")
        lines.append("\n## العائلات الأقرب")
        for d, s, w in v.get("scores") or []:
            lines.append(f"- **{LABEL.get(d, d)}** (`{d}`) — {s} نقطة: " + " · ".join(w))
        if not v.get("scores"):
            lines.append("- ولا عائلة — صفحة جديدة علينا (درايفر جديد)")
    if extra:
        lines += ["", "## تفاصيل", extra[:3000]]
    p.write_text("\n".join(lines) + "\n", "utf-8")
    return p


def digest_lines(since: float) -> list[str]:
    """سطور للملخص اليومي (dump_digest.py): وش تبرمج لحاله ووش تحوّل للمبرمج"""
    auto, esc = {}, {}
    try:
        rows = [json.loads(x) for x in CASES.read_text("utf-8").splitlines() if x.strip()]
    except Exception:
        return []
    for r in rows:
        if r.get("t", 0) <= since:
            continue
        m = (r.get("model") or "؟")[:40]
        if r.get("ev") == "result" and r.get("ok"):
            auto[m] = LABEL.get(r.get("driver"), r.get("driver") or "؟") + (" + تغيير" if r.get("writes") else " (قراءة بس)")
        elif (r.get("ev") == "verdict" and r.get("status") == "none") or (r.get("ev") == "result" and not r.get("ok") and not r.get("neutral")):
            esc[m] = r.get("why") or r.get("err") or "ما طابق"
    for m in auto:
        esc.pop(m, None)
    if not auto and not esc:
        return []
    out = [f"\n🤖 برمج لي جهازي: {len(auto)} تبرمج لحاله · {len(esc)} يحتاجك"]
    out += [f"✓ {m} ← {fam}" for m, fam in list(auto.items())[:8]]
    out += [f"✗ {m} — {str(w)[:60]}" for m, w in list(esc.items())[:8]]
    if esc:
        out.append("التقارير: data/autoprog/escalate/")
    return out


# ─── الروابط (تنحمّل بس لو FastAPI موجود — الاختبارات والـ CLI ما يحتاجونه) ───
try:
    from fastapi import APIRouter, HTTPException, Request
except Exception:  # pragma: no cover
    APIRouter = None

if APIRouter:
    router = APIRouter()
    _HITS: dict[str, list[float]] = {}

    def _rate(req, n=40, per=3600.0):
        ip = req.headers.get("x-real-ip") or (req.client.host if req.client else "?")
        now = time.time()
        lst = [t for t in _HITS.get(ip, []) if now - t < per]
        if len(lst) >= n:
            raise HTTPException(429, "كثير")
        lst.append(now)
        _HITS[ip] = lst

    async def _body(req) -> dict:
        try:
            b = json.loads((await req.body()).decode("utf-8", "replace"))
        except Exception:
            raise HTTPException(400, "bad json")
        if not isinstance(b, dict):
            raise HTTPException(400, "bad json")
        return b

    def _s(v, n: int) -> str:
        return re.sub(r"[\x00-\x1f]", " ", str(v or ""))[:n].strip()

    @router.post("/live-api/app/autoprog/lookup")
    async def ap_lookup(req: Request):
        """قبل رفع الملفات: هل هالصفحة تبرمجت عند عضو قبل؟ (بالبصمة بس — بدون ملفات)"""
        _rate(req)
        b = await _body(req)
        if OFF.exists():
            return {"status": "none"}
        key = fp_key(b.get("fp"))
        p = _load(PROFILES, {}).get(key) if key else None
        if not profile_ok(p):
            return {"status": "none"}
        cid = _open_case({"key": key, "driver": p["driver"], "model": _s(b.get("model"), 60), "via": "lookup"})
        _log({"ev": "lookup", "id": cid, "key": key, "driver": p["driver"], "model": _s(b.get("model"), 60)})
        return {"status": "known", "id": cid, "driver": p["driver"], "label": LABEL.get(p["driver"], p["driver"]),
                "key": key, "writes": live_writes(p)}

    @router.post("/live-api/app/autoprog/verdict")
    async def ap_verdict(req: Request):
        """بعد رفع الملفات: نطابقها مع العائلات. match ← التطبيق يجرّب · none ← تحوّل للمبرمج"""
        _rate(req)
        b = await _body(req)
        model, host = _s(b.get("model"), 60), _s(b.get("host"), 40)
        if OFF.exists():
            return {"status": "none"}
        z = find_zip(model, host)
        if not z:
            _log({"ev": "verdict", "status": "nozip", "model": model})
            return {"status": "none"}
        try:
            from starlette.concurrency import run_in_threadpool
            def work():
                files = read_zip(z)
                c = classify(files)
                c["writes"] = evidence_writes(c["driver"], files) if c["status"] == "match" else []
                return c
            v = await run_in_threadpool(work)
        except Exception as e:
            print(f"[autoprog] classify failed {z.name}: {str(e)[:120]}", flush=True)
            return {"status": "none"}
        key = fp_key(b.get("fp"))
        have = {str(x) for x in (b.get("drivers") or [])}
        why = ""
        if v["status"] != "match":
            why = "ما طابق أي عائلة" if not v["scores"] else f"مو واضح — الأقرب {LABEL.get(v['driver'], '؟')} ({v['score']})"
        elif have and v["driver"] not in have:
            why = f"عائلة {v['label']} — نسخة التطبيق عند العضو ما فيها الدرايفر (يحدّث)"
        if why:
            esc = escalate(model, why, v, f"الملف: {z.name}")
            _log({"ev": "verdict", "status": "none", "model": model, "zip": z.name, "why": why, "driver": v["driver"], "score": v["score"], "esc": esc.name})
            return {"status": "none"}
        cid = _open_case({"key": key, "driver": v["driver"], "model": model, "zip": z.name, "via": "verdict", "v": v, "writes": v["writes"]})
        _log({"ev": "verdict", "status": "match", "id": cid, "model": model, "zip": z.name, "driver": v["driver"], "score": v["score"],
              "second": v["second"], "key": key, "writes": v["writes"]})
        open_now = live_writes({"writes": v["writes"], "blocked": (_load(PROFILES, {}).get(key) or {}).get("blocked")})
        return {"status": "match", "id": cid, "driver": v["driver"], "label": v["label"], "key": key, "writes": open_now}

    @router.post("/live-api/app/autoprog/result")
    async def ap_result(req: Request):
        """نتيجة تجربة التطبيق على الراوتر نفسه — بدون كلمات مرور ولا قراءات، بس «نجح/وين وقف»"""
        _rate(req)
        b = await _body(req)
        cid = re.sub(r"[^a-f0-9]", "", str(b.get("id") or ""))[:16]
        f = OPEN / f"{cid}.json"
        case = _load(f, None) if cid else None
        if not case:
            raise HTTPException(404, "ما لقينا الحالة")
        ok = bool(b.get("ok"))
        stage, err = _s(b.get("stage"), 20), _s(b.get("err"), 200)
        got = [_s(x, 20) for x in (b.get("got") or [])[:20]]
        key, drv, model = case.get("key") or "", case.get("driver") or "", case.get("model") or ""
        # كلمة المرور غلط أو العضو ما جرّب — مو عيب البرمجة: تنسجّل بس، ما تنحسب على البصمة ولا تتحول للمبرمج
        neutral = not ok and stage in ("password", "skipped")
        if key and not neutral:
            profs = _load(PROFILES, {})
            p = profs.get(key) or {"driver": drv, "ok": 0, "fail": 0, "models": [], "first": int(time.time())}
            if p.get("driver") == drv:
                p["ok" if ok else "fail"] = int(p.get("ok" if ok else "fail", 0)) + 1
                p["last"] = int(time.time())
                if model and model not in p["models"]:
                    p["models"] = (p["models"] + [model])[-10:]
                # دليل أوامر التغيير من ملفات هالعضو: أول نجاح يثبّته، وكل ملف جديد بنفس البصمة يضيّقه (التقاطع) — ما يوسّعه
                if ok and case.get("via") == "verdict":
                    w = [m for m in (case.get("writes") or []) if m not in NEVER]
                    p["writes"] = sorted(set(p["writes"]) & set(w)) if "writes" in p else sorted(w)
                profs[key] = p
                AP.mkdir(parents=True, exist_ok=True)
                PROFILES.write_text(json.dumps(profs, ensure_ascii=False, indent=1), "utf-8")
        ev = {"ev": "result", "id": cid, "ok": ok, "stage": stage, "err": err, "got": got, "model": model, "driver": drv,
              "key": key, "via": case.get("via"), "ver": _s(b.get("ver"), 20), "os": _s(b.get("os"), 10)}
        prof_now = _load(PROFILES, {}).get(key) if key else None
        ev["writes"] = len(live_writes(prof_now if prof_now else {"writes": case.get("writes")}))
        if neutral:
            ev["neutral"] = True
        elif not ok:
            esc = escalate(model, f"طابق {LABEL.get(drv, drv)} بس التجربة وقفت عند «{stage or '؟'}»", case.get("v"),
                           f"الخطأ: {err or '—'}\nالملف: {case.get('zip') or '(من البصمة)'}\nالنسخة: {ev['ver']} · {ev['os']}")
            ev["esc"] = esc.name
        _log(ev)
        try:
            f.unlink()
        except Exception:
            pass
        return {"ok": True}


if APIRouter:
    @router.post("/live-api/app/autoprog/caps")
    async def ap_caps(req: Request):
        """التطبيق يسأل مرة باليوم: وش أوامر التغيير المفتوحة لهالبصمة الحين؟ (قفلنا شي؟ وقّفنا الكل؟)"""
        _rate(req, 120)
        b = await _body(req)
        key = re.sub(r"[^a-f0-9]", "", str(b.get("key") or ""))[:20]
        p = _load(PROFILES, {}).get(key) if key else None
        if not p:
            # بصمة ما نعرفها (راوتر انضاف قبل ما تنحفظ) ← التطبيق يبقى على اللي عنده، إلا لو الكل موقوف
            return {"known": False, "writes": [] if (WRITES_OFF.exists() or OFF.exists()) else None}
        return {"known": True, "writes": live_writes(p)}

    @router.post("/live-api/app/autoprog/discovered")
    async def ap_discovered(req: Request):
        """نتيجة اكتشاف الميزات على راوتر العضو: أسماء القراءات ونجحت/لا — بدون أي قيم"""
        _rate(req, 60)
        b = await _body(req)
        reads = b.get("reads") if isinstance(b.get("reads"), dict) else {}
        rec = {"t": int(time.time()), "key": re.sub(r"[^a-f0-9]", "", str(b.get("key") or ""))[:20], "driver": _s(b.get("driver"), 20),
               "model": _s(b.get("model"), 60), "ok": sorted(_s(k, 30) for k, v in list(reads.items())[:60] if v is True),
               "fail": sorted(_s(k, 30) for k, v in list(reads.items())[:60] if v is False),
               "writes": [_s(x, 30) for x in (b.get("writes") or [])[:30]], "ver": _s(b.get("ver"), 20), "os": _s(b.get("os"), 10)}
        AP.mkdir(parents=True, exist_ok=True)
        with DISCOVERED.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return {"ok": True}


def set_block(key: str, method: str, on: bool) -> bool:
    profs = _load(PROFILES, {})
    p = profs.get(key)
    if not p:
        return False
    cur = set(p.get("blocked") or [])
    (cur.add if on else cur.discard)(method)
    p["blocked"] = sorted(cur)
    PROFILES.write_text(json.dumps(profs, ensure_ascii=False, indent=1), "utf-8")
    return True


# ─── التشغيل اليدوي ───

def _scan():
    seen, rows = set(), []
    for d in DUMP_DIRS:
        if not d.exists():
            continue
        for z in sorted(d.glob("router-*.zip")):
            if z.name in seen or re.search(r"-(FULL?|AUTH|add-error|PARTIAL)-", z.name, re.I):
                continue
            seen.add(z.name)
            try:
                files = read_zip(z)
                v = classify(files)
                v["writes"] = evidence_writes(v["driver"], files) if v["status"] == "match" else []
            except Exception as e:
                print(f"✗ {z.name}: {e}", file=sys.stderr)
                continue
            m = re.search(r"^الموديل:\s*(.*)$", files.get("README.txt", ""), re.M)
            rows.append(((m.group(1).strip() if m else z.stem)[:34], v))
    hit = [r for r in rows if r[1]["status"] == "match"]
    print(f"ملفات «جهاز جديد»: {len(rows)} · تطابق عائلة معروفة: {len(hit)} · للمبرمج: {len(rows) - len(hit)}\n")
    by: dict[str, int] = {}
    for _m, v in hit:
        by[v["label"]] = by.get(v["label"], 0) + 1
    for k, n in sorted(by.items(), key=lambda x: -x[1]):
        print(f"  {n:>3} × {k}")
    print("\n── التفاصيل ──")
    for m, v in sorted(rows, key=lambda r: (r[1]["status"] != "match", -r[1]["score"])):
        sec = f" · الثاني {v['second'][0]} {v['second'][1]}" if v["second"] else ""
        if v["status"] == "match":
            w = [x for x in v["writes"] if x not in RESTORE]
            print(f"✓ {m:<34} ← {v['label']} ({v['score']}){sec} · تغيير: {'، '.join(w) or 'ولا أمر (قراءة بس)'}")
        elif v["scores"]:
            print(f"? {m:<34} ← مو واضح: {v['label']} ({v['score']}){sec}")
        else:
            print(f"✗ {m:<34} ← ولا عائلة · ميزات صفحته: {'، '.join(v['features']) or '—'}")


def _one(path: str):
    files = read_zip(Path(path))
    v = classify(files)
    print(f"النتيجة: {v['status']} · {v['label'] or '—'} ({v['score']})")
    if v["status"] == "match":
        print("أوامر التغيير اللي في صفحته:", "، ".join(evidence_writes(v["driver"], files)) or "ولا أمر")
    for d, s, w in v["scores"]:
        print(f"  {LABEL.get(d, d)} [{d}] = {s}\n     " + "\n     ".join(w))
    print("ميزات الصفحة:", "، ".join(v["features"]) or "—")


def _stats():
    profs = _load(PROFILES, {})
    lines = digest_lines(0)
    print("\n".join(lines) if lines else "ما فيه حالات لسا.")
    print(f"\nالبصمات المحفوظة: {len(profs)}")
    for k, p in profs.items():
        print(f"  {k} ← {LABEL.get(p.get('driver'), p.get('driver'))} · نجح {p.get('ok', 0)} · فشل {p.get('fail', 0)} · "
              f"{'✓ مفعّلة' if profile_ok(p) else '✗ موقوفة'} · {'، '.join(p.get('models') or [])[:60]}")
        print(f"      تغيير مفتوح: {'، '.join(m for m in live_writes(p) if m not in RESTORE) or '—'}"
              + (f" · مقفول يدوي: {'، '.join(p['blocked'])}" if p.get("blocked") else ""))
    print(f"الإيقاف: {'موقوف (data/autoprog/off)' if OFF.exists() else 'شغّال'} · "
          f"أوامر التغيير: {'موقوفة (writes_off)' if WRITES_OFF.exists() else 'شغّالة'}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--scan" in a:
        _scan()
    elif "--zip" in a and len(a) > a.index("--zip") + 1:
        _one(a[a.index("--zip") + 1])
    elif "--stats" in a:
        _stats()
    elif ("--block" in a or "--unblock" in a) and len(a) >= 3:
        on = "--block" in a
        i = a.index("--block" if on else "--unblock")
        done = set_block(a[i + 1], a[i + 2], on)
        print(f"✓ {'انقفل' if on else 'انفتح'} {a[i + 2]} على {a[i + 1]}" if done else "✗ ما لقيت هالبصمة (شوف --stats)")
    else:
        print(__doc__)
