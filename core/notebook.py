import ast
import json
import re
import subprocess
import sys
import tempfile
import textwrap
import time


NOTEBOOK_CONTEXT_KEY = "python_notebook"
MAX_NOTEBOOK_CELLS = 30
MAX_CELL_SOURCE_LENGTH = 12000
MAX_NOTEBOOK_SOURCE_LENGTH = 60000
MAX_NOTEBOOK_JSON_LENGTH = 90000
PYTHON_RUN_TIMEOUT_SECONDS = 8


DEFAULT_NOTEBOOK_CELLS = [
    {
        "id": "md-intro",
        "kind": "markdown",
        "source": "### Python workspace\nUse markdown for notes and code cells for real Python.",
    },
    {
        "id": "code-intro",
        "kind": "code",
        "source": "values = [2, 4, 8]\nmean_value = sum(values) / len(values)\nmean_value",
    },
]


def normalize_cell_id(value, fallback):
    cell_id = str(value or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", cell_id):
        return cell_id
    return fallback


def normalize_cell_kind(value):
    return "markdown" if str(value or "").strip() == "markdown" else "code"


def normalize_cell_output(value):
    if not isinstance(value, dict):
        return None
    output = {}
    for key in (
        "durationMs",
        "error",
        "executionCount",
        "result",
        "status",
        "stderr",
        "stdout",
        "traceback",
    ):
        if key in value:
            output[key] = value.get(key)
    return output


def normalize_notebook(value):
    data = value if isinstance(value, dict) else {}
    raw_cells = data.get("cells")
    if not isinstance(raw_cells, list) or not raw_cells:
        raw_cells = DEFAULT_NOTEBOOK_CELLS

    cells = []
    seen_ids = set()
    total_source_length = 0
    for index, raw_cell in enumerate(raw_cells[:MAX_NOTEBOOK_CELLS], start=1):
        if not isinstance(raw_cell, dict):
            continue
        cell_id = normalize_cell_id(raw_cell.get("id"), f"cell-{index}")
        if cell_id in seen_ids:
            cell_id = f"{cell_id}-{index}"
        seen_ids.add(cell_id)
        source = str(raw_cell.get("source", ""))
        if len(source) > MAX_CELL_SOURCE_LENGTH:
            source = source[:MAX_CELL_SOURCE_LENGTH]
        total_source_length += len(source)
        if total_source_length > MAX_NOTEBOOK_SOURCE_LENGTH:
            break

        cell = {
            "id": cell_id,
            "kind": normalize_cell_kind(raw_cell.get("kind")),
            "source": source,
        }
        output = normalize_cell_output(raw_cell.get("output"))
        if output:
            cell["output"] = output
        cells.append(cell)

    if not cells:
        cells = [dict(cell) for cell in DEFAULT_NOTEBOOK_CELLS]

    active_cell_id = normalize_cell_id(data.get("activeCellId"), cells[0]["id"])
    if active_cell_id not in {cell["id"] for cell in cells}:
        active_cell_id = cells[0]["id"]

    execution_count = data.get("executionCount", 0)
    if not isinstance(execution_count, int) or execution_count < 0:
        execution_count = 0

    notebook = {
        "activeCellId": active_cell_id,
        "cells": cells,
        "executionCount": execution_count,
        "updatedAt": str(data.get("updatedAt") or ""),
    }
    if len(json.dumps(notebook, ensure_ascii=True)) > MAX_NOTEBOOK_JSON_LENGTH:
        raise ValueError("Notebook is too large.")
    return notebook


def notebook_context_snapshot(notebook):
    normalized = normalize_notebook(notebook)
    cells = []
    terminal_lines = []
    for index, cell in enumerate(normalized["cells"], start=1):
        output = cell.get("output") if isinstance(cell.get("output"), dict) else {}
        compact_output = {
            key: str(output.get(key, ""))[:2000]
            for key in ("stdout", "stderr", "result", "error")
            if output.get(key) not in (None, "")
        }
        cells.append(
            {
                "id": cell["id"],
                "index": index,
                "kind": cell["kind"],
                "output": compact_output,
                "source": cell["source"][:6000],
            }
        )
        if compact_output:
            terminal_lines.append(f"[{index}] {cell['id']}")
            for key in ("stdout", "result", "stderr", "error"):
                if key in compact_output:
                    terminal_lines.append(f"{key}: {compact_output[key]}")

    return {
        "activeCellId": normalized["activeCellId"],
        "cells": cells,
        "executionCount": normalized["executionCount"],
        "terminal": "\n".join(terminal_lines)[-8000:],
        "updatedAt": normalized.get("updatedAt", ""),
    }


def format_python_source(source):
    source = str(source or "")
    try:
        import black

        return black.format_str(source, mode=black.FileMode()), "black"
    except Exception:
        pass

    stripped_lines = [line.rstrip() for line in source.splitlines()]
    normalized_source = "\n".join(stripped_lines).strip()
    if not normalized_source:
        return "", "trim"

    if "#" in normalized_source:
        return f"{normalized_source}\n", "trim"

    try:
        tree = ast.parse(normalized_source)
    except SyntaxError:
        return f"{normalized_source}\n", "trim"

    try:
        return f"{ast.unparse(tree)}\n", "ast"
    except Exception:
        return f"{normalized_source}\n", "trim"


PYTHON_RUNNER = r"""
import ast
import contextlib
import io
import json
import sys
import time
import traceback

MAX_STREAM_CHARS = 12000


class LimitedWriter(io.TextIOBase):
    def __init__(self):
        self.parts = []
        self.length = 0
        self.truncated = False

    def writable(self):
        return True

    def write(self, value):
        text = str(value)
        remaining = MAX_STREAM_CHARS - self.length
        if remaining <= 0:
            self.truncated = True
            return len(text)
        if len(text) > remaining:
            self.parts.append(text[:remaining])
            self.length += remaining
            self.truncated = True
            return len(text)
        self.parts.append(text)
        self.length += len(text)
        return len(text)

    def getvalue(self):
        text = "".join(self.parts)
        if self.truncated:
            text += "\n...[truncated]"
        return text


def execute_cell(source, namespace):
    stdout = LimitedWriter()
    stderr = LimitedWriter()
    started = time.perf_counter()
    output = {"status": "ok"}
    try:
        tree = ast.parse(source or "", filename="<notebook-cell>", mode="exec")
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
                ast.fix_missing_locations(prefix)
                if prefix.body:
                    exec(compile(prefix, "<notebook-cell>", "exec"), namespace)
                expression = ast.Expression(tree.body[-1].value)
                ast.fix_missing_locations(expression)
                result = eval(compile(expression, "<notebook-cell>", "eval"), namespace)
                if result is not None:
                    output["result"] = repr(result)
            else:
                exec(compile(tree, "<notebook-cell>", "exec"), namespace)
    except Exception as error:
        output["status"] = "error"
        output["error"] = f"{type(error).__name__}: {error}"
        output["traceback"] = traceback.format_exc(limit=8)
    output["stdout"] = stdout.getvalue()
    output["stderr"] = stderr.getvalue()
    output["durationMs"] = round((time.perf_counter() - started) * 1000)
    return output


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    cells = payload.get("cells") if isinstance(payload.get("cells"), list) else []
    target_id = str(payload.get("targetCellId") or "")
    run_all = bool(payload.get("runAll"))
    execution_count = int(payload.get("executionCount") or 0)
    namespace = {"__name__": "__notebook__"}
    outputs = {}

    for cell in cells:
        if not isinstance(cell, dict) or cell.get("kind") != "code":
            continue
        execution_count += 1
        output = execute_cell(str(cell.get("source") or ""), namespace)
        output["executionCount"] = execution_count
        outputs[str(cell.get("id") or "")] = output
        if output.get("status") == "error" or (target_id and cell.get("id") == target_id):
            break
        if not run_all and not target_id:
            break

    print(json.dumps({"executionCount": execution_count, "outputs": outputs}))


main()
"""


def run_python_notebook(notebook, target_cell_id="", run_all=False):
    normalized = normalize_notebook(notebook)
    target_cell_id = str(target_cell_id or "").strip()
    code_cell_ids = [cell["id"] for cell in normalized["cells"] if cell["kind"] == "code"]
    if target_cell_id and target_cell_id not in code_cell_ids:
        raise ValueError("Code cell not found.")

    payload = {
        "cells": normalized["cells"],
        "executionCount": normalized["executionCount"],
        "runAll": bool(run_all),
        "targetCellId": "" if run_all else target_cell_id,
    }

    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="dlu-python-notebook-") as cwd:
        try:
            result = subprocess.run(
                [sys.executable, "-I", "-c", PYTHON_RUNNER],
                input=json.dumps(payload),
                capture_output=True,
                cwd=cwd,
                text=True,
                timeout=PYTHON_RUN_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            outputs = {}
            target = target_cell_id or (code_cell_ids[-1] if code_cell_ids else "")
            if target:
                outputs[target] = {
                    "durationMs": round((time.perf_counter() - started) * 1000),
                    "error": f"TimeoutError: Python run exceeded {PYTHON_RUN_TIMEOUT_SECONDS}s.",
                    "executionCount": normalized["executionCount"] + 1,
                    "status": "error",
                    "stderr": "",
                    "stdout": "",
                    "traceback": "",
                }
            data = {
                "executionCount": normalized["executionCount"] + (1 if target else 0),
                "outputs": outputs,
            }
        else:
            if result.returncode != 0:
                raise ValueError(result.stderr.strip() or "Python could not run.")
            try:
                data = json.loads(result.stdout or "{}")
            except ValueError as error:
                raise ValueError("Python returned unreadable output.") from error

    outputs = data.get("outputs") if isinstance(data, dict) else {}
    if not isinstance(outputs, dict):
        outputs = {}

    next_cells = []
    for cell in normalized["cells"]:
        next_cell = dict(cell)
        output = outputs.get(cell["id"])
        if isinstance(output, dict):
            next_cell["output"] = normalize_cell_output(output) or output
        next_cells.append(next_cell)

    normalized["cells"] = next_cells
    normalized["executionCount"] = data.get(
        "executionCount",
        normalized["executionCount"],
    )
    normalized["updatedAt"] = str(round(time.time() * 1000))
    return normalized


def format_notebook_cell(notebook, cell_id):
    normalized = normalize_notebook(notebook)
    for cell in normalized["cells"]:
        if cell["id"] == cell_id and cell["kind"] == "code":
            cell["source"], formatter = format_python_source(cell["source"])
            normalized["updatedAt"] = str(round(time.time() * 1000))
            return normalized, formatter
    raise ValueError("Code cell not found.")
