import {
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
  useMemo,
  useRef,
} from "react";

export type PythonNotebookCellKind = "code" | "markdown";

export type PythonNotebookOutput = {
  durationMs?: number;
  error?: string;
  executionCount?: number;
  result?: string;
  status?: "ok" | "error" | string;
  stderr?: string;
  stdout?: string;
  traceback?: string;
};

export type PythonNotebookCell = {
  id: string;
  kind: PythonNotebookCellKind;
  output?: PythonNotebookOutput;
  source: string;
};

export type PythonNotebookState = {
  activeCellId: string;
  cells: PythonNotebookCell[];
  executionCount: number;
  updatedAt?: string;
};

export type PythonNotebookStatus = "idle" | "saving" | "running" | "formatting";

const pythonKeywords = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const pythonBuiltins = new Set([
  "abs",
  "all",
  "any",
  "bool",
  "dict",
  "enumerate",
  "float",
  "int",
  "len",
  "list",
  "max",
  "min",
  "print",
  "range",
  "repr",
  "round",
  "set",
  "sorted",
  "str",
  "sum",
  "tuple",
  "zip",
]);

export function defaultPythonNotebookState(): PythonNotebookState {
  return {
    activeCellId: "code-intro",
    cells: [
      {
        id: "md-intro",
        kind: "markdown",
        source:
          "### Python workspace\nUse markdown for notes and code cells for real Python.",
      },
      {
        id: "code-intro",
        kind: "code",
        source:
          "values = [2, 4, 8]\nmean_value = sum(values) / len(values)\nmean_value",
      },
    ],
    executionCount: 0,
  };
}

export function normalizePythonNotebookState(
  value: unknown,
): PythonNotebookState {
  const fallback = defaultPythonNotebookState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const rawCells = Array.isArray(record.cells) ? record.cells : [];
  const cells = rawCells.flatMap((rawCell, index): PythonNotebookCell[] => {
    if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) {
      return [];
    }
    const cell = rawCell as Record<string, unknown>;
    const id =
      typeof cell.id === "string" && cell.id.trim()
        ? cell.id.trim()
        : `cell-${index + 1}`;
    const kind = cell.kind === "markdown" ? "markdown" : "code";
    const output =
      cell.output && typeof cell.output === "object" && !Array.isArray(cell.output)
        ? (cell.output as PythonNotebookOutput)
        : undefined;
    return [
      {
        id,
        kind,
        output,
        source: typeof cell.source === "string" ? cell.source : "",
      },
    ];
  });

  const normalizedCells = cells.length ? cells : fallback.cells;
  const activeCellId =
    typeof record.activeCellId === "string" &&
    normalizedCells.some((cell) => cell.id === record.activeCellId)
      ? record.activeCellId
      : normalizedCells[0]?.id || fallback.activeCellId;
  const executionCount =
    typeof record.executionCount === "number" &&
    Number.isFinite(record.executionCount)
      ? Math.max(0, Math.round(record.executionCount))
      : 0;

  return {
    activeCellId,
    cells: normalizedCells,
    executionCount,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

function createCellId(kind: PythonNotebookCellKind) {
  const prefix = kind === "markdown" ? "md" : "code";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

function codeOutputText(cell: PythonNotebookCell) {
  const output = cell.output;
  if (!output) return "";
  return [output.stdout, output.result, output.stderr, output.error]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");
}

function outputStatus(cell: PythonNotebookCell) {
  if (!cell.output) return "idle";
  return cell.output.status === "error" || cell.output.error ? "error" : "ok";
}

function hasNotebookOutput(notebook: PythonNotebookState) {
  return notebook.cells.some((cell) => cell.kind === "code" && cell.output);
}

function highlightedPython(source: string) {
  const pieces: ReactNode[] = [];
  const pattern =
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|==|!=|<=|>=|[-+*/%=<>:.,()[\]{}])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) {
      pieces.push(source.slice(cursor, match.index));
    }
    const token = match[0];
    let className = "";
    if (token.startsWith("#")) {
      className = "syntax-comment";
    } else if (
      token.startsWith('"') ||
      token.startsWith("'") ||
      token.startsWith('"""') ||
      token.startsWith("'''")
    ) {
      className = "syntax-string";
    } else if (/^\d/.test(token)) {
      className = "syntax-number";
    } else if (pythonKeywords.has(token)) {
      className = "syntax-keyword";
    } else if (pythonBuiltins.has(token)) {
      className = "syntax-builtin";
    } else if (/^[-+*/%=<>:.,()[\]{}]+$/.test(token)) {
      className = "syntax-operator";
    }

    pieces.push(
      className ? (
        <span className={className} key={`${match.index}-${token}`}>
          {token}
        </span>
      ) : (
        token
      ),
    );
    cursor = match.index + token.length;
  }

  if (cursor < source.length) {
    pieces.push(source.slice(cursor));
  }

  return pieces;
}

