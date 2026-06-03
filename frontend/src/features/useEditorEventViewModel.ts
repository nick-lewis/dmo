import { useMemo } from "react";

import { eventActionLabel } from "../actionRegistry";
import { eventTitleForTrigger } from "../eventGraph";
import { stringConfigValue } from "../runtimeUtils";
import type {
  EventDraft,
  Experience,
} from "../types";
import {
  getSelectedExperienceEvent,
  sortedExperienceEvents,
} from "./eventEditorUtils";

export function useEditorEventViewModel({
  eventDraft,
  eventSearch,
  experience,
  selectedEventId,
}: {
  eventDraft: EventDraft;
  eventSearch: string;
  experience: Experience | null;
  selectedEventId: string;
}) {
  const editorEvents = useMemo(
    () => (experience ? sortedExperienceEvents(experience.events) : []),
    [experience],
  );
  const selectedEvent = useMemo(
    () => getSelectedExperienceEvent(experience, selectedEventId),
    [experience, selectedEventId],
  );
  const normalizedEventSearch = eventSearch.trim().toLowerCase();
  const visibleEditorEvents = useMemo(
    () =>
      normalizedEventSearch
        ? editorEvents.filter((event) =>
            [
              event.title,
              event.description,
              event.slug,
            ].some((value) => value.toLowerCase().includes(normalizedEventSearch)),
          )
        : editorEvents,
    [editorEvents, normalizedEventSearch],
  );
  const selectedEventRoutes = useMemo(
    () =>
      eventDraft.steps
        .filter((step) =>
          ["set_ui_trigger", "goto_event", "button_choice"].includes(
            step.actionType,
          ),
        )
        .map((step) => {
          const triggersEvent = stringConfigValue(step.config, "triggersEvent");
          return {
            id: step.id,
            label: eventActionLabel(step.actionType),
            target: eventTitleForTrigger(editorEvents, triggersEvent) || "Choose event",
          };
        })
        .concat(
          eventDraft.chatTools.map((tool) => ({
            id: tool.id,
            label: "FC route",
            target:
              eventTitleForTrigger(editorEvents, tool.triggersEvent) ||
              "Choose event",
          })),
        )
        .concat(
          eventDraft.conversationChecks.map((check) => ({
            id: check.id,
            label: "Check",
            target:
              eventTitleForTrigger(editorEvents, check.triggersEvent) ||
              "Choose event",
          })),
        )
        .concat(
          eventDraft.classifierGroups.map((group) => ({
            id: group.id,
            label: "Classifiers",
            target:
              eventTitleForTrigger(editorEvents, group.triggersEvent) ||
              "No direct route",
          })),
        )
        .concat(
          eventDraft.conversationChoices.map((choice) => ({
            id: choice.id,
            label: "Choice",
            target:
              eventTitleForTrigger(editorEvents, choice.triggersEvent) ||
              "Choose event",
          })),
        ),
    [editorEvents, eventDraft],
  );

  return {
    editorEvents,
    normalizedEventSearch,
    selectedEvent,
    selectedEventRoutes,
    visibleEditorEvents,
  };
}
