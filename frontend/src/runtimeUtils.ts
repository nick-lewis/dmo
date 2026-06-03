import type { RuntimeInteractive } from "./mainPanelApps";
import type {
  CheckpointRecordingMode,
  ResolvedSlide,
  RuntimeDebugTraceEntry,
  RuntimeNote,
  RuntimeOverlay,
} from "./types";

export function compactPreview(value: string, fallback: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return fallback;
  return compact.length > 112 ? `${compact.slice(0, 109)}...` : compact;
}

export function compactRuntimeValue(value: unknown, fallback = "---") {
  if (value === null) return "null";
  if (value === undefined) return fallback;
  if (typeof value === "string") return compactPreview(value, fallback);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return compactPreview(JSON.stringify(value), fallback);
  } catch {
    return fallback;
  }
}

export function stringConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

export function conditionValueSummary(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return compactRuntimeValue(value, "expected");
}

export function conditionRecordSummary(condition: Record<string, unknown>): string {
  const type = typeof condition.type === "string" ? condition.type : "always";
  const key = typeof condition.key === "string" ? condition.key : "context";
  const value = conditionValueSummary(condition.value);

  if (!condition.type || type === "always") return "";
  if (type === "context_equals") return `${key} == ${value}`;
  if (type === "context_not_equals") return `${key} != ${value}`;
  if (type === "context_contains") return `${key} has ${value}`;
  if (type === "context_not_contains") return `${key} lacks ${value}`;
  if (type === "context_exists") return `${key} exists`;
  if (type === "context_missing") return `${key} missing`;

  if (type === "all" || type === "any") {
    const conditions = Array.isArray(condition.conditions)
      ? condition.conditions
      : [];
    const summaries: string[] = conditions
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? conditionRecordSummary(item as Record<string, unknown>)
          : "",
      )
      .filter(Boolean);
    if (!summaries.length) return type;
    const joiner = type === "all" ? " and " : " or ";
    return summaries.join(joiner);
  }

  return compactRuntimeValue(condition, "custom");
}

export function fullRuntimeValue(value: unknown, fallback = "---") {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

export function runtimeValueTypeLabel(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (value === undefined) return "unset";
  if (typeof value === "object") return "object";
  return typeof value;
}

export function runtimeActionText(action: Record<string, unknown>) {
  const type = typeof action.type === "string" ? action.type : "action";
  if (type === "pause") {
    const durationMs =
      typeof action.durationMs === "number" || typeof action.durationMs === "string"
        ? Number(action.durationMs)
        : 0;
    return Number.isFinite(durationMs) && durationMs > 0
      ? `${Math.round(durationMs)}ms`
      : "pause";
  }
  if (type === "conversation_check_result") {
    const result = action.result ? "matched" : "missed";
    const reason = compactRuntimeValue(action.reason, "");
    return reason ? `${result}: ${reason}` : result;
  }
  if (type === "classifier_result") {
    return `${compactRuntimeValue(action.classifierName, "classifier")}: ${compactRuntimeValue(
      action.result,
      "result",
    )}`;
  }
  if (type === "classifier_group_result") {
    const runMode = compactRuntimeValue(action.runMode, "");
    const count = compactRuntimeValue(action.ranClassifierCount, "");
    const suffix = runMode && count ? ` (${runMode} ${count})` : "";
    return `${compactRuntimeValue(action.classifierGroupTitle, "classifiers")}: ${compactRuntimeValue(
      action.results,
      "results",
    )}${suffix}`;
  }
  if (type === "classifier_skipped" || type === "classifier_group_skipped") {
    return `${compactRuntimeValue(
      action.classifierName || action.classifierGroupTitle,
      "classifier",
    )} skipped`;
  }
  if (type === "chat_tool_call") {
    return compactRuntimeValue(action.toolName, "function call");
  }
  if (type === "set_context") {
    return `${compactRuntimeValue(action.key, "key")} = ${compactRuntimeValue(
      action.value,
      "value",
    )}`;
  }
  if (type === "append_context_list") {
    return `${compactRuntimeValue(action.key, "key")} += ${compactRuntimeValue(
      action.value,
      "value",
    )}`;
  }
  if (type === "get_ui_state") {
    return `${compactRuntimeValue(action.stateKey, "ui")} -> ${compactRuntimeValue(
      action.contextKey,
      "context",
    )}`;
  }
  if (type === "chat_message") {
    const message = recordFromUnknown(action.message);
    if (typeof message.content === "string") {
      return compactRuntimeValue(message.content, "message");
    }
    return compactRuntimeValue(action.content, "message");
  }
  if (type === "goto_event" || type === "set_ui_trigger") {
    return `-> ${compactRuntimeValue(action.triggersEvent, "event")}`;
  }
  if (type === "button_choice") {
    return `${compactRuntimeValue(action.label, "button")} -> ${compactRuntimeValue(
      action.triggersEvent,
      "event",
    )}`;
  }
  if (type === "highlight_on" || type === "highlight_off") {
    return compactRuntimeValue(action.selector, "selector");
  }
  if (type === "show_image") {
    return compactRuntimeValue(action.imagePath, "image");
  }
  if (type === "overlay") {
    return `${compactRuntimeValue(action.overlayId, "default")} -> ${compactRuntimeValue(
      action.imagePath,
      "image",
    )}`;
  }
  if (type === "overlay_off") {
    return compactRuntimeValue(action.overlayId, "all overlays");
  }
  if (type === "agent_image_visibility") {
    return action.visible === false ? "main image off" : "main image on";
  }
  if (type === "add_note") {
    return compactRuntimeValue(action.text, "note");
  }
  if (type === "play_sound") {
    return compactRuntimeValue(action.soundPath, "sound");
  }
  if (type === "interactive") {
    return `mount ${compactRuntimeValue(
      action.interactiveId,
      "app",
    )} ${compactRuntimeValue(
      action.mode,
      "",
    )}`;
  }
  if (type === "interactive_update") {
    return `${compactRuntimeValue(
      action.interactiveId,
      "app",
    )} -> ${compactRuntimeValue(action.mode, "update")}`;
  }
  if (type === "interactive_state") {
    return `${compactRuntimeValue(action.interactiveId, "app")} state saved`;
  }
  if (type === "interactive_error") {
    return `${compactRuntimeValue(action.interactiveId, "app")}: ${compactRuntimeValue(
      action.detail,
      "not registered",
    )}`;
  }
  if (type === "interactive_action_rejected") {
    return `${compactRuntimeValue(action.actionType, "action")}: ${compactRuntimeValue(
      action.reason,
      "rejected",
    )}`;
  }
  if (type === "interactive_clear") {
    return "clear main-panel app";
  }
  if (type === "python_notebook") {
    if (action.status === "loaded" || action.notebook) return "load Python notebook";
    if (action.runAll) return "python notebook run all";
    return `python ${compactRuntimeValue(action.cellId, "notebook")}`;
  }
  if (type === "chat_availability") {
    return action.enabled === false ? "chat off" : "chat on";
  }
  if (type === "gslide") {
    return `slide ${compactRuntimeValue(action.slideRef, "1")}`;
  }
  if (type === "slide_error") {
    return compactRuntimeValue(action.detail, "slide unavailable");
  }
  if (type === "transition_missing") {
    return `missing ${compactRuntimeValue(action.triggersEvent, "event")}`;
  }
  if (type === "event_skipped") {
    return compactRuntimeValue(action.reason, "skipped");
  }

  return compactRuntimeValue(action, type);
}

export function runtimeDebugEntries(value: unknown): RuntimeDebugTraceEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "action";
    const at = typeof record.at === "string" ? record.at : "";
    const summary =
      typeof record.summary === "string"
        ? record.summary
        : compactRuntimeValue(record, type);
    return [
      {
        at,
        details: recordFromUnknown(record.details),
        summary,
        type,
      },
    ];
  });
}