function MarkdownPreview({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);
  return (
    <div className="notebook-markdown-preview">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
        if (heading) {
          const level = heading[1].length;
          const Heading = (`h${Math.min(level + 2, 5)}` ||
            "h4") as keyof JSX.IntrinsicElements;
          return <Heading key={index}>{heading[2]}</Heading>;
        }
        if (/^[-*]\s+/m.test(trimmed)) {
          return (
            <ul key={index}>
              {trimmed.split("\n").map((line, itemIndex) => (
                <li key={itemIndex}>{line.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

function PythonSyntaxTextarea({
  disabled,
  onChange,
  onFormat,
  onRun,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  onFormat: () => void;
  onRun: () => void;
  value: string;
}) {
  const highlightRef = useRef<HTMLPreElement | null>(null);

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(nextValue);
      window.requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRun();
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "F") {
      event.preventDefault();
      onFormat();
    }
  }

  return (
    <div className="python-editor-shell">
      <pre aria-hidden="true" className="python-highlight-layer" ref={highlightRef}>
        <code>{highlightedPython(value || " ")}</code>
      </pre>
      <textarea
        aria-label="Python code"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

export function PythonNotebookPanel({
  error,
  notebook,
  onChange,
  onClearOutputs,
  onFormatCell,
  onRunAll,
  onRunCell,
  status,
}: {
  error: string;
  notebook: PythonNotebookState;
  onChange: (notebook: PythonNotebookState) => void;
  onClearOutputs: () => void;
  onFormatCell: (cellId: string) => void;
  onRunAll: () => void;
  onRunCell: (cellId: string) => void;
  status: PythonNotebookStatus;
}) {
  const isBusy = status === "running" || status === "formatting";
  const hasOutputs = hasNotebookOutput(notebook);

  function updateCell(cellId: string, patch: Partial<PythonNotebookCell>) {
    onChange({
      ...notebook,
      activeCellId: cellId,
      cells: notebook.cells.map((cell) =>
        cell.id === cellId ? { ...cell, ...patch } : cell,
      ),
    });
  }

  function addCell(kind: PythonNotebookCellKind, afterId = notebook.activeCellId) {
    const id = createCellId(kind);
    const nextCell: PythonNotebookCell = {
      id,
      kind,
      source: kind === "markdown" ? "### Note" : "",
    };
    const index = notebook.cells.findIndex((cell) => cell.id === afterId);
    const insertIndex = index >= 0 ? index + 1 : notebook.cells.length;
    onChange({
      ...notebook,
      activeCellId: id,
      cells: [
        ...notebook.cells.slice(0, insertIndex),
        nextCell,
        ...notebook.cells.slice(insertIndex),
      ],
    });
  }

  function deleteCell(cellId: string) {
    if (notebook.cells.length <= 1) return;
    const nextCells = notebook.cells.filter((cell) => cell.id !== cellId);
    onChange({
      ...notebook,
      activeCellId: nextCells[0]?.id ?? "",
      cells: nextCells,
    });
  }

  function moveCell(cellId: string, direction: -1 | 1) {
    const index = notebook.cells.findIndex((cell) => cell.id === cellId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= notebook.cells.length) return;
    const nextCells = [...notebook.cells];
    const [cell] = nextCells.splice(index, 1);
    nextCells.splice(nextIndex, 0, cell);
    onChange({ ...notebook, activeCellId: cellId, cells: nextCells });
  }

  return (
    <div className="python-notebook-panel">
      <div className="python-panel-header">
        <div>
          <span>Notebook</span>
          <strong>Python workspace</strong>
        </div>
        <div className="python-panel-actions">
          <button disabled={isBusy} onClick={onRunAll} title="Run all code cells." type="button">
            Run all
          </button>
          <button
            disabled={!hasOutputs || isBusy}
            onClick={onClearOutputs}
            title="Clear all code outputs."
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="python-cell-add-row" aria-label="Add notebook cell">
        <button onClick={() => addCell("code")} type="button">
          + Code
        </button>
        <button onClick={() => addCell("markdown")} type="button">
          + Markdown
        </button>
        <span>{status === "idle" ? "ready" : status}</span>
      </div>

      {error ? <p className="python-panel-error">{error}</p> : null}

      <div className="python-cell-list">
        {notebook.cells.map((cell, index) => {
          const isActive = cell.id === notebook.activeCellId;
          const cellStatus = outputStatus(cell);
          return (
            <section
              className={[
                "python-cell",
                `python-cell-${cell.kind}`,
                isActive ? "active" : "",
                cellStatus,
              ]
                .filter(Boolean)
                .join(" ")}
              key={cell.id}
              onFocus={() =>
                notebook.activeCellId !== cell.id
                  ? onChange({ ...notebook, activeCellId: cell.id })
                  : undefined
              }
            >
              <div className="python-cell-toolbar">
                <span>{cell.kind}</span>
                <div>
                  {cell.kind === "code" ? (
                    <>
                      <button
                        disabled={isBusy}
                        onClick={() => onRunCell(cell.id)}
                        title="Run to this cell. Prior code cells are replayed first so variables exist."
                        type="button"
                      >
                        Run
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => onFormatCell(cell.id)}
                        title="Format this Python cell."
                        type="button"
                      >
                        Format
                      </button>
                    </>
                  ) : null}
                  <button
                    disabled={index === 0}
                    onClick={() => moveCell(cell.id, -1)}
                    title="Move cell up."
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    disabled={index === notebook.cells.length - 1}
                    onClick={() => moveCell(cell.id, 1)}
                    title="Move cell down."
                    type="button"
                  >
                    Down
                  </button>
                  <button
                    disabled={notebook.cells.length <= 1}
                    onClick={() => deleteCell(cell.id)}
                    title="Delete cell."
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {cell.kind === "markdown" ? (
                <>
                  <textarea
                    aria-label="Markdown cell"
                    className="markdown-cell-editor"
                    onChange={(event) =>
                      updateCell(cell.id, { source: event.target.value })
                    }
                    value={cell.source}
                  />
                  <MarkdownPreview source={cell.source} />
                </>
              ) : (
                <>
                  <PythonSyntaxTextarea
                    disabled={isBusy}
                    onChange={(source) => updateCell(cell.id, { source })}
                    onFormat={() => onFormatCell(cell.id)}
                    onRun={() => onRunCell(cell.id)}
                    value={cell.source}
                  />
                  <CellOutput cell={cell} />
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CellOutput({ cell }: { cell: PythonNotebookCell }) {
  if (cell.kind !== "code" || !cell.output) return null;
  const output = cell.output;
  const pieces = [
    output.stdout ? { className: "stdout", label: "stdout", text: output.stdout } : null,
    output.result ? { className: "result", label: "result", text: output.result } : null,
    output.stderr ? { className: "stderr", label: "stderr", text: output.stderr } : null,
    output.error ? { className: "error", label: "error", text: output.error } : null,
  ].filter(Boolean) as Array<{ className: string; label: string; text: string }>;

  if (!pieces.length) {
    return (
      <div className="python-cell-output empty">
        <span>ok</span>
        <code>no output</code>
      </div>
    );
  }

  return (
    <div className="python-cell-output">
      <div className="python-output-meta">
        <span>{output.status === "error" ? "error" : "ok"}</span>
        {typeof output.executionCount === "number" ? (
          <code>In [{output.executionCount}]</code>
        ) : null}
        {typeof output.durationMs === "number" ? (
          <code>{output.durationMs}ms</code>
        ) : null}
      </div>
      {pieces.map((piece) => (
        <pre className={piece.className} key={piece.label}>
          <span>{piece.label}</span>
          <code>{piece.text}</code>
        </pre>
      ))}
    </div>
  );
}

export function PythonTerminalPanel({
  error,
  notebook,
  onRunAll,
  status,
}: {
  error: string;
  notebook: PythonNotebookState;
  onRunAll: () => void;
  status: PythonNotebookStatus;
}) {
  const outputCells = useMemo(
    () =>
      notebook.cells.filter(
        (cell) => cell.kind === "code" && (cell.output || codeOutputText(cell)),
      ),
    [notebook.cells],
  );
  const latestError = outputCells.find(
    (cell) => cell.output?.status === "error" || cell.output?.error,
  );

  return (
    <div className="python-terminal-panel">
      <div className="python-panel-header compact">
        <div>
          <span>Terminal</span>
          <strong>{latestError ? "Python error" : "Python output"}</strong>
        </div>
        <button
          disabled={status === "running"}
          onClick={onRunAll}
          title="Run the full Python notebook."
          type="button"
        >
          Run all
        </button>
      </div>
      {error ? <p className="python-panel-error">{error}</p> : null}
      <div className="python-terminal-stream" aria-label="Python terminal output">
        {outputCells.length ? (
          outputCells.map((cell, index) => (
            <div className="python-terminal-entry" key={`${cell.id}-${index}`}>
              <span>
                {cell.id}
                {cell.output?.executionCount
                  ? ` [${cell.output.executionCount}]`
                  : ""}
              </span>
              <pre>{codeOutputText(cell) || "ok"}</pre>
            </div>
          ))
        ) : (
          <p className="python-terminal-empty">
            Run a Python cell to capture stdout, returned values, and errors here.
          </p>
        )}
      </div>
    </div>
  );
}
