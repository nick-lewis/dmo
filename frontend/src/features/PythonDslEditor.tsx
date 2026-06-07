import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { indentWithTab, redo, toggleLineComment, undo } from "@codemirror/commands";
import { pythonLanguage } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

type PythonDslEditorProps = {
  ariaLabel: string;
  eventTargets?: PythonDslEventTarget[];
  mode?: PythonDslEditorMode;
  onChange: (value: string) => void;
  onOpenScriptAction?: (action: PythonDslScriptAction) => void;
  value: string;
};

type PythonDslEditorMode = "on-entry" | "conversation";

export type PythonDslScriptAction = {
  actionIndex: number;
  from: number;
  lineNumber: number;
  source: string;
  to: number;
};

type PythonDslChatAction = {
  enabled: boolean;
  from: number;
  lineNumber: number;
  source: string;
  to: number;
};

type PythonDslButtonStringArgument = {
  from: number;
  to: number;
  value: string;
  valueFrom: number;
  valueTo: number;
};

type PythonDslButtonBooleanArgument = {
  from: number;
  to: number;
  value: boolean;
  valueFrom: number;
  valueTo: number;
};

type PythonDslButtonAction = {
  destination?: PythonDslButtonStringArgument;
  from: number;
  icon?: PythonDslButtonBooleanArgument;
  lineNumber: number;
  source: string;
  to: number;
};

type PythonDslDestinationAction = {
  destination?: PythonDslButtonStringArgument;
  from: number;
  lineNumber: number;
  source: string;
  to: number;
};

export type PythonDslEventTarget = {
  description?: string;
  id: string;
  slug?: string;
  title: string;
};

type DslContextMenuState = {
  chatTarget?: PythonDslChatAction;
  insertionPoint: DslInsertionPoint;
  mode: PythonDslEditorMode;
  x: number;
  y: number;
};

type DslButtonDestinationMenuState = {
  action: PythonDslDestinationAction;
  x: number;
  y: number;
};

type DslInsertionPoint = {
  mode: "append" | "line";
  position: number;
};

const indent = "    ";

const pythonKeywordCompletions: Completion[] = [
  {
    label: "if",
    apply: "if condition:\n    ",
    detail: "condition",
    section: "Python",
    type: "keyword",
  },
  {
    label: "elif",
    apply: "elif condition:\n    ",
    detail: "condition",
    section: "Python",
    type: "keyword",
  },
  {
    label: "else",
    apply: "else:\n    ",
    detail: "condition",
    section: "Python",
    type: "keyword",
  },
  {
    label: "for",
    apply: "for item in items:\n    ",
    detail: "loop",
    section: "Python",
    type: "keyword",
  },
  {
    label: "while",
    apply: "while condition:\n    ",
    detail: "loop",
    section: "Python",
    type: "keyword",
  },
  { label: "and", section: "Python", type: "keyword" },
  { label: "or", section: "Python", type: "keyword" },
  { label: "not", section: "Python", type: "keyword" },
  { label: "True", section: "Python", type: "constant" },
  { label: "False", section: "Python", type: "constant" },
  { label: "None", section: "Python", type: "constant" },
  { label: "pass", section: "Python", type: "keyword" },
  { label: "return", section: "Python", type: "keyword" },
];

const rootDslCompletions: Completion[] = [
  ...pythonKeywordCompletions,
  {
    label: "event",
    detail: "current event",
    info: "Current event data for this On entry script.",
    section: "Runtime",
    type: "variable",
  },
  {
    label: "learner",
    detail: "learner data",
    info: "Learner state available while this event starts.",
    section: "Runtime",
    type: "variable",
  },
  {
    label: "state",
    detail: "experience state",
    info: "Shared experience state for reading and writing values.",
    section: "Runtime",
    type: "variable",
  },
  {
    label: "context",
    detail: "runtime context",
    info: "Runtime context for the current session.",
    section: "Runtime",
    type: "variable",
  },
  {
    label: "goto",
    apply: 'goto_event(destination="event")',
    detail: "route",
    info: "Route to another event.",
    section: "Actions",
    type: "function",
  },
  {
    label: "goto_event",
    apply: 'goto_event(destination="event")',
    detail: "route",
    info: "Route to another event.",
    section: "Actions",
    type: "function",
  },
  {
    label: "chat_on",
    apply: "chat(enabled=True)",
    detail: "chat on",
    displayLabel: "chat on",
    info: "Enable learner typing.",
    section: "Actions",
    type: "function",
  },
  {
    label: "chat_off",
    apply: "chat(enabled=False)",
    detail: "chat off",
    displayLabel: "chat off",
    info: "Disable learner typing.",
    section: "Actions",
    type: "function",
  },
  {
    label: "chat",
    apply: "chat(enabled=True)",
    detail: "availability",
    info: "Set whether the learner can type in chat.",
    section: "Actions",
    type: "function",
  },
  {
    label: "set_context",
    apply: 'set_context(key="entry_ready", value="yes")',
    detail: "context write",
    info: "Store a value in the runtime context.",
    section: "Actions",
    type: "function",
  },
  {
    label: "script",
    apply: "script()",
    detail: "action",
    info: "Open script action details.",
    section: "Actions",
    type: "function",
  },
  {
    label: "say",
    apply: 'say("...")',
    detail: "voice",
    info: "Queue spoken tutor text.",
    section: "Actions",
    type: "function",
  },
  {
    label: "set_state",
    apply: 'set_state("key", value)',
    detail: "state write",
    info: "Store a value in experience state.",
    section: "Actions",
    type: "function",
  },
  {
    label: "get_state",
    apply: 'get_state("key")',
    detail: "state read",
    info: "Read a value from experience state.",
    section: "Actions",
    type: "function",
  },
  {
    label: "choice",
    apply: 'choice("label", target="event_id")',
    detail: "branch",
    info: "Create or expose a branch choice.",
    section: "Actions",
    type: "function",
  },
  {
    label: "emit",
    apply: 'emit("event_name")',
    detail: "signal",
    info: "Emit a named runtime signal.",
    section: "Actions",
    type: "function",
  },
];

