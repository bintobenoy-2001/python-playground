from __future__ import annotations

import ast
import builtins as py_builtins
import io
import json
import math
import os
import resource
import signal
import sys
import traceback
from collections import deque
from dataclasses import dataclass
from typing import Any

MAX_EVENTS = 2500
MAX_OUTPUT = 65536
MAX_SOURCE = 30000
MAX_AST_NODES = 4000
MAX_ITEMS = 24
MAX_DEPTH = 4
SAFE_MODULES = {
    "math", "statistics", "random", "string", "collections", "itertools",
    "functools", "decimal", "fractions", "operator", "re"
}

COMMON_ERROR_HINTS = {
    "ZeroDivisionError": "You divided by zero. Check the denominator before dividing, e.g. guard with `if divisor != 0:`.",
    "IndexError": "You asked for a position that does not exist in the sequence. Valid indexes run from 0 to len(sequence) - 1.",
    "KeyError": "You looked up a dictionary key that is not present. Use `d.get(key)` or check `if key in d:` first.",
    "NameError": "You used a name before it was defined, or misspelled it. Make sure the variable is assigned above this line.",
    "TypeError": "You combined incompatible types. A common cause is mixing str and int, e.g. use int(text) or str(number) to convert first.",
    "ValueError": "The value had the right type but unacceptable content, e.g. int('abc'). Check the value you are converting.",
    "AttributeError": "You accessed an attribute or method the object does not have. Check the spelling and the object's type.",
    "RecursionError": "A function called itself too many times without a base case. Add a condition that returns without recursing.",
    "StopIteration": "An iterator ran out of items. This usually happens when next() is called past the end.",
    "UnboundLocalError": "You read a local variable before assigning it inside this function. Assign it before use, or mark it `global`.",
    "AssertionError": "An assert statement failed because its condition was False.",
}


def syntax_hint(message: str, text: str | None) -> str:
    """Turn a raw SyntaxError message into a beginner-friendly fix suggestion."""
    msg = (message or "").lower()
    line = (text or "").strip()
    if "expected ':'" in msg or ("expected" in msg and "':'" in msg):
        return "A compound statement header (if/for/while/def/class) must end with a colon ':'. Add it at the end of the line."
    if "was never closed" in msg or "closing parenthesis" in msg or "unexpected eof" in msg:
        return "A bracket or quote was opened but never closed. Check that every ( [ { and quote has a matching partner."
    if "invalid syntax" in msg and line.endswith("="):
        return "An assignment needs a value on the right of '='. Did you mean '==' for a comparison?"
    if "cannot assign" in msg or ("assign" in msg and "literal" in msg):
        return "You are assigning to something that cannot hold a value. Use '==' to compare, or assign to a variable name."
    if "unexpected indent" in msg:
        return "This line is indented more than expected. Line up the indentation with the surrounding block (use 4 spaces per level)."
    if "expected an indented block" in msg:
        return "The line after a ':' header must be indented. Add 4 spaces before the body of the block."
    if "unindent does not match" in msg:
        return "The indentation here does not line up with any earlier level. Make each level a consistent 4 spaces."
    if "eol while scanning" in msg or "unterminated string" in msg:
        return "A string was opened with a quote but not closed on the same line. Add the matching closing quote."
    return "Python could not parse this line. Check for a missing colon, bracket, quote, or comma."


def friendly_type(value: Any) -> str:
    names = {
        "int": "a whole number", "float": "a decimal number", "str": "a piece of text",
        "bool": "a True/False value", "list": "a list", "dict": "a dictionary",
        "tuple": "a tuple", "set": "a set", "NoneType": "None (no value)",
    }
    return names.get(type(value).__name__, f"a {type(value).__name__}")


class TraceLimit(Exception):
    pass

class InputNeeded(Exception):
    def __init__(self, prompt: str):
        self.prompt = prompt

class SecurityError(Exception):
    pass

@dataclass
class Limits:
    events: int = MAX_EVENTS
    output: int = MAX_OUTPUT

