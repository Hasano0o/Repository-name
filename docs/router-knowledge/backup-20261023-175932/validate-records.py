#!/usr/bin/env python3
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCOMING = ROOT / "incoming"
STATUSES = {"DISCOVERED", "CODE_TESTED", "DEVICE_TESTED", "APPROVED", "UNSUPPORTED"}
RISKS = {"LOW", "MEDIUM", "HIGH"}
SECRET_KEYS = {
    "password", "passwd", "cookie", "cookies", "token",
    "access_token", "refresh_token", "api_key", "apikey",
    "api_secret", "client_secret", "secret_key", "authorization",
    "imei"
}

def secret_errors(obj, where="$"):
    errors = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key.lower() in SECRET_KEYS:
                errors.append(f"{where}.{key}: حقل حساس ممنوع")
            errors.extend(secret_errors(value, f"{where}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            errors.extend(secret_errors(value, f"{where}[{i}]"))
    return errors

def validate(r, source):
    errors = []
    required = (
        "recordId", "manufacturer", "featureId",
        "verification", "evidence", "limitations", "riskLevel"
    )
    for key in required:
        if key not in r:
            errors.append(f"{source}: حقل مفقود: {key}")

    rid = r.get("recordId", "")
    if not isinstance(rid, str) or not re.fullmatch(
        r"[a-z0-9][a-z0-9._-]*", rid
    ):
        errors.append(f"{source}: recordId غير صالح")

    for key in ("manufacturer", "featureId"):
        value = r.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{source}: {key} غير صالح")

    v = r.get("verification", {})
    if not isinstance(v, dict):
        errors.append(f"{source}: verification يجب أن يكون كائنًا")
        v = {}
    elif v.get("status") not in STATUSES:
        errors.append(f"{source}: verification.status غير صالح")
    elif not isinstance(v.get("checkedAt"), str) or not v["checkedAt"].strip():
        errors.append(f"{source}: verification.checkedAt مطلوب")
    else:
        checked_at = v["checkedAt"].strip()
        try:
            from datetime import date, datetime
            if len(checked_at) == 10:
                date.fromisoformat(checked_at)
            else:
                datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            errors.append(
                f"{source}: verification.checkedAt يجب أن يكون تاريخ ISO صالحًا"
            )

    if r.get("riskLevel") not in RISKS:
        errors.append(f"{source}: riskLevel غير صالح")

    allowed_evidence_types = {
        "official_documentation", "source_code", "automated_test",
        "physical_device_test", "other"
    }
    evidence = r.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        errors.append(f"{source}: evidence يجب أن تحتوي دليلًا واحدًا على الأقل")
    else:
        for i, item in enumerate(evidence):
            if not isinstance(item, dict):
                errors.append(f"{source}: evidence[{i}] يجب أن يكون كائنًا")
                continue
            if item.get("type") not in allowed_evidence_types:
                errors.append(f"{source}: evidence[{i}].type غير صالح")
            if not isinstance(item.get("reference"), str) or not item["reference"].strip():
                errors.append(f"{source}: evidence[{i}] يحتاج reference نصيًا")
            if not isinstance(item.get("supports"), str) or not item["supports"].strip():
                errors.append(f"{source}: evidence[{i}] يحتاج supports نصيًا")

    limitations = r.get("limitations")
    if not isinstance(limitations, list):
        errors.append(f"{source}: limitations يجب أن تكون قائمة")
    elif any(not isinstance(item, str) for item in limitations):
        errors.append(f"{source}: كل عناصر limitations يجب أن تكون نصوصًا")

    if v.get("status") == "APPROVED":
        if not v.get("reviewer"):
            errors.append(f"{source}: APPROVED يتطلب reviewer")
        if not v.get("testNotes"):
            errors.append(f"{source}: APPROVED يتطلب testNotes")
        if not isinstance(evidence, list) or not any(
            isinstance(item, dict)
            and item.get("type") == "physical_device_test"
            for item in evidence
        ):
            errors.append(
                f"{source}: APPROVED يتطلب دليل اختبار على جهاز فعلي"
            )

    errors.extend(secret_errors(r, source))
    return errors

def main():
    files = sorted(INCOMING.glob("*.json"))
    if not files:
        print("لا توجد سجلات JSON في incoming/.")
        return 0
    errors, seen = [], {}
    count = 0
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            records = data if isinstance(data, list) else [data]
            for r in records:
                count += 1
                if not isinstance(r, dict):
                    errors.append(f"{path.name}: كل سجل يجب أن يكون كائن JSON")
                    continue
                errors.extend(validate(r, path.name))
                rid = r.get("recordId")
                if isinstance(rid, str) and rid in seen:
                    errors.append(f"recordId مكرر: {rid} ({seen[rid]} و{path.name})")
                elif isinstance(rid, str) and rid:
                    seen[rid] = path.name
        except Exception as e:
            errors.append(f"{path.name}: خطأ في JSON: {e}")
    if errors:
        print("فشل التحقق:")
        print("\n".join("- " + e for e in errors))
        return 1
    print(f"نجح فحص بنية {count} سجلًا. هذا لا يثبت صحة الادعاءات التقنية.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
