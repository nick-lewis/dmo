import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";

import { RefreshIcon } from "../components/Icons";
import type { ScriptAudioItem } from "../types";
import {
  displayBreakCount,
  displayBreaksAreEqual,
  displaySlotsAreEqual,
  normalizeDisplayBreaks,
} from "./scriptAudioDisplayUtils";

const displayDocumentHistoryLimit = 80;

export type DisplayDocumentDraft = {
  displayBreaks: number[];
  displaySlots: string[];
};

type DisplayDocumentRead = DisplayDocumentDraft & {
  hasUnslottedWords: boolean;
};

type DisplayDocumentHistoryEntry = DisplayDocumentDraft & {
  selectionOffset: number | null;
};

export function displayTextFromSlots(slots: string[], breaks: number[] = []) {
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(breaks, slots.length).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  const lines = [""];
  slots.forEach((slot, index) => {
    const text = slot.trim();
    if (text) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${text}`.trim();
    }

    for (
      let breakIndex = 0;
      breakIndex < (breakCounts.get(index) ?? 0);
      breakIndex += 1
    ) {
      lines.push("");
    }
  });

  return lines.join("\n").replace(/\n+$/, "");
}

function displayAlignmentWord(value: string) {
  return value.trim().toLocaleLowerCase();
}

function displayDocumentTextFromElement(element: HTMLElement) {
  const blockTags = new Set(["DIV", "LI", "OL", "P", "UL"]);
  let text = "";

  function appendLineBreak() {
    text += "\n";
  }

  function visitNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const childElement = node as HTMLElement;
    if (childElement.classList.contains("next-display-missing-word")) {
      return;
    }

    if (childElement.tagName === "BR") {
      appendLineBreak();
      return;
    }

    const isNestedBlock =
      childElement !== element && blockTags.has(childElement.tagName);
    if (isNestedBlock && text && !text.endsWith("\n")) {
      appendLineBreak();
    }

    Array.from(childElement.childNodes).forEach(visitNode);

    if (isNestedBlock && text && !text.endsWith("\n")) {
      appendLineBreak();
    }
  }

  Array.from(element.childNodes).forEach(visitNode);
  return text.replace(/\u00a0/g, " ").replace(/\n+$/, "");
}

function displayWordsAndBreaksFromText(text: string) {
  const words: string[] = [];
  const breakCountsAfterWord = new Map<number, number>();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, lineIndex) => {
    line
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => words.push(word));

    if (lineIndex < lines.length - 1 && words.length) {
      const wordIndex = words.length - 1;
      breakCountsAfterWord.set(
        wordIndex,
        (breakCountsAfterWord.get(wordIndex) ?? 0) + 1,
      );
    }
  });

  return { breakCountsAfterWord, words };
}

export function displayBreaksFromText(text: string) {
  const { breakCountsAfterWord, words } = displayWordsAndBreaksFromText(text);
  const displayBreaks: number[] = [];

  breakCountsAfterWord.forEach((breakCount, wordIndex) => {
    for (let index = 0; index < breakCount; index += 1) {
      displayBreaks.push(wordIndex);
    }
  });

  return normalizeDisplayBreaks(displayBreaks, words.length);
}

function alignDisplayWordsToBase(displayWords: string[], baseSlots: string[]) {
  const baseWords = baseSlots.map(displayAlignmentWord);
  const nextWords = displayWords.map(displayAlignmentWord);
  const rowCount = baseWords.length + 1;
  const columnCount = nextWords.length + 1;
  const costs = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => Number.POSITIVE_INFINITY),
  );
  const operations = Array.from({ length: rowCount }, () =>
    Array.from(
      { length: columnCount },
      (): "delete" | "insert" | "slot" | "" => "",
    ),
  );

  costs[0][0] = 0;
  for (let index = 1; index < rowCount; index += 1) {
    costs[index][0] = costs[index - 1][0] + 1;
    operations[index][0] = "delete";
  }
  for (let index = 1; index < columnCount; index += 1) {
    costs[0][index] = costs[0][index - 1] + 1.4;
    operations[0][index] = "insert";
  }

  for (let baseIndex = 1; baseIndex < rowCount; baseIndex += 1) {
    for (let wordIndex = 1; wordIndex < columnCount; wordIndex += 1) {
      const isMatch = baseWords[baseIndex - 1] === nextWords[wordIndex - 1];
      const slotCost = costs[baseIndex - 1][wordIndex - 1] + (isMatch ? 0 : 0.85);
      const deleteCost = costs[baseIndex - 1][wordIndex] + 1;
      const insertCost = costs[baseIndex][wordIndex - 1] + 1.4;

      costs[baseIndex][wordIndex] = slotCost;
      operations[baseIndex][wordIndex] = "slot";

      if (deleteCost < costs[baseIndex][wordIndex]) {
        costs[baseIndex][wordIndex] = deleteCost;
        operations[baseIndex][wordIndex] = "delete";
      }

      if (insertCost < costs[baseIndex][wordIndex]) {
        costs[baseIndex][wordIndex] = insertCost;
        operations[baseIndex][wordIndex] = "insert";
      }
    }
  }

  const displaySlots = Array.from({ length: baseSlots.length }, () => "");
  const wordSlotIndexes = Array.from({ length: displayWords.length }, () => -1);
  let baseIndex = baseSlots.length;
  let wordIndex = displayWords.length;

  while (baseIndex > 0 || wordIndex > 0) {
    const operation = operations[baseIndex]?.[wordIndex];
    if (operation === "slot") {
      displaySlots[baseIndex - 1] = displayWords[wordIndex - 1] ?? "";
      wordSlotIndexes[wordIndex - 1] = baseIndex - 1;
      baseIndex -= 1;
      wordIndex -= 1;
      continue;
    }

    if (operation === "delete") {
      displaySlots[baseIndex - 1] = "";
      baseIndex -= 1;
      continue;
    }

    if (operation === "insert") {
      wordIndex -= 1;
      continue;
    }

    break;
  }

  return { displaySlots, wordSlotIndexes };
}

function displayDocumentReadFromElement(
  element: HTMLElement,
  baseSlots: string[],
): DisplayDocumentRead {
  const { breakCountsAfterWord, words } = displayWordsAndBreaksFromText(
    displayDocumentTextFromElement(element),
  );
  const { displaySlots, wordSlotIndexes } = alignDisplayWordsToBase(
    words,
    baseSlots,
  );
  const displayBreaks: number[] = [];

  breakCountsAfterWord.forEach((breakCount, wordIndex) => {
    let slotIndex = wordSlotIndexes[wordIndex] ?? -1;
    for (
      let previousWordIndex = wordIndex - 1;
      slotIndex < 0 && previousWordIndex >= 0;
      previousWordIndex -= 1
    ) {
      slotIndex = wordSlotIndexes[previousWordIndex] ?? -1;
    }

    if (slotIndex < 0 || slotIndex >= baseSlots.length - 1) return;
    for (let index = 0; index < breakCount; index += 1) {
      displayBreaks.push(slotIndex);
    }
  });

  return {
    displayBreaks: normalizeDisplayBreaks(displayBreaks, baseSlots.length),
    displaySlots,
    hasUnslottedWords: wordSlotIndexes.some((slotIndex) => slotIndex < 0),
  };
}

function displayDocumentDraftFromElement(
  element: HTMLElement,
  baseSlots: string[],
): DisplayDocumentDraft {
  const { displayBreaks, displaySlots } = displayDocumentReadFromElement(
    element,
    baseSlots,
  );
  return { displayBreaks, displaySlots };
}

function renderDisplayDocument(
  element: HTMLElement,
  displaySlots: string[],
  displayBreaks: number[],
) {
  const fragment = document.createDocumentFragment();

  displaySlots.forEach((slot, index) => {
    const text = slot.trim();
    if (text) {
      fragment.appendChild(document.createTextNode(text));
    } else {
      const missingWord = document.createElement("span");
      missingWord.className = "next-display-missing-word";
      missingWord.contentEditable = "false";
      missingWord.dataset.slotIndex = String(index);
      missingWord.setAttribute("aria-label", `Missing display word ${index + 1}`);
      fragment.appendChild(missingWord);
    }

    if (index < displaySlots.length - 1) {
      fragment.appendChild(document.createTextNode(" "));
    }

    for (
      let breakIndex = 0;
      breakIndex < displayBreakCount(displayBreaks, index);
      breakIndex += 1
    ) {
      const lineBreak = document.createElement("br");
      lineBreak.className = "next-display-line-break";
      fragment.appendChild(lineBreak);
    }
  });

  element.replaceChildren(fragment);
}

function displayMissingSlotCount(displaySlots: string[]) {
  return displaySlots.filter((slot) => !slot.trim()).length;
}

function displayMissingArtifactCount(element: HTMLElement) {
  return element.querySelectorAll(".next-display-missing-word").length;
}

function cloneDisplayDocumentDraft(
  draft: DisplayDocumentDraft,
): DisplayDocumentDraft {
  return {
    displayBreaks: [...draft.displayBreaks],
    displaySlots: [...draft.displaySlots],
  };
}

function cloneDisplayDocumentHistoryEntry(
  entry: DisplayDocumentHistoryEntry,
): DisplayDocumentHistoryEntry {
  return {
    ...cloneDisplayDocumentDraft(entry),
    selectionOffset: entry.selectionOffset,
  };
}

function displayDocumentDraftFromValues(
  displaySlots: string[],
  displayBreaks: number[],
): DisplayDocumentDraft {
  return {
    displayBreaks: normalizeDisplayBreaks(displayBreaks, displaySlots.length),
    displaySlots: [...displaySlots],
  };
}

function displayDocumentDraftsAreEqual(
  left: DisplayDocumentDraft,
  right: DisplayDocumentDraft,
) {
  return (
    displaySlotsAreEqual(left.displaySlots, right.displaySlots) &&
    displayBreaksAreEqual(left.displayBreaks, right.displayBreaks)
  );
}

function displayDocumentHistoryEntryFromDraft(
  draft: DisplayDocumentDraft,
  selectionOffset: number | null,
): DisplayDocumentHistoryEntry {
  return {
    ...cloneDisplayDocumentDraft(draft),
    selectionOffset,
  };
}

function appendDisplayDocumentHistoryEntry(
  stack: DisplayDocumentHistoryEntry[],
  entry: DisplayDocumentHistoryEntry,
) {
  const previousEntry = stack[stack.length - 1];
  if (previousEntry && displayDocumentDraftsAreEqual(previousEntry, entry)) {
    return stack;
  }

  return [...stack, cloneDisplayDocumentHistoryEntry(entry)].slice(
    -displayDocumentHistoryLimit,
  );
}

function displayDocumentDraftTextLength(draft: DisplayDocumentDraft) {
  return displayTextFromSlots(draft.displaySlots, draft.displayBreaks).length;
}

function displayDocumentSelectionOffset(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.focusNode) return null;
  if (!element.contains(selection.focusNode)) return null;

  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(selection.focusNode, selection.focusOffset);
  } catch {
    return null;
  }

  const selectedFragment = document.createElement("div");
  selectedFragment.appendChild(range.cloneContents());
  return displayDocumentTextFromElement(selectedFragment).length;
}

function setDisplayDocumentSelectionOffset(
  element: HTMLElement,
  targetOffset: number | null,
) {
  if (targetOffset === null) return;

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let remainingOffset = Math.max(0, targetOffset);
  let didPlaceSelection = false;

  function placeSelection(node: Node) {
    if (didPlaceSelection) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = node.textContent?.length ?? 0;
      if (remainingOffset <= textLength) {
        range.setStart(node, remainingOffset);
        range.collapse(true);
        didPlaceSelection = true;
        return;
      }
      remainingOffset -= textLength;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const childElement = node as HTMLElement;
    if (childElement.classList.contains("next-display-missing-word")) {
      return;
    }

    if (childElement.tagName === "BR") {
      if (remainingOffset <= 1) {
        range.setStartAfter(childElement);
        range.collapse(true);
        didPlaceSelection = true;
        return;
      }
      remainingOffset -= 1;
      return;
    }

    Array.from(childElement.childNodes).forEach(placeSelection);
  }

  Array.from(element.childNodes).forEach(placeSelection);

  if (!didPlaceSelection) {
    range.selectNodeContents(element);
    range.collapse(false);
  }

  element.focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertDisplayTextAtSelection(
  element: HTMLElement,
  text: string,
  { allowCollapsed = false }: { allowCollapsed?: boolean } = {},
) {
  const selection = window.getSelection();
  if (
    !selection ||
    (!allowCollapsed && selection.isCollapsed) ||
    !selection.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !element.contains(selection.anchorNode) ||
    !element.contains(selection.focusNode)
  ) {
    return false;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function DisplayTextEditor({
  baseSlots,
  displayBreaks,
  displaySlots,
  isSaving,
  item,
  onChange,
  onReset,
  resetDisabled,
}: {
  baseSlots: string[];
  displayBreaks: number[];
  displaySlots: string[];
  isSaving: boolean;
  item: ScriptAudioItem;
  onChange: (draft: DisplayDocumentDraft) => void;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHistoryDraftRef = useRef<DisplayDocumentDraft | null>(null);
  const redoStackRef = useRef<DisplayDocumentHistoryEntry[]>([]);
  const undoStackRef = useRef<DisplayDocumentHistoryEntry[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement === editor || editor.contains(document.activeElement)) {
      return;
    }
    renderDisplayDocument(editor, displaySlots, displayBreaks);
    lastHistoryDraftRef.current = displayDocumentDraftFromValues(
      displaySlots,
      displayBreaks,
    );
    redoStackRef.current = [];
    undoStackRef.current = [];
  }, [displayBreaks, displaySlots, item.id]);

  if (!displaySlots.length) {
    return <div aria-label="Display Text" className="next-display-text-empty" />;
  }

  function applyDisplayDocumentHistoryEntry(
    element: HTMLElement,
    entry: DisplayDocumentHistoryEntry,
  ) {
    const draft = cloneDisplayDocumentDraft(entry);
    const scrollTop = element.scrollTop;
    const textLength = displayDocumentDraftTextLength(draft);
    const selectionOffset =
      entry.selectionOffset === null
        ? textLength
        : Math.min(entry.selectionOffset, textLength);

    lastHistoryDraftRef.current = cloneDisplayDocumentDraft(draft);
    onChange(draft);
    renderDisplayDocument(element, draft.displaySlots, draft.displayBreaks);
    element.scrollTop = scrollTop;
    setDisplayDocumentSelectionOffset(element, selectionOffset);
  }

  function readDocumentDraft(element: HTMLElement, recordHistory = true) {
    const selectionOffset = displayDocumentSelectionOffset(element);
    const scrollTop = element.scrollTop;
    const documentRead = displayDocumentReadFromElement(element, baseSlots);
    const draft = {
      displayBreaks: documentRead.displayBreaks,
      displaySlots: documentRead.displaySlots,
    };
    const previousDraft =
      lastHistoryDraftRef.current ??
      displayDocumentDraftFromValues(displaySlots, displayBreaks);

    if (
      recordHistory &&
      !displayDocumentDraftsAreEqual(previousDraft, draft)
    ) {
      undoStackRef.current = appendDisplayDocumentHistoryEntry(
        undoStackRef.current,
        displayDocumentHistoryEntryFromDraft(previousDraft, selectionOffset),
      );
      redoStackRef.current = [];
    }

    lastHistoryDraftRef.current = cloneDisplayDocumentDraft(draft);
    onChange(draft);
    if (
      documentRead.hasUnslottedWords ||
      displayMissingArtifactCount(element) !==
      displayMissingSlotCount(draft.displaySlots)
    ) {
      renderDisplayDocument(element, draft.displaySlots, draft.displayBreaks);
      element.scrollTop = scrollTop;
      setDisplayDocumentSelectionOffset(
        element,
        selectionOffset === null
          ? null
          : Math.min(selectionOffset, displayDocumentDraftTextLength(draft)),
      );
    }
    return draft;
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

    const key = event.key.toLocaleLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);

    if (!isUndo && !isRedo) return;

    event.preventDefault();

    const element = event.currentTarget;
    const currentDraft = displayDocumentDraftFromElement(element, baseSlots);
    const currentEntry = displayDocumentHistoryEntryFromDraft(
      currentDraft,
      displayDocumentSelectionOffset(element),
    );

    if (isUndo) {
      let targetEntry = undoStackRef.current.pop();
      while (
        targetEntry &&
        displayDocumentDraftsAreEqual(targetEntry, currentDraft)
      ) {
        targetEntry = undoStackRef.current.pop();
      }

      if (!targetEntry) return;

      redoStackRef.current = appendDisplayDocumentHistoryEntry(
        redoStackRef.current,
        currentEntry,
      );
      applyDisplayDocumentHistoryEntry(element, targetEntry);
      return;
    }

    const targetEntry = redoStackRef.current.pop();
    if (!targetEntry) return;

    undoStackRef.current = appendDisplayDocumentHistoryEntry(
      undoStackRef.current,
      currentEntry,
    );
    applyDisplayDocumentHistoryEntry(element, targetEntry);
  }

  function handleEditorBeforeInput(event: FormEvent<HTMLDivElement>) {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.inputType !== "insertText" ||
      typeof nativeEvent.data !== "string" ||
      !nativeEvent.data
    ) {
      return;
    }

    const element = event.currentTarget;
    if (!insertDisplayTextAtSelection(element, nativeEvent.data)) {
      return;
    }

    event.preventDefault();
    readDocumentDraft(element);
  }

  return (
    <div
      aria-busy={isSaving ? "true" : "false"}
      aria-label="Display Text"
      className="next-display-text-editor"
      onContextMenu={(event) => event.stopPropagation()}
      role="group"
    >
      <button
        aria-label="Reset display text to audio script"
        className="next-display-reset-button"
        disabled={resetDisabled}
        onClick={onReset}
        title="Reset display text to audio script"
        type="button"
      >
        <RefreshIcon />
      </button>
      <div
        aria-label="Display Text document"
        aria-keyshortcuts="Control+Z Control+Y Meta+Z Meta+Y"
        className="next-display-document-editor"
        contentEditable
        onBeforeInput={handleEditorBeforeInput}
        onBlur={(event) => {
          const draft = readDocumentDraft(event.currentTarget, false);
          renderDisplayDocument(
            event.currentTarget,
            draft.displaySlots,
            draft.displayBreaks,
          );
        }}
        onFocus={(event) => {
          lastHistoryDraftRef.current = displayDocumentDraftFromElement(
            event.currentTarget,
            baseSlots,
          );
        }}
        onInput={(event) => readDocumentDraft(event.currentTarget)}
        onKeyDown={handleEditorKeyDown}
        onPaste={(event) => {
          const pastedText = event.clipboardData.getData("text/plain");
          if (!pastedText) return;
          event.preventDefault();
          if (
            insertDisplayTextAtSelection(event.currentTarget, pastedText, {
              allowCollapsed: true,
            })
          ) {
            readDocumentDraft(event.currentTarget);
          }
        }}
        ref={editorRef}
        role="textbox"
        spellCheck
        suppressContentEditableWarning
        tabIndex={0}
      />
    </div>
  );
}
