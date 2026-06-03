import type { Experience, ExperienceEvent } from "../types";
import {
  eventDraftFromEvent,
  getSelectedExperienceEvent,
} from "./eventEditorUtils";

export function useSelectedEventPersistence({
  experience,
  lastPersistedEvent,
  selectedEventId,
}: {
  experience: Experience | null;
  lastPersistedEvent: { current: ExperienceEvent | null };
  selectedEventId: string;
}) {
  function getSelectedEventParts() {
    const selectedEvent = getSelectedExperienceEvent(experience, selectedEventId);
    return { selectedEvent };
  }

  function getComparableSelectedEvent() {
    const { selectedEvent } = getSelectedEventParts();
    if (
      selectedEvent &&
      lastPersistedEvent.current?.id === selectedEvent.id
    ) {
      return lastPersistedEvent.current;
    }
    return selectedEvent;
  }

  function persistedDraftForUndo(selectedEvent: ExperienceEvent) {
    return eventDraftFromEvent(
      lastPersistedEvent.current?.id === selectedEvent.id
        ? lastPersistedEvent.current
        : selectedEvent,
    );
  }

  return {
    getComparableSelectedEvent,
    getSelectedEventParts,
    persistedDraftForUndo,
  };
}
