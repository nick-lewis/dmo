import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

const leftPanels = [
  { density: "tall", kind: "brief", label: "Left panel one" },
  { density: "compact", kind: "code", label: "Left panel two" },
  { density: "compact", kind: "reference", label: "Left panel three" },
  { density: "compact", kind: "checks", label: "Left panel four" },
] as const;

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
  "bool",
  "dict",
  "float",
  "int",
  "list",
  "set",
  "str",
  "tuple",
]);

const pythonTokenPattern =
  /("""[\s\S]*?"""|'''[\s\S]*?'''|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_]\w*(?=\()|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?\b|[{}()[\].,:=+\-*/<>!]+)/g;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const pathname = window.location.pathname;

  if (pathname === "/surfaces/tutoring/panels") {
    return <PanelStudy />;
  }

  return null;
}

function PanelStudy() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const hasManualToolWidth = useRef(false);
  const latestToolWidth = useRef(330);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(330);
  const [lowerHeight, setLowerHeight] = useState(210);
  const shellStyle = { "--left-width": `${leftWidth}px` } as CSSProperties;

  useEffect(() => {
    function setDefaultToolWidth() {
      if (hasManualToolWidth.current) return;

      const shell = shellRef.current;
      const right = rightRef.current;
      if (!shell || !right) return;

      const shellBounds = shell.getBoundingClientRect();
      const rightBounds = right.getBoundingClientRect();
      const maxWidth = Math.max(280, Math.min(1180, shellBounds.width - 80));
      const minWidth = Math.min(280, maxWidth);
      const gutterWidth = rightBounds.left - shellBounds.left;
      const nextWidth = Math.round(clamp(gutterWidth - 12, minWidth, maxWidth));

      latestToolWidth.current = nextWidth;
      setLeftWidth(nextWidth);
    }

    setDefaultToolWidth();
    window.addEventListener("resize", setDefaultToolWidth);
    return () => window.removeEventListener("resize", setDefaultToolWidth);
  }, []);

  function dragLeftDivider(event: PointerEvent<HTMLDivElement>) {
    const shell = shellRef.current;
    if (!shell) return;

    const bounds = shell.getBoundingClientRect();
    const maxWidth = Math.max(260, Math.min(1180, bounds.width - 80));
    const minWidth = Math.min(260, maxWidth);
    let animationFrame = 0;
    hasManualToolWidth.current = true;
    shell.classList.add("is-resizing-tools");

    function applyWidth(width: number) {
      latestToolWidth.current = Math.round(width);

      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        shell.style.setProperty("--left-width", `${latestToolWidth.current}px`);
        animationFrame = 0;
      });
    }

    function onMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = moveEvent.clientX - bounds.left;
      applyWidth(clamp(nextWidth, minWidth, maxWidth));
    }

    function onUp() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        shell.style.setProperty("--left-width", `${latestToolWidth.current}px`);
      }

      shell.classList.remove("is-resizing-tools");
      setLeftWidth(latestToolWidth.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    event.preventDefault();
  }

  function dragLowerDivider(event: PointerEvent<HTMLDivElement>) {
    const right = rightRef.current;
    if (!right) return;

    const bounds = right.getBoundingClientRect();

    function onMove(moveEvent: globalThis.PointerEvent) {
      const nextHeight = bounds.bottom - moveEvent.clientY;
      setLowerHeight(clamp(nextHeight, 150, Math.max(180, bounds.height - 300)));
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    event.preventDefault();
  }

  return (
    <main
      className="panel-study"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">Tutoring workspace</p>
      </header>

      <section
        className={`workspace-shell ${isLeftOpen ? "drawer-open" : "drawer-closed"}`}
        ref={shellRef}
        style={shellStyle}
      >
        <button
          aria-label={isLeftOpen ? "Hide left panels" : "Show left panels"}
          aria-pressed={isLeftOpen}
          className="left-panel-toggle"
          onClick={() => setIsLeftOpen((current) => !current)}
          type="button"
        >
          <span className="toggle-panel-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>

        <aside
          aria-hidden={!isLeftOpen}
          className="left-tools-drawer"
          aria-label="Panel stack"
        >
          <div className="left-stack-scroll">
            {leftPanels.map((panel) => (
              <PanelWindow
                ariaLabel={panel.label}
                density={panel.density}
                key={panel.label}
              >
                <LeftPanelContent kind={panel.kind} />
              </PanelWindow>
            ))}
          </div>
        </aside>

        <div
          aria-label="Resize tools"
          className="vertical-resizer drawer-resizer"
          onPointerDown={dragLeftDivider}
          role="separator"
        />

        <section className="panel-stage">
          <section className="right-region" ref={rightRef}>
            <PanelWindow ariaLabel="Panel five" density="main">
              <MainPanelContent />
            </PanelWindow>
            <div
              aria-label="Resize rows"
              className="horizontal-resizer"
              onPointerDown={dragLowerDivider}
              role="separator"
            />
            <PanelWindow
              ariaLabel="Panel six"
              density="lower"
              style={{ height: lowerHeight }}
            >
              <ChatPanelContent />
            </PanelWindow>
          </section>
        </section>
      </section>
    </main>
  );
}

