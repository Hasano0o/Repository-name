#!/usr/bin/env python3
"""
اختبارات «برمج لي جهازي» (السيرفر) — بدون مكتبات:  python3 live-server/test_autoprog.py
اختبارات الروابط تشتغل بس لو fastapi + httpx موجودين (في venv السيرفر موجودين).
"""
import json
import os
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import autoprog as ap  # noqa: E402

FIX = HERE.parent / "tests" / "fixtures"


def fx(*parts) -> str:
    return (FIX.joinpath(*parts)).read_text("utf-8", "replace")


class Classify(unittest.TestCase):
    def test_zte_goform(self):
        v = ap.classify({
            "index.html": '<script src="js/main.js"></script>',
            "js/service.js": 'url:"/goform/goform_get_cmd_process",x="/goform/goform_set_cmd_process";goformId:"LOGIN";cmd="wa_inner_version"',
            "_bandly/live.txt": 'ZTE إصدارات: GET /goform/goform_get_cmd_process?x → 200 · application/json · 90B · 30ms · {"wa_inner_version":"BD_XXMF297V1.0","cr_version":"CR_1"}',
        })
        self.assertEqual((v["status"], v["driver"]), ("match", "zte"))

    def test_zte_old_ufi_not_new_zte(self):
        """ZTE القديم (بدون wa_inner_version) ما ينحسب ZTE الجديد — درايفر MU5001 ما يلمسه"""
        v = ap.classify({
            "js/service.js": 'goform_get_cmd_process goform_set_cmd_process goformId:"SET_BAND_LOCK" lockband1',
            "_bandly/live.txt": 'ZTE إصدارات: GET /goform/x → 200 · text/html · 60B · 20ms · {"wa_inner_version":"","cr_version":"CR_MF920V1"}',
        })
        self.assertEqual((v["status"], v["driver"]), ("match", "zte-ufi"))

    def test_huawei(self):
        v = ap.classify({
            "js/main.js": 'getAjaxData("api/webserver/SesTokInfo");saveAjaxData("api/user/login");"api/device/signal";headers["__RequestVerificationToken"]',
        })
        self.assertEqual((v["status"], v["driver"]), ("match", "huawei-lte"))

    def test_zte_ng(self):
        v = ap.classify({"js/app.js": 'ubus("zwrt_web","web_login_info");ubus("zte_nwinfo_api","nwinfo_get_netinfo")'})
        self.assertEqual((v["status"], v["driver"]), ("match", "zte-ng"))

    def test_nokia_31_vs_61(self):
        a = ap.classify({"index.html": '<base href="/web_whw/"><title>FastMile</title><script src="main-es2015.abc.js">', "main-es2015.abc.js": "login_web_app.cgi"})
        b = ap.classify({"index.html": '<base href="/web_whw/"><script src="main.123.js">', "main.123.js": "login_web_app.cgi?nonce service_function_web_app.cgi"})
        self.assertEqual((a["status"], a["driver"]), ("match", "nokia"))
        self.assertEqual((b["status"], b["driver"]), ("match", "nokia-fwa"))

    def test_m2a_page_with_copied_huawei_code_is_not_huawei(self):
        """فحص السيرفر ١٠ نوفمبر: M2A-77 طلع «هواوي ١٣ · الثاني m2a ٨» — واجهته منسوخة من هواوي وأوامره على منفذ ثاني"""
        v = ap.classify({
            "js/main.js": 'getAjaxData("api/webserver/SesTokInfo");"api/user/login";"api/device/signal";h["__RequestVerificationToken"]',
            "ipaddr.js": 'var postaddr = "192.168.100.1:8080";',
            "index.html": '<script src="ipaddr.js"></script>',
        })
        self.assertEqual((v["status"], v["driver"]), ("match", "m2a"))

    def test_native_hint_mirrors_app_detection(self):
        zte = 'ZTE إصدارات: GET /goform/x → 200 · application/json · 90B · 30ms · {"wa_inner_version":"%s","cr_version":"CR_1"}'
        self.assertEqual(ap.native_hint("zte", {"_bandly/live.txt": zte % "BD_MF297"}), "yes")
        self.assertEqual(ap.native_hint("zte", {"_bandly/live.txt": zte % ""}), "no")
        self.assertEqual(ap.native_hint("zte", {"_bandly/live.txt": "ZTE إصدارات: GET /goform/x → فشل (ما رد خلال 5ث) · 5000ms"}), "no")
        self.assertEqual(ap.native_hint("zte", {"js/a.js": "goform_get_cmd_process"}), "?")
        hw = "هواوي SesTokInfo: GET /api/webserver/SesTokInfo → %s"
        self.assertEqual(ap.native_hint("huawei-lte", {"_bandly/live.txt": hw % "200 · text/html · 150B · 12ms · <response><SesInfo>«محذوف»</SesInfo></response>"}), "yes")
        self.assertEqual(ap.native_hint("huawei-lte", {"_bandly/live.txt": hw % "404 · text/html · 90B · 8ms · Not Found"}), "no")
        self.assertEqual(ap.native_hint("dlink", {"_bandly/live.txt": "أي شي"}), "?")

    def test_real_fixtures(self):
        """ملفات صفحات حقيقية من الأعضاء (tests/fixtures)"""
        d = ap.classify({"index.html": fx("dlink-dwr2000m", "index.html")})
        self.assertNotEqual(d["driver"], "zte")
        z = ap.classify({"index.html": fx("zte-u30pro", "index.html"), "js/main.js": fx("zte-u30pro", "main.js")})
        self.assertIn(z["driver"], ("zte", ""))
        for name in ("dg8245v.html", "hg8245w5.html", "hg8245x6.html", "lg8245x6.html"):
            h = ap.classify({"index.html": fx("hgont", name)})
            self.assertEqual((h["status"], h["driver"]), ("match", "hgont"), name)

    def test_unknown_page_is_none(self):
        v = ap.classify({"index.html": "<html><title>TP-Link</title><input type=password name=pw></html>", "js/x.js": "var rsrp=1;$.post('/cgi/login')"})
        self.assertEqual(v["status"], "none")
        self.assertIn("إشارة", v["features"])

    def test_single_weak_marker_is_not_a_match(self):
        """كلمة وحدة ما تكفي — «cgi-bin/luci» في صفحة TP-Link مثلاً"""
        v = ap.classify({"index.html": '<a href="/cgi-bin/luci/;stok=/login">'})
        self.assertEqual(v["status"], "none")

    def test_ambiguous_goes_to_developer(self):
        v = ap.classify({"a.js": "api/webserver/SesTokInfo api/user/login api/device/signal goform_get_cmd_process goform_set_cmd_process wa_inner_version"})
        self.assertEqual(v["status"], "none")
        self.assertTrue(v["scores"])

    def test_libraries_are_skipped(self):
        v = ap.classify({"js/jquery.min.js": "goform_get_cmd_process goform_set_cmd_process wa_inner_version goformId"})
        self.assertEqual(v["status"], "none")


