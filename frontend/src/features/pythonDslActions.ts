import {
  defaultGlowColor,
  glowTargetById,
  glowTargetBySelector,
} from "../glowTargets";
import type { EventActionStep } from "../types";

export type PythonDslChatAction = {
  enabled: boolean;
};

export type PythonDslScriptAction = {
  enabled: boolean;
};

export type PythonDslContextAction = {
  key: string;
  value: unknown;
};

export type PythonDslGotoAction = {
  triggersEvent: string;
};

export type PythonDslPanelAction = {
  mode: "open" | "available" | "off";
  panelId: string;
};

export type PythonDslRoadmapCompleteAction = {
  nodeId: string;
};

export type PythonDslGlowOnAction = {
  color: string;
  selector: string;
};

export type PythonDslGlowOffAction = {
  selector: string;
};

export type PythonDslStepAction =
  | ({ actionType: "chat_availability" } & PythonDslChatAction)
  | ({ actionType: "goto_event" } & PythonDslGotoAction)
  | ({ actionType: "highlight_off" } & PythonDslGlowOffAction)
  | ({ actionType: "highlight_on" } & PythonDslGlowOnAction)
  | ({ actionType: "roadmap_complete" } & PythonDslRoadmapCompleteAction)
  | ({ actionType: "script" } & PythonDslScriptAction)
  | ({ actionType: "set_context" } & PythonDslContextAction)
  | ({ actionType: "side_panel" } & PythonDslPanelAction);

function sortedEventActionSteps(steps: EventActionStep[]) {
  return [...steps].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function stripPythonLineComment(line: string) {
  let quote: '"' | "'" | null = null;
  let tripleQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextThree = line.slice(index, index + 3);

    if (tripleQuote) {
      if (nextThree === tripleQuote.repeat(3)) {
        tripleQuote = null;
        index += 2;
      }
      continue;
    }

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (nextThree === "'''" || nextThree === '"""') {
      tripleQuote = char as '"' | "'";
      index += 2;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "#") {
      return line.slice(0, index).trimEnd();
    }
  }

  return line.trimEnd();
}

export function executablePythonDslSource(source: string) {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(stripPythonLineComment)
    .filter((line) => line.trim())
    .join("\n");
}

export function parsePythonDslChatActions(source: string): PythonDslChatAction[] {
  const chatCallPattern =
    /^chat\s*\(\s*(?:enabled\s*=\s*)?(True|False|true|false)\s*\)\s*$/;

  return executablePythonDslSource(source)
    .split("\n")
    .flatMap((line): PythonDslChatAction[] => {
      if (/^\s/.test(line)) return [];

      const match = chatCallPattern.exec(line.trim());
      if (!match) return [];

      return [{ enabled: match[1].toLowerCase() === "true" }];
    });
}

export function parsePythonDslScriptActions(
  source: string,
): PythonDslScriptAction[] {
  const scriptCallPattern = /^script\s*\([^)]*\)\s*$/;

  return executablePythonDslSource(source)
    .split("\n")
    .flatMap((line): PythonDslScriptAction[] => {
      if (/^\s/.test(line)) return [];
      if (!scriptCallPattern.test(line.trim())) return [];

      return [{ enabled: true }];
    });
}

function splitDslArguments(args: string) {
  const values: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let isEscaped = false;

  for (const char of args) {
    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      isEscaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) values.push(current.trim());
  return values;
}

