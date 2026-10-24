#!/usr/bin/env python3
"""Organize discovered router records; preview by default."""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCOMING = ROOT / "incoming"
MANUFACTURERS = ROOT / "manufacturers"
UNKNOWN = ROOT / "unknown-models"
ALLOWED = {"DISCOVERED", "CODE_TESTED"}


def slug(value):
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "unknown"


def load_records():
    records = []
    seen = set()

    for path in sorted(INCOMING.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ValueError(f"JSON غير صالح في {path.name}: {exc}")

        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"سجل ليس كائن JSON في {path.name}")

            rid = item.get("recordId")
            status = item.get("verification", {}).get("status")
            required = ("recordId", "manufacturer", "featureId",
                        "verification", "evidence", "limitations", "riskLevel")

            missing = [key for key in required if key not in item]
            if missing:
                raise ValueError(
                    f"{path.name}: السجل {rid!r} ينقصه: {', '.join(missing)}"
                )
            if not isinstance(rid, str) or not rid.strip():
                raise ValueError(f"recordId غير صالح في {path.name}")
            if rid in seen:
                raise ValueError(f"معرّف مكرر: {rid}")
            seen.add(rid)

            if status in ALLOWED:
                records.append((path, item))

    return records


def existing_record_ids():
    found = {}
    incoming = INCOMING.resolve()

    for path in ROOT.rglob("*.json"):
        if incoming in path.resolve().parents:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict) and item.get("recordId"):
                found.setdefault(item["recordId"], []).append(path)

    return found


def target_for(record):
    maker = slug(record.get("manufacturer"))
    model = slug(record.get("model"))
    feature = slug(record.get("featureId"))
    rid = slug(record.get("recordId"))

    # السجل الذي لا يحدد موديلًا يذهب إلى unknown-models.
    if not record.get("model") or model == "unknown":
        directory = UNKNOWN / maker
    else:
        directory = MANUFACTURERS / maker

    return directory / f"{model}--{feature}--{rid}.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply-discovered",
        action="store_true",
        help="اكتب السجلات DISCOVERED/CODE_TESTED إلى ملفات جديدة فقط",
    )
    args = parser.parse_args()

    try:
        records = load_records()
    except ValueError as exc:
        print(f"خطأ: {exc}", file=sys.stderr)
        return 2

    existing_ids = existing_record_ids()
    conflicts = {
        record["recordId"]: existing_ids[record["recordId"]]
        for _, record in records
        if record["recordId"] in existing_ids
    }
    if conflicts:
        print("تعارض معرّفات موجودة خارج incoming:")
        for rid, paths in sorted(conflicts.items()):
            print(f"  {rid}: " + ", ".join(str(p) for p in paths))
        print("أُوقفت العملية قبل أي كتابة.")
        return 2

    print(f"السجلات المرشحة: {len(records)}")
    print("الوضع:", "كتابة ملفات جديدة" if args.apply_discovered else "معاينة فقط")
    planned = []
    errors = 0

    for source, record in records:
        target = target_for(record)
        print(
            f"[{record['verification']['status']}] "
            f"{record['recordId']}\n"
            f"  المصدر: {source.relative_to(ROOT)}\n"
            f"  الوجهة: {target.relative_to(ROOT)}"
        )

        if target.exists():
            try:
                existing = json.loads(target.read_text(encoding="utf-8"))
            except Exception:
                existing = None

            if existing == record:
                print("  النتيجة: موجود ومطابق؛ تخطٍّ")
            else:
                print("  تحذير: الوجهة موجودة ومختلفة؛ لن يتم الاستبدال")
                errors += 1
            continue

        planned.append((target, record))

    print(f"\nملفات جديدة مخططة: {len(planned)}")
    print(f"تعارضات تحتاج مراجعة: {errors}")

    if not args.apply_discovered:
        print("لم تُكتب أو تُعدّل أي ملفات. راجع المعاينة أولًا.")
        return 1 if errors else 0

    if errors:
        print("أُلغيت الكتابة بسبب وجود تعارضات.")
        return 2

    # افحص كل الوجهات قبل إنشاء أي ملف.
    if any(target.exists() for target, _ in planned):
        print("أُلغيت الكتابة: ظهرت وجهة موجودة أثناء الفحص.")
        return 2

    written = []
    try:
        for target, record in planned:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("x", encoding="utf-8") as handle:
                json.dump(record, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            written.append(target)
    except Exception as exc:
        print(f"خطأ أثناء الكتابة: {exc}", file=sys.stderr)
        print("الملفات التي أُنشئت قبل الخطأ:")
        for path in written:
            print(f"  {path.relative_to(ROOT)}")
        return 2

    print(f"تم إنشاء {len(written)} ملفًا جديدًا.")
    print("لم تُعدّل ملفات incoming أو مصفوفة التوافق.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
