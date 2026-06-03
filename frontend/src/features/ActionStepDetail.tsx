import {
  normalizePythonNotebookState,
} from "../PythonNotebookPanel";
import {
  compactRuntimeValue,
  recordFromUnknown,
  stringConfigValue,
} from "../runtimeUtils";
import type {
  EventStepDraft,
  ExperienceEvent,
  ScriptAudioItem,
  StepConditionDraft,
} from "../types";
import { MainPanelAppFields } from "./MainPanelAppFields";
import { ScriptActionEditor } from "./ScriptActionEditor";

type ActionStepDetailProps = {
  className?: string;
  editorEvents: ExperienceEvent[];
  scriptAudioItems: ScriptAudioItem[];
  step: EventStepDraft;
  updateConfig: (key: string, value: unknown) => void;
  updateCondition: (condition: Partial<StepConditionDraft>) => void;
  updateConfigPatch?: (patch: Record<string, unknown>) => void;
};

export function ActionStepDetail({
  className = "event-step-detail",
  editorEvents,
  scriptAudioItems,
  step,
  updateConfig,
  updateCondition,
  updateConfigPatch,
}: ActionStepDetailProps) {
  const triggerEventSlug = stringConfigValue(step.config, "triggersEvent");
  const hasTriggerEventOption = editorEvents.some(
    (event) => event.slug === triggerEventSlug,
  );

  return (
    <div className={className}>
      <div className="event-condition-editor">
        {step.condition.type === "context_equals" ? (
          <>
            <span className="event-detail-label">IF</span>
            <input
              aria-label="Condition context key"
              onChange={(event) => updateCondition({ key: event.target.value })}
              placeholder="entry_ready"
              type="text"
              value={step.condition.key}
            />
            <span className="event-inline-operator">=</span>
            <input
              aria-label="Condition context value"
              onChange={(event) => updateCondition({ value: event.target.value })}
              placeholder="expected"
              type="text"
              value={step.condition.value}
            />
            <button
              className="event-text-button"
              onClick={() => updateCondition({ type: "always" })}
              type="button"
            >
              Clear
            </button>
          </>
        ) : step.condition.type === "custom" ? (
          <>
            <span className="event-detail-label">IF</span>
            <span className="event-custom-condition">
              {compactRuntimeValue(step.condition.raw, "custom condition")}
            </span>
            <button
              className="event-text-button"
              onClick={() => updateCondition({ type: "always" })}
              type="button"
            >
              Clear
            </button>
          </>
        ) : (
          <button
            className="event-add-condition-button"
            onClick={() => updateCondition({ type: "context_equals" })}
            type="button"
          >
            Add IF condition
          </button>
        )}
      </div>

      {step.actionType === "script" ? (
        <ScriptActionEditor
          deckUrl={stringConfigValue(step.config, "deckUrl")}
          onDeckUrlChange={(value) => updateConfig("deckUrl", value)}
          onTextChange={(value) => updateConfig("text", value)}
          scriptAudioItems={scriptAudioItems}
          text={stringConfigValue(step.config, "text")}
        />
      ) : null}

      {step.actionType === "set_context" ? (
        <div className="event-context-line">
          <span className="event-detail-label">SET</span>
          <input
            aria-label="Context key"
            onChange={(event) => updateConfig("key", event.target.value)}
            placeholder="entry_ready"
            type="text"
            value={stringConfigValue(step.config, "key")}
          />
          <span className="event-inline-operator">=</span>
            <input
              aria-label="Context value"
              onChange={(event) => updateConfig("value", event.target.value)}
              placeholder="yes"
              type="text"
              value={stringConfigValue(step.config, "value")}
            />
        </div>
      ) : null}

      {step.actionType === "append_context_list" ? (
        <div className="event-context-line">
          <span className="event-detail-label">APPEND</span>
          <input
            aria-label="Context list key"
            onChange={(event) => updateConfig("key", event.target.value)}
            placeholder="fruits_mentioned"
            type="text"
            value={stringConfigValue(step.config, "key")}
          />
          <span className="event-inline-operator">+=</span>
            <input
              aria-label="Context list value"
              onChange={(event) => updateConfig("value", event.target.value)}
              placeholder="banana"
              type="text"
              value={stringConfigValue(step.config, "value")}
            />
        </div>
      ) : null}

      {step.actionType === "get_ui_state" ? (
        <div className="event-context-line">
          <span className="event-detail-label">READ</span>
          <input
            aria-label="UI state key"
            onChange={(event) => updateConfig("stateKey", event.target.value)}
            placeholder="notesVisible"
            type="text"
            value={stringConfigValue(step.config, "stateKey")}
          />
          <span className="event-inline-operator">{"->"}</span>
          <input
            aria-label="Context key"
            onChange={(event) => updateConfig("contextKey", event.target.value)}
            placeholder="notes_visible"
            type="text"
            value={stringConfigValue(step.config, "contextKey")}
          />
        </div>
      ) : null}

      {step.actionType === "highlight_on" ? (
        <div className="event-context-line">
          <span className="event-detail-label">TARGET</span>
          <input
            aria-label="Highlight selector"
            onChange={(event) => updateConfig("selector", event.target.value)}
            placeholder=".runtime-notes-toggle"
            type="text"
            value={stringConfigValue(step.config, "selector")}
          />
          <span className="event-detail-label">COLOR</span>
          <input
            aria-label="Highlight color"
            onChange={(event) => updateConfig("color", event.target.value)}
            placeholder="rgba(59, 130, 246, 0.6)"
            type="text"
            value={stringConfigValue(step.config, "color")}
          />
        </div>
      ) : null}

      {step.actionType === "highlight_off" ? (
        <div className="event-context-line single-value">
          <span className="event-detail-label">CLEAR</span>
          <input
            aria-label="Highlight selector"
            onChange={(event) => updateConfig("selector", event.target.value)}
            placeholder=".runtime-notes-toggle"
            type="text"
            value={stringConfigValue(step.config, "selector")}
          />
        </div>
      ) : null}

      {step.actionType === "interactive" ? (
        <>
          <div className="event-context-line interactive-action-line">
            <MainPanelAppFields
              appId={stringConfigValue(step.config, "interactiveId")}
              appConfig={recordFromUnknown(step.config.config)}
              onConfigChange={updateConfig}
              onConfigPatch={updateConfigPatch}
              view={stringConfigValue(step.config, "mode")}
            />
          </div>
          <div className="event-context-line single-value">
            <span className="event-detail-label">ON SUBMIT</span>
            <select
              aria-label="Main-panel app completion event"
              onChange={(event) =>
                updateConfig("triggersEvent", event.target.value)
              }
              value={triggerEventSlug}
            >
              <option value="">Stay in this event</option>
              {triggerEventSlug && !hasTriggerEventOption ? (
                <option value={triggerEventSlug}>{triggerEventSlug}</option>
              ) : null}
              {editorEvents.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.title || event.slug}
                  {event.isStart ? " (start)" : ""}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}

      {step.actionType === "interactive_update" ? (
        <>
          <div className="event-context-line interactive-action-line">
            <MainPanelAppFields
              appId={stringConfigValue(step.config, "interactiveId")}
              appConfig={recordFromUnknown(step.config.config)}
              onConfigChange={updateConfig}
              onConfigPatch={updateConfigPatch}
              view={stringConfigValue(step.config, "mode")}
            />
          </div>
          <div className="event-context-line single-value">
            <span className="event-detail-label">ON SUBMIT</span>
            <select
              aria-label="Updated main-panel app completion event"
              onChange={(event) =>
                updateConfig("triggersEvent", event.target.value)
              }
              value={triggerEventSlug}
            >
              <option value="">Keep current target</option>
              {triggerEventSlug && !hasTriggerEventOption ? (
                <option value={triggerEventSlug}>{triggerEventSlug}</option>
              ) : null}
              {editorEvents.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.title || event.slug}
                  {event.isStart ? " (start)" : ""}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}

      {step.actionType === "python_notebook" ? (
        <div className="event-context-line single-value">
          <span className="event-detail-label">NOTEBOOK</span>
          <span className="event-inline-note">
            {normalizePythonNotebookState(step.config.notebook).cells.length} cells
          </span>
        </div>
      ) : null}

      {step.actionType === "chat_availability" ? (
        <div className="event-context-line single-value">
          <span className="event-detail-label">CHAT</span>
          <select
            aria-label="Chat availability"
            onChange={(event) =>
              updateConfig("enabled", event.target.value === "on")
            }
            value={step.config.enabled === false ? "off" : "on"}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </div>
      ) : null}

      {step.actionType === "set_ui_trigger" ? (
        <div className="event-context-line">
          <span className="event-detail-label">WHEN</span>
          <input
            aria-label="Trigger selector"
            onChange={(event) => updateConfig("selector", event.target.value)}
            placeholder=".runtime-notes-toggle"
            type="text"
            value={stringConfigValue(step.config, "selector")}
          />
          <span className="event-inline-operator">{"->"}</span>
          <select
            aria-label="Triggered event"
            onChange={(event) => updateConfig("triggersEvent", event.target.value)}
            value={triggerEventSlug}
          >
            <option value="">Choose event</option>
            {triggerEventSlug && !hasTriggerEventOption ? (
              <option value={triggerEventSlug}>{triggerEventSlug}</option>
            ) : null}
            {editorEvents.map((event) => (
              <option key={event.id} value={event.slug}>
                {event.title || event.slug}
                {event.isStart ? " (start)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {step.actionType === "goto_event" ? (
        <div className="event-context-line single-value">
          <span className="event-detail-label">GO</span>
          <select
            aria-label="Target event"
            onChange={(event) => updateConfig("triggersEvent", event.target.value)}
            value={triggerEventSlug}
          >
            <option value="">Choose event</option>
            {triggerEventSlug && !hasTriggerEventOption ? (
              <option value={triggerEventSlug}>{triggerEventSlug}</option>
            ) : null}
            {editorEvents.map((event) => (
              <option key={event.id} value={event.slug}>
                {event.title || event.slug}
                {event.isStart ? " (start)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {step.actionType === "button_choice" ? (
        <div className="event-context-line">
          <span className="event-detail-label">BUTTON</span>
          <input
            aria-label="Button label"
            onChange={(event) => updateConfig("label", event.target.value)}
            placeholder="Continue"
            type="text"
            value={stringConfigValue(step.config, "label")}
          />
          <span className="event-inline-operator">{"->"}</span>
          <select
            aria-label="Button target event"
            onChange={(event) => updateConfig("triggersEvent", event.target.value)}
            value={triggerEventSlug}
          >
            <option value="">Choose event</option>
            {triggerEventSlug && !hasTriggerEventOption ? (
              <option value={triggerEventSlug}>{triggerEventSlug}</option>
            ) : null}
            {editorEvents.map((event) => (
              <option key={event.id} value={event.slug}>
                {event.title || event.slug}
                {event.isStart ? " (start)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
