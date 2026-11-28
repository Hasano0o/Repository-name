"""اختبارات labfix: python3 live-server/test_labfix.py"""
import tempfile, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import labfix

tmp = pathlib.Path(tempfile.mkdtemp())
labfix.LF = tmp / "labfix"
labfix.STORE = labfix.LF / "variants.json"

labfix.record("zte", "MC801A", "speed", "comma")
labfix.record("zte", "MC801A", "speed", "comma")
labfix.record("zte", "MU5001", "speed", "semi")
assert labfix.best("zte", "MC801A") == {"speed": "comma"}, labfix.best("zte", "MC801A")
assert labfix.best("zte", "MU5001") == {"speed": "semi"}
# موديل جديد ياخذ الأكثر على الدرايفر كله
assert labfix.best("zte", "U60") == {"speed": "comma"}
assert labfix.best("huawei-lte", "x") == {}
(labfix.LF / "off").touch()
assert labfix.best("zte", "MC801A") == {}
print("labfix OK")
