import importlib.util
import unittest
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "validate-records.py"
)

spec = importlib.util.spec_from_file_location("kb_validator", SCRIPT)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def valid_record():
    return {
        "recordId": "test-router-feature-001",
        "manufacturer": "test-lab",
        "model": "workflow-test",
        "featureId": "sample-feature",
        "claim": "سجل اختبار فقط، وليس ادعاءً تقنيًا",
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


class ValidationTests(unittest.TestCase):
    def test_valid_record_passes_current_validator(self):
        self.assertEqual(validator.validate(valid_record(), "test"), [])

    def test_missing_record_id_is_rejected(self):
        record = valid_record()
        del record["recordId"]
        self.assertTrue(validator.validate(record, "test"))

    def test_secret_key_is_rejected(self):
        record = valid_record()
        record["password"] = "NOT_A_REAL_PASSWORD"
        errors = validator.validate(record, "test")
        self.assertTrue(any("حقل حساس ممنوع" in e for e in errors))

    def test_approved_without_reviewer_is_rejected(self):
        record = valid_record()
        record["verification"]["status"] = "APPROVED"
        record["verification"]["testNotes"] = "اختبار شكلي"
        errors = validator.validate(record, "test")
        self.assertTrue(any("reviewer" in e for e in errors))

    def test_empty_evidence_is_rejected(self):
        record = valid_record()
        record["evidence"] = []
        errors = validator.validate(record, "test")
        self.assertTrue(any("evidence" in e for e in errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