class Writes(unittest.TestCase):
    """أوامر التغيير تنفتح بس لو أمرها في كود صفحة الراوتر نفسه"""

    def test_zte_page_with_commands(self):
        files = {"js/service.js": 'goformId:"BAND_SELECT",x;goformId:"SET_BEARER_PREFERENCE";goformId:"REBOOT_DEVICE";goformId:"SEND_SMS"'}
        w = ap.evidence_writes("zte", files)
        self.assertEqual(w, sorted(["setBand", "setNetworkMode", "reboot", "sendSms"] + ap.RESTORE))

    def test_u30_lesson_no_band_select_no_setband(self):
        """صفحة U30: الترددات بـ LTE_BAND_LOCK — BAND_SELECT مو موجود ← setBand ما ينفتح (ولا الإرجاع لو ما فيه وضع شبكة)"""
        w = ap.evidence_writes("zte", {"js/service.js": 'goformId:"LTE_BAND_LOCK";goformId:"NR_BAND_LOCK";goformId:"REBOOT_DEVICE"'})
        self.assertEqual(w, ["reboot"])

    def test_all_tokens_required_and_whole_word(self):
        # آي بي جديد يحتاج الأمرين
        self.assertNotIn("reconnectData", ap.evidence_writes("zte", {"a.js": '"DISCONNECT_NETWORK"'}))
        self.assertIn("reconnectData", ap.evidence_writes("zte", {"a.js": '"DISCONNECT_NETWORK","CONNECT_NETWORK"'}))
        # جزء من اسم أطول ما ينحسب
        self.assertEqual(ap.evidence_writes("zte", {"a.js": '"MY_BAND_SELECT_OLD" "REBOOT_DEVICE_X"'}), [])
        self.assertEqual(ap.evidence_writes("huawei-lte", {"a.js": 'getAjaxData("api/net/net-mode-list")'}), [])
        self.assertIn("setBand", ap.evidence_writes("huawei-lte", {"a.js": 'saveAjaxData("api/net/net-mode",x)'}))

    def test_library_and_live_files_are_not_evidence(self):
        self.assertEqual(ap.evidence_writes("zte", {"js/jquery.min.js": '"BAND_SELECT"', "_bandly/live.txt": "BAND_SELECT REBOOT_DEVICE"}), [])

    def test_unknown_family_and_cell_lock_never(self):
        self.assertEqual(ap.evidence_writes("luci", {"a.js": "anything"}), [])
        old = ap.WRITES["zte"].copy()
        try:
            ap.WRITES["zte"]["lockCell"] = ["LTE_LOCK_CELL_SET"]
            self.assertNotIn("lockCell", ap.evidence_writes("zte", {"a.js": '"LTE_LOCK_CELL_SET"'}))
        finally:
            ap.WRITES["zte"] = old
        self.assertNotIn("lockCell", ap.live_writes({"writes": ["lockCell", "reboot"]}))
        for fam in ap.WRITES.values():
            self.assertFalse(set(fam) & ap.NEVER)

    def test_every_family_in_writes_is_a_known_driver(self):
        self.assertTrue(set(ap.WRITES) <= set(ap.LABEL))


