import { useEffect, useState, type ReactNode } from "react";

export type RuntimeInteractive = {
  config: Record<string, unknown>;
  eventId: string;
  interactiveId: string;
  mode: string;
  prompt: string;
  stepId: string;
  title: string;
  triggersEvent: string;
};

export type MainPanelAppHost = {
  context: Record<string, unknown>;
  emitActions: (
    actions: Array<Record<string, unknown>>,
    state?: Record<string, unknown>,
  ) => void;
  runEvent: (eventSlug: string, state?: Record<string, unknown>) => void;
  saveContext: (values: Record<string, unknown>) => Promise<void>;
  setState: (state: Record<string, unknown>) => void;
  submit: (
    state?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => void;
};

export type MainPanelAppProps = {
  host: MainPanelAppHost;
  interactive: RuntimeInteractive;
  state: Record<string, unknown>;
};

export type MainPanelAppDefinition = {
  Component: (props: MainPanelAppProps) => ReactNode;
  configFields?: MainPanelAppConfigField[];
  defaultConfig?: Record<string, unknown>;
  defaultView: string;
  id: string;
  label: string;
  views: Array<{ id: string; label: string }>;
};

export type MainPanelAppConfigField = {
  defaultValue?: string | number;
  id: string;
  inputMode?: "text" | "numeric" | "decimal";
  label: string;
  placeholder?: string;
  type?: "text" | "number";
};

type DeliveryDataRow = {
  distance: number;
  minutes: number;
  order: string;
};

const defaultDeliveryRows: DeliveryDataRow[] = [
  { distance: 1.2, minutes: 7, order: "A-184" },
  { distance: 2.1, minutes: 12, order: "B-302" },
  { distance: 3.4, minutes: 18, order: "C-119" },
  { distance: 4.8, minutes: 27, order: "D-447" },
];

function stringConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function numberConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function numberStateValue(
  state: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = state[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function deliveryRowsFromConfig(config: Record<string, unknown>) {
  const rawRows = config.rows;
  if (!Array.isArray(rawRows)) return defaultDeliveryRows;

  const rows = rawRows.flatMap((rawRow): DeliveryDataRow[] => {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      return [];
    }
    const row = rawRow as Record<string, unknown>;
    const order = stringConfigValue(row, "order").trim();
    const distance = numberConfigValue(row, "distance", Number.NaN);
    const minutes = numberConfigValue(row, "minutes", Number.NaN);
    if (!order || !Number.isFinite(distance) || !Number.isFinite(minutes)) {
      return [];
    }
    return [{ distance, minutes, order }];
  });

  return rows.length ? rows.slice(0, 12) : defaultDeliveryRows;
}

function DeliveryDataInteractive({
  host,
  interactive,
  state,
}: MainPanelAppProps) {
  const rows = deliveryRowsFromConfig(interactive.config);
  const estimate =
    typeof state.estimate === "string"
      ? state.estimate
      : String(state.estimate ?? "");
  const mode = interactive.mode || "table";
  const view = mode === "graph" ? "graph" : "table";
  const maxMinutes = Math.max(...rows.map((row) => row.minutes));
  const appTitle = interactive.title || "Delivery data";
  const targetDistance = numberConfigValue(
    interactive.config,
    "targetDistance",
    3.9,
  );
  const estimateContextKey =
    stringConfigValue(
      interactive.config,
      "estimateContextKey",
      "delivery_estimate",
    ).trim() || "delivery_estimate";
  const appPrompt =
    interactive.prompt ||
    `Estimate the delivery time for a ${targetDistance.toFixed(1)} mile order.`;

  return (
    <div className="interactive-workspace">
      <div className="interactive-shell delivery-interactive">
        <div className="interactive-header">
          <span>{view}</span>
          <strong>{appTitle}</strong>
        </div>
        <p>{appPrompt}</p>

        {view === "graph" ? (
          <div className="delivery-bars" aria-label="Delivery data graph">
            {rows.map((row) => (
              <div className="delivery-bar-row" key={row.order}>
                <span>{row.order}</span>
                <div>
                  <i style={{ width: `${(row.minutes / maxMinutes) * 100}%` }} />
                </div>
                <strong>{row.minutes}m</strong>
              </div>
            ))}
          </div>
        ) : (
          <table className="delivery-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Distance</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.order}>
                  <td>{row.order}</td>
                  <td>{row.distance.toFixed(1)} mi</td>
                  <td>{row.minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="interactive-response-row">
          <label>
            <span>Estimate</span>
            <input
              inputMode="numeric"
              onChange={(event) =>
                host.setState({ ...state, estimate: event.target.value })
              }
              placeholder="minutes"
              type="text"
              value={estimate}
            />
          </label>
          {interactive.triggersEvent ? (
            <button
              className="interactive-primary-action"
              disabled={!estimate.trim()}
              onClick={() => {
                const nextState = {
                  ...state,
                  completedAt: new Date().toISOString(),
                  estimate: estimate.trim(),
                };
                host.emitActions(
                  [
                    {
                      key: estimateContextKey,
                      type: "set_context",
                      value: estimate.trim(),
                    },
                    {
                      triggersEvent: interactive.triggersEvent,
                      type: "goto_event",
                    },
                  ],
                  nextState,
                );
              }}
              type="button"
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimingChallengeInteractive({
  host,
  interactive,
  state,
}: MainPanelAppProps) {
  const targetMs = numberConfigValue(interactive.config, "targetMs", 3200);
  const toleranceMs = numberConfigValue(interactive.config, "toleranceMs", 450);
  const markedContextKey =
    stringConfigValue(interactive.config, "markedContextKey", "marked_ms").trim() ||
    "marked_ms";
  const accuracyContextKey =
    stringConfigValue(
      interactive.config,
      "accuracyContextKey",
      "marked_accuracy_ms",
    ).trim() || "marked_accuracy_ms";
  const initialElapsedMs = Math.max(0, numberStateValue(state, "elapsedMs", 0));
  const initialMarkedMs = numberStateValue(state, "markedMs", Number.NaN);
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);
  const [markedMs, setMarkedMs] = useState(
    Number.isFinite(initialMarkedMs) ? initialMarkedMs : 0,
  );
  const [hasMark, setHasMark] = useState(Number.isFinite(initialMarkedMs));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const appTitle = interactive.title || "Timing challenge";
  const view = interactive.mode === "review" ? "review" : "timer";
  const maxMs = Math.max(targetMs + toleranceMs * 2, targetMs + 1000);
  const elapsedRatio = Math.min(1, elapsedMs / maxMs);
  const targetRatio = Math.min(1, targetMs / maxMs);
  const markedRatio = Math.min(1, markedMs / maxMs);
  const deltaMs = hasMark ? Math.round(markedMs - targetMs) : 0;
  const absoluteDeltaMs = Math.abs(deltaMs);
  const isClose = hasMark && absoluteDeltaMs <= toleranceMs;
  const prompt =
    interactive.prompt ||
    "Start the timer, mark the target moment, then submit the marked time.";

  useEffect(() => {
    if (startedAt === null) return;

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 50);

    return () => window.clearInterval(timer);
  }, [startedAt]);

  function persistState(nextState: Record<string, unknown>) {
    host.setState({
      ...state,
      ...nextState,
    });
  }

  function startTimer() {
    const nextStartedAt = Date.now() - elapsedMs;
    setStartedAt(nextStartedAt);
    persistState({ elapsedMs, running: true });
  }

  function pauseTimer() {
    setStartedAt(null);
    persistState({ elapsedMs, running: false });
  }

  function resetTimer() {
    setStartedAt(null);
    setElapsedMs(0);
    setMarkedMs(0);
    setHasMark(false);
    persistState({ elapsedMs: 0, markedMs: null, running: false });
  }

  function markMoment() {
    const mark = Math.round(elapsedMs);
    setMarkedMs(mark);
    setHasMark(true);
    persistState({
      elapsedMs: mark,
      markedMs: mark,
      running: startedAt !== null,
    });
  }

  function submitTiming() {
    const mark = Math.round(markedMs);
    const accuracy = Math.abs(mark - targetMs);
    const nextState = {
      ...state,
      completedAt: new Date().toISOString(),
      elapsedMs: Math.round(elapsedMs),
      markedMs: mark,
      running: false,
    };
    setStartedAt(null);
    host.emitActions(
      [
        {
          key: markedContextKey,
          type: "set_context",
          value: mark,
        },
        {
          key: accuracyContextKey,
          type: "set_context",
          value: accuracy,
        },
        {
          key: "timing_within_tolerance",
          type: "set_context",
          value: accuracy <= toleranceMs,
        },
        {
          triggersEvent: interactive.triggersEvent,
          type: "goto_event",
        },
      ],
      nextState,
    );
  }

  return (
    <div className="interactive-workspace">
      <div className="interactive-shell timing-interactive">
        <div className="interactive-header">
          <span>{view}</span>
          <strong>{appTitle}</strong>
        </div>
        <p>{prompt}</p>

        <div className="timing-readout" aria-label="Timing challenge">
          <strong>{(elapsedMs / 1000).toFixed(2)}s</strong>
          <span>target {(targetMs / 1000).toFixed(2)}s</span>
        </div>

        <div className="timing-track" aria-hidden="true">
          <i style={{ width: `${elapsedRatio * 100}%` }} />
          <span
            className="timing-target"
            style={{ left: `${targetRatio * 100}%` }}
          />
          {hasMark ? (
            <span
              className="timing-mark"
              style={{ left: `${markedRatio * 100}%` }}
            />
          ) : null}
        </div>

        <div className="timing-status-row">
          <span>{hasMark ? `Marked ${(markedMs / 1000).toFixed(2)}s` : "---"}</span>
          <strong className={isClose ? "is-close" : ""}>
            {hasMark ? `${deltaMs > 0 ? "+" : ""}${deltaMs}ms` : "not marked"}
          </strong>
        </div>

        <div className="interactive-button-row">
          <button
            className="interactive-secondary-action"
            onClick={startedAt === null ? startTimer : pauseTimer}
            type="button"
          >
            {startedAt === null ? "Start" : "Pause"}
          </button>
          <button
            className="interactive-secondary-action"
            onClick={resetTimer}
            type="button"
          >
            Reset
          </button>
          <button
            className="interactive-primary-action"
            onClick={markMoment}
            type="button"
          >
            Mark moment
          </button>
          {interactive.triggersEvent ? (
            <button
              className="interactive-primary-action"
              disabled={!hasMark}
              onClick={submitTiming}
              type="button"
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const mainPanelAppDefinitions: MainPanelAppDefinition[] = [
  {
    Component: DeliveryDataInteractive,
    configFields: [
      {
        defaultValue: 3.9,
        id: "targetDistance",
        inputMode: "decimal",
        label: "TARGET MI",
        placeholder: "3.9",
        type: "number",
      },
      {
        defaultValue: "delivery_estimate",
        id: "estimateContextKey",
        label: "SAVE AS",
        placeholder: "delivery_estimate",
      },
    ],
    defaultConfig: {
      estimateContextKey: "delivery_estimate",
      targetDistance: 3.9,
    },
    defaultView: "table",
    id: "delivery_data",
    label: "Delivery data",
    views: [
      { id: "table", label: "Table" },
      { id: "graph", label: "Graph" },
    ],
  },
  {
    Component: TimingChallengeInteractive,
    configFields: [
      {
        defaultValue: 3200,
        id: "targetMs",
        inputMode: "numeric",
        label: "TARGET MS",
        placeholder: "3200",
        type: "number",
      },
      {
        defaultValue: 450,
        id: "toleranceMs",
        inputMode: "numeric",
        label: "TOLERANCE",
        placeholder: "450",
        type: "number",
      },
      {
        defaultValue: "marked_ms",
        id: "markedContextKey",
        label: "SAVE AS",
        placeholder: "marked_ms",
      },
    ],
    defaultConfig: {
      accuracyContextKey: "marked_accuracy_ms",
      markedContextKey: "marked_ms",
      targetMs: 3200,
      toleranceMs: 450,
    },
    defaultView: "timer",
    id: "timing_challenge",
    label: "Timing challenge",
    views: [
      { id: "timer", label: "Timer" },
      { id: "review", label: "Review" },
    ],
  },
];

export const defaultMainPanelApp = mainPanelAppDefinitions[0];

export function getMainPanelAppDefinition(appId: string) {
  return mainPanelAppDefinitions.find((app) => app.id === appId) ?? null;
}

export function cloneMainPanelAppConfig(app: MainPanelAppDefinition) {
  return JSON.parse(JSON.stringify(app.defaultConfig ?? {})) as Record<
    string,
    unknown
  >;
}