class SafetyVisitor(ast.NodeVisitor):
    blocked_names = {
        "eval", "exec", "compile", "open", "__import__", "globals", "locals",
        "vars", "dir", "breakpoint", "help", "getattr", "setattr", "delattr",
        "input"  # replaced safely; direct use remains supported by runtime namespace
    }

    def __init__(self) -> None:
        self.errors: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root not in SAFE_MODULES:
                self.errors.append(f"Import '{alias.name}' is not available in the playground.")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        root = (node.module or "").split(".")[0]
        if node.level or root not in SAFE_MODULES:
            self.errors.append(f"Import from '{node.module or ''}' is not available in the playground.")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__"):
            self.errors.append("Dunder attribute access is disabled in the playground.")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id.startswith("__"):
            self.errors.append(f"Name '{node.id}' is reserved by the playground.")
        elif node.id in self.blocked_names and node.id != "input":
            self.errors.append(f"Built-in '{node.id}' is disabled in the playground.")

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.errors.append("Async functions are not supported in this version.")

    def visit_Await(self, node: ast.Await) -> None:
        self.errors.append("await is not supported in this version.")


def validate_source(code: str) -> ast.AST:
    if len(code) > MAX_SOURCE:
        raise SecurityError(f"Source is too large ({len(code)} characters; limit {MAX_SOURCE}).")
    try:
        tree = ast.parse(code, filename="<playground>")
    except SyntaxError:
        raise
    count = sum(1 for _ in ast.walk(tree))
    if count > MAX_AST_NODES:
        raise SecurityError(f"Program structure is too large ({count} nodes; limit {MAX_AST_NODES}).")
    visitor = SafetyVisitor()
    visitor.visit(tree)
    if visitor.errors:
        raise SecurityError(" ".join(dict.fromkeys(visitor.errors)))
    return tree


def safe_import(name: str, globals=None, locals=None, fromlist=(), level=0):
    root = name.split(".")[0]
    if level or root not in SAFE_MODULES:
        raise ImportError(f"Import '{name}' is not available in the playground")
    return py_builtins.__import__(name, globals, locals, fromlist, level)

SAFE_BUILTINS = {
    name: getattr(py_builtins, name) for name in [
        "abs", "all", "any", "bin", "bool", "chr", "complex", "dict", "divmod",
        "enumerate", "filter", "float", "format", "frozenset", "hash", "hex", "int",
        "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min", "next",
        "object", "oct", "ord", "pow", "print", "property", "range", "repr", "reversed",
        "round", "set", "slice", "sorted", "str", "sum", "super", "tuple", "type", "zip",
        "Exception", "ArithmeticError", "AssertionError", "AttributeError", "EOFError",
        "IndexError", "KeyError", "LookupError", "NameError", "RuntimeError", "StopIteration",
        "TypeError", "ValueError", "ZeroDivisionError", "BaseException", "NotImplementedError",
        "classmethod", "staticmethod", "__build_class__"
    ]
}
SAFE_BUILTINS["__import__"] = safe_import


def node_label(node: ast.AST, lines: list[str]) -> tuple[str, str]:
    kind_map = {
        ast.Assign: "assignment", ast.AnnAssign: "assignment", ast.AugAssign: "assignment",
        ast.If: "condition", ast.For: "loop", ast.While: "loop", ast.FunctionDef: "function",
        ast.Return: "return", ast.Expr: "expression", ast.Try: "exception", ast.Raise: "exception",
        ast.ClassDef: "class", ast.Break: "break", ast.Continue: "continue", ast.With: "context",
    }
    kind = next((value for cls, value in kind_map.items() if isinstance(node, cls)), "statement")
    lineno = getattr(node, "lineno", 0)
    text = lines[lineno - 1].strip() if lineno and lineno <= len(lines) else kind.title()
    return kind, text[:100]


def build_structure(tree: ast.AST, code: str) -> dict[str, Any]:
    lines = code.splitlines()
    candidates = [n for n in ast.walk(tree) if isinstance(n, ast.stmt) and hasattr(n, "lineno")]
    candidates.sort(key=lambda n: (n.lineno, getattr(n, "col_offset", 0)))
    nodes = []
    for index, node in enumerate(candidates):
        kind, label = node_label(node, lines)
        nodes.append({
            "id": f"line-{node.lineno}-{index}", "line": node.lineno,
            "endLine": getattr(node, "end_lineno", node.lineno), "kind": kind, "label": label,
            "indent": getattr(node, "col_offset", 0) // 4,
        })
    edges = []
    for left, right in zip(nodes, nodes[1:]):
        edges.append({"from": left["id"], "to": right["id"], "type": "next"})
    # Add explicit body / else relationships. They improve the flow view while execution remains trace-driven.
    by_line: dict[int, list[dict[str, Any]]] = {}
    for n in nodes:
        by_line.setdefault(n["line"], []).append(n)
    for original in ast.walk(tree):
        if isinstance(original, (ast.If, ast.For, ast.While)):
            source = by_line.get(original.lineno, [None])[0]
            if not source:
                continue
            body = getattr(original, "body", [])
            other = getattr(original, "orelse", [])
            if body and body[0].lineno in by_line:
                edges.append({"from": source["id"], "to": by_line[body[0].lineno][0]["id"], "type": "true" if isinstance(original, ast.If) else "iterate"})
            if other and other[0].lineno in by_line:
                edges.append({"from": source["id"], "to": by_line[other[0].lineno][0]["id"], "type": "false" if isinstance(original, ast.If) else "exit"})
    return {"nodes": nodes, "edges": edges}