function parseDslValue(value: string | undefined): unknown {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(
        trimmed.startsWith("'")
          ? `"${trimmed.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : trimmed,
      );
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "none" || normalized === "null") return null;

  const numericValue = Number(trimmed);
  if (trimmed && Number.isFinite(numericValue)) return numericValue;

  return trimmed;
}

export function parsePythonDslContextActions(
  source: string,
): PythonDslContextAction[] {
  const setContextCallPattern = /^set_context\s*\((.*)\)\s*$/;

  return executablePythonDslSource(source)
    .split("\n")
    .flatMap((line): PythonDslContextAction[] => {
      if (/^\s/.test(line)) return [];

      const match = setContextCallPattern.exec(line.trim());
      if (!match) return [];

      const namedArgs = new Map<string, string>();
      const positionalArgs: string[] = [];
      splitDslArguments(match[1] ?? "").forEach((arg) => {
        const equalsIndex = arg.indexOf("=");
        if (equalsIndex > 0) {
          namedArgs.set(
            arg.slice(0, equalsIndex).trim(),
            arg.slice(equalsIndex + 1).trim(),
          );
          return;
        }
        positionalArgs.push(arg);
      });

      const key = String(
        parseDslValue(namedArgs.get("key") ?? positionalArgs[0]),
      ).trim();
      if (!key) return [];

      return [
        {
          key,
          value: parseDslValue(namedArgs.get("value") ?? positionalArgs[1]),
        },
      ];
    });
}

function parseDslNamedAndPositionalArgs(args: string) {
  const namedArgs = new Map<string, string>();
  const positionalArgs: string[] = [];
  splitDslArguments(args).forEach((arg) => {
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 0) {
      namedArgs.set(
        arg.slice(0, equalsIndex).trim(),
        arg.slice(equalsIndex + 1).trim(),
      );
      return;
    }
    positionalArgs.push(arg);
  });
  return { namedArgs, positionalArgs };
}

function parseContextActionFromArgs(args: string): PythonDslContextAction | null {
  const { namedArgs, positionalArgs } = parseDslNamedAndPositionalArgs(args);
  const key = String(
    parseDslValue(namedArgs.get("key") ?? positionalArgs[0]),
  ).trim();
  if (!key) return null;

  return {
    key,
    value: parseDslValue(namedArgs.get("value") ?? positionalArgs[1]),
  };
}

function parseGotoActionFromArgs(args: string): PythonDslGotoAction | null {
  const { namedArgs, positionalArgs } = parseDslNamedAndPositionalArgs(args);
  const triggersEvent = String(
    parseDslValue(
      namedArgs.get("destination") ??
        namedArgs.get("target") ??
        namedArgs.get("triggersEvent") ??
        positionalArgs[0],
    ),
  ).trim();
  if (!triggersEvent) return null;

  return { triggersEvent };
}

const sidePanelModes = new Set(["open", "available", "off"]);

function parsePanelActionFromArgs(args: string): PythonDslPanelAction | null {
  const { namedArgs, positionalArgs } = parseDslNamedAndPositionalArgs(args);
  const panelId = String(
    parseDslValue(
      namedArgs.get("id") ?? namedArgs.get("panel") ?? positionalArgs[0],
    ),
  ).trim();
  if (!panelId) return null;

  const rawMode = String(
    parseDslValue(namedArgs.get("mode") ?? positionalArgs[1]),
  )
    .trim()
    .toLowerCase();
  const mode = sidePanelModes.has(rawMode) ? rawMode : "open";
  return { mode: mode as PythonDslPanelAction["mode"], panelId };
}

function parseRoadmapCompleteActionFromArgs(
  args: string,
): PythonDslRoadmapCompleteAction | null {
  const { namedArgs, positionalArgs } = parseDslNamedAndPositionalArgs(args);
  const nodeId = String(
    parseDslValue(
      namedArgs.get("node") ?? namedArgs.get("id") ?? positionalArgs[0],
    ),
  ).trim();
  return nodeId ? { nodeId } : null;
}

function parseGlowTargetFromArgs(args: string) {
  const { namedArgs, positionalArgs } = parseDslNamedAndPositionalArgs(args);
  const targetId = String(
    parseDslValue(namedArgs.get("target") ?? positionalArgs[0]),
  ).trim();
  return { namedArgs, positionalArgs, target: glowTargetById(targetId) };
}

function parseGlowOnActionFromArgs(args: string): PythonDslGlowOnAction | null {
  const { namedArgs, positionalArgs, target } = parseGlowTargetFromArgs(args);
  if (!target) return null;

  const color = String(
    parseDslValue(namedArgs.get("color") ?? positionalArgs[1]),
  ).trim();
  return { color: color || defaultGlowColor, selector: target.selector };
}

function parseGlowOffActionFromArgs(
  args: string,
): PythonDslGlowOffAction | null {
  const { target } = parseGlowTargetFromArgs(args);
  return target ? { selector: target.selector } : null;
}

export function parsePythonDslGotoActions(source: string): PythonDslGotoAction[] {
  const gotoCallPattern = /^(?:goto_event|goto)\s*\((.*)\)\s*$/;

  return executablePythonDslSource(source)
    .split("\n")
    .flatMap((line): PythonDslGotoAction[] => {
      if (/^\s/.test(line)) return [];

      const match = gotoCallPattern.exec(line.trim());
      if (!match) return [];

      const action = parseGotoActionFromArgs(match[1] ?? "");
      return action ? [action] : [];
    });
}

export function parsePythonDslStepActions(source: string): PythonDslStepAction[] {
  const chatCallPattern =
    /^chat\s*\(\s*(?:enabled\s*=\s*)?(True|False|true|false)\s*\)\s*$/;
  const scriptCallPattern = /^script\s*\([^)]*\)\s*$/;
  const setContextCallPattern = /^set_context\s*\((.*)\)\s*$/;
  const gotoCallPattern = /^(?:goto_event|goto)\s*\((.*)\)\s*$/;
  const panelCallPattern = /^panel\s*\((.*)\)\s*$/;
  const roadmapCompleteCallPattern = /^roadmap_complete\s*\((.*)\)\s*$/;
  const glowOffCallPattern = /^glow_off\s*\((.*)\)\s*$/;
  const glowCallPattern = /^glow\s*\((.*)\)\s*$/;

  return executablePythonDslSource(source)
    .split("\n")
    .flatMap((line): PythonDslStepAction[] => {
      if (/^\s/.test(line)) return [];

      const trimmed = line.trim();
      const chatMatch = chatCallPattern.exec(trimmed);
      if (chatMatch) {
        return [
          {
            actionType: "chat_availability",
            enabled: chatMatch[1].toLowerCase() === "true",
          },
        ];
      }

      if (scriptCallPattern.test(trimmed)) {
        return [{ actionType: "script", enabled: true }];
      }

      const contextMatch = setContextCallPattern.exec(trimmed);
      if (contextMatch) {
        const action = parseContextActionFromArgs(contextMatch[1] ?? "");
        return action ? [{ actionType: "set_context", ...action }] : [];
      }

      const gotoMatch = gotoCallPattern.exec(trimmed);
      if (gotoMatch) {
        const action = parseGotoActionFromArgs(gotoMatch[1] ?? "");
        return action ? [{ actionType: "goto_event", ...action }] : [];
      }

      const panelMatch = panelCallPattern.exec(trimmed);
      if (panelMatch) {
        const action = parsePanelActionFromArgs(panelMatch[1] ?? "");
        return action ? [{ actionType: "side_panel", ...action }] : [];
      }

      const roadmapCompleteMatch = roadmapCompleteCallPattern.exec(trimmed);
      if (roadmapCompleteMatch) {
        const action = parseRoadmapCompleteActionFromArgs(
          roadmapCompleteMatch[1] ?? "",
        );
        return action ? [{ actionType: "roadmap_complete", ...action }] : [];
      }

      const glowOffMatch = glowOffCallPattern.exec(trimmed);
      if (glowOffMatch) {
        const action = parseGlowOffActionFromArgs(glowOffMatch[1] ?? "");
        return action ? [{ actionType: "highlight_off", ...action }] : [];
      }

      const glowMatch = glowCallPattern.exec(trimmed);
      if (glowMatch) {
        const action = parseGlowOnActionFromArgs(glowMatch[1] ?? "");
        return action ? [{ actionType: "highlight_on", ...action }] : [];
      }

      return [];
    });
}

// Disabled script steps project as "# script()" comment lines. Surplus-step
// deletion must stay conservative while any of those are present, because
// commented scripts are invisible to the parser yet still own a step.
export function hasCommentedScriptAction(source: string) {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .some((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("#")) return false;
      return /\bscript\s*\([^)]*\)/.test(trimmed.replace(/^#\s*/, ""));
    });
}

function hasScriptStepContent(step: EventActionStep) {
  const text = step.config.text;
  const deckUrl = step.config.deckUrl;
  return (
    (typeof text === "string" && text.trim().length > 0) ||
    (typeof deckUrl === "string" && deckUrl.trim().length > 0)
  );
}

function glowStepTarget(step: EventActionStep) {
  return glowTargetBySelector(String(step.config.selector ?? ""));
}

function isDslOwnedGlowStep(step: EventActionStep) {
  const source = typeof step.config.source === "string" ? step.config.source : "";
  return Boolean(source) && Boolean(glowStepTarget(step));
}

export function pythonDslSourceFromEventSteps(steps: EventActionStep[]) {
  return sortedEventActionSteps(steps)
    .filter(
      (step) =>
        ((step.actionType === "set_context" ||
          step.actionType === "goto_event" ||
          step.actionType === "side_panel" ||
          step.actionType === "roadmap_complete") &&
          step.config.source !== "next-conversation-dsl") ||
        ((step.actionType === "highlight_on" ||
          step.actionType === "highlight_off") &&
          step.config.source !== "next-conversation-dsl" &&
          isDslOwnedGlowStep(step)) ||
        step.actionType === "chat_availability" ||
        (step.actionType === "script" && hasScriptStepContent(step)),
    )
    .map((step) => {
      if (step.actionType === "script") {
        const source = "script()";
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "set_context") {
        const source = `set_context(key=${JSON.stringify(
          String(step.config.key ?? "context_key"),
        )}, value=${JSON.stringify(step.config.value ?? "")})`;
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "goto_event") {
        const source = `goto_event(destination=${JSON.stringify(
          String(step.config.triggersEvent ?? ""),
        )})`;
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "side_panel") {
        const panelId = JSON.stringify(String(step.config.panelId ?? ""));
        const mode = String(step.config.mode ?? "open");
        const source =
          mode === "open"
            ? `panel(${panelId})`
            : `panel(${panelId}, mode=${JSON.stringify(mode)})`;
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "roadmap_complete") {
        const source = `roadmap_complete(${JSON.stringify(
          String(step.config.nodeId ?? ""),
        )})`;
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "highlight_on") {
        const target = glowStepTarget(step);
        const targetId = JSON.stringify(target?.id ?? "");
        const color = String(step.config.color ?? "").trim();
        const source =
          color && color !== defaultGlowColor
            ? `glow(${targetId}, color=${JSON.stringify(color)})`
            : `glow(${targetId})`;
        return step.enabled ? source : `# ${source}`;
      }

      if (step.actionType === "highlight_off") {
        const target = glowStepTarget(step);
        const source = `glow_off(${JSON.stringify(target?.id ?? "")})`;
        return step.enabled ? source : `# ${source}`;
      }

      const source = `chat(enabled=${step.config.enabled === false ? "False" : "True"})`;
      return step.enabled ? source : `# ${source}`;
    })
    .join("\n");
}
