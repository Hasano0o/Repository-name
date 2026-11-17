"""كم مستخدم حقيقي ومستفيد — آيفون مقابل أندرويد (١٧ نوفمبر)
التشغيل: python3 live-server/users_compare.py [مجلد data] [أيام=30]
من ملفات الإحصائية اليومية stats/days/*.json (جهاز = معرّف التطبيق، بدون أي بيانات شخصية).

التعريفات:
  ثبّت وفتح     = ظهر ولو يوم واحد
  رجع له        = فتح التطبيق في يومين مختلفين أو أكثر
  نشط ٧ أيام    = فتحه خلال آخر ٧ أيام
  أضاف راوتر    = عنده راوتر محفوظ (حقيقي، مو التجريبي)
  مستفيد        = دخل راوتر حقيقي فعلاً (دخول ناجح)
  مستفيد منتظم  = دخل راوتره في ٣ أيام مختلفة أو أكثر
  الألعاب       = فتح مُحسّن الألعاب أو كاشف اللاق أو تعزيز اللعب
"""
import glob, json, os, sys
from collections import Counter, defaultdict

D = sys.argv[1] if len(sys.argv) > 1 else "/root/bandly-live/data"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 30
files = sorted(glob.glob(f"{D}/stats/days/*.json"))[-N:]
if not files:
    sys.exit("ما فيه ملفات إحصائية")
last7 = {os.path.basename(f)[:10] for f in files[-7:]}


def os_of(r):
    o = (r.get("os") or "").lower()
    if o in ("ios", "android"):
        return o
    return "ios" if not r.get("brand") and "." in (r.get("android") or "") else "android"


GAME = ("الألعاب", "اللاق", "اللعب")
dev = defaultdict(lambda: {"os": "", "days": set(), "router": False, "login_days": set(), "ever": False,
                           "game": 0, "opens": 0, "blocker": ""})
for f in files:
    day = os.path.basename(f)[:10]
    try:
        data = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    for did, r in data.items():
        x = dev[did]
        x["os"] = os_of(r)
        x["days"].add(day)
        routers = [t for t in (r.get("routers") or []) if t and "demo" not in t.lower() and "تجريب" not in t]
        if routers:
            x["router"] = True
        if r.get("logins"):
            x["login_days"].add(day)
        if r.get("login_ever"):
            x["ever"] = True
        sc = r.get("screens") or {}
        x["opens"] += sum(sc.values())
        x["game"] += sum(v for k, v in sc.items() if any(g in k for g in GAME))
        if r.get("blocker"):
            x["blocker"] = r["blocker"]

rows = [
    ("ثبّت وفتح", lambda x: True),
    ("رجع له (يومين+)", lambda x: len(x["days"]) >= 2),
    ("نشط آخر ٧ أيام", lambda x: bool(x["days"] & last7)),
    ("أضاف راوتر", lambda x: x["router"]),
    ("مستفيد (دخل راوتره)", lambda x: bool(x["login_days"]) or x["ever"]),
    ("مستفيد منتظم (٣ أيام+)", lambda x: len(x["login_days"]) >= 3),
    ("استخدم الألعاب", lambda x: x["game"] > 0),
]
g = {o: [x for x in dev.values() if x["os"] == o] for o in ("ios", "android")}
tot = {o: len(v) or 1 for o, v in g.items()}
print(f"\nالفترة: {os.path.basename(files[0])[:10]} ← {os.path.basename(files[-1])[:10]} ({len(files)} يوم)\n")
print(f"{'':24}{'آيفون':>14}{'أندرويد':>16}")
for name, fn in rows:
    a = sum(1 for x in g["ios"] if fn(x))
    b = sum(1 for x in g["android"] if fn(x))
    print(f"{name:24}{a:7} ({a * 100 // tot['ios']:3}%){b:8} ({b * 100 // tot['android']:3}%)")

print("\nمتوسط أيام الاستخدام للمستفيد:")
for o, lbl in (("ios", "آيفون"), ("android", "أندرويد")):
    m = [len(x["days"]) for x in g[o] if x["login_days"] or x["ever"]]
    print(f"  {lbl:8} {sum(m) / len(m):.1f} يوم" if m else f"  {lbl:8} -")

print("\nليش ما أضافوا راوتر (اللي جاوبوا):")
for o, lbl in (("ios", "آيفون"), ("android", "أندرويد")):
    c = Counter(x["blocker"] for x in g[o] if not x["router"] and x["blocker"])
    print(f"  {lbl:8} " + (" · ".join(f"{k} {v}" for k, v in c.most_common(5)) or "-"))
