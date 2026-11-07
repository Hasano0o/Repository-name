#!/usr/bin/env python3
"""
إحصائيات الرواترات — تشغيل يدوي على السيرفر (قراءة بس، ما يغيّر شي):
    python3 /root/router-manager/mobile/live-server/router_stats.py

يقرأ:
  data/stats/days/*.json  ← لكل جهاز في اليوم: routers (أسماء الرواترات المحفوظة) و logins (اللي دخل عليها)
  data/errors.jsonl        ← فشل الإضافة/الدخول
  data/reports/bandly-newdevice-*.txt ← طلبات «جهاز جديد»
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

D = sys.argv[1] if len(sys.argv) > 1 else "/root/bandly-live/data"
RIYADH = timezone(timedelta(hours=3))
DEMO = {"راوتر تجريبي", "Demo", "demo"}


def brand(name: str) -> str:
    """اسم الراوتر المحفوظ («ZTE MC801A») واسم الدخول («ZTE») يختلفون — نقارن بالشركة."""
    n = (name or "").lower()
    for key, pat in (("openwrt", ("openwrt", "luci", "pro7", "wis ", "aw1000", "mywrt", "bpi", "telstra")),
                     ("huawei", ("huawei", "هواوي")), ("zte", ("zte", "جيب 4g", "xfnj")),
                     ("fiberhome", ("fiberhome",)), ("zyxel", ("zyxel",)), ("oppo", ("oppo",)),
                     ("greenpacket", ("green packet", "greenpacket")), ("nokia", ("nokia",)),
                     ("dlink", ("d-link", "dlink")), ("inseego", ("inseego", "mifi")),
                     ("device", ("هذا الجهاز",)), ("unknown", ("غير معروف",))):
        if any(x in n for x in pat):
            return key
    return n.split(" ")[0] if n else "?"


def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    now = datetime.now(RIYADH)
    today = now.strftime("%Y-%m-%d")
    yest = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    wk = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    wins = [("today", lambda d: d == today), ("yest", lambda d: d == yest),
            ("7d", lambda d: d >= wk), ("all", lambda d: True)]
    rt = {k: defaultdict(set) for k, _ in wins}
    lg = {k: defaultdict(set) for k, _ in wins}
    first = {}
    days = sorted(glob.glob(os.path.join(D, "stats", "days", "*.json")))
    for p in days:
        day = os.path.basename(p)[:-5]
        for did, r in load(p).items():
            if not isinstance(r, dict):
                continue
            for x in r.get("routers") or []:
                first[x] = min(first.get(x, day), day)
                for k, f in wins:
                    if f(day):
                        rt[k][x].add(did)
            lb = {brand(x) for x in r.get("logins") or []}
            for x in r.get("routers") or []:
                if brand(x) in lb:
                    for k, f in wins:
                        if f(day):
                            lg[k][x].add(did)

    print(f"== الرواترات (عدد الأجهزة) — {today} · {len(days)} يوم بيانات ==")
    print("الراوتر | اليوم | أمس | ٧ أيام | الكل | دخل ✓ (٧ أيام) | أول ظهور")
    names = sorted((n for n in rt["all"] if n not in DEMO), key=lambda n: (-len(rt["7d"][n]), -len(rt["all"][n])))
    for n in names:
        new = "  🆕" if first.get(n, "") >= yest else ""
        print(f"{n[:30]} | {len(rt['today'][n])} | {len(rt['yest'][n])} | {len(rt['7d'][n])} | "
              f"{len(rt['all'][n])} | {len(lg['7d'][n])} | {first.get(n, '')}{new}")

    def tot(k):
        s = set()
        for n, v in rt[k].items():
            if n not in DEMO:
                s |= v
        return len(s)
    print("\n== حسب الشركة (أجهزة ٧ أيام · دخل ✓) ==")
    bs, bl = defaultdict(set), defaultdict(set)
    for n in names:
        bs[brand(n)] |= rt["7d"][n]
        bl[brand(n)] |= lg["7d"][n]
    allb = len(set().union(*bs.values())) if bs else 0
    for b_, v in sorted(bs.items(), key=lambda kv: -len(kv[1])):
        pct = f"{100 * len(v) / allb:.0f}%" if allb else "-"
        print(f"{b_} | {len(v)} | {pct} | دخل ✓ {len(bl[b_])}")
    print(f"\nأجهزة عليها راوتر حقيقي: اليوم {tot('today')} · أمس {tot('yest')} · ٧ أيام {tot('7d')} · الكل {tot('all')}")

    print("\n== فشل الإضافة/الدخول: اليوم ← أمس ==")
    ec = {today: Counter(), yest: Counter()}
    try:
        with open(os.path.join(D, "errors.jsonl"), encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                t = str(e.get("ts") or e.get("time") or e.get("at") or "")
                if t.isdigit():
                    v = int(t)
                    t = datetime.fromtimestamp(v / 1000 if v > 1e11 else v, RIYADH).strftime("%Y-%m-%d")
                d = t[:10]
                if d in ec:
                    feat = str(e.get("feature") or e.get("kind") or e.get("type") or "?")[:16]
                    # model = موديل الجوال، مو الراوتر — نعرض الراوتر بس
                    rtr = str(e.get("router") or "").strip()[:26] or "ما انعرف الراوتر"
                    ec[d][(feat, rtr)] += 1
    except FileNotFoundError:
        print("  (ما فيه errors.jsonl)")
    keys = sorted(set(ec[today]) | set(ec[yest]), key=lambda k: -(ec[today][k] + ec[yest][k]))[:25]
    for k in keys:
        print(f"  {k[0]} · {k[1]} : {ec[today][k]} ← {ec[yest][k]}")
    if not keys:
        print("  ما فيه")

    print("\n== طلبات «جهاز جديد» اليوم وأمس ==")
    tags = {now.strftime("%m%d"), (now - timedelta(days=1)).strftime("%m%d")}
    seen = 0
    for f in sorted(glob.glob(os.path.join(D, "reports", "bandly-newdevice-*.txt"))):
        tag = os.path.basename(f)[len("bandly-newdevice-"):][:4]
        if tag not in tags:
            continue
        mod = "?"
        with open(f, encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if "الموديل:" in line:
                    mod = line.split(":", 1)[1].strip()
                    break
        print(f"  {tag[2:]}/{tag[:2]} · {mod[:40]}")
        seen += 1
    if not seen:
        print("  ما فيه")


if __name__ == "__main__":
    main()
