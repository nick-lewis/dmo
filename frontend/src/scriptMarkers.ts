import { getMainPanelAppMetadata } from "./mainPanelAppMetadata";

export type ScriptEditorViewMode = "text" | "chips" | "slides" | "timeline";

export type ScriptSlidePreview = {
  detail?: string;
  imageUrl?: string;
  status: "error" | "idle" | "loading" | "ready";
};

export type ScriptMarkerInstance = {
  args: string;
  argList: string[];
  detail: string;
  end: number;
  id: string;
  label: string;
  linkId?: string;
  marker: string;
  start: number;
  timeMs?: number;
  type: string;
  wordIndex: number;
};

export const scriptMarkerOptions = [
  {
    label: "Slide",
    marker: "[gslide: 1]",
    title: "Insert a timed Google slide change at the cursor.",
  },
  {
    label: "Interface image",
    marker: "[side_image: right, show, test-images/dLU-right.png]",
    title: "Set a left or right interface image beside the chat.",
  },
  {
    label: "Note",
    marker: "[add_note: Remember this moment]",
    title: "Add a timed runtime note while the script is spoken.",
  },
  {
    label: "Sound",
    marker: "[play_sound: sounds/thud.mp3, 0.5]",
    title: "Play a timed sound effect while the script is spoken.",
  },
  {
    label: "Highlight",
    marker: "[highlight_on: .runtime-notes-toggle, rgba(59, 130, 246, 0.6)]",
    title: "Insert a timed highlight at the cursor.",
  },
  {
    label: "Clear highlight",
    marker: "[highlight_off: .runtime-notes-toggle]",
    title: "Clear a highlight at this point in the script.",
  },
  {
    label: "App",
    marker: "[interactive: delivery_data, table]",
    title:
      "Mount a registered app. Add a third argument to route on submit, like [interactive: delivery_data, table, next_event].",
  },
  {
    label: "Update app",
    marker: "[interactive_update: delivery_data, graph]",
    title: "Update the current main-panel app at this point in the script.",
  },
  {
    label: "Clear app",
    marker: "[interactive_clear]",
    title: "Clear the main-panel app at this point in the script.",
  },
  {
    label: "Pause",
    marker: "[pause: 500]",
    title: "Insert a timed pause marker.",
  },
  {
    label: "Chat off",
    marker: "[chat_off]",
    title: "Pause student typing at this point in the script.",
  },
  {
    label: "Chat on",
    marker: "[chat_on]",
    title: "Allow student typing again at this point in the script.",
  },
] as const;
export type ScriptMarkerOption = (typeof scriptMarkerOptions)[number];
export const scriptMarkerGroups: Array<{
  description: string;
  label: string;
  options: ScriptMarkerOption[];
}> = [
  {
    description: "Slides and interface images.",
    label: "Visuals",
    options: scriptMarkerOptions.filter((option) =>
      ["Slide", "Interface image"].includes(option.label),
    ),
  },
  {
    description: "Sound effects and spoken timing.",
    label: "Audio",
    options: scriptMarkerOptions.filter((option) =>
      ["Sound", "Pause"].includes(option.label),
    ),
  },
  {
    description: "Highlights and runtime notes.",
    label: "Interface",
    options: scriptMarkerOptions.filter((option) =>
      ["Highlight", "Clear highlight", "Note"].includes(option.label),
    ),
  },
  {
    description: "Main-panel apps.",
    label: "Apps",
    options: scriptMarkerOptions.filter((option) =>
      ["App", "Update app", "Clear app"].includes(option.label),
    ),
  },
  {
    description: "Student typing state.",
    label: "Conversation",
    options: scriptMarkerOptions.filter((option) =>
      ["Chat off", "Chat on"].includes(option.label),
    ),
  },
];
export const scriptSoundOptions = [{ label: "Thud", path: "sounds/thud.mp3" }] as const;
export const customSoundOptionValue = "__custom__";
export const scriptMarkerDragDataType = "application/x-dlu-script-marker";
export const scriptMarkerPattern =
  /\[(show_image|side_image|slide|gslide|interactive|interactive_update|interactive_clear|highlight|highlight_on|highlight_off|overlay|overlay_off|agent_image_off|agent_image_on|pause|chat_off|chat_on|add_note|play_sound)(?::\s*[^\]]+)?\]/gi;