class Keys(unittest.TestCase):
    def test_fp_key_stable_and_order_free(self):
        a = ap.fp_key({"server": "GoAhead", "scripts": ["js/a.js", "js/b.js"], "loginFields": ["pw(password)"]})
        b = ap.fp_key({"server": "goahead ", "scripts": ["js/b.js", "js/a.js", "js/a.js"], "loginFields": ["pw(password)"], "lanMs": 9})
        self.assertTrue(a)
        self.assertEqual(a, b)
        self.assertNotEqual(a, ap.fp_key({"server": "GoAhead", "scripts": ["js/a.js", "js/c.js"], "loginFields": ["pw(password)"]}))

    def test_poor_fingerprint_has_no_key(self):
        self.assertEqual(ap.fp_key({"server": "nginx", "scripts": [], "loginFields": []}), "")
        self.assertEqual(ap.fp_key(None), "")
        self.assertEqual(ap.fp_key({"scripts": ["a.js"]}), "")

    def test_profile_ok(self):
        self.assertFalse(ap.profile_ok(None))
        self.assertFalse(ap.profile_ok({"ok": 0, "fail": 0}))
        self.assertTrue(ap.profile_ok({"ok": 1, "fail": 1}))
        self.assertFalse(ap.profile_ok({"ok": 1, "fail": 2}))


def make_zip(d: Path, name: str, model: str, host: str, files: dict, mtime: float | None = None) -> Path:
    z = d / name
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("README.txt", f"Bandly — ملفات صفحة الراوتر\nالموديل: {model}\nالعنوان: {host}\n")
        for p, t in files.items():
            f.writestr(p, t)
    if mtime:
        os.utime(z, (mtime, mtime))
    return z