type PanelWindowProps = {
  density: "compact" | "tall" | "main" | "lower";
  ariaLabel: string;
  children: ReactNode;
  style?: CSSProperties;
};

function PanelWindow({ ariaLabel, children, density, style }: PanelWindowProps) {
  return (
    <article aria-label={ariaLabel} className={`panel-window panel-${density}`} style={style}>
      <div className="panel-body">{children}</div>
    </article>
  );
}

type LeftPanelKind = (typeof leftPanels)[number]["kind"];

function LeftPanelContent({ kind }: { kind: LeftPanelKind }) {
  if (kind === "code") {
    return (
      <CodeBlock
        code={`def next_tutor_move(state: dict) -> str:
    if state["reasoning"] == "hidden":
        return "ask_for_visible_step"

    return "confirm_and_extend"`}
      />
    );
  }

  if (kind === "reference") {
    return (
      <div className="text-stack">
        <p>
          Ask for one observable step before adding explanation. Keep the move short
          enough that the student can answer without scrolling.
        </p>
        <p className="muted-copy">
          Use examples only after the student commits to a first operation.
        </p>
      </div>
    );
  }

  if (kind === "checks") {
    return (
      <ul className="check-list">
        <li>
          <span>Reasoning visible</span>
          <strong>needed</strong>
        </li>
        <li>
          <span>Hint depth</span>
          <strong>low</strong>
        </li>
        <li>
          <span>Next action</span>
          <strong>ask</strong>
        </li>
      </ul>
    );
  }

  return (
    <div className="text-stack">
      <div className="tag-row">
        <span>Objective</span>
        <span>Constraint</span>
      </div>
      <p>
        The student has a partly correct first move. The interface should make
        supporting context easy to scan without competing with the main work area.
      </p>
      <p className="muted-copy">
        Preferred response shape: short question, one target, no full solution yet.
      </p>
    </div>
  );
}

function MainPanelContent() {
  return (
    <div className="workspace-content">
      <section className="copy-card">
        <h2 className="content-title">Reasoning before explanation</h2>
        <p>
          The main panel needs to support reading, writing, and comparison. Normal
          text should stay neutral; the brand color is reserved for selection,
          emphasis, and small status cues.
        </p>
      </section>

      <section className="split-work">
        <div className="copy-card">
          <h2 className="content-title">Plain text area</h2>
          <p>
            Before we solve the whole thing, what is the first operation you would
            undo, and what equation remains after that step?
          </p>
        </div>

        <CodeBlock
          code={`response_shape = {
    "mode": "question",
    "target": "first_operation",
    "reveal_solution": False,
    "max_sentences": 2,
}`}
        />
      </section>

      <section className="copy-card subtle-card">
        <h2 className="content-title">Resize without losing hierarchy</h2>
        <p>
          The left stack can carry reference material and tools. The lower panel can
          stay conversational while the main panel holds the durable work surface.
        </p>
      </section>
    </div>
  );
}

function ChatPanelContent() {
  return (
    <div className="chat-thread">
      <div className="chat-message student">
        <span>Student</span>
        <p>I moved the 4 first because it was outside the parentheses.</p>
      </div>
      <div className="chat-message tutor">
        <span>Tutor draft</span>
        <p>Good. After subtracting 4 from both sides, what equation is left?</p>
      </div>
      <div className="chat-message student">
        <span>Student</span>
        <p>3(x - 2) = 12</p>
      </div>
      <div className="composer-row" aria-hidden="true">
        <span>Ask one follow-up...</span>
        <strong>Send</strong>
      </div>
    </div>
  );
}

function getPythonTokenKind(token: string, source: string, index: number) {
  if (token.startsWith("#")) return "comment";
  if (token.startsWith('"') || token.startsWith("'")) return "string";
  if (/^\d/.test(token)) return "number";
  if (pythonKeywords.has(token)) return "keyword";
  if (pythonBuiltins.has(token)) return "builtin";
  if (/^[A-Za-z_]\w*$/.test(token) && source[index + token.length] === "(") {
    return "function";
  }
  return "operator";
}

function highlightPython(code: string) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of code.matchAll(pythonTokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push(code.slice(cursor, index));
    }

    nodes.push(
      <span
        className={`syntax-token syntax-${getPythonTokenKind(token, code, index)}`}
        key={tokenIndex}
      >
        {token}
      </span>,
    );
    cursor = index + token.length;
    tokenIndex += 1;
  }

  if (cursor < code.length) {
    nodes.push(code.slice(cursor));
  }

  return nodes;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="code-block" data-language="python">
      <code>{highlightPython(code)}</code>
    </pre>
  );
}

export default App;