const conversationDslCompletions: Completion[] = [
  ...pythonKeywordCompletions,
  {
    label: "button",
    apply: 'button(text="Continue", destination="", icon=True)',
    detail: "conversation action",
    info: "Add a learner button.",
    section: "Conversation",
    type: "function",
  },
  {
    label: "set_context",
    apply: 'set_context(key="conversation_note", value="yes")',
    detail: "context write",
    info: "Store a value in the runtime context.",
    section: "Conversation",
    type: "function",
  },
  {
    label: "goto_event",
    apply: 'goto_event(destination="event")',
    detail: "route",
    info: "Route to another event.",
    section: "Conversation",
    type: "function",
  },
  {
    label: "text",
    apply: 'text="Continue"',
    detail: "button label",
    section: "Button",
    type: "property",
  },
  {
    label: "destination",
    apply: 'destination=""',
    detail: "event destination",
    section: "Route",
    type: "property",
  },
  {
    label: "icon",
    apply: "icon=True",
    detail: "show icon",
    section: "Button",
    type: "property",
  },
  {
    label: "key",
    apply: 'key="context_key"',
    detail: "context key",
    section: "Set context",
    type: "property",
  },
  {
    label: "value",
    apply: 'value="yes"',
    detail: "context value",
    section: "Set context",
    type: "property",
  },
];

const memberCompletions: Record<string, Completion[]> = {
  context: [
    { label: "attempt", detail: "number", section: "context", type: "property" },
    { label: "input", detail: "latest learner input", section: "context", type: "property" },
    { label: "now", detail: "timestamp", section: "context", type: "property" },
    { label: "session_id", detail: "session", section: "context", type: "property" },
  ],
  event: [
    { label: "description", detail: "text", section: "event", type: "property" },
    { label: "id", detail: "id", section: "event", type: "property" },
    { label: "name", detail: "text", section: "event", type: "property" },
    { label: "title", detail: "text", section: "event", type: "property" },
  ],
  learner: [
    { label: "answer", detail: "latest answer", section: "learner", type: "property" },
    { label: "level", detail: "current level", section: "learner", type: "property" },
    { label: "score", detail: "number", section: "learner", type: "property" },
    { label: "streak", detail: "number", section: "learner", type: "property" },
  ],
  state: [
    { label: "clear", apply: 'clear("key")', detail: "delete value", section: "state", type: "method" },
    { label: "get", apply: 'get("key")', detail: "read value", section: "state", type: "method" },
    { label: "has", apply: 'has("key")', detail: "check value", section: "state", type: "method" },
    { label: "set", apply: 'set("key", value)', detail: "write value", section: "state", type: "method" },
  ],
};

const pythonDslHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--dl-purple-s50)", fontWeight: "700" },
  { tag: tags.atom, color: "var(--accent)" },
  { tag: tags.bool, color: "var(--accent)" },
  { tag: tags.number, color: "var(--dl-blue)", fontWeight: "680" },
  { tag: tags.string, color: "var(--dl-secondary-s47)" },
  { tag: tags.comment, color: "var(--muted-ink)", fontStyle: "italic" },
  { tag: tags.definition(tags.variableName), color: "var(--page-ink)", fontWeight: "720" },
  { tag: tags.function(tags.variableName), color: "var(--accent-2)", fontWeight: "720" },
  { tag: tags.operator, color: "color-mix(in srgb, var(--page-ink) 70%, var(--accent-2))" },
  { tag: tags.punctuation, color: "color-mix(in srgb, var(--page-ink) 72%, var(--muted-ink))" },
]);

