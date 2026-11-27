#!/usr/bin/env python3
"""
الشريحة الإلكترونية (eSIM) — كم عضو يبيها، وكم راوتر فيه eSIM فعلاً، ومن استخدم الشاشة التجريبية.
  python3 /root/bandly-live/esim_report.py        ← آخر ٣٠ يوم
  python3 /root/bandly-live/esim_report.py 90     ← آخر ٩٠ يوم
الأرقام = أجهزة مختلفة (كل جهاز مرة لكل نوع وموديل). البيانات من POST /live-api/community/esim.
"""
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

DB = Path(__file__).resolve().parent / "data" / "community.db"
LABEL = {
    "want": "ضغطوا «أبغاها»",
    "probe": "راوترات انفحصت",
    "open": "فتحوا الشاشة التجريبية",
    "scan": "صوّروا باركود شريحة",
    "page": "فتحوا صفحة eSIM في راوترهم",
}


def summary(rows):
    """rows: (kind, dev, model, brand, esim) → نص التقرير"""
    out = []
    by = {k: [r for r in rows if r[0] == k] for k in LABEL}
    for k, lbl in LABEL.items():
        devs = {r[1] for r in by[k]}
        out.append(f"{lbl}: {len(devs)}")
    probes = by["probe"]
    if probes:
        es = Counter(r[4] for r in probes)
        out.append(f"   الفحص: فيه eSIM {es.get('yes', 0)} · ما فيه {es.get('no', 0)} · ما عرفنا {es.get('unknown', 0)}")
        yes = Counter(r[2] or "?" for r in probes if r[4] == "yes")
        if yes:
            out.append("   موديلات فيها eSIM: " + " · ".join(f"{m} ({n})" for m, n in yes.most_common(10)))
    if by["want"]:
        models = Counter((r[2] or r[3] or "?") for r in by["want"])
        out.append("   «أبغاها» حسب الراوتر: " + " · ".join(f"{m} ({n})" for m, n in models.most_common(12)))
    return "\n".join(out)


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 30
    if not DB.exists():
        print("ما فيه بيانات للحين")
        return
    c = sqlite3.connect(DB)
    try:
        rows = c.execute("SELECT kind, dev, model, brand, esim FROM esim WHERE at > ?", (int(time.time()) - days * 86400,)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    print(f"📶 الشريحة الإلكترونية — آخر {days} يوم")
    print(summary(rows) if rows else "ما فيه بيانات للحين")


if __name__ == "__main__":
    main()
