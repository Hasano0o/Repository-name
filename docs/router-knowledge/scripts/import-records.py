#!/usr/bin/env python3
import argparse, csv, json, re, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCOMING = ROOT / "incoming"
MANUFACTURERS = ROOT / "manufacturers"
MATRIX = ROOT / "catalogs" / "compatibility-matrix.csv"
ALLOWED = {"DISCOVERED", "CODE_TESTED", "DEVICE_TESTED", "APPROVED", "UNSUPPORTED"}
KNOWN = {"huawei", "zte", "mikrotik", "zyxel", "tp-link", "openwrt", "netgear", "cudy"}

def slug(s):
    out = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    if not out:
        raise ValueError("قيمة لا تصلح لاسم ملف")
    return out

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="نفّذ الاستيراد بعد المراجعة")
    args = parser.parse_args()

    check = subprocess.run([sys.executable, str(ROOT / "scripts/validate-records.py")])
    if check.returncode:
        return check.returncode

    files = sorted(INCOMING.glob("*.json"))
    if not files:
        print("لا توجد سجلات للاستيراد.")
        return 0

    records, ids = [], set()
    for src in files:
        data = json.loads(src.read_text(encoding="utf-8"))
        for r in (data if isinstance(data, list) else [data]):
            rid = r["recordId"]
            if rid in ids:
                raise SystemExit(f"recordId مكرر: {rid}")
            ids.add(rid)
            if r["verification"]["status"] not in ALLOWED:
                raise SystemExit(f"حالة غير معروفة في {rid}")
            records.append((src, r))

    existing = set()
    for p in MANUFACTURERS.glob("*/*.json"):
        try:
            existing.add(json.loads(p.read_text(encoding="utf-8")).get("recordId"))
        except Exception:
            pass

    plan = []
    for src, r in records:
        if r["recordId"] in existing:
            raise SystemExit(f"السجل موجود مسبقًا؛ لن تتم الكتابة فوقه: {r['recordId']}")
        maker = slug(r["manufacturer"])
        if maker not in KNOWN:
            raise SystemExit(
                f"شركة مصنّعة غير معروفة: {r['manufacturer']}. "
                "أضفها إلى KNOWN بعد التحقق."
            )
        model = slug(r.get("model") or "model-unknown")
        feature = slug(r["featureId"])
        target = MANUFACTURERS / maker / f"{model}--{feature}--{slug(r['recordId'])}.json"
        if target.exists():
            raise SystemExit(f"المسار موجود مسبقًا: {target}")
        plan.append((src, r, target))

    print("معاينة الاستيراد:")
    for src, r, target in plan:
        print(f"{src.name} -> {target.relative_to(ROOT)} [{r['verification']['status']}]")
    if not args.apply:
        print("لم تتغير أي ملفات. بعد المراجعة شغّل الأمر مع --apply.")
        return 0

    pending = [
        r["recordId"] for _, r, _ in plan
        if r["verification"]["status"] != "APPROVED"
    ]
    if pending:
        print("أُلغي الاستيراد: يجب اعتماد السجلات أولًا: " + ", ".join(pending))
        return 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = ROOT / "backups" / stamp
    backup.mkdir(parents=True, exist_ok=False)
    for src in files:
        shutil.copy2(src, backup / src.name)

    for _, r, target in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    new_matrix = not MATRIX.exists()
    with MATRIX.open("a", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        if new_matrix:
            writer.writerow(["manufacturer", "model", "hardwareVersion", "softwareVersion",
                             "featureId", "status", "evidenceCount", "limitations"])
        for _, r, _ in plan:
            writer.writerow([r.get("manufacturer", ""), r.get("model") or "",
                r.get("hardwareVersion") or "", r.get("softwareVersion") or "",
                r["featureId"], r["verification"]["status"], len(r["evidence"]),
                " | ".join(r["limitations"])])
    print(f"تم استيراد {len(plan)} سجلًا. النسخة الاحتياطية: {backup}")
    print("لم تُحذف ملفات incoming.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
