import { useState } from "react";
import type { EventDraft } from "../types";

type EventDraftHistoryOptions = {
  clearStructuralRedo: () => void;
  currentDraft: EventDraft;
  limit: number;
  queueAutosave: (draft: EventDraft) => void;
  setDraft: (draft: EventDraft) => void;
};

function cloneEventDraft(draft: EventDraft) {
  return JSON.parse(JSON.stringify(draft)) as EventDraft;
}

function eventDraftSignature(draft: EventDraft) {
  return JSON.stringify(draft);
}

export function useEventDraftHistory({
  clearStructuralRedo,
  currentDraft,
  limit,
  queueAutosave,
  setDraft,
}: EventDraftHistoryOptions) {
  const [eventRedoStack, setEventRedoStack] = useState<EventDraft[]>([]);
  const [eventUndoStack, setEventUndoStack] = useState<EventDraft[]>([]);

  function clearEventUndoHistory() {
    setEventUndoStack([]);
    setEventRedoStack([]);
  }

  function rememberEventDraftForUndo(draft = currentDraft) {
    clearStructuralRedo();
    const snapshot = cloneEventDraft(draft);
    const snapshotSignature = eventDraftSignature(snapshot);
    setEventUndoStack((current) => {
      if (current[0] && eventDraftSignature(current[0]) === snapshotSignature) {
        return current;
      }
      return [snapshot, ...current].slice(0, limit);
    });
    setEventRedoStack([]);
  }

  function stageEventDraft(nextDraft: EventDraft, recordHistory = true) {
    if (eventDraftSignature(nextDraft) === eventDraftSignature(currentDraft)) {
      return;
    }
    if (recordHistory) {
      rememberEventDraftForUndo();
    }
    const stagedDraft = cloneEventDraft(nextDraft);
    setDraft(stagedDraft);
    queueAutosave(stagedDraft);
  }

  function undoEventEdit() {
    const previousDraft = eventUndoStack[0];
    if (!previousDraft) return;

    setEventUndoStack((current) => current.slice(1));
    setEventRedoStack((current) =>
      [cloneEventDraft(currentDraft), ...current].slice(0, limit),
    );
    const nextDraft = cloneEventDraft(previousDraft);
    setDraft(nextDraft);
    queueAutosave(nextDraft);
  }

  function redoEventEdit() {
    const nextDraft = eventRedoStack[0];
    if (!nextDraft) return;

    setEventRedoStack((current) => current.slice(1));
    setEventUndoStack((current) =>
      [cloneEventDraft(currentDraft), ...current].slice(0, limit),
    );
    const restoredDraft = cloneEventDraft(nextDraft);
    setDraft(restoredDraft);
    queueAutosave(restoredDraft);
  }

  return {
    clearEventUndoHistory,
    eventRedoStack,
    eventUndoStack,
    redoEventEdit,
    rememberEventDraftForUndo,
    stageEventDraft,
    undoEventEdit,
  };
}
