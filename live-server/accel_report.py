#!/usr/bin/env python3
"""
تقرير «هل يفيدك مسرّع؟» — نقرر عليه نبني المسرّع الفعلي (المرحلة ٢) ولا لا.
  python3 /root/bandly-live/accel_report.py            ← يطبع (آخر ١٤ يوم)
  python3 /root/bandly-live/accel_report.py 30         ← آخر ٣٠ يوم
  python3 /root/bandly-live/accel_report.py --send     ← التقرير اليومي للمالك على تليجرام (cron ١١:٥٥ م)
كل جهاز ينحسب مرة لكل منطقة لعبة (وسيط فحوصاته) — عضو كثير الفحص ما يغلب الباقي.
"""
import json
import sqlite3
import sys
import time
import urllib.request as ur
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
DB = DATA / "community.db"
RIYADH = timezone(timedelta(hours=3))
GAIN_MIN = 10
# بنق مباشر فوق كذا = قياس مو موثوق (الجوال يصحى/الشبكة مزحومة لحظتها) — تقرير ١٦ نوفمبر: «1983 ← 968» انحسب أكبر فايدة
NOISE_MS = 600
# سيرفرنا ← سيرفر اللعبة فوق كذا = طريق مكسور من سيرفرنا (١٦ نوفمبر: الرياض ← الدمام 886ms) — مو حكم على المسرّع
ROUTE_BAD_MS = 300
REGION = {
    "ae": "الإمارات", "sa": "الدمام", "sa-ruh": "الرياض", "sa-jed": "جدة", "qa": "قطر", "tr": "تركيا",
    "eg": "مصر", "in": "الهند", "it": "إيطاليا", "eu": "ألمانيا", "fr": "فرنسا", "uk": "بريطانيا",
    "se": "السويد", "sg": "سنغافورة", "kr": "كوريا", "us": "أمريكا", "br": "البرازيل",
}
MAIN = ["ae", "sa", "sa-ruh", "eu", "fr", "uk", "tr", "in"]


def med(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def rows_since(c, since):
    try:
        return c.execute("SELECT at, dev, op, city, region, direct, via, gain, kind, to_server, route FROM accel WHERE at>=?",
                         (int(since),)).fetchall()
    except sqlite3.OperationalError:
        return []


def per_user(rows):
    """(جهاز، منطقة) ← وسيط نتايجه"""
    g = {}
    for at, dev, op, city, region, direct, via, gain, kind, to_s, route in rows:
        g.setdefault((dev, region), []).append((op, city or "—", direct, via, gain, kind, to_s))
    out = []
    for (dev, region), lst in g.items():
        d = dict(dev=dev, region=region, op=lst[-1][0], city=lst[-1][1],
                 direct=med([x[2] for x in lst]), via=med([x[3] for x in lst]),
                 gain=med([x[4] for x in lst]), to_s=med([x[6] for x in lst]),
                 helps=sum(1 for x in lst if x[5] == "helps") * 2 > len(lst))
        d["noisy"] = (d["direct"] or 0) > NOISE_MS
        if d["noisy"]:
            d["helps"] = False
        out.append(d)
    return out


def net(users):
    """صافي الوسيط (مباشر − عبرنا) للقياسات الموثوقة — موجب = المسرّع أسرع للعضو العادي"""
    return med([u["direct"] - u["via"] for u in users
                if not u["noisy"] and u["direct"] is not None and u["via"] is not None])


def block(title, users, key, top=6, name=lambda k: k):
    groups = {}
    for u in users:
        groups.setdefault(key(u), []).append(u)
    if not groups:
        return []
    out = [f"\n{title}"]
    for k, us in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:top]:
        h = [u for u in us if u["helps"]]
        gm = med([u["gain"] for u in h])
        out.append(f"• {name(k)}: {len(us)} · يستفيد {len(h)} ({round(100 * len(h) / len(us))}%)"
                   + (f" −{gm}ms" if gm else "")
                   + f" · مباشر {med([u['direct'] for u in us])} ← عبرنا {med([u['via'] for u in us])}")
    return out


def servers_now():
    try:
        cfg = json.loads((DATA / "accel.json").read_text()).get("servers", [])
    except Exception:
        return ["\n🖥️ ما فيه سيرفر مسرّع مفعّل (data/accel.json)"]
    out = ["\n🖥️ سيرفراتنا الحين (منها لسيرفرات الألعاب):"]
    for s in cfg:
        try:
            with ur.urlopen(s["url"] + "/routes", timeout=10) as r:
                d = json.load(r)
            reg = d.get("regions", {})
            age = int((time.time() - d.get("at", 0)) / 60)
            parts = [f"{REGION.get(k, k)} {reg[k]['median']}" + (" ⚠️" if (reg[k].get("median") or 0) > ROUTE_BAD_MS else "")
                     + (f"(فقد {reg[k]['lossPct']}%)" if reg[k].get("lossPct") else "")
                     for k in MAIN if k in reg and reg[k].get("samples")]
            dead = [REGION.get(k, k) for k in MAIN if k in reg and not reg[k].get("samples")]
            out.append(f"• {s.get('name', s.get('id'))} ✅ (قبل {age} د): " + " · ".join(parts)
                       + (f" · ما رد: {'، '.join(dead)}" if dead else ""))
            bad = [REGION.get(k, k) for k in MAIN if k in reg and (reg[k].get("median") or 0) > ROUTE_BAD_MS]
            if bad:
                out.append(f"  ⚠️ طريق سيرفرنا لـ {'، '.join(bad)} مكسور (فوق {ROUTE_BAD_MS}ms) — نتايج هالمنطقة ما تحكم على المسرّع")
        except Exception as e:
            out.append(f"• {s.get('name', s.get('id'))} ❌ ما يرد ({str(e)[:60]})")
    return out


