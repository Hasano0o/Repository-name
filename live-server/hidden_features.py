#!/usr/bin/env python3
"""
الميزات المدفونة (٢٨ نوفمبر ٢٠٢٦): أوامر موجودة في كود صفحات راوترات الأعضاء (المكتبة: router_library.py)
وما يستخدمها أي درايفر في التطبيق — مرتبة بالماركة وعدد الموديلات اللي فيها الأمر، ومصنّفة بالنوع.

  python3 /root/router-manager/mobile/live-server/hidden_features.py          ← يحدّث المكتبة ويكتب التقرير
  python3 …/hidden_features.py --brand ZTE                                   ← ماركة وحدة
التقرير: /root/bandly-live/data/reports/bandly-hidden-features-<الوقت>.txt (يقرأه موصّل Claude) + يطبع مساره.

قراءة بس: ما يرسل شي لأي راوتر. «موجود في الصفحة» ≠ «يشتغل» — قبل أي أمر كتابة لازم دليل (القاعدة ٢ في الدليل).
"""
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import router_library as RL  # noqa: E402

REPO = Path(os.environ.get("BANDLY_REPO", "/root/router-manager/mobile"))
REPORTS = Path(os.environ.get("BANDLY_REPORTS", "/root/bandly-live/data/reports"))

# أوامر ما تهم (دخول/جلسة/لغة/صفحات عامة) — ما نعرضها
NOISE = re.compile(r"login|logout|token|sestok|state-login|language|lang\b|hilink|redirect|notification|remind|publickey|"
                   r"webserver|captcha|guide|quicksetup|wizard|help|faq|privacy|user_improv|gdpr|heartbeat|keepalive|"
                   r"autorun|homepage|prsite|host/info|getrandurl|cradle|sdcard|httpshare|samba|dlna|^\d+$", re.I)
DANGER = re.compile(r"upgrade|update|fota|firmware|restore|reset|factory|backup|upload|flash|ota\b|reboot_?all|format", re.I)
# (المفتاح، الاسم بالعربي، نمط) — أول نمط يطابق
CATS = [
    ("bands", "ترددات/تثبيت", r"band|lock|earfcn|arfcn|freq"),
    ("cells", "أبراج/خلايا", r"cell|pci|nbr|neighbo|scan_?net|plmn|operator"),
    ("mode", "وضع الشبكة", r"net_?select|netmode|net-mode|network_?mode|bearer|rat\b|workmode|preferred"),
    ("antenna", "أنتنا/مكان", r"ant\b|antenna|position|direction|azimuth|best"),
    ("signal", "إشارة/معلومات", r"signal|rsrp|sinr|status|info|monitor|ca_|carrier|engineer"),
    ("sms", "رسائل", r"sms|wms|message"),
    ("ussd", "USSD/رصيد", r"ussd|stk|balance"),
    ("esim", "eSIM/شريحة", r"esim|lpa|euicc|profile_?download|sim_?(slot|switch|mode)|slot"),
    ("wifi", "واي فاي", r"wifi|wlan|ssid|wps|guest|channel|radio"),
    ("devices", "الأجهزة/الحظر", r"station|host|device_?list|mac|filter|block|parental|child|access_?list|white|black"),
    ("speed", "سرعة/QoS/ألعاب", r"qos|speed|limit|bandwidth|game|accelerat|priority"),
    ("data", "الاستهلاك/الباقة", r"traffic|statistic|usage|data_?limit|flux|month|plan"),
    ("net", "شبكة/منافذ", r"dmz|nat|upnp|port|forward|vpn|dns|apn|dial|pppoe|ipv6|lan|dhcp|firewall|ddns|static_?route"),
    ("power", "طاقة/حرارة/أنوار", r"temp|thermal|battery|bat_|power|sleep|led|light|night|fan"),
    ("time", "جدولة/صيانة", r"schedule|reboot|restart|watchdog|time|ntp|sntp|log"),
]
CAT_RX = [(k, n, re.compile(rx, re.I)) for k, n, rx in CATS]


