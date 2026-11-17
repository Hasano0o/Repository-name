#!/usr/bin/env python3
"""
كشف eSIM في ملفات الراوترات (١٧ نوفمبر ٢٠٢٦ — اقتراح عضو: «بدل ما نشيل الشريحة كل شهر»).

Bandly يقدر يضيف «أضف شريحة بالباركود» بس للراوتر اللي فيه eSIM مدمجة وصفحته تسمح تحمّل ملف الشريحة.
هنا ندوّر في ملفات zip (FULL · جهاز جديد · AUTH) على أي أثر لـ eSIM: eUICC · SM-DP+ · LPA:1$ · esim_profile…
قراءة بس — ما يحذف ولا ينقل.

  python3 esim.py                ← كل الموديلات اللي ملفاتها فيها eSIM (مع مثال من الكود)
  (ونفس الكشف يطلع في الملخص اليومي dump_digest.py للملفات الجديدة)
"""
import re
import sys
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
DIRS = [BASE / "data" / "dumps", Path("/root/bandly-archive/dumps")]
TEXT_EXT = {".js", ".html", ".htm", ".txt", ".json", ".xml", ".asp", ".lua", ".cgi", ".tmpl", ".properties", ""}
MAX_SCAN = 1_500_000

# النص ينصغّر قبل البحث. «esim» كلمة كاملة (ما تطلع من resim…)، والباقي مصطلحات خاصة بالشرائح الإلكترونية
ESIM_RX = re.compile(
    r"\besim\b|\be-sim\b|esim_|_esim|euicc|sm-?dp\+?|smdp|lpa:1\$|\blpa_|activationcode|activation_code|"
    r"profile_?download|download_?profile|esimprofile|esim_?profile|\bisdp\b",
    re.A)
# مكتبات معروفة — ما فيها شي يخص الراوتر
LIBLIKE = re.compile(r"(^|/)(lib|libs|vendor|vendors|node_modules)/|jquery|echarts|bootstrap|crypto-js|forge|polyfill|"
                     r"chunk-vendors|lodash|moment|knockout|require\.js", re.I)


def text_hits(text: str, limit: int = 3) -> list[str]:
    """مقاطع قصيرة حول كل تطابق (للعرض)"""
    out = []
    tl = text.lower()
    for m in ESIM_RX.finditer(tl):
        s = max(0, m.start() - 50)
        out.append(text[s:m.end() + 70].replace("\n", " ").strip())
        if len(out) >= limit:
            break
    return out


def zip_hits(z: Path, limit: int = 3) -> list[tuple[str, str]]:
    """[(الملف، المقطع)] — فاضي لو ما فيه eSIM"""
    out: list[tuple[str, str]] = []
    try:
        zf = zipfile.ZipFile(z)
    except Exception:
        return out
    with zf:
        for info in zf.infolist():
            name = info.filename
            if (info.is_dir() or info.file_size > MAX_SCAN or name == "README.txt" or LIBLIKE.search(name)
                    or Path(name).suffix.lower() not in TEXT_EXT):
                continue
            try:
                t = zf.read(info).decode("utf-8", "replace")
            except Exception:
                continue
            for h in text_hits(t, 1):
                out.append((name, h))
            if len(out) >= limit:
                break
    return out


def main():
    from dump_digest import model_of, norm
    seen, models = set(), {}
    for d in DIRS:
        if not d.exists():
            continue
        for z in sorted(d.glob("*.zip")):
            if z.name in seen:
                continue
            seen.add(z.name)
            hits = zip_hits(z)
            if hits:
                m = models.setdefault(norm(model_of(z)), {"zips": [], "hits": hits})
                m["zips"].append(z.name)
    print(f"فحصنا {len(seen)} ملف zip")
    if not models:
        print("ما لقينا ولا راوتر صفحته فيها eSIM")
        return
    print(f"📶 {len(models)} موديل فيه أثر eSIM:\n")
    for m, v in sorted(models.items(), key=lambda kv: -len(kv[1]["zips"])):
        print(f"■ {m} — {len(v['zips'])} ملف · مثال: {v['zips'][-1]}")
        for f, h in v["hits"]:
            print(f"    {f}: {h[:160]}")


if __name__ == "__main__":
    import signal
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    sys.path.insert(0, str(BASE))
    main()