const pythonDslTheme = EditorView.theme({
  "&": {
    background: "transparent",
    color: "var(--page-ink)",
    minHeight: "260px",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent-soft) 34%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--accent-soft) 42%, transparent)",
    color: "var(--page-ink)",
  },
  ".cm-completionDetail": {
    color: "var(--muted-ink)",
    fontSize: "0.68rem",
  },
  ".cm-completionIcon": {
    opacity: "0.72",
  },
  ".cm-content": {
    caretColor: "var(--accent-2)",
    padding: "10px 0",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent-2)",
  },
  ".cm-focused": {
    outline: "0",
  },
  ".cm-foldGutter span": {
    color: "color-mix(in srgb, var(--muted-ink) 60%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "color-mix(in srgb, var(--page-bg) 72%, var(--panel-bg-strong))",
    borderRight: "1px solid color-mix(in srgb, var(--panel-soft-border) 84%, transparent)",
    color: "color-mix(in srgb, var(--muted-ink) 54%, transparent)",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--accent-2) 16%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--accent-2) 30%, transparent)",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono-font)",
    fontSize: "0.78rem",
    fontWeight: "650",
    lineHeight: "1.6",
    minHeight: "260px",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent-2) 22%, transparent) !important",
  },
  ".cm-tooltip": {
    backgroundColor: "color-mix(in srgb, var(--panel-bg-strong) 98%, white)",
    border: "1px solid color-mix(in srgb, var(--accent-2) 18%, var(--panel-border))",
    borderRadius: "8px",
    boxShadow: "0 16px 44px rgba(22, 74, 92, 0.16)",
    color: "var(--page-ink)",
  },
  ".cm-tooltip-autocomplete ul": {
    fontFamily: "var(--mono-font)",
    fontSize: "0.74rem",
    lineHeight: "1.45",
    maxHeight: "230px",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "4px 8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--accent-soft) 58%, var(--panel-bg-strong))",
    color: "var(--page-ink)",
  },
});

function eventTargetCompletions(
  eventTargets: PythonDslEventTarget[],
  mode: PythonDslEditorMode,
) {
  return eventTargets.map((event): Completion => {
    const label = event.title.trim() || event.slug || event.id;
    const value = mode === "conversation" ? eventTargetValue(event) : event.id;
    return {
      apply: value,
      boost: 20,
      detail: event.slug ? `event: ${event.slug}` : "event",
      info: event.description || event.id,
      label,
      section: "Events",
      type: "constant",
    };
  });
}