export function runtimeTraceDetailsText(details: Record<string, unknown>) {
  const entries = Object.entries(details);
  if (!entries.length) return "";

  return entries
    .map(([key, value]) => `${key}: ${compactRuntimeValue(value)}`)
    .join(" | ");
}

export function runtimeTraceTime(value: string) {
  if (!value) return "---";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function checkpointTimeLabel(value: string) {
  if (!value) return "---";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

export function checkpointRecordingModeLabel(mode: CheckpointRecordingMode) {
  if (mode === "off") return "Off";
  if (mode === "full") return "Full";
  return "Structural";
}

export function runtimeSlideFromRecord(
  value: unknown,
): (ResolvedSlide & { deckUrl: string }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const slide = value as Record<string, unknown>;
  const imageUrl = typeof slide.imageUrl === "string" ? slide.imageUrl : "";
  if (!imageUrl) return null;

  return {
    cached: Boolean(slide.cached),
    deckUrl: typeof slide.deckUrl === "string" ? slide.deckUrl : "",
    imageUrl,
    pageId: typeof slide.pageId === "string" ? slide.pageId : "",
    presentationId:
      typeof slide.presentationId === "string" ? slide.presentationId : "",
    slideRef: typeof slide.slideRef === "string" ? slide.slideRef : "1",
  };
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function runtimeOverlaysFromRecord(value: unknown): Record<string, RuntimeOverlay> {
  const next: Record<string, RuntimeOverlay> = {};
  const source = recordFromUnknown(value);
  for (const [fallbackId, rawOverlay] of Object.entries(source)) {
    const overlay = recordFromUnknown(rawOverlay);
    const id =
      typeof overlay.id === "string" && overlay.id.trim()
        ? overlay.id.trim()
        : fallbackId.trim();
    const imagePath =
      typeof overlay.imagePath === "string" ? overlay.imagePath.trim() : "";
    if (!id || !imagePath) continue;
    next[id] = { id, imagePath };
  }
  return next;
}

export function runtimeNotesFromValue(value: unknown): RuntimeNote[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index): RuntimeNote[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const note = item as Record<string, unknown>;
    const text = typeof note.text === "string" ? note.text.trim() : "";
    if (!text) return [];

    const id =
      typeof note.id === "string" && note.id.trim()
        ? note.id.trim()
        : `note-${index}-${text}`;
    return [
      {
        id,
        source: typeof note.source === "string" ? note.source : "",
        text,
      },
    ];
  });
}

export function runtimeInteractiveFromRecord(value: unknown): RuntimeInteractive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const interactive = value as Record<string, unknown>;
  const interactiveId =
    typeof interactive.interactiveId === "string"
      ? interactive.interactiveId.trim()
      : "";
  if (!interactiveId) return null;

  const title =
    typeof interactive.title === "string" && interactive.title.trim()
      ? interactive.title.trim()
      : interactiveId;

  return {
    config: recordFromUnknown(interactive.config),
    eventId: typeof interactive.eventId === "string" ? interactive.eventId : "",
    interactiveId,
    mode: typeof interactive.mode === "string" ? interactive.mode : "default",
    prompt: typeof interactive.prompt === "string" ? interactive.prompt : "",
    stepId: typeof interactive.stepId === "string" ? interactive.stepId : "",
    title,
    triggersEvent:
      typeof interactive.triggersEvent === "string"
        ? interactive.triggersEvent.trim()
        : "",
  };
}