def verdict(users):
    devs = {u["dev"] for u in users}
    hdev = {u["dev"] for u in users if u["helps"]}
    gm = med([u["gain"] for u in users if u["helps"]])
    if len(devs) < 10:
        return f"⏳ لسا البيانات قليلة ({len(devs)} جهاز) — نحتاج ١٠ على الأقل قبل نحكم"
    pct = round(100 * len(hdev) / len(devs))
    n = net(users)
    if pct >= 30 and (gm or 0) >= 15 and (n or 0) >= 0:
        return f"👍 مؤشر قوي للمرحلة ٢: {pct}% يستفيدون بوسيط {gm}ms"
    if pct >= 30 and (n or 0) < 0:
        return (f"🤔 مختلط: {pct}% يستفيدون (−{gm}ms) بس للعضو العادي المسرّع أبطأ بـ {-n}ms — "
                "الفايدة عند فئة بس (شوف الشركة/المنطقة)، وصلّح الطرق ⚠️ قبل تحكم")
    if pct >= 15:
        return f"🤔 متوسط: {pct}% يستفيدون — شوف أي شركة/منطقة بالضبط قبل تقرر"
    return f"👎 ضعيف: {pct}% بس يستفيدون — المسرّع بهالسيرفر ما يستاهل"


def build(days=14):
    if not DB.exists():
        return "🚀 تقرير المسرّع\nما فيه بيانات للحين"
    now = datetime.now(RIYADH)
    c = sqlite3.connect(DB)
    all_rows = rows_since(c, time.time() - days * 86400)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    today = [r for r in all_rows if r[0] >= day0]
    first = c.execute("SELECT MIN(at) FROM accel").fetchone()[0] if all_rows else None
    old_devs = {r[1] for r in all_rows if r[0] < day0}
    users = per_user(all_rows)
    devs = {u["dev"] for u in users}
    hdev = {u["dev"] for u in users if u["helps"]}
    gm = med([u["gain"] for u in users if u["helps"]])
    kinds = {}
    for u in users:
        k = "قياس مو موثوق" if u["noisy"] else "يفيد" if u["helps"] else ("فرق بسيط" if (u["gain"] or 0) >= 4 else "ما يفيد")
        kinds[k] = kinds.get(k, 0) + 1

    L = [f"🚀 تقرير المسرّع — {now.strftime('%Y-%m-%d')}"]
    L.append(f"\n📅 اليوم: {len(today)} فحص · {len({r[1] for r in today})} جهاز"
             f" (جدد {len({r[1] for r in today} - old_devs)})")
    since = f" من {datetime.fromtimestamp(first, RIYADH).strftime('%m-%d')}" if first else ""
    L.append(f"📈 آخر {days} يوم{since}: {len(all_rows)} فحص · {len(devs)} جهاز")
    if users:
        L.append(f"✅ يستفيدون (≥{GAIN_MIN}ms أو فقد أقل): {len(hdev)} من {len(devs)} جهاز"
                 + (f" · وسيط النقص {gm}ms" if gm else ""))
        L.append("📊 النتايج (جهاز×منطقة): " + " · ".join(f"{k} {v}" for k, v in kinds.items()))
        L.append(f"📶 بنق الأعضاء لسيرفرنا (وسيط): {med([u['to_s'] for u in users])}ms")
        n = net(users)
        if n is not None:
            L.append(f"⚖️ للعضو العادي (وسيط مباشر − عبرنا): {'أسرع ' + str(n) if n > 0 else 'أبطأ ' + str(-n) if n < 0 else 'نفس'}ms"
                     + (f" · استبعدنا {sum(1 for u in users if u['noisy'])} قياس فوق {NOISE_MS}ms" if any(u['noisy'] for u in users) else ""))
        L += block("🎮 حسب سيرفر اللعبة:", users, lambda u: u["region"], name=lambda k: REGION.get(k, k))
        L += block("📡 حسب الشركة:", users, lambda u: u["op"])
        L += block("🏙️ حسب المدينة:", users, lambda u: u["city"])
        best = sorted([u for u in users if u["helps"] and u["gain"]], key=lambda u: -u["gain"])[:3]
        if best:
            L.append("\n🏆 أكبر فايدة:")
            L += [f"• {u['op']} · {u['city']} → {REGION.get(u['region'], u['region'])}: {u['direct']} ← {u['via']}ms (−{u['gain']})"
                  for u in best]
    L += servers_now()
    L.append("\n" + verdict(users))
    return "\n".join(L)


def send(text):
    try:
        tok = (DATA / "bot_token").read_text().strip()
        owner = int(json.loads((DATA / "config.json").read_text()).get("owner_id") or 0)
    except Exception:
        tok, owner = "", 0
    if not tok or not owner:
        print("✗ ما فيه bot_token أو owner_id", file=sys.stderr)
        return False
    req = ur.Request(f"https://api.telegram.org/bot{tok}/sendMessage",
                     data=json.dumps({"chat_id": owner, "text": text[:4000], "disable_web_page_preview": True},
                                     ensure_ascii=False).encode(),
                     headers={"Content-Type": "application/json"})
    for _ in range(3):  # انقطاعات تليجرام عادية
        try:
            with ur.urlopen(req, timeout=20) as r:
                if json.load(r).get("ok"):
                    return True
        except Exception as e:
            print(f"تليجرام: {e}", file=sys.stderr)
        time.sleep(10)
    return False


if __name__ == "__main__":
    days = next((int(a) for a in sys.argv[1:] if a.isdigit()), 14)
    text = build(days)
    if "--send" in sys.argv:
        print("✓ انرسل" if send(text) else "✗ ما انرسل")
    else:
        print(text)