class WithData(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.dumps = root / "dumps"
        self.dumps.mkdir()
        self._old = (ap.DUMP_DIRS, ap.AP, ap.OPEN, ap.ESC, ap.CASES, ap.PROFILES, ap.OFF)
        ap.DUMP_DIRS = [self.dumps]
        ap.AP = root / "autoprog"
        ap.OPEN, ap.ESC, ap.CASES, ap.PROFILES, ap.OFF = ap.AP / "open", ap.AP / "escalate", ap.AP / "cases.jsonl", ap.AP / "profiles.json", ap.AP / "off"
        self._old2 = (ap.WRITES_OFF, ap.DISCOVERED)
        ap.WRITES_OFF, ap.DISCOVERED = ap.AP / "writes_off", ap.AP / "discovered.jsonl"

    def tearDown(self):
        ap.DUMP_DIRS, ap.AP, ap.OPEN, ap.ESC, ap.CASES, ap.PROFILES, ap.OFF = self._old
        ap.WRITES_OFF, ap.DISCOVERED = self._old2
        self.tmp.cleanup()


ZTE_FILES = {"js/service.js": "goform_get_cmd_process goform_set_cmd_process wa_inner_version goformId"}
FP = {"server": "GoAhead", "scripts": ["js/main.js", "js/service.js"], "loginFields": ["txtPwd(password)"]}


class FindZip(WithData):
    def test_matches_model_and_host_newest(self):
        now = time.time()
        make_zip(self.dumps, "router-MF297-1110-1000.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES, now - 300)
        new = make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES, now - 60)
        make_zip(self.dumps, "router-Other-1110-1005.zip", "Tenda X", "192.168.0.1", {}, now - 10)
        self.assertEqual(ap.find_zip("zte mf297", "192.168.0.1", now), new)

    def test_ignores_old_other_host_and_full_dumps(self):
        now = time.time()
        make_zip(self.dumps, "router-MF297-1110-0900.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES, now - 3600)
        make_zip(self.dumps, "router-MF297-FULL-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES, now - 30)
        make_zip(self.dumps, "router-MF297-1110-1003.zip", "ZTE MF297", "192.168.1.1", ZTE_FILES, now - 30)
        self.assertIsNone(ap.find_zip("ZTE MF297", "192.168.0.1", now))


class Reports(WithData):
    def test_escalate_and_digest(self):
        v = ap.classify({"x.js": "var rsrp; band_lock; $.post('/cgi/login', {password:1})"})
        p = ap.escalate("TP-Link MR600", "ما طابق أي عائلة", v, "الملف: router-x.zip")
        txt = p.read_text("utf-8")
        self.assertIn("TP-Link MR600", txt)
        self.assertIn("ترددات", txt)
        self.assertIn("درايفر جديد", txt)
        ap._log({"ev": "verdict", "status": "none", "model": "TP-Link MR600", "why": "ما طابق أي عائلة"})
        ap._log({"ev": "result", "ok": True, "model": "ZTE MF297", "driver": "zte"})
        ap._log({"ev": "result", "ok": False, "model": "ZTE MF297", "driver": "zte", "err": "قديم"})
        lines = "\n".join(ap.digest_lines(0))
        self.assertIn("1 تبرمج لحاله · 1 يحتاجك", lines)
        self.assertIn("✓ ZTE MF297 ← ZTE", lines)
        self.assertIn("✗ TP-Link MR600", lines)
        self.assertEqual(ap.digest_lines(time.time() + 5), [])


try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    HAVE_API = True
except Exception:
    HAVE_API = False


@unittest.skipUnless(HAVE_API, "fastapi/httpx مو مثبتة")
class Api(WithData):
    def setUp(self):
        super().setUp()
        ap._HITS.clear()
        app = FastAPI()
        app.include_router(ap.router)
        self.c = TestClient(app)

    def post(self, path, body):
        return self.c.post("/live-api/app/autoprog/" + path, content=json.dumps(body, ensure_ascii=False).encode())

    def test_full_flow_match_success_then_lookup(self):
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES)
        # قبل أي نجاح: البصمة مو معروفة
        self.assertEqual(self.post("lookup", {"fp": FP}).json(), {"status": "none"})
        r = self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP, "drivers": ["zte", "huawei-lte"]}).json()
        self.assertEqual((r["status"], r["driver"], r["label"]), ("match", "zte", "ZTE"))
        # مطابقة بدون تجربة ناجحة ما تفعّل البصمة
        self.assertEqual(self.post("lookup", {"fp": FP}).json(), {"status": "none"})
        self.assertEqual(self.post("result", {"id": r["id"], "ok": True, "stage": "signal", "got": ["rsrp", "sinr"]}).json(), {"ok": True})
        # النتيجة تنرسل مرة وحدة
        self.assertEqual(self.post("result", {"id": r["id"], "ok": True}).status_code, 404)
        k = self.post("lookup", {"fp": FP, "model": "MF297D"}).json()
        self.assertEqual((k["status"], k["driver"]), ("known", "zte"))
        self.assertFalse(list(ap.ESC.glob("*.md")) if ap.ESC.exists() else [])

    def test_trial_failure_escalates_and_demotes(self):
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES)
        ids = [self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP}).json()["id"] for _ in range(3)]
        self.post("result", {"id": ids[0], "ok": True, "stage": "signal"})
        self.assertEqual(self.post("lookup", {"fp": FP}).json()["status"], "known")
        self.post("result", {"id": ids[1], "ok": False, "stage": "login", "err": "كلمة المرور غلط"})
        self.post("result", {"id": ids[2], "ok": False, "stage": "signal", "err": "ما فيه قراءة"})
        # فشلين مقابل نجاح ← البصمة تتوقف
        self.assertEqual(self.post("lookup", {"fp": FP}).json(), {"status": "none"})
        reports = [p.read_text("utf-8") for p in ap.ESC.glob("*.md")]
        self.assertEqual(len(reports), 2)
        self.assertTrue(any("كلمة المرور غلط" in t and "وقفت عند «login»" in t for t in reports))

    def test_wrong_password_or_skip_is_not_the_profiles_fault(self):
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES)
        ids = [self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP}).json()["id"] for _ in range(4)]
        self.post("result", {"id": ids[0], "ok": True, "stage": "signal"})
        for i, st in ((1, "password"), (2, "skipped"), (3, "password")):
            self.post("result", {"id": ids[i], "ok": False, "stage": st, "err": "كلمة المرور غلط"})
        self.assertEqual(self.post("lookup", {"fp": FP}).json()["status"], "known")
        self.assertFalse(ap.ESC.exists() and list(ap.ESC.glob("*.md")))
        self.assertIn("1 تبرمج لحاله · 0 يحتاجك", "\n".join(ap.digest_lines(0)))

    def test_writes_follow_page_evidence_and_remote_control(self):
        page = {"js/service.js": ZTE_FILES["js/service.js"] + ' goformId:"BAND_SELECT" goformId:"REBOOT_DEVICE"'}
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", page)
        r = self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP}).json()
        self.assertEqual(r["writes"], sorted(["setBand", "reboot"] + ap.RESTORE))
        key = r["key"]
        self.assertEqual(key, ap.fp_key(FP))
        # قبل ما تنحفظ البصمة: التطبيق يبقى على اللي عنده
        self.assertEqual(self.post("caps", {"key": key}).json(), {"known": False, "writes": None})
        self.post("result", {"id": r["id"], "ok": True, "stage": "signal"})
        self.assertEqual(self.post("caps", {"key": key}).json(), {"known": True, "writes": r["writes"]})
        # العضو الجاي (بدون ملفات) ياخذ نفس الأوامر
        self.assertEqual(self.post("lookup", {"fp": FP}).json()["writes"], r["writes"])
        # قفل أمر واحد على البصمة
        self.assertTrue(ap.set_block(key, "setBand", True))
        self.assertNotIn("setBand", self.post("caps", {"key": key}).json()["writes"])
        self.assertIn("reboot", self.post("lookup", {"fp": FP}).json()["writes"])
        self.assertTrue(ap.set_block(key, "setBand", False))
        self.assertIn("setBand", self.post("caps", {"key": key}).json()["writes"])
        self.assertFalse(ap.set_block("nope", "setBand", True))
        # إيقاف أوامر التغيير للكل: المضافين يرجعون قراءة بس، والمطابقة تكمّل
        ap.WRITES_OFF.write_text("")
        self.assertEqual(self.post("caps", {"key": key}).json()["writes"], [])
        self.assertEqual(self.post("caps", {"key": "abc"}).json(), {"known": False, "writes": []})
        k = self.post("lookup", {"fp": FP}).json()
        self.assertEqual((k["status"], k["writes"]), ("known", []))

    def test_second_dump_narrows_writes_never_widens(self):
        full = {"js/service.js": ZTE_FILES["js/service.js"] + ' "BAND_SELECT" "REBOOT_DEVICE"'}
        less = {"js/service.js": ZTE_FILES["js/service.js"] + ' "REBOOT_DEVICE" "SEND_SMS"'}
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", full)
        a = self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP}).json()
        self.post("result", {"id": a["id"], "ok": True, "stage": "signal"})
        make_zip(self.dumps, "router-MF297B-1110-1005.zip", "ZTE MF297B", "192.168.0.1", less)
        b = self.post("verdict", {"model": "ZTE MF297B", "host": "192.168.0.1", "fp": FP}).json()
        self.post("result", {"id": b["id"], "ok": True, "stage": "signal"})
        self.assertEqual(self.post("caps", {"key": a["key"]}).json()["writes"], ["reboot"])

    def test_discovered_is_logged_without_values(self):
        r = self.post("discovered", {"key": "abc123", "driver": "zte", "model": "ZTE MF297",
                                     "reads": {"getDevices": True, "getCells": False, "x": "secret-value"}, "writes": ["reboot"]})
        self.assertEqual(r.json(), {"ok": True})
        rec = json.loads(ap.DISCOVERED.read_text("utf-8").strip())
        self.assertEqual((rec["ok"], rec["fail"], rec["writes"]), (["getDevices"], ["getCells"], ["reboot"]))
        self.assertNotIn("secret-value", ap.DISCOVERED.read_text("utf-8"))

    def test_no_match_escalates(self):
        make_zip(self.dumps, "router-MR600-1110-1004.zip", "TP-Link MR600", "192.168.1.1", {"x.js": "rsrp /cgi/login password"})
        r = self.post("verdict", {"model": "TP-Link MR600", "host": "192.168.1.1", "fp": FP}).json()
        self.assertEqual(r, {"status": "none"})
        self.assertEqual(len(list(ap.ESC.glob("*.md"))), 1)

    def test_app_without_the_driver_is_not_offered_it(self):
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES)
        r = self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP, "drivers": ["huawei-lte"]}).json()
        self.assertEqual(r, {"status": "none"})

    def test_no_zip_and_kill_switch(self):
        self.assertEqual(self.post("verdict", {"model": "X", "host": "192.168.0.1", "fp": FP}).json(), {"status": "none"})
        make_zip(self.dumps, "router-MF297-1110-1004.zip", "ZTE MF297", "192.168.0.1", ZTE_FILES)
        ap.AP.mkdir(parents=True, exist_ok=True)
        ap.OFF.write_text("")
        self.assertEqual(self.post("verdict", {"model": "ZTE MF297", "host": "192.168.0.1", "fp": FP}).json(), {"status": "none"})
        self.assertEqual(self.post("lookup", {"fp": FP}).json(), {"status": "none"})

    def test_bad_input(self):
        self.assertEqual(self.c.post("/live-api/app/autoprog/verdict", content=b"not json").status_code, 400)
        self.assertEqual(self.post("result", {"id": "../../etc/passwd"}).status_code, 404)

    def test_rate_limit(self):
        codes = [self.post("lookup", {"fp": FP}).status_code for _ in range(42)]
        self.assertEqual(codes[39], 200)
        self.assertEqual(codes[40], 429)


if __name__ == "__main__":
    unittest.main(verbosity=1)
