import { Fragment } from "react";
import {
  cloneMainPanelAppConfig,
  defaultMainPanelApp,
  getMainPanelAppDefinition,
  mainPanelAppDefinitions,
  type MainPanelAppConfigField,
} from "../mainPanelApps";


export function MainPanelAppFields({
  appId,
  appConfig,
  onConfigChange,
  onConfigPatch,
  view,
}: {
  appConfig: Record<string, unknown>;
  appId: string;
  onConfigChange: (key: string, value: unknown) => void;
  onConfigPatch?: (patch: Record<string, unknown>) => void;
  view: string;
}) {
  const appDefinition =
    getMainPanelAppDefinition(appId) ?? defaultMainPanelApp;
  const hasCurrentApp = mainPanelAppDefinitions.some((app) => app.id === appId);
  const currentView = view || appDefinition.defaultView;
  const hasCurrentView = appDefinition.views.some(
    (candidate) => candidate.id === currentView,
  );
  const configFields = appDefinition.configFields ?? [];

  function changeAppConfigField(
    field: MainPanelAppConfigField,
    rawValue: string,
  ) {
    const nextValue =
      field.type === "number" && rawValue.trim()
        ? Number(rawValue)
        : rawValue;
    onConfigChange("config", {
      ...appConfig,
      [field.id]: Number.isNaN(nextValue) ? rawValue : nextValue,
    });
  }

  return (
    <>
      <span className="event-detail-label">APP</span>
      <select
        aria-label="Main-panel app"
        onChange={(event) => {
          const nextApp = getMainPanelAppDefinition(event.target.value);
          if (nextApp && onConfigPatch) {
            onConfigPatch({
              config: cloneMainPanelAppConfig(nextApp),
              interactiveId: nextApp.id,
              mode: nextApp.defaultView,
            });
            return;
          }
          onConfigChange("interactiveId", nextApp?.id ?? event.target.value);
          if (nextApp) {
            onConfigChange("config", cloneMainPanelAppConfig(nextApp));
            if (!nextApp.views.some((item) => item.id === currentView)) {
              onConfigChange("mode", nextApp.defaultView);
            }
          }
        }}
        value={hasCurrentApp ? appId : ""}
      >
        {!hasCurrentApp ? (
          <option value="">{appId || "Choose app"}</option>
        ) : null}
        {mainPanelAppDefinitions.map((app) => (
          <option key={app.id} value={app.id}>
            {app.label}
          </option>
        ))}
      </select>
      <span className="event-detail-label">VIEW</span>
      <select
        aria-label="Main-panel app view"
        onChange={(event) => onConfigChange("mode", event.target.value)}
        value={hasCurrentView ? currentView : ""}
      >
        {!hasCurrentView && currentView ? (
          <option value="">{currentView}</option>
        ) : null}
        {appDefinition.views.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {!hasCurrentApp ? (
        <span className="event-config-warning">
          Unregistered app: {appId || "missing app id"}
        </span>
      ) : null}
      {hasCurrentApp && !hasCurrentView ? (
        <span className="event-config-warning">
          Unknown view for {appDefinition.label}: {currentView || "missing view"}
        </span>
      ) : null}
      {configFields.map((field) => {
        const fallback = field.defaultValue ?? "";
        const rawValue = appConfig[field.id];
        const value =
          typeof rawValue === "number" || typeof rawValue === "string"
            ? String(rawValue)
            : String(fallback);

        return (
          <Fragment key={field.id}>
            <span className="event-detail-label">{field.label}</span>
            <input
              aria-label={`${appDefinition.label} ${field.label.toLowerCase()}`}
              inputMode={field.inputMode}
              onChange={(event) =>
                changeAppConfigField(field, event.target.value)
              }
              placeholder={field.placeholder}
              type={field.type ?? "text"}
              value={value}
            />
          </Fragment>
        );
      })}
    </>
  );
}
