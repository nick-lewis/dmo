import { useState } from "react";

import type { EventStructuralHistoryItem } from "../types";

export function useEventStructuralHistory({
  limit,
}: {
  limit: number;
}) {
  const [eventStructuralRedoStack, setEventStructuralRedoStack] = useState<
    EventStructuralHistoryItem[]
  >([]);
  const [eventStructuralUndoStack, setEventStructuralUndoStack] = useState<
    EventStructuralHistoryItem[]
  >([]);

  function clearEventStructuralHistory() {
    setEventStructuralUndoStack([]);
    setEventStructuralRedoStack([]);
  }

  function clearEventStructuralRedo() {
    setEventStructuralRedoStack([]);
  }

  function pushEventStructuralUndo(item: EventStructuralHistoryItem) {
    setEventStructuralUndoStack((current) =>
      [item, ...current].slice(0, limit),
    );
    setEventStructuralRedoStack([]);
  }

  function pushEventStructuralRedo(item: EventStructuralHistoryItem) {
    setEventStructuralRedoStack((current) =>
      [item, ...current].slice(0, limit),
    );
  }

  function completeStructuralHistoryMove(
    from: "redo" | "undo",
    opposite: EventStructuralHistoryItem,
  ) {
    if (from === "undo") {
      setEventStructuralUndoStack((current) => current.slice(1));
      pushEventStructuralRedo(opposite);
      return;
    }

    setEventStructuralRedoStack((current) => current.slice(1));
    setEventStructuralUndoStack((current) =>
      [opposite, ...current].slice(0, limit),
    );
  }

  return {
    clearEventStructuralHistory,
    clearEventStructuralRedo,
    completeStructuralHistoryMove,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    pushEventStructuralUndo,
  };
}