export const scriptMarkerParsePattern =
  /\[(show_image|side_image|slide|gslide|interactive|interactive_update|interactive_clear|highlight|highlight_on|highlight_off|overlay|overlay_off|agent_image_off|agent_image_on|pause|chat_off|chat_on|add_note|play_sound)(?::\s*([^\]]+))?\]/gi;

export function countScriptWords(text: string) {
  const words = text.trim().match(/[A-Za-z0-9]+(?:[.'_-][A-Za-z0-9]+)*/g);
  return words?.length ?? 0;
}

export function normalizeScriptAudioText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function spokenTextFromMarkedScript(text: string) {
  scriptMarkerPattern.lastIndex = 0;
  return normalizeScriptAudioText(text.replace(scriptMarkerPattern, " "));
}

export function displayTranscriptSlotsFromText(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function scriptMarkerLabel(type: string) {
  const labels: Record<string, string> = {
    add_note: "Note",
    agent_image_off: "Image off",
    agent_image_on: "Image on",
    chat_off: "Chat off",
    chat_on: "Chat on",
    gslide: "Slide",
    highlight: "Highlight",
    highlight_off: "Clear highlight",
    highlight_on: "Highlight",
    interactive: "App",
    interactive_clear: "Clear app",
    interactive_update: "Update app",
    overlay: "Overlay",
    overlay_off: "Clear overlay",
    pause: "Pause",
    play_sound: "Sound",
    show_image: "Image",
    side_image: "Interface image",
    slide: "Slide",
  };
  return labels[type] ?? type;
}

export function scriptMarkerIcon(type: string) {
  const icons: Record<string, string> = {
    add_note: "N",
    agent_image_off: "I-",
    agent_image_on: "I+",
    chat_off: "C-",
    chat_on: "C+",
    gslide: "S",
    highlight: "H",
    highlight_off: "H-",
    highlight_on: "H",
    interactive: "A",
    interactive_clear: "A-",
    interactive_update: "A+",
    overlay: "O",
    overlay_off: "O-",
    pause: "P",
    play_sound: "AU",
    show_image: "I",
    side_image: "UI",
    slide: "S",
  };
  return icons[type] ?? "M";
}

export function parseScriptMarkerArgs(argsText: string) {
  if (!argsText.trim()) return [];

  const args: string[] = [];
  let current = "";
  let parenDepth = 0;
  for (const char of argsText) {
    if (char === "(") parenDepth += 1;
    if (char === ")" && parenDepth > 0) parenDepth -= 1;

    if (char === "," && parenDepth === 0) {
      const arg = current.trim();
      if (arg) args.push(arg);
      current = "";
      continue;
    }

    current += char;
  }

  const arg = current.trim();
  if (arg) args.push(arg);
  return args;
}

export function scriptTimelineTimeFromArg(arg: string) {
  const match = arg.trim().match(/^@\s*(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || "ms").toLowerCase();
  return Math.round(Math.max(0, unit === "s" ? amount * 1000 : amount));
}

export function scriptTimelineLinkFromArg(arg: string) {
  const match = arg.trim().match(/^@\s*link\s*:\s*([a-z0-9_-]+)\s*$/i);
  return match?.[1] ?? null;
}

export function splitScriptMarkerTimelineArgs(args: string[]) {
  let linkId: string | undefined;
  let timeMs: number | undefined;
  const visibleArgs: string[] = [];

  args.forEach((arg) => {
    const markerTimeMs = scriptTimelineTimeFromArg(arg);
    if (markerTimeMs !== null) {
      timeMs = markerTimeMs;
      return;
    }

    const markerLinkId = scriptTimelineLinkFromArg(arg);
    if (markerLinkId) {
      linkId = markerLinkId;
      return;
    }

    visibleArgs.push(arg);
  });

  return { args: visibleArgs, linkId, timeMs };
}

export function appendScriptMarkerTimelineArg(
  args: string[],
  timeMs?: number,
  linkId?: string,
) {
  const nextArgs = [...args];
  if (Number.isFinite(timeMs)) {
    nextArgs.push(`@${Math.max(0, Math.round(timeMs ?? 0))}ms`);
  }
  const safeLinkId = linkId?.trim();
  if (safeLinkId) {
    nextArgs.push(`@link:${safeLinkId}`);
  }
  return nextArgs;
}

export function scriptMarkerDetail(type: string, args: string, argList: string[]) {
  if (type === "interactive" || type === "interactive_update") {
    const appId = argList[0] ?? "";
    const view = argList[1] ?? "";
    const destination = argList[2] ?? "";
    const appDefinition = getMainPanelAppMetadata(appId);
    const appLabel = appDefinition?.label ?? appId;
    const viewLabel =
      appDefinition?.views.find((item) => item.id === view)?.label ?? view;
    const appDetail = [appLabel, viewLabel].filter(Boolean).join(" / ");
    if (destination) return `${appDetail || "app"} -> ${destination}`;
    return appDetail || args;
  }

  if (type === "agent_image_off") return "hide main image";
  if (type === "agent_image_on") return "show main image";
  if (type === "side_image") {
    const side = argList[0] || "left";
    const mode = (argList[1] || "show").toLowerCase();
    if (["hide", "hidden", "off", "false", "0"].includes(mode)) {
      return `${side} hide`;
    }
    const imagePath =
      argList.length > 2
        ? argList[2]
        : ["show", "on", "visible", "true", "1"].includes(mode)
          ? ""
          : argList[1] || "";
    return [side, imagePath].filter(Boolean).join(" -> ");
  }
  if (type === "interactive_clear") return "";
  return args;
}

export function buildScriptMarker(type: string, args: string[]) {
  const trimmedArgs = args.map((arg) => arg.trim());
  let lastValueIndex = -1;
  for (let index = trimmedArgs.length - 1; index >= 0; index -= 1) {
    if (trimmedArgs[index].length > 0) {
      lastValueIndex = index;
      break;
    }
  }
  if (lastValueIndex < 0) return `[${type}]`;
  return `[${type}: ${trimmedArgs.slice(0, lastValueIndex + 1).join(", ")}]`;
}

export function scriptMarkerEditKeyFrom(start: number, end: number, marker: string) {
  return `${start}:${end}:${marker}`;
}

export function scriptMarkerEditKey(marker: ScriptMarkerInstance) {
  return scriptMarkerEditKeyFrom(marker.start, marker.end, marker.marker);
}

export function parseScriptMarkerInstances(text: string) {
  const markers: ScriptMarkerInstance[] = [];
  const pattern = new RegExp(scriptMarkerParsePattern);

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const marker = match[0];
    const type = (match[1] ?? "").toLowerCase();
    const args = (match[2] ?? "").trim();
    const parsedArgs = parseScriptMarkerArgs(args);
    const { args: argList, linkId, timeMs } =
      splitScriptMarkerTimelineArgs(parsedArgs);
    const visibleArgs = argList.join(", ");
    const spokenBefore = text.slice(0, start).replace(scriptMarkerPattern, " ");
    markers.push({
      args: visibleArgs,
      argList,
      detail: scriptMarkerDetail(type, visibleArgs, argList),
      end: start + marker.length,
      id: `${start}-${marker}`,
      label: scriptMarkerLabel(type),
      linkId,
      marker,
      start,
      timeMs,
      type,
      wordIndex: countScriptWords(spokenBefore),
    });
  }

  return markers;
}

export function spokenScriptText(text: string) {
  return text.replace(scriptMarkerPattern, " ").replace(/\s+/g, " ").trim();
}
