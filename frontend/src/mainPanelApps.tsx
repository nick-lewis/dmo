import type { ReactNode } from "react";

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
  emitActions: (actions: Array<Record<string, unknown>>) => void;
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
                host.submit(nextState, {
                  [estimateContextKey]: estimate.trim(),
                });
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