def _names_in(node: ast.AST) -> list[str]:
    out: list[str] = []
    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            out.append(child.id)
    return out


def build_line_facts(tree: ast.AST) -> dict[int, dict[str, Any]]:
    """Index each source line with structural facts used to write contextual explanations.

    This is pure static analysis (no execution) and is combined with runtime state
    at trace time to produce beginner-friendly, line-specific sentences.
    """
    facts: dict[int, dict[str, Any]] = {}

    def record(lineno: int, data: dict[str, Any]) -> None:
        if lineno and lineno not in facts:
            facts[lineno] = data

    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Assign):
            targets: list[str] = []
            for target in node.targets:
                targets.extend(_names_in(target))
            record(line, {"kind": "assign", "targets": targets, "op": None})
        elif isinstance(node, ast.AugAssign):
            op = type(node.op).__name__
            record(line, {"kind": "augassign", "targets": _names_in(node.target), "op": op})
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            record(line, {"kind": "assign", "targets": _names_in(node.target), "op": None})
        elif isinstance(node, ast.For):
            record(line, {"kind": "for", "loopvar": _names_in(node.target)})
        elif isinstance(node, ast.While):
            record(line, {"kind": "while"})
        elif isinstance(node, ast.If):
            record(line, {"kind": "if"})
        elif isinstance(node, ast.Return):
            record(line, {"kind": "return"})
        elif isinstance(node, ast.FunctionDef):
            record(line, {"kind": "functiondef", "name": node.name,
                          "params": [a.arg for a in node.args.args]})
        elif isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else (
                func.attr if isinstance(func, ast.Attribute) else "function")
            record(line, {"kind": "call", "callee": name})
    return facts