def driver_text() -> str:
    """كل كود الدرايفرات والشاشات (نص صغير) — الأمر «مستخدم» لو اسمه طالع فيه"""
    parts = []
    for sub in ("src/drivers", "src/services", "src/utils", "app"):
        for p in (REPO / sub).rglob("*"):
            if p.suffix in (".ts", ".tsx") and p.is_file():
                try:
                    parts.append(p.read_text("utf-8", "ignore"))
                except OSError:
                    pass
    return "\n".join(parts).lower()


def core_names(cmd: str) -> list:
    """«goform: SET_X» ← [set_x] · «ubus: zwrt_a.b.method» ← [method] · «huawei-api: net/net-mode» ← [net/net-mode] · cmd=a,b ← [a,b]"""
    kind, _, v = cmd.partition(": ")
    v = v.strip()
    if kind == "goform-get":
        return [x.strip().lower() for x in re.split(r",|%2c", v, flags=re.I) if len(x.strip()) >= 4]
    if kind == "ubus":
        return [v.rsplit(".", 1)[-1].lower()]
    if kind in ("endpoint", "cgi"):
        return [v.strip("/").lower()]
    return [v.lower()]


def cat_of(name: str):
    for k, n, rx in CAT_RX:
        if rx.search(name):
            return k, n
    return "other", "غيره"


def build_report(only_brand=None) -> str:
    RL.build()
    idx = RL.load_json(RL.LIB / "index.json", {"models": {}})
    used = driver_text()
    # الماركة ← الأمر ← الموديلات
    found = defaultdict(lambda: defaultdict(set))
    totals = defaultdict(int)
    for key, m in idx["models"].items():
        brand = m["brand"]
        if only_brand and brand.lower() != only_brand.lower():
            continue
        model = key.split("/", 1)[1]
        totals[brand] += 1
        for cmd in m.get("commands", []):
            for name in core_names(cmd):
                if len(name) < 4 or NOISE.search(name) or name in used:
                    continue
                found[brand][name].add(model)
    L = [f"🔎 الميزات المدفونة — {time.strftime('%Y-%m-%d %H:%M')}",
         "أوامر في كود صفحات راوترات الأعضاء وما يستخدمها التطبيق. «في الصفحة» ≠ «يشتغل» — قبل أي كتابة لازم دليل.",
         f"الموديلات بالمكتبة: " + " · ".join(f"{b} {n}" for b, n in sorted(totals.items(), key=lambda kv: -kv[1]))]
    for brand in sorted(found, key=lambda b: -totals[b]):
        cmds = found[brand]
        if not cmds:
            continue
        L.append(f"\n━━━━ {brand} ({totals[brand]} موديل · {len(cmds)} أمر ما نستخدمه) ━━━━")
        groups = defaultdict(list)
        danger = []
        for name, models in cmds.items():
            if DANGER.search(name):
                danger.append((name, models))
                continue
            k, n = cat_of(name)
            groups[(k, n)].append((name, models))
        order = [k for k, _n, _r in CATS] + ["other"]
        for (k, n), items in sorted(groups.items(), key=lambda kv: order.index(kv[0][0])):
            items.sort(key=lambda x: (-len(x[1]), x[0]))
            L.append(f"\n• {n} ({len(items)}):")
            for name, models in items[:25]:
                ms = sorted(models)
                L.append(f"   {name}  ·  {len(ms)} موديل: {', '.join(ms[:4])}{' …' if len(ms) > 4 else ''}")
            if len(items) > 25:
                L.append(f"   … و{len(items) - 25} ثانية")
        if danger:
            L.append(f"\n• ⚠️ خطرة (تحديث/ضبط مصنع/رفع — ما نضيفها) ({len(danger)}): "
                     + ", ".join(sorted(n for n, _ in danger)[:20]))
    return "\n".join(L)


def main():
    brand = sys.argv[sys.argv.index("--brand") + 1] if "--brand" in sys.argv else None
    text = build_report(brand)
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / f"bandly-hidden-features-{time.strftime('%m%d-%H%M%S')}.txt"
    out.write_text(text + "\n", "utf-8")
    print(text[:3000])
    print(f"\n✓ التقرير كامل: {out}")


if __name__ == "__main__":
    main()
