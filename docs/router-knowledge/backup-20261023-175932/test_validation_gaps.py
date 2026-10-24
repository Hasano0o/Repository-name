import importlib.util
import unittest
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "validate-records.py"
)
spec = importlib.util.spec_from_file_location("kb_validator_gaps", SCRIPT)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def record():
    return {
        "recordId": "gap-test-001",
        "manufacturer": "test-lab",
        "model": "workflow-test",
        "featureId": "sample-feature",
        "claim": "اختبار فقط",
        "verification": {
            "status": "DISCOVERED",
            "checkedAt": "2026-10-23"
        },
        "evidence": [{
            "type": "other",
            "reference": "WORKFLOW_TEST_ONLY",
            "supports": "اختبار بنية السجل فقط"
        }],
        "limitations": ["اختبار فقط"],
        "riskLevel": "LOW"
    }


class ValidationGapTests(unittest.TestCase):
    def test_verification_must_be_object(self):
        r = record()
        r["verification"] = "APPROVED"
        self.assertTrue(validator.validate(r, "test"))

    def test_evidence_item_must_have_valid_type(self):
        r = record()
        r["evidence"] = [{
            "type": "made_up",
            "reference": "x",
            "supports": "y"
        }]
        self.assertTrue(validator.validate(r, "test"))

    def test_limitations_items_must_be_strings(self):
        r = record()
        r["limitations"] = [123]
        self.assertTrue(validator.validate(r, "test"))

    def test_approved_requires_physical_test_evidence(self):
        r = record()
        r["verification"] = {
            "status": "APPROVED",
            "checkedAt": "2026-10-23",
            "reviewer": "reviewer-test",
            "testNotes": "ملاحظة اختبار شكلية"
        }
        self.assertTrue(validator.validate(r, "test"))



    def test_invalid_checked_at_date_is_rejected(self):
        r = record()
        r["verification"]["checkedAt"] = "yesterday-ish"
        errors = validator.validate(r, "test")
        self.assertTrue(errors, "يجب رفض التاريخ غير الصحيح")

    def test_api_key_field_is_rejected(self):
        r = record()
        r["api_key"] = "TEST_VALUE_NOT_A_REAL_SECRET"
        errors = validator.validate(r, "test")
        self.assertTrue(
            any("حقل حساس ممنوع" in e for e in errors),
            "يجب رفض حقل api_key الحساس"
        )

if __name__ == "__main__":
    unittest.main(verbosity=2)

    def test_invalid_checked_at_date_is_rejected(self):
        r = record()
        r["verification"]["checkedAt"] = "yesterday-ish"
        errors = validator.validate(r, "test")
        self.assertTrue(errors, "يجب رفض التاريخ غير الصحيح")

    def test_api_key_field_is_rejected(self):
        r = record()
        r["api_key"] = "TEST_VALUE_NOT_A_REAL_SECRET"
        errors = validator.validate(r, "test")
        self.assertTrue(
            any("حقل حساس ممنوع" in e for e in errors),
            "يجب رفض حقل api_key الحساس"
        )