class Snapshotter:
    def __init__(self) -> None:
        self.ids: dict[int, str] = {}
        self.counter = 0

    def object_id(self, value: Any) -> str:
        key = id(value)
        if key not in self.ids:
            self.counter += 1
            self.ids[key] = f"obj-{self.counter}"
        return self.ids[key]

    @staticmethod
    def preview(value: Any) -> str:
        try:
            text = repr(value)
        except Exception:
            text = f"<{type(value).__name__}>"
        return text if len(text) <= 140 else text[:137] + "..."

    def atomic(self, value: Any) -> bool:
        return value is None or isinstance(value, (bool, int, float, str, bytes, complex))

    def snapshot(self, frame) -> dict[str, Any]:
        roots: list[tuple[str, Any, str]] = []
        if frame.f_code.co_name == "<module>":
            for name, value in frame.f_globals.items():
                if not name.startswith("__") and name not in {"input"}:
                    roots.append((name, value, "global"))
        else:
            for name, value in frame.f_locals.items():
                if not name.startswith("__"):
                    roots.append((name, value, "local"))
            for name, value in frame.f_globals.items():
                if not name.startswith("__") and name not in {"input"} and name not in frame.f_locals:
                    roots.append((name, value, "global"))
        heap: dict[str, dict[str, Any]] = {}
        variables = []
        for name, value, scope in sorted(roots, key=lambda x: (x[2], x[0])):
            if self.atomic(value):
                variables.append({"name": name, "scope": scope, "type": type(value).__name__, "value": self.preview(value), "objectId": None})
            else:
                oid = self.object_id(value)
                variables.append({"name": name, "scope": scope, "type": type(value).__name__, "value": self.preview(value), "objectId": oid})
                self.describe(value, heap, 0)
        return {"variables": variables, "heap": list(heap.values())}

    def describe(self, value: Any, heap: dict[str, dict[str, Any]], depth: int) -> str | None:
        if self.atomic(value):
            return None
        oid = self.object_id(value)
        if oid in heap:
            return oid
        descriptor: dict[str, Any] = {
            "id": oid, "type": type(value).__name__, "preview": self.preview(value),
            "length": None, "items": [], "truncated": False,
        }
        heap[oid] = descriptor
        if depth >= MAX_DEPTH:
            descriptor["truncated"] = True
            return oid
        try:
            if isinstance(value, dict):
                descriptor["length"] = len(value)
                entries = list(value.items())[:MAX_ITEMS]
                descriptor["truncated"] = len(value) > MAX_ITEMS
                for key, item in entries:
                    child = self.describe(item, heap, depth + 1)
                    descriptor["items"].append({"key": self.preview(key), "value": self.preview(item), "ref": child})
            elif isinstance(value, (list, tuple, set, frozenset, deque)):
                sequence = list(value)
                descriptor["length"] = len(sequence)
                descriptor["truncated"] = len(sequence) > MAX_ITEMS
                for index, item in enumerate(sequence[:MAX_ITEMS]):
                    child = self.describe(item, heap, depth + 1)
                    descriptor["items"].append({"key": str(index), "value": self.preview(item), "ref": child})
            elif callable(value):
                descriptor["items"].append({"key": "name", "value": getattr(value, "__name__", type(value).__name__), "ref": None})
            elif hasattr(value, "__dict__"):
                attrs = list(value.__dict__.items())[:MAX_ITEMS]
                descriptor["length"] = len(value.__dict__)
                descriptor["truncated"] = len(value.__dict__) > MAX_ITEMS
                for key, item in attrs:
                    child = self.describe(item, heap, depth + 1)
                    descriptor["items"].append({"key": str(key), "value": self.preview(item), "ref": child})
        except Exception as exc:
            descriptor["items"].append({"key": "inspection", "value": f"Unavailable: {exc}", "ref": None})
        return oid


class OutputCapture(io.TextIOBase):
    def __init__(self, tracer: "RuntimeTracer") -> None:
        self.tracer = tracer
        self.value = ""

    def write(self, text: str) -> int:
        if not text:
            return 0
        room = self.tracer.limits.output - len(self.value)
        if room <= 0:
            raise TraceLimit("Output limit reached")
        accepted = text[:room]
        self.value += accepted
        self.tracer.add_output(accepted)
        if len(text) > room:
            raise TraceLimit("Output limit reached")
        return len(text)

    def flush(self) -> None:
        pass


