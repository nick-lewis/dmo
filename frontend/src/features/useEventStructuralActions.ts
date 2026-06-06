import type {
  Dispatch,
  SetStateAction,
} from "react";

import { apiFetch } from "../api";
import type {
  EventDraft,
  EventStructuralHistoryItem,
  Experience,
  ExperienceEvent,
} from "../types";
import {
  addExperienceEvent,
  sortedExperienceEvents,
} from "./eventEditorUtils";

export function useEventStructuralActions({
  completeStructuralHistoryMove,
  eventRedoStack,
  eventStructuralRedoStack,
  eventStructuralUndoStack,
  eventUndoStack,
  experience,
  loadScriptAudioItems,
  redoEventEdit,
  resetStructuralEditorState,
  selectedEventId,
  setError,
  setExperience,
  undoEventEdit,
}: {
  completeStructuralHistoryMove: (
    from: "redo" | "undo",
    opposite: EventStructuralHistoryItem,
  ) => void;
  eventRedoStack: EventDraft[];
  eventStructuralRedoStack: EventStructuralHistoryItem[];
  eventStructuralUndoStack: EventStructuralHistoryItem[];
  eventUndoStack: EventDraft[];
  experience: Experience | null;
  loadScriptAudioItems: (experienceId: string, showLoading?: boolean) => Promise<unknown>;
  redoEventEdit: () => void;
  resetStructuralEditorState: (event: ExperienceEvent | null) => void;
  selectedEventId: string;
  setError: Dispatch<SetStateAction<string>>;
  setExperience: Dispatch<SetStateAction<Experience | null>>;
  undoEventEdit: () => void;
}) {
  async function applyStructuralHistoryItem(
    item: EventStructuralHistoryItem,
    from: "redo" | "undo",
  ) {
    if (!experience) return;

    setError("");

    if (item.type === "reorder_events") {
      const previousOrder = sortedExperienceEvents(experience.events).map(
        (event) => event.id,
      );
      const previousSelectedEventId = selectedEventId;

      try {
        const payload = await apiFetch<{ events: ExperienceEvent[] }>(
          `/api/experiences/${experience.id}/events/reorder/`,
          {
            method: "POST",
            body: JSON.stringify({ eventIds: item.eventIdOrder }),
          },
        );
        const nextEvents = sortedExperienceEvents(payload.events);
        const nextSelectedEvent =
          nextEvents.find((event) => event.id === item.selectedEventId) ??
          nextEvents.find((event) => event.id === previousSelectedEventId) ??
          nextEvents[0] ??
          null;

        setExperience({
          ...experience,
          events: nextEvents,
        });
        resetStructuralEditorState(nextSelectedEvent);
        completeStructuralHistoryMove(from, {
          eventIdOrder: previousOrder,
          selectedEventId: previousSelectedEventId,
          type: "reorder_events",
        });
      } catch (reorderError) {
        setError(
          reorderError instanceof Error
            ? reorderError.message
            : "Could not reorder events.",
        );
      }
      return;
    }

    if (item.type === "restore") {
      try {
        const payload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/`,
          {
            method: "POST",
            body: JSON.stringify({ event: item.event }),
          },
        );

        setExperience((current) => {
          if (!current || current.id !== experience.id) return current;
          const baseExperience = payload.event.isStart
            ? {
                ...current,
                events: current.events.map((event) => ({
                  ...event,
                  isStart: false,
                })),
              }
            : current;
          return addExperienceEvent(baseExperience, payload.event);
        });
        resetStructuralEditorState(payload.event);
        completeStructuralHistoryMove(from, {
          event: payload.event,
          type: "delete",
        });
        void loadScriptAudioItems(experience.id, false);
      } catch (restoreError) {
        setError(
          restoreError instanceof Error
            ? restoreError.message
            : "Could not restore event.",
        );
      }
      return;
    }

    if (experience.events.length <= 1) return;

    try {
      const payload = await apiFetch<{ events: ExperienceEvent[] }>(
        `/api/experiences/${experience.id}/events/${item.event.id}/`,
        {
          method: "DELETE",
        },
      );
      const nextEvents = sortedExperienceEvents(payload.events);
      const nextSelectedEvent =
        nextEvents.find((event) => event.isStart) ?? nextEvents[0] ?? null;

      setExperience({
        ...experience,
        events: nextEvents,
      });
      resetStructuralEditorState(nextSelectedEvent);
      completeStructuralHistoryMove(from, {
        event: item.event,
        type: "restore",
      });
      void loadScriptAudioItems(experience.id, false);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event.",
      );
    }
  }

  async function undoStructuralEvent() {
    const undo = eventStructuralUndoStack[0];
    if (!undo) return;
    await applyStructuralHistoryItem(undo, "undo");
  }

  async function redoStructuralEvent() {
    const redo = eventStructuralRedoStack[0];
    if (!redo) return;
    await applyStructuralHistoryItem(redo, "redo");
  }

  function undoEditorHistory() {
    if (eventUndoStack.length) {
      undoEventEdit();
      return;
    }
    void undoStructuralEvent();
  }

  function redoEditorHistory() {
    if (eventRedoStack.length) {
      redoEventEdit();
      return;
    }
    void redoStructuralEvent();
  }

  return {
    redoEditorHistory,
    undoEditorHistory,
  };
}
