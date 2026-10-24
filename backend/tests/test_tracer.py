import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from tracer_runner import run, validate_source, SecurityError

CASES = {
    "arithmetic": ("x = 10\ny = 20\nresult = x + y\nprint(result)", "30"),
    "loop": ("numbers = [10, 20, 30]\ntotal = 0\nfor number in numbers:\n    total = total + number\nprint(total)", "60"),
    "condition": ('temperature = 31\nif temperature > 30:\n    status = "Hot"\nelse:\n    status = "Comfortable"\nprint(status)', "Hot"),
    "function": ("def calculate_area(width, height):\n    area = width * height\n    return area\nresult = calculate_area(5, 4)\nprint(result)", "20"),
    "recursion": ("def factorial(n):\n    if n == 1:\n        return 1\n    return n * factorial(n - 1)\nanswer = factorial(4)\nprint(answer)", "24"),
    "shared": ("first = [1, 2]\nsecond = first\nsecond.append(3)\nprint(first)\nprint(second)", "[1, 2, 3]"),
    "transform": ('text = "  Hello Python World  "\ncleaned = text.strip().lower().replace(" ", "_")\nprint(cleaned)', "hello_python_world"),
}

def test_validation_programs_complete():
    for name, (code, expected) in CASES.items():
        result = run({"code": code, "inputs": []})
        assert result["status"] == "completed", (name, result["error"])
        assert expected in result["output"]
        assert result["events"], name

def test_shared_reference_identity_is_preserved():
    result = run({"code": CASES["shared"][0], "inputs": []})
    snapshots = [event["snapshot"] for event in result["events"]]
    found = False
    for snap in snapshots:
        refs = {v["name"]: v["objectId"] for v in snap["variables"]}
        if refs.get("first") and refs.get("first") == refs.get("second"):
            found = True
    assert found

def test_exception_is_recorded():
    result = run({"code": "numbers = [10, 20, 30]\nvalue = numbers[5]\nprint(value)", "inputs": []})
    assert result["status"] == "error"
    assert result["error"]["type"] == "IndexError"
    assert any(event["type"] == "exception" for event in result["events"])
    assert "value" not in result["output"]

def test_input_handshake_and_resume():
    code = 'age = int(input("Age: "))\nprint(age + 1)'
    first = run({"code": code, "inputs": []})
    assert first["status"] == "needs_input"
    second = run({"code": code, "inputs": ["25"]})
    assert second["status"] == "completed"
    assert "26" in second["output"]

def test_dangerous_import_is_blocked():
    try:
        validate_source("import os\nprint(os.environ)")
    except SecurityError:
        pass
    else:
        raise AssertionError("unsafe import should be blocked")
