#!/usr/bin/env python3
"""إدارة فنيين Bandly Live من سطر الأوامر.

  python3 admin.py list
  python3 admin.py add "اسم الفني" 0551234567 شرورة 30     ← يضيف فني باشتراك ٣٠ يوم ويطبع مفتاحه
  python3 admin.py renew KEY 30                            ← يمدد الاشتراك
  python3 admin.py stop KEY                                ← يوقف الفني
  python3 admin.py hide KEY / show KEY                     ← يخفيه أو يظهره في دليل الفنيين
  python3 admin.py require on|off                          ← يلزم مفتاح الفني للمتابعة (الاشتراك المدفوع)
"""
import json, secrets, sys, time
from pathlib import Path

D = Path(__file__).resolve().parent / "data"
D.mkdir(exist_ok=True)
TF, CF = D / "techs.json", D / "config.json"
load = lambda p, d: json.loads(p.read_text("utf-8")) if p.exists() else d
save = lambda p, v: p.write_text(json.dumps(v, ensure_ascii=False, indent=1), "utf-8")
day = 86400


def fmt(t):
    exp = time.strftime("%Y-%m-%d", time.localtime(t["expires"])) if t.get("expires") else "بدون"
    st = "✅" if t.get("active", True) and (not t.get("expires") or t["expires"] > time.time()) else "⛔"
    return f"{st} {t['name']} · {t.get('phone','')} · {t.get('city','')} · ينتهي {exp} · {'ظاهر' if t.get('listed', True) else 'مخفي'}"


a = sys.argv[1:]
techs = load(TF, {})
if not a or a[0] == "list":
    cfg = load(CF, {})
    print("مفتاح الفني مطلوب:", "نعم" if cfg.get("require_tech_key") else "لا (مجاني للكل)")
    for k, t in techs.items():
        print(f"{k}  {fmt(t)}")
    if not techs:
        print("ما فيه فنيين للحين")
elif a[0] == "add" and len(a) >= 5:
    key = "T" + secrets.token_hex(4).upper()
    techs[key] = {"name": a[1], "phone": a[2], "city": a[3], "expires": int(time.time() + int(a[4]) * day),
                  "active": True, "listed": True, "created": int(time.time())}
    save(TF, techs)
    print("✓ انضاف الفني:", fmt(techs[key]))
    print("مفتاح الفني (أرسله له):", key)
elif a[0] == "renew" and len(a) == 3 and a[1] in techs:
    t = techs[a[1]]
    t["expires"] = int(max(time.time(), t.get("expires") or 0) + int(a[2]) * day)
    t["active"] = True
    save(TF, techs); print("✓", fmt(t))
elif a[0] in ("stop", "hide", "show") and len(a) == 2 and a[1] in techs:
    t = techs[a[1]]
    if a[0] == "stop": t["active"] = False
    if a[0] == "hide": t["listed"] = False
    if a[0] == "show": t["listed"] = True
    save(TF, techs); print("✓", fmt(t))
elif a[0] == "require" and len(a) == 2 and a[1] in ("on", "off"):
    cfg = load(CF, {}); cfg["require_tech_key"] = a[1] == "on"; save(CF, cfg)
    print("✓ مفتاح الفني الحين:", "مطلوب" if a[1] == "on" else "غير مطلوب")
else:
    print(__doc__)