class RuntimeTracer:
    def __init__(self, code: str, inputs: list[str], limits: Limits,
                 line_facts: dict[int, dict[str, Any]] | None = None) -> None:
        self.code = code
        self.lines = code.splitlines()
        self.inputs = deque(str(v) for v in inputs)
        self.limits = limits
        self.events: list[dict[str, Any]] = []
        self.snapshotter = Snapshotter()
        self.output = OutputCapture(self)
        self.active_frame = None
        self.stop_reason: str | None = None
        self.line_facts = line_facts or {}
        # Remember the last variable value per (scope, name) so a "line" event can
        # describe what actually changed since the previous step.
        self._last_values: dict[str, str] = {}

    def source(self, line: int) -> str:
        return self.lines[line - 1].strip() if 0 < line <= len(self.lines) else ""

    def call_stack(self, frame) -> list[dict[str, Any]]:
        stack = []
        current = frame
        while current:
            if current.f_code.co_filename == "<playground>":
                stack.append({"function": current.f_code.co_name, "line": current.f_lineno})
            current = current.f_back
        return list(reversed(stack))

    def _frame_values(self, frame) -> dict[str, str]:
        """Flat map of visible names to their repr, for change detection."""
        values: dict[str, str] = {}
        if frame.f_code.co_name == "<module>":
            items = frame.f_globals.items()
        else:
            items = list(frame.f_locals.items()) + list(frame.f_globals.items())
        for name, value in items:
            if name.startswith("__") or name == "input":
                continue
            try:
                values[name] = self.snapshotter.preview(value)
            except Exception:
                values[name] = "<unreadable>"
        return values

    def _describe_changes(self, frame) -> str:
        """Compare current visible values against the last snapshot to narrate effects."""
        current = self._frame_values(frame)
        parts: list[str] = []
        for name, value in current.items():
            old = self._last_values.get(name)
            if old is None:
                parts.append(f"`{name}` is now {value}")
            elif old != value:
                parts.append(f"`{name}` changed from {old} to {value}")
        self._last_values = current
        return "; ".join(parts[:3])

    def explain(self, event_type: str, frame, arg=None) -> tuple[str, str]:
        line = frame.f_lineno if frame else 0
        source = self.source(line)
        if event_type == "line":
            changed = self._describe_changes(frame)
            facts = self.line_facts.get(line, {})
            intent = self._line_intent(facts, source)
            beginner = intent
            if changed:
                beginner = f"{changed}. Next, {intent}" if intent else f"{changed}."
            technical = f"Frame `{frame.f_code.co_name}` is about to execute line {line}: `{source}`."
            if changed:
                technical = f"{changed}. " + technical
            return (beginner or f"Python is ready to run line {line}: {source}", technical)
        if event_type == "call":
            facts = self.line_facts.get(line, {})
            params = facts.get("params") or []
            local_args = [f"{v['name']}={v['value']}" for v in
                          self.snapshotter.snapshot(frame)["variables"] if v["scope"] == "local"]
            arg_text = ", ".join(local_args[:4]) if local_args else "no arguments"
            beginner = (f"Python calls `{frame.f_code.co_name}` and gives it its own fresh workspace "
                        f"with {arg_text}.")
            technical = (f"A stack frame for `{frame.f_code.co_name}` was pushed; "
                         f"parameters {params or '[]'} are bound to the passed arguments.")
            return (beginner, technical)
        if event_type == "return":
            preview = self.snapshotter.preview(arg)
            beginner = (f"`{frame.f_code.co_name}` finishes its work and hands back {preview} "
                        f"to whoever called it.")
            technical = (f"The frame returns {preview} to its caller and is popped from the stack.")
            return (beginner, technical)
        if event_type == "exception":
            exc_type, exc, _ = arg
            hint = COMMON_ERROR_HINTS.get(exc_type.__name__, "")
            beginner = f"Python hit a problem on line {line}: {exc_type.__name__} — {exc}."
            if hint:
                beginner += f" {hint}"
            technical = (f"{exc_type.__name__} was raised in frame `{frame.f_code.co_name}` at line {line}; "
                         f"Python now unwinds the stack looking for a matching except handler.")
            return (beginner, technical)
        if event_type == "output":
            return ("Your program printed something to the output console.",
                    "The print call wrote text to standard output (a side effect, not a return value).")
        if event_type == "input":
            return ("Python paused to read a value you typed, as a string.",
                    "input() returns the entered text as a str; convert with int()/float() if you need a number.")
        return (source, source)

    def _line_intent(self, facts: dict[str, Any], source: str) -> str:
        """Turn static AST facts about a line into a plain-language 'what will happen'."""
        kind = facts.get("kind")
        if kind == "assign":
            targets = facts.get("targets") or []
            if targets:
                joined = ", ".join(f"`{t}`" for t in targets)
                return f"Python will evaluate the right side and store the result in {joined}."
            return "Python will evaluate the right side and store it in a name."
        if kind == "augassign":
            targets = facts.get("targets") or []
            name = targets[0] if targets else "the variable"
            return f"Python will update `{name}` using its current value."
        if kind == "for":
            loopvar = facts.get("loopvar") or []
            name = loopvar[0] if loopvar else "the loop variable"
            return f"Python takes the next item from the sequence and binds it to `{name}`."
        if kind == "while":
            return "Python checks the while condition to decide whether to run the loop body again."
        if kind == "if":
            return "Python evaluates the condition and will pick the matching branch."
        if kind == "return":
            return "Python will compute the return value and leave this function."
        if kind == "functiondef":
            name = facts.get("name", "a function")
            return f"Python defines the function `{name}` (its body does not run yet)."
        if kind == "call":
            callee = facts.get("callee", "a function")
            return f"Python evaluates the arguments and calls `{callee}`."
        return f"Python will run: {source}" if source else "Python runs this line."

    def emit(self, event_type: str, frame, arg=None, extra: dict[str, Any] | None = None) -> None:
        if len(self.events) >= self.limits.events:
            raise TraceLimit("Event limit reached")
        self.active_frame = frame
        beginner, technical = self.explain(event_type, frame, arg)
        snapshot = self.snapshotter.snapshot(frame) if frame else {"variables": [], "heap": []}
        event = {
            "id": len(self.events), "type": event_type,
            "line": frame.f_lineno if frame else 0,
            "function": frame.f_code.co_name if frame else "<module>",
            "source": self.source(frame.f_lineno) if frame else "",
            "snapshot": snapshot, "stack": self.call_stack(frame) if frame else [],
            "output": self.output.value, "beginner": beginner, "technical": technical,
        }
        if event_type == "return":
            event["returnValue"] = self.snapshotter.preview(arg)
        elif event_type == "exception":
            exc_type, exc, _ = arg
            event["exception"] = {
                "type": exc_type.__name__,
                "message": str(exc),
                "hint": COMMON_ERROR_HINTS.get(exc_type.__name__, ""),
            }
        if extra:
            event.update(extra)
        self.events.append(event)

    def add_output(self, text: str) -> None:
        if self.active_frame:
            self.emit("output", self.active_frame, extra={"text": text})

    def safe_input(self, prompt: str = "") -> str:
        if prompt:
            self.output.write(str(prompt))
        if not self.inputs:
            raise InputNeeded(str(prompt))
        value = self.inputs.popleft()
        if self.active_frame:
            self.emit("input", self.active_frame, extra={"prompt": str(prompt), "inputValue": value})
        return value

    def trace(self, frame, event, arg):
        if frame.f_code.co_filename != "<playground>":
            return self.trace
        if event in {"call", "line", "return", "exception"}:
            self.emit(event, frame, arg)
        return self.trace