function createDslCompletionSource(
  getEventTargets: () => PythonDslEventTarget[],
  mode: PythonDslEditorMode,
) {
  const chatArgumentCompletions: Completion[] = [
    {
      label: "enabled=True",
      detail: "chat on",
      info: "Enable learner typing.",
      section: "Chat",
      type: "constant",
    },
    {
      label: "enabled=False",
      detail: "chat off",
      info: "Disable learner typing.",
      section: "Chat",
      type: "constant",
    },
  ];

  return function dslCompletionSource(
    context: CompletionContext,
  ): CompletionResult | null {
    const eventCompletions = eventTargetCompletions(getEventTargets(), mode);
    const currentLine = context.state.doc.lineAt(context.pos);
    const prefix = currentLine.text.slice(0, context.pos - currentLine.from);
    const routeTargetMatch =
      /(?:\b(?:goto|goto_event)\s*\(\s*["']|\btarget\s*=\s*["']|\bdestination\s*=\s*["']|\btriggersEvent\s*=\s*["'])([^"']*)$/.exec(prefix);
    if (routeTargetMatch && eventCompletions.length) {
      return {
        from: context.pos - routeTargetMatch[1].length,
        options: eventCompletions,
        validFor: /^[^"']*$/,
      };
    }

    if (mode === "conversation") {
      const iconArgumentMatch = /\bicon\s*=\s*([A-Za-z]*)$/.exec(prefix);
      if (iconArgumentMatch) {
        return {
          from: context.pos - iconArgumentMatch[1].length,
          options: [
            { label: "True", section: "Choice", type: "constant" },
            { label: "False", section: "Choice", type: "constant" },
          ],
          validFor: /^[A-Za-z]*$/,
        };
      }
    }

    const chatArgumentMatch = /\bchat\s*\(\s*([A-Za-z_=]*)$/.exec(prefix);
    if (chatArgumentMatch) {
      return {
        from: context.pos - chatArgumentMatch[1].length,
        options: chatArgumentCompletions,
        validFor: /^[A-Za-z_=]*$/,
      };
    }

    const memberMatch = context.matchBefore(/[A-Za-z_]\w*\.(?:[A-Za-z_]\w*)?$/);
    if (memberMatch) {
      const [objectName, memberPrefix = ""] = memberMatch.text.split(".");
      const options = memberCompletions[objectName];
      if (!options) return null;

      return {
        from: memberMatch.to - memberPrefix.length,
        options,
        validFor: /^\w*$/,
      };
    }

    const word = context.matchBefore(/\w*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    return {
      from: word.from,
      options:
        mode === "conversation"
          ? conversationDslCompletions
          : rootDslCompletions,
      validFor: /^\w*$/,
    };
  };
}

function eventTargetValue(event: PythonDslEventTarget) {
  return event.slug || event.id;
}

function isBlockStarter(line: string) {
  return /:\s*(#.*)?$/.test(line) && !line.trimStart().startsWith("#");
}

function isDedentStarter(line: string) {
  return /^(elif|else|except|finally)\b/.test(line);
}

function formatPythonDsl(source: string) {
  const normalized = source.replace(/\t/g, indent).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const formatted: string[] = [];
  let depth = 0;
  let blankCount = 0;

  for (const rawLine of lines) {
    const trimmedRight = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = trimmedRight.trimStart();

    if (!trimmed) {
      blankCount += 1;
      if (blankCount <= 1 && formatted.length) {
        formatted.push("");
      }
      continue;
    }

    blankCount = 0;
    if (isDedentStarter(trimmed)) {
      depth = Math.max(0, depth - 1);
    }

    formatted.push(`${indent.repeat(depth)}${trimmed}`);

    if (isBlockStarter(trimmed)) {
      depth += 1;
    }
  }

  return formatted.join("\n").trimEnd();
}

function formatView(view: EditorView) {
  const source = view.state.doc.toString();
  const formatted = formatPythonDsl(source);
  if (formatted === source) return true;

  view.dispatch({
    changes: { from: 0, insert: formatted, to: source.length },
    scrollIntoView: true,
    selection: { anchor: Math.min(view.state.selection.main.head, formatted.length) },
  });
  return true;
}

function runHistoryShortcut(
  event: globalThis.KeyboardEvent,
  view: EditorView,
) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return false;

  const key = event.key.toLowerCase();
  const command =
    key === "z" && event.shiftKey
      ? redo
      : key === "z"
        ? undo
        : key === "y"
          ? redo
          : null;
  if (!command) return false;

  event.preventDefault();
  event.stopPropagation();
  command(view);
  return true;
}

const chatActionPattern =
  /\bchat\s*\(\s*(?:enabled\s*=\s*)?(True|False|true|false)\s*\)/g;
const scriptActionPattern = /\bscript\s*\([^)]*\)/g;
const setContextActionPattern = /\bset_context\s*\([^)]*\)/g;
const gotoActionPattern = /\b(?:goto_event|goto)\s*\([^)]*\)/g;
const conversationButtonActionPattern = /\b(?:button|choice)\s*\([^)]*\)/g;
const chatActionDecoration = Decoration.mark({
  attributes: {
    "aria-label": "Ctrl-click to toggle chat action",
    role: "button",
  },
  class: "cm-dsl-chat-action",
});
const scriptActionDecoration = Decoration.mark({
  attributes: {
    "aria-label": "Open script action",
    role: "button",
  },
  class: "cm-dsl-script-action",
});
const conversationButtonActionDecoration = Decoration.mark({
  attributes: {
    "aria-label": "Conversation button",
    role: "button",
  },
  class: "cm-dsl-button-action",
});
const setContextActionDecoration = Decoration.mark({
  attributes: {
    "aria-label": "Set context action",
    role: "button",
  },
  class: "cm-dsl-context-action",
});
const gotoActionDecoration = Decoration.mark({
  attributes: {
    "aria-label": "Ctrl-click destination to choose event",
    role: "button",
  },
  class: "cm-dsl-route-action",
});

function dslActionDecorations(
  view: EditorView,
  mode: PythonDslEditorMode,
): DecorationSet {
  const ranges = [];

  for (const visibleRange of view.visibleRanges) {
    let position = visibleRange.from;

    while (position <= visibleRange.to) {
      const line = view.state.doc.lineAt(position);
      const lineText = line.text;
      const trimmed = lineText.trimStart();

      if (!trimmed.startsWith("#")) {
        for (const match of lineText.matchAll(setContextActionPattern)) {
          if (typeof match.index !== "number") continue;
          const from = line.from + match.index;
          const to = from + match[0].length;
          ranges.push(setContextActionDecoration.range(from, to));
        }

        for (const match of lineText.matchAll(gotoActionPattern)) {
          if (typeof match.index !== "number") continue;
          const from = line.from + match.index;
          const to = from + match[0].length;
          ranges.push(gotoActionDecoration.range(from, to));
        }

        if (mode === "conversation") {
          for (const match of lineText.matchAll(
            conversationButtonActionPattern,
          )) {
            if (typeof match.index !== "number") continue;
            const from = line.from + match.index;
            const to = from + match[0].length;
            ranges.push(conversationButtonActionDecoration.range(from, to));
          }
        } else {
          for (const match of lineText.matchAll(chatActionPattern)) {
            if (typeof match.index !== "number") continue;
            const from = line.from + match.index;
            const to = from + match[0].length;
            ranges.push(chatActionDecoration.range(from, to));
          }

          for (const match of lineText.matchAll(scriptActionPattern)) {
            if (typeof match.index !== "number") continue;
            const from = line.from + match.index;
            const to = from + match[0].length;
            ranges.push(scriptActionDecoration.range(from, to));
          }
        }
      }

      if (line.to >= visibleRange.to) break;
      position = line.to + 1;
    }
  }

  return Decoration.set(ranges, true);
}

function dslActionPluginForMode(mode: PythonDslEditorMode) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = dslActionDecorations(view, mode);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = dslActionDecorations(update.view, mode);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function explicitDslActionTarget(
  event: globalThis.MouseEvent | MouseEvent,
  view: EditorView,
  className: string,
) {
  const target = event.target;
  if (!(target instanceof Element)) return null;

  const actionTarget = target.closest(`.${className}`);
  if (!actionTarget || !view.dom.contains(actionTarget)) return null;

  return actionTarget;
}

function chatActionAtPosition(
  view: EditorView,
  position: number,
): PythonDslChatAction | null {
  const line = view.state.doc.lineAt(position);
  const trimmed = line.text.trimStart();
  if (trimmed.startsWith("#")) return null;

  for (const match of line.text.matchAll(chatActionPattern)) {
    if (typeof match.index !== "number") continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;

    return {
      enabled: match[1].toLowerCase() === "true",
      from,
      lineNumber: line.number,
      source: match[0],
      to,
    };
  }

  return null;
}

function scriptActionAtPosition(
  view: EditorView,
  position: number,
): PythonDslScriptAction | null {
  const line = view.state.doc.lineAt(position);
  const trimmed = line.text.trimStart();
  if (trimmed.startsWith("#")) return null;
  let actionIndex = 0;

  for (let lineNumber = 1; lineNumber < line.number; lineNumber += 1) {
    const precedingLine = view.state.doc.line(lineNumber);
    if (precedingLine.text.trimStart().startsWith("#")) continue;

    actionIndex += Array.from(
      precedingLine.text.matchAll(scriptActionPattern),
    ).length;
  }

  for (const match of line.text.matchAll(scriptActionPattern)) {
    if (typeof match.index !== "number") continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position >= from && position <= to) {
      return {
        actionIndex,
        from,
        lineNumber: line.number,
        source: match[0],
        to,
      };
    }

    actionIndex += 1;
  }

  return null;
}

function parseDestinationArgumentRange(
  source: string,
  actionFrom: number,
  allowPositional = true,
) {
  const destinationMatch =
    /\b(?:destination|target|triggersEvent)\s*=\s*(["'])(.*?)\1/.exec(source);
  if (destinationMatch) {
    const quoteIndex = destinationMatch[0].indexOf(destinationMatch[1]);
    const value = destinationMatch[2];
    const valueFrom =
      actionFrom + destinationMatch.index + quoteIndex + 1;
    return {
      from: actionFrom + destinationMatch.index,
      to: actionFrom + destinationMatch.index + destinationMatch[0].length,
      value,
      valueFrom,
      valueTo: valueFrom + value.length,
    };
  }

  if (!allowPositional) return undefined;

  const positionalDestinationMatch = /\(\s*(["'])(.*?)\1/.exec(source);
  if (!positionalDestinationMatch) return undefined;

  const quoteIndex = positionalDestinationMatch[0].indexOf(
    positionalDestinationMatch[1],
  );
  const value = positionalDestinationMatch[2];
  const valueFrom =
    actionFrom + positionalDestinationMatch.index + quoteIndex + 1;
  return {
    from: actionFrom + positionalDestinationMatch.index,
    to:
      actionFrom +
      positionalDestinationMatch.index +
      positionalDestinationMatch[0].length,
    value,
    valueFrom,
    valueTo: valueFrom + value.length,
  };
}

function parseButtonActionArgumentRanges(
  source: string,
  actionFrom: number,
) {
  const destination = parseDestinationArgumentRange(source, actionFrom, false);

  const iconMatch = /\bicon\s*=\s*(True|False|true|false)\b/.exec(source);
  const icon = iconMatch
    ? (() => {
        const rawValue = iconMatch[1];
        const valueOffset = iconMatch[0].lastIndexOf(rawValue);
        const valueFrom = actionFrom + iconMatch.index + valueOffset;
        return {
          from: actionFrom + iconMatch.index,
          to: actionFrom + iconMatch.index + iconMatch[0].length,
          value: rawValue.toLowerCase() === "true",
          valueFrom,
          valueTo: valueFrom + rawValue.length,
        };
      })()
    : undefined;

  return { destination, icon };
}

function routeActionAtPosition(
  view: EditorView,
  position: number,
): PythonDslDestinationAction | null {
  const line = view.state.doc.lineAt(position);
  const trimmed = line.text.trimStart();
  if (trimmed.startsWith("#")) return null;

  for (const match of line.text.matchAll(gotoActionPattern)) {
    if (typeof match.index !== "number") continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;

    return {
      destination: parseDestinationArgumentRange(match[0], from),
      from,
      lineNumber: line.number,
      source: match[0],
      to,
    };
  }

  return null;
}

function buttonActionAtPosition(
  view: EditorView,
  position: number,
): PythonDslButtonAction | null {
  const line = view.state.doc.lineAt(position);
  const trimmed = line.text.trimStart();
  if (trimmed.startsWith("#")) return null;

  for (const match of line.text.matchAll(conversationButtonActionPattern)) {
    if (typeof match.index !== "number") continue;
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;

    return {
      ...parseButtonActionArgumentRanges(match[0], from),
      from,
      lineNumber: line.number,
      source: match[0],
      to,
    };
  }

  return null;
}

function insertStatementAtCursor(
  view: EditorView,
  statement: string,
  insertionPoint?: DslInsertionPoint,
): PythonDslScriptAction {
  const doc = view.state.doc;
  const point = insertionPoint ?? {
    mode: "append",
    position: view.state.selection.main.from,
  };
  const position = Math.min(Math.max(point.position, 0), doc.length);
  const line = doc.lineAt(position);
  const lineText = line.text;
  const indentation = lineText.match(/^\s*/)?.[0] ?? "";
  const isLineEmpty = lineText.trim().length === 0;
  const isLineInsertion = point.mode === "line";
  const from = isLineInsertion
    ? line.from
    : isLineEmpty
      ? line.from
      : line.to;
  const to = isLineInsertion && isLineEmpty ? line.to : from;
  const insertion = isLineInsertion
    ? `${indentation}${statement}${isLineEmpty ? "" : "\n"}`
    : `${isLineEmpty ? "" : "\n"}${indentation}${statement}`;
  const statementFrom = from + (isLineInsertion || isLineEmpty ? 0 : 1) + indentation.length;
  const statementTo = statementFrom + statement.length;

  view.dispatch({
    changes: { from, insert: insertion, to },
    scrollIntoView: true,
    selection: { anchor: from + insertion.length },
  });
  view.focus();

  const scriptAction = scriptActionAtPosition(view, statementFrom);
  if (scriptAction) return scriptAction;

  return {
    actionIndex: 0,
    from: statementFrom,
    lineNumber: view.state.doc.lineAt(statementFrom).number,
    source: statement,
    to: statementTo,
  };
}

function toggleChatAction(view: EditorView, chatAction: PythonDslChatAction) {
  const statement = chatAction.enabled
    ? "chat(enabled=False)"
    : "chat(enabled=True)";

  view.dispatch({
    changes: { from: chatAction.from, insert: statement, to: chatAction.to },
    scrollIntoView: true,
    selection: { anchor: chatAction.from + statement.length },
  });
  view.focus();
}

function replaceButtonDestination(
  view: EditorView,
  action: PythonDslDestinationAction,
  destination: string,
) {
  if (!action.destination) return;

  view.dispatch({
    changes: {
      from: action.destination.valueFrom,
      insert: destination,
      to: action.destination.valueTo,
    },
    scrollIntoView: true,
    selection: { anchor: action.destination.valueFrom + destination.length },
  });
  view.focus();
}

function toggleButtonIcon(view: EditorView, action: PythonDslButtonAction) {
  if (!action.icon) return;

  const statement = action.icon.value ? "False" : "True";
  view.dispatch({
    changes: {
      from: action.icon.valueFrom,
      insert: statement,
      to: action.icon.valueTo,
    },
    scrollIntoView: true,
    selection: { anchor: action.icon.valueFrom + statement.length },
  });
  view.focus();
}

function contextMenuPosition(
  clientX: number,
  clientY: number,
  width = 196,
  height = 190,
) {
  return {
    x: Math.max(12, Math.min(clientX, window.innerWidth - width)),
    y: Math.max(12, Math.min(clientY, window.innerHeight - height)),
  };
}

function contextMenuInsertionPoint(
  view: EditorView,
  event: { clientX: number; clientY: number },
): { insertionPoint: DslInsertionPoint; position: number | null } {
  const position = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  }, false);
  const doc = view.state.doc;
  const documentBottom = view.documentTop + view.contentHeight;
  const isBelowDocument = event.clientY > documentBottom + 6;
  const clickedLine = isBelowDocument
    ? null
    : doc.lineAt(
        Math.min(
          view.lineBlockAtHeight(event.clientY - view.documentTop).from,
          doc.length,
        ),
      );
  const insertionPoint =
    clickedLine === null
      ? { mode: "append" as const, position: doc.length }
      : { mode: "line" as const, position: clickedLine.from };

  view.dispatch({
    selection: { anchor: insertionPoint.position },
  });
  return { insertionPoint, position };
}

export function PythonDslEditor({
  ariaLabel,
  eventTargets = [],
  mode = "on-entry",
  onChange,
  onOpenScriptAction,
  value,
}: PythonDslEditorProps) {
  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const eventTargetsRef = useRef(eventTargets);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const modeRef = useRef(mode);
  const onOpenScriptActionRef = useRef(onOpenScriptAction);
  const [contextMenu, setContextMenu] = useState<DslContextMenuState | null>(
    null,
  );
  const [buttonDestinationMenu, setButtonDestinationMenu] =
    useState<DslButtonDestinationMenuState | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onOpenScriptActionRef.current = onOpenScriptAction;
  }, [onOpenScriptAction]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    eventTargetsRef.current = eventTargets;
  }, [eventTargets]);

  useEffect(() => {
    if (!contextMenu && !buttonDestinationMenu) return undefined;

    function closeMenu() {
      setContextMenu(null);
      setButtonDestinationMenu(null);
    }

    function closeMenuOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
        setButtonDestinationMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuOnEscape);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuOnEscape);
      window.removeEventListener("resize", closeMenu);
    };
  }, [buttonDestinationMenu, contextMenu]);

  const extensions = useMemo<Extension[]>(
    () => [
      basicSetup,
      pythonLanguage,
      pythonLanguage.data.of({
        autocomplete: createDslCompletionSource(
          () => eventTargetsRef.current,
          mode,
        ),
      }),
      autocompletion({ activateOnTyping: true, closeOnBlur: true }),
      indentUnit.of(indent),
      EditorState.tabSize.of(4),
      syntaxHighlighting(pythonDslHighlightStyle),
      pythonDslTheme,
      dslActionPluginForMode(mode),
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false",
      }),
      EditorView.domEventHandlers({
        keydown(event, view) {
          return runHistoryShortcut(event, view);
        },
        click(event, view) {
          const clickedRouteAction = explicitDslActionTarget(
            event,
            view,
            "cm-dsl-route-action",
          );
          const routePosition = clickedRouteAction
            ? view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              })
            : null;
          const routeAction =
            routePosition === null
              ? null
              : routeActionAtPosition(view, routePosition);
          if (
            routePosition !== null &&
            routeAction?.destination &&
            routePosition >= routeAction.destination.from &&
            routePosition <= routeAction.destination.to &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ selection: { anchor: routePosition } });
            view.focus();
            setContextMenu(null);
            setButtonDestinationMenu({
              action: routeAction,
              ...contextMenuPosition(event.clientX, event.clientY, 292, 280),
            });
            return true;
          }

          if (modeRef.current === "conversation") {
            const clickedButtonAction = explicitDslActionTarget(
              event,
              view,
              "cm-dsl-button-action",
            );
            const buttonPosition = clickedButtonAction
              ? view.posAtCoords({
                  x: event.clientX,
                  y: event.clientY,
                })
              : null;
            const buttonAction =
              buttonPosition === null
                ? null
                : buttonActionAtPosition(view, buttonPosition);

            if (
              buttonPosition === null ||
              !buttonAction ||
              (!event.ctrlKey && !event.metaKey)
            ) {
              return false;
            }

            if (
              buttonAction.icon &&
              buttonPosition >= buttonAction.icon.from &&
              buttonPosition <= buttonAction.icon.to
            ) {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch({ selection: { anchor: buttonPosition } });
              toggleButtonIcon(view, buttonAction);
              setContextMenu(null);
              setButtonDestinationMenu(null);
              return true;
            }

            if (
              buttonAction.destination &&
              buttonPosition >= buttonAction.destination.from &&
              buttonPosition <= buttonAction.destination.to
            ) {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch({ selection: { anchor: buttonPosition } });
              view.focus();
              setContextMenu(null);
              setButtonDestinationMenu({
                action: buttonAction,
                ...contextMenuPosition(event.clientX, event.clientY, 292, 280),
              });
              return true;
            }

            return false;
          }

          const clickedChatAction = explicitDslActionTarget(
            event,
            view,
            "cm-dsl-chat-action",
          );
          const chatPosition = clickedChatAction
            ? view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              })
            : null;
          const chatAction =
            chatPosition === null
              ? null
              : chatActionAtPosition(view, chatPosition);
          if (
            chatPosition !== null &&
            chatAction &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ selection: { anchor: chatPosition } });
            toggleChatAction(view, chatAction);
            setContextMenu(null);
            setButtonDestinationMenu(null);
            return true;
          }

          const clickedScriptAction = explicitDslActionTarget(
            event,
            view,
            "cm-dsl-script-action",
          );
          const scriptPosition = clickedScriptAction
            ? view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
              })
            : null;
          const scriptAction =
            scriptPosition === null
              ? null
              : scriptActionAtPosition(view, scriptPosition);
          if (scriptPosition === null || !scriptAction) return false;

          event.preventDefault();
          event.stopPropagation();
          view.dispatch({ selection: { anchor: scriptPosition } });
          view.focus();
          setButtonDestinationMenu(null);
          onOpenScriptActionRef.current?.(scriptAction);
          return true;
        },
        contextmenu(event, view) {
          event.preventDefault();
          event.stopPropagation();
          const { insertionPoint, position } = contextMenuInsertionPoint(
            view,
            event,
          );
          const clickedChatAction =
            modeRef.current === "conversation"
              ? null
              : explicitDslActionTarget(
                  event,
                  view,
                  "cm-dsl-chat-action",
                );
          const chatAction =
            position === null || !clickedChatAction
              ? null
              : chatActionAtPosition(view, position);
          view.focus();
          setButtonDestinationMenu(null);
          setContextMenu({
            chatTarget: chatAction ?? undefined,
            insertionPoint,
            mode: modeRef.current,
            ...contextMenuPosition(event.clientX, event.clientY),
          });
          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        onChangeRef.current(update.state.doc.toString());
      }),
      keymap.of([
        { key: "Mod-z", run: undo },
        { key: "Mod-Shift-z", run: redo },
        { key: "Mod-y", run: redo },
        { key: "Mod-Shift-f", run: formatView },
        { key: "Mod-/", run: toggleLineComment },
        indentWithTab,
      ]),
    ],
    [ariaLabel, mode],
  );

  useEffect(() => {
    if (!editorParentRef.current) return;

    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: value,
        extensions,
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (value === currentValue) return;

    view.dispatch({
      changes: { from: 0, insert: value, to: currentValue.length },
    });
  }, [value]);

  function insertChatAction(choice: "on" | "off") {
    const view = viewRef.current;
    if (!view) return;

    const statement =
      choice === "on" ? "chat(enabled=True)" : "chat(enabled=False)";
    if (contextMenu?.chatTarget) {
      view.dispatch({
        changes: {
          from: contextMenu.chatTarget.from,
          insert: statement,
          to: contextMenu.chatTarget.to,
        },
        scrollIntoView: true,
        selection: {
          anchor: contextMenu.chatTarget.from + statement.length,
        },
      });
      view.focus();
    } else {
      insertStatementAtCursor(view, statement, contextMenu?.insertionPoint);
    }
    setContextMenu(null);
  }

  function insertScriptAction() {
    const view = viewRef.current;
    if (!view) return;

    const scriptAction = insertStatementAtCursor(
      view,
      "script()",
      contextMenu?.insertionPoint,
    );
    onOpenScriptActionRef.current?.(scriptAction);
    setContextMenu(null);
  }

  function insertSetContextAction() {
    const view = viewRef.current;
    if (!view) return;

    insertStatementAtCursor(
      view,
      'set_context(key="context_key", value="yes")',
      contextMenu?.insertionPoint,
    );
    setContextMenu(null);
    setButtonDestinationMenu(null);
  }

  function insertGotoAction() {
    const view = viewRef.current;
    if (!view) return;

    const destination = eventTargetsRef.current[0]
      ? eventTargetValue(eventTargetsRef.current[0])
      : "";
    insertStatementAtCursor(
      view,
      `goto_event(destination="${destination}")`,
      contextMenu?.insertionPoint,
    );
    setContextMenu(null);
    setButtonDestinationMenu(null);
  }

  function chooseButtonDestination(eventTarget: PythonDslEventTarget) {
    const view = viewRef.current;
    if (!view || !buttonDestinationMenu) return;

    replaceButtonDestination(
      view,
      buttonDestinationMenu.action,
      eventTargetValue(eventTarget),
    );
    setButtonDestinationMenu(null);
  }

  function insertConversationButton() {
    const view = viewRef.current;
    if (!view) return;

    const destination = eventTargetsRef.current[0]
      ? eventTargetValue(eventTargetsRef.current[0])
      : "";
    const statement = `button(text="Continue", destination="${destination}", icon=True)`;
    insertStatementAtCursor(view, statement, contextMenu?.insertionPoint);
    setContextMenu(null);
    setButtonDestinationMenu(null);
  }

  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const view = viewRef.current;
    if (view) {
      const { insertionPoint, position } = contextMenuInsertionPoint(
        view,
        event,
      );
      const clickedChatAction =
        modeRef.current === "conversation"
          ? null
          : explicitDslActionTarget(
              event,
              view,
              "cm-dsl-chat-action",
            );
      const chatAction =
        position === null || !clickedChatAction
          ? null
          : chatActionAtPosition(view, position);
      view.focus();
      setButtonDestinationMenu(null);
      setContextMenu({
        chatTarget: chatAction ?? undefined,
        insertionPoint,
        mode: modeRef.current,
        ...contextMenuPosition(event.clientX, event.clientY),
      });
      return;
    }

    setContextMenu({
      insertionPoint: { mode: "append", position: 0 },
      mode: modeRef.current,
      ...contextMenuPosition(event.clientX, event.clientY),
    });
    setButtonDestinationMenu(null);
  }

  return (
    <div
      className="python-dsl-editor"
      onContextMenu={openContextMenu}
    >
      <div className="python-dsl-codemirror" ref={editorParentRef} />
      {contextMenu ? (
        <div
          className="python-dsl-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.mode === "conversation" ? (
            <>
              <button
                className="python-dsl-context-action python-dsl-context-button"
                onClick={insertConversationButton}
                role="menuitem"
                type="button"
              >
                Button
              </button>
              <button
                className="python-dsl-context-action python-dsl-context-context"
                onClick={insertSetContextAction}
                role="menuitem"
                type="button"
              >
                Set context
              </button>
              <button
                className="python-dsl-context-action python-dsl-context-route"
                onClick={insertGotoAction}
                role="menuitem"
                type="button"
              >
                Go to event
              </button>
            </>
          ) : (
            <>
              <button
                className="python-dsl-context-action python-dsl-context-script"
                onClick={insertScriptAction}
                role="menuitem"
                type="button"
              >
                Script
              </button>
              <button
                className="python-dsl-context-action python-dsl-context-context"
                onClick={insertSetContextAction}
                role="menuitem"
                type="button"
              >
                Set context
              </button>
              <button
                className="python-dsl-context-action python-dsl-context-route"
                onClick={insertGotoAction}
                role="menuitem"
                type="button"
              >
                Go to event
              </button>
              <div className="python-dsl-context-label">
                Chat
              </div>
              <div className="python-dsl-context-options" role="group">
                <button
                  data-chat-state="on"
                  onClick={() => insertChatAction("on")}
                  role="menuitem"
                  type="button"
                >
                  On
                </button>
                <button
                  data-chat-state="off"
                  onClick={() => insertChatAction("off")}
                  role="menuitem"
                  type="button"
                >
                  Off
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {buttonDestinationMenu ? (
        <div
          className="python-dsl-context-menu python-dsl-destination-menu"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{
            left: buttonDestinationMenu.x,
            top: buttonDestinationMenu.y,
          }}
        >
          <div className="python-dsl-context-label">
            Destination
          </div>
          <div className="python-dsl-event-options" role="group">
            {eventTargets.length ? (
              eventTargets.map((eventTarget) => {
                const destinationValue = eventTargetValue(eventTarget);
                const isSelected =
                  buttonDestinationMenu.action.destination?.value ===
                  destinationValue;
                return (
                  <button
                    aria-checked={isSelected}
                    key={eventTarget.id}
                    onClick={() => chooseButtonDestination(eventTarget)}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className="python-dsl-event-option-title">
                      {eventTarget.title.trim() ||
                        eventTarget.slug ||
                        eventTarget.id}
                    </span>
                    <span className="python-dsl-event-option-detail">
                      {destinationValue}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="python-dsl-event-empty">
                No destination events
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
