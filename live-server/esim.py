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
# دليل قوي = تحميل/إدارة ملف الشريحة فعلاً (LPA · eUICC · SM-DP+ · إدارة eSIM).
# الباقي (كلمة esim بس) ضعيف: مثلاً كل صفحات هواوي فيها «SkyTone eSIM» (شريحة سفر افتراضية من هواوي — مو تحميل شريحة شركتك)
STRONG_RX = re.compile(
    r"euicc|sm-?dp\+?|smdp|lpa:1\$|\blpa_|_lpa\b|profile_?download|download_?profile|esim_?profile|esimprofile|"
    r"esim_?manage|esimmanage|activation_?code|activationcode",
    re.A)
SKYTONE = re.compile(r"skytone", re.A)
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


def is_strong(snippet: str) -> bool:
    t = snippet.lower()
    return bool(STRONG_RX.search(t)) and not SKYTONE.search(t)


def zip_hits(z: Path, limit: int = 3, strong_only: bool = False) -> list[tuple[str, str]]:
    """[(الملف، المقطع)] — فاضي لو ما فيه eSIM. strong_only ← بس الدليل القوي (تحميل/إدارة الشريحة)"""
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
            if strong_only:
                tl = t.lower()
                m = next((m for m in STRONG_RX.finditer(tl) if not SKYTONE.search(tl[max(0, m.start() - 80):m.end() + 80])), None)
                if m:
                    s0 = max(0, m.start() - 50)
                    out.append((name, t[s0:m.end() + 70].replace("\n", " ").strip()))
            else:
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
            strong = zip_hits(z, strong_only=True)
            hits = strong or zip_hits(z)
            if hits:
                m = models.setdefault(norm(model_of(z)), {"zips": [], "hits": hits, "strong": False})
                m["zips"].append(z.name)
                if strong and not m["strong"]:
                    m["strong"], m["hits"] = True, strong
    print(f"فحصنا {len(seen)} ملف zip")
    if not models:
        print("ما لقينا ولا راوتر صفحته فيها eSIM")
        return
    strong = {m: v for m, v in models.items() if v["strong"]}
    weak = {m: v for m, v in models.items() if not v["strong"]}
    print(f"✅ دليل قوي (تحميل/إدارة الشريحة) — {len(strong)} موديل:\n")
    for m, v in sorted(strong.items(), key=lambda kv: -len(kv[1]["zips"])):
        print(f"■ {m} — {len(v['zips'])} ملف · مثال: {v['zips'][-1]}")
        for f, h in v["hits"]:
            print(f"    {f}: {h[:160]}")
    if weak:
        print(f"\n· كلمة eSIM بس (غالباً SkyTone هواوي أو أيقونة) — {len(weak)} موديل: " + " · ".join(f"{m} ({len(v['zips'])})" for m, v in weak.items()))


if __name__ == "__main__":
    import signal
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    sys.path.insert(0, str(BASE))
    main()