def set_limits() -> None:
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
        memory = 320 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
        resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    except Exception:
        pass
    sys.setrecursionlimit(100)
    signal.alarm(4)


def run(payload: dict[str, Any]) -> dict[str, Any]:
    code = str(payload.get("code", ""))
    inputs = payload.get("inputs") or []
    tree = validate_source(code)
    structure = build_structure(tree, code)
    line_facts = build_line_facts(tree)
    tracer = RuntimeTracer(code, inputs, Limits(), line_facts=line_facts)
    namespace = {"__builtins__": dict(SAFE_BUILTINS), "__name__": "__main__"}
    namespace["__builtins__"]["input"] = tracer.safe_input
    status = "completed"
    error = None
    needs_input = None
    try:
        compiled = compile(tree, "<playground>", "exec")
        sys.stdout = tracer.output
        sys.stderr = tracer.output
        sys.settrace(tracer.trace)
        exec(compiled, namespace, namespace)
    except InputNeeded as exc:
        status = "needs_input"
        needs_input = {"prompt": exc.prompt, "index": len(inputs)}
    except TraceLimit as exc:
        status = "stopped"
        error = {"type": "ExecutionLimit", "message": str(exc)}
    except BaseException as exc:
        status = "error"
        error = {"type": type(exc).__name__, "message": str(exc),
                 "hint": COMMON_ERROR_HINTS.get(type(exc).__name__, "")}
    finally:
        sys.settrace(None)
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        signal.alarm(0)
    return {
        "status": status, "events": tracer.events, "structure": structure,
        "output": tracer.output.value, "error": error, "needsInput": needs_input,
        "limits": {"events": MAX_EVENTS, "output": MAX_OUTPUT, "recursion": 100, "timeSeconds": 3},
    }


def main() -> None:
    try:
        set_limits()
        payload = json.loads(sys.stdin.read())
        result = run(payload)
    except SyntaxError as exc:
        result = {
            "status": "syntax_error", "events": [], "structure": {"nodes": [], "edges": []}, "output": "",
            "error": {"type": "SyntaxError", "message": exc.msg, "line": exc.lineno, "offset": exc.offset,
                      "text": exc.text, "hint": syntax_hint(exc.msg or "", exc.text)},
            "needsInput": None,
        }
    except SecurityError as exc:
        result = {
            "status": "blocked", "events": [], "structure": {"nodes": [], "edges": []}, "output": "",
            "error": {"type": "SecurityError", "message": str(exc)}, "needsInput": None,
        }
    except BaseException as exc:
        result = {
            "status": "error", "events": [], "structure": {"nodes": [], "edges": []}, "output": "",
            "error": {"type": type(exc).__name__, "message": str(exc)}, "needsInput": None,
        }
    sys.__stdout__.write(json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    main()
