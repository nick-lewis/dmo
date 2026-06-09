import { defaultChoiceIconPath } from "../tutorAssets";
import type { EventConversationChoice } from "../types";

function conversationChoiceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `conversation-choice-${crypto.randomUUID()}`;
  }

  return `conversation-choice-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

export function sortedConversationChoices(choices: EventConversationChoice[]) {
  return [...choices].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

export function dslStringLiteral(value: string) {
  return JSON.stringify(value);
}

export function conversationChoiceDslSourceFromChoices(
  choices: EventConversationChoice[],
) {
  return sortedConversationChoices(choices)
    .map(
      (choice) =>
        `button(text=${dslStringLiteral(choice.label || "Continue")}, destination=${dslStringLiteral(
          choice.triggersEvent || "",
        )}, icon=${choice.iconPath ? "True" : "False"})`,
    )
    .join("\n");
}

export function splitDslArguments(args: string) {
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

export function parseDslValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      if (trimmed.startsWith('"')) return JSON.parse(trimmed);

      const jsonBody = trimmed
        .slice(1, -1)
        .replace(/\\(.)|"/g, (match, escapedChar: string | undefined) => {
          if (escapedChar === "'") return "'";
          if (escapedChar !== undefined) return match;
          return '\\"';
        });
      return JSON.parse(`"${jsonBody}"`);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

export function parseDslBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return fallback;
}

export function conversationChoicesFromDslSource(
  source: string,
  existingChoices: EventConversationChoice[],
) {
  const existingSorted = sortedConversationChoices(existingChoices);
  const choices: EventConversationChoice[] = [];

  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^(?:button|choice)\s*\((.*)\)\s*$/);
    const existingChoice = existingSorted[choices.length];
    if (!match) {
      if (
        (trimmed.includes("button") || trimmed.includes("choice")) &&
        existingChoice
      ) {
        choices.push({ ...existingChoice, sortOrder: choices.length });
      }
      return;
    }

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

    const label = String(
      parseDslValue(
        namedArgs.get("text") ??
          namedArgs.get("label") ??
          positionalArgs[0] ??
          existingChoice?.label ??
          "Continue",
      ),
    ).trim();
    const destination = String(
      parseDslValue(
        namedArgs.get("destination") ??
          namedArgs.get("target") ??
          namedArgs.get("triggersEvent") ??
          positionalArgs[1] ??
          existingChoice?.triggersEvent ??
          "",
      ),
    ).trim();
    const hasIcon = parseDslBoolean(
      namedArgs.get("icon"),
      Boolean(existingChoice?.iconPath),
    );

    choices.push({
      enabled: existingChoice?.enabled ?? true,
      iconPath: hasIcon
        ? existingChoice?.iconPath || defaultChoiceIconPath
        : "",
      id: existingChoice?.id ?? conversationChoiceId(),
      label: label || "Continue",
      sortOrder: choices.length,
      triggersEvent: destination,
    });
  });

  return choices;
}
