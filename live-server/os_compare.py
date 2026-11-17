"""مقارنة قياسات الألعاب بين الآيفون والأندرويد (١٧ نوفمبر — «الألعاب أحسن في الآيفون؟»)
التشغيل: python3 live-server/os_compare.py [مجلد data] [أيام]
النظام من إحصائيات اليوم (stats/days) — المعرّف نفسه مشفّر في community.db بنفس دالة _dev."""
import json, glob, hashlib, sqlite3, statistics as st, time, sys
D = sys.argv[1] if len(sys.argv) > 1 else "/root/bandly-live/data"
days = int(sys.argv[2]) if len(sys.argv) > 2 else 14
osmap = {}
for f in sorted(glob.glob(f"{D}/stats/days/*.json"))[-30:]:
    for did, r in json.load(open(f)).items():
        o = (r.get("os") or "").lower()
        if o not in ("ios", "android"):
            o = "ios" if not r.get("brand") and "." in (r.get("android") or "") else "android"
        osmap[hashlib.sha256(("bandly:" + did).encode()).hexdigest()[:20]] = o
db = sqlite3.connect(f"{D}/community.db")
since = int(time.time()) - days * 86400
def show(title, q):
    rows = db.execute(q, (since,)).fetchall()
    g = {"ios": [], "android": [], "?": []}
    devs = {"ios": set(), "android": set(), "?": set()}
    for dev, *v in rows:
        o = osmap.get(dev, "?")
        g[o].append(v); devs[o].add(dev)
    print(f"\n== {title} (آخر {days} يوم) ==")
    for o, vs in g.items():
        if not vs: continue
        cols = list(zip(*vs))
        med = lambda c: round(st.median([x for x in c if x is not None and x > 0] or [0]))
        print(f"  {o:8} أجهزة {len(devs[o]):3} · قياسات {len(vs):5} | بنق {med(cols[0]):4} | تذبذب {med(cols[1]):3}" + (f" | فقد {med(cols[2]):3}%" if len(cols) > 2 else ""))
show("جاهز للعب (tests)", "SELECT dev, ping, jitter, loss FROM tests WHERE at > ?")
show("مستشار البرج (obs)", "SELECT dev, ping, jitter FROM obs WHERE at > ? AND ping > 0")
try: show("المسرّع — مباشر (accel)", "SELECT dev, direct, direct_jitter, direct_loss FROM accel WHERE at > ?")
except Exception as e: print("accel:", e)
print("\nأجهزة معروفة النظام:", sum(1 for v in osmap.values() if v == "ios"), "آيفون /", sum(1 for v in osmap.values() if v == "android"), "أندرويد")
