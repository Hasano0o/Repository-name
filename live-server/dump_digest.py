#!/usr/bin/env python3
"""
ملخص يومي لملفات الراوترات (٢ نوفمبر ٢٠٢٦) — بدل إشعار لكل ملف.

يقرأ ملفات zip اللي وصلت من التطبيق (جهاز جديد · FULL · AUTH · أخطاء الإضافة) في
data/dumps/ و /root/bandly-archive/dumps/، ويجمعها بالموديل، ويرسل رسالة وحدة للمالك:
  • الجديد من آخر تشغيل (لكل موديل: كم ملف ونوعها)
  • الأكثر طلباً آخر ٣٠ يوم (عشان نشتغل بالأولوية)

ما يحذف ولا ينقل أي ملف — قراءة بس.
التشغيل:  python3 dump_digest.py          ← يرسل
          python3 dump_digest.py --dry    ← يطبع بس (للتجربة)
"""
import json
import re
import sys
import time
import zipfile
import urllib.request as ur
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DIRS = [DATA / "dumps", Path("/root/bandly-archive/dumps")]
STATE = DATA / "digest_state.json"
DAY = 86400


def kind_of(name: str) -> str:
    n = name.lower()
    if "-auth" in n:
        return "AUTH"
    if "-ful" in n:
        return "FULL"
    if "add-error" in n:
        return "خطأ إضافة"
    if "partial" in n:
        return "ناقص"
    return "جهاز جديد"


def model_of(z: Path) -> str:
    try:
        with zipfile.ZipFile(z) as f:
            txt = f.read("README.txt").decode("utf-8", "replace")
        m = re.search(r"^الموديل:\s*(.+)$", txt, re.M)
        if m and m.group(1).strip() not in ("", "—"):
            return m.group(1).strip()[:50]
    except Exception:
        pass
    m = re.match(r"router-(.+?)(?:-FULL?|-AUTH|-add-error|-PARTIAL)?-\d{4}-\d{4,6}\.zip$", z.name, re.I)
    return (m.group(1) if m else z.stem)[:50]


def norm(model: str) -> str:
    """الاسم بدون الزوائد: «Pro7 - System Status (OpenWrt)-FULL» = «Pro7»"""
    m = re.sub(r"-(FULL?|AUTH|add-error|PARTIAL)$", "", model.strip(), flags=re.I)
    m = re.sub(r"\s*\((OpenWrt)\)\s*$", "", m, flags=re.I)
    m = re.sub(r"\s+-\s+.*$", "", m)
    return m.strip() or model


def key_of(name: str) -> str:
    """مفتاح التجميع: «5G CPE PRO 7» = «5g cpe pro7» = «Pro7»"""
    k = re.sub(r"[^a-z0-9]", "", name.lower())
    k = re.sub(r"^(5gcpe|4gcpe|cpe)", "", k)
    return k or name


def collect():
    seen, out = set(), []
    for d in DIRS:
        if not d.exists():
            continue
        for z in d.glob("*.zip"):
            if z.name in seen:  # نفس الملف في dumps والأرشيف
                continue
            seen.add(z.name)
            out.append((z.stat().st_mtime, norm(model_of(z)), kind_of(z.name)))
    # نفس الجهاز بكتابات مختلفة ← اسم واحد (الأكثر تكرار)
    names: dict[str, dict[str, int]] = {}
    for _, m, _k in out:
        names.setdefault(key_of(m), {}).setdefault(m, 0)
        names[key_of(m)][m] += 1
    best = {k: max(v.items(), key=lambda x: x[1])[0] for k, v in names.items()}
    return [(t, best[key_of(m)], k) for t, m, k in out]


def send(text: str) -> bool:
    tok = (DATA / "bot_token").read_text().strip() if (DATA / "bot_token").exists() else ""
    try:
        owner = int(json.loads((DATA / "config.json").read_text()).get("owner_id") or 0)
    except Exception:
        owner = 0
    if not tok or not owner:
        print("✗ ما فيه bot_token أو owner_id", file=sys.stderr)
        return False
    req = ur.Request(f"https://api.telegram.org/bot{tok}/sendMessage",
                     data=json.dumps({"chat_id": owner, "text": text[:4000]}, ensure_ascii=False).encode(),
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


def main():
    dry = "--dry" in sys.argv
    now = time.time()
    try:
        last = float(json.loads(STATE.read_text()).get("last", 0))
    except Exception:
        last = 0
    since = last if last > now - 7 * DAY else now - DAY
    items = collect()

    new: dict[str, dict[str, int]] = {}
    for t, m, k in items:
        if t > since:
            new.setdefault(m, {}).setdefault(k, 0)
            new[m][k] += 1
    top: dict[str, int] = {}
    errs = 0
    for t, m, k in items:
        if t <= now - 30 * DAY:
            continue
        if k in ("جهاز جديد", "FULL"):  # طلبات أجهزة — أخطاء الإضافة غالباً راوترات مدعومة (كلمة غلط…) فنعدّها لحالها
            top[m] = top.get(m, 0) + 1
        elif k == "خطأ إضافة":
            errs += 1

    hrs = max(1, round((now - since) / 3600))
    lines = [f"📦 ملخص ملفات الراوترات — آخر {hrs} ساعة"]
    if new:
        for m, ks in sorted(new.items(), key=lambda x: -sum(x[1].values())):
            lines.append(f"• {m}: " + " · ".join(f"{k} {n}" for k, n in sorted(ks.items(), key=lambda x: -x[1])))
    else:
        lines.append("ما وصل شي جديد.")
    if top:
        lines.append("\n🔝 الأكثر طلباً (٣٠ يوم):")
        for i, (m, n) in enumerate(sorted(top.items(), key=lambda x: -x[1])[:10], 1):
            lines.append(f"{i}. {m} — {n}")
    if errs:
        lines.append(f"\n⚠️ أخطاء إضافة راوتر (٣٠ يوم): {errs} — في data/reports/bandly-add-login-*")
    # «برمج لي جهازي»: وش تبرمج لحاله ووش يحتاج المبرمج (autoprog.py — لو الملف مو موجود نكمّل بدونه)
    try:
        from autoprog import digest_lines
        lines += digest_lines(since)
    except Exception as e:
        print(f"autoprog: {e}", file=sys.stderr)
    lines.append("\nالملفات في /root/bandly-live/data/dumps/")
    text = "\n".join(lines)

    if dry:
        print(text)
        return
    if send(text):
        STATE.write_text(json.dumps({"last": now}))
        print("✓ انرسل")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
