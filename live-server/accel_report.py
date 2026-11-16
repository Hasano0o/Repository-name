#!/usr/bin/env python3
"""
ملخص «هل يفيدك مسرّع؟» — نقرر عليه نبني المسرّع الفعلي (المرحلة ٢) ولا لا.
  python3 /root/bandly-live/accel_report.py          (آخر ١٤ يوم)
  python3 /root/bandly-live/accel_report.py 30       (آخر ٣٠ يوم)
كل جهاز ينحسب مرة لكل (منطقة لعبة): وسيط فحوصاته — عضو كثير الفحص ما يغلب الباقي.
"""
import sqlite3
import sys
import time
from pathlib import Path

DB = Path(__file__).resolve().parent / "data" / "community.db"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 14
GAIN_MIN = 10


def med(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def main():
    if not DB.exists():
        print("ما فيه بيانات للحين")
        return
    c = sqlite3.connect(DB)
    try:
        rows = c.execute("SELECT dev, op, city, region, direct, via, gain, kind, direct_loss, via_loss FROM accel WHERE at>=?",
                         (int(time.time()) - DAYS * 86400,)).fetchall()
    except sqlite3.OperationalError:
        print("ما فيه بيانات للحين (ولا فحص وصل)")
        return
    if not rows:
        print(f"ما فيه فحوصات آخر {DAYS} يوم")
        return

    per = {}
    for dev, op, city, region, direct, via, gain, kind, dl, vl in rows:
        per.setdefault((dev, region), []).append((op, city or "—", direct, via, gain, kind, dl, vl))

    users = {}
    for (dev, region), lst in per.items():
        op, city = lst[-1][0], lst[-1][1]
        g = med([x[4] for x in lst])
        helps = sum(1 for x in lst if x[5] == "helps") * 2 > len(lst)
        users[(dev, region)] = dict(op=op, city=city, region=region, gain=g, helps=helps,
                                    direct=med([x[2] for x in lst]), via=med([x[3] for x in lst]))

    def block(title, key):
        groups = {}
        for u in users.values():
            groups.setdefault(key(u), []).append(u)
        print(f"\n── {title} ──")
        for k, us in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            h = [u for u in us if u["helps"]]
            pct = round(100 * len(h) / len(us))
            gm = med([u["gain"] for u in h])
            print(f"  {k}: {len(us)} عضو · يستفيد {len(h)} ({pct}%)" + (f" · ينقص بنقهم ~{gm}ms" if gm else "")
                  + f" · مباشر {med([u['direct'] for u in us])}ms ← عبرنا {med([u['via'] for u in us])}ms")

    devs = {d for d, _ in users}
    h_all = [u for u in users.values() if u["helps"]]
    print(f"آخر {DAYS} يوم: {len(rows)} فحص · {len(devs)} جهاز")
    print(f"يستفيدون من المسرّع: {len({k[0] for k, u in users.items() if u['helps']})} جهاز من {len(devs)}"
          + (f" · وسيط النقص {med([u['gain'] for u in h_all])}ms" if h_all else ""))
    block("حسب منطقة سيرفر اللعبة", lambda u: u["region"])
    block("حسب الشركة", lambda u: u["op"])
    block("حسب المدينة", lambda u: u["city"])
    block("الشركة + المنطقة", lambda u: f"{u['op']} → {u['region']}")


if __name__ == "__main__":
    main()
