import { useEffect, useRef } from "react";

import {
  appendScriptActionHistoryEntry,
  isNativeUndoTarget,
} from "./nextEditorScriptUtils";

type UseScriptActionHistoryOptions = {
  activeStepId: string;
  activeText: string;
  isEnabled: boolean;
  onApplyHistory: (text: string) => void;
};

export function useScriptActionHistory({
  activeStepId,
  activeText,
  isEnabled,
  onApplyHistory,
}: UseScriptActionHistoryOptions) {
  const historyStepIdRef = useRef("");
  const redoStackRef = useRef<string[]>([]);
  const undoStackRef = useRef<string[]>([]);

  useEffect(() => {
    if (historyStepIdRef.current === activeStepId) return;

    historyStepIdRef.current = activeStepId;
    redoStackRef.current = [];
    undoStackRef.current = [];
  }, [activeStepId]);

  function recordHistory(previousText: string, nextText: string) {
    if (!activeStepId || previousText === nextText) return;

    undoStackRef.current = appendScriptActionHistoryEntry(
      undoStackRef.current,
      previousText,
    );
    redoStackRef.current = [];
  }

  function applyHistory(direction: "redo" | "undo") {
    if (!activeStepId) return;

    const sourceStack =
      direction === "undo" ? undoStackRef.current : redoStackRef.current;
    let targetText = sourceStack.pop();
    while (targetText !== undefined && targetText === activeText) {
      targetText = sourceStack.pop();
    }
    if (targetText === undefined) return;

    if (direction === "undo") {
      undoStackRef.current = sourceStack;
      redoStackRef.current = appendScriptActionHistoryEntry(
        redoStackRef.current,
        activeText,
      );
    } else {
      redoStackRef.current = sourceStack;
      undoStackRef.current = appendScriptActionHistoryEntry(
        undoStackRef.current,
        activeText,
      );
    }

    onApplyHistory(targetText);
  }

  useEffect(() => {
    function handleHistoryShortcut(event: globalThis.KeyboardEvent) {
      if (!isEnabled || isNativeUndoTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const isMod = event.ctrlKey || event.metaKey;
      const isRedo =
        isMod &&
        !event.altKey &&
        (key === "y" || (key === "z" && event.shiftKey));
      const isUndo = isMod && !event.altKey && key === "z" && !event.shiftKey;
      if (!isRedo && !isUndo) return;

      const stack = isRedo ? redoStackRef.current : undoStackRef.current;
      if (!stack.length) return;

      event.preventDefault();
      event.stopPropagation();
      applyHistory(isRedo ? "redo" : "undo");
    }

    document.addEventListener("keydown", handleHistoryShortcut);
    return () => document.removeEventListener("keydown", handleHistoryShortcut);
  });

  return { recordHistory };
}
