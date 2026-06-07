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

function hasScriptStepContent(step: EventActionStep) {
  const text = step.config.text;
  const deckUrl = step.config.deckUrl;
  return (
    (typeof text === "string" && text.trim().length > 0) ||
    (typeof deckUrl === "string" && deckUrl.trim().length > 0)
  );
}

export function pythonDslSourceFromEventSteps(steps: EventActionStep[]) {
  return sortedEventActionSteps(steps)
    .filter(
      (step) =>
        (step.actionType === "set_context" &&
          step.config.source !== "next-conversation-dsl") ||
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

      const source = `chat(enabled=${step.config.enabled === false ? "False" : "True"})`;
      return step.enabled ? source : `# ${source}`;
    })
    .join("\n");
}
