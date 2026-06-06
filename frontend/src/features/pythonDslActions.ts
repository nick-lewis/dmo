import type { EventActionStep } from "../types";

export type PythonDslChatAction = {
  enabled: boolean;
};

export type PythonDslScriptAction = {
  enabled: boolean;
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
        step.actionType === "chat_availability" ||
        (step.actionType === "script" && hasScriptStepContent(step)),
    )
    .map((step) => {
      if (step.actionType === "script") {
        const source = "script()";
        return step.enabled ? source : `# ${source}`;
      }

      const source = `chat(enabled=${step.config.enabled === false ? "False" : "True"})`;
      return step.enabled ? source : `# ${source}`;
    })
    .join("\n");
}
