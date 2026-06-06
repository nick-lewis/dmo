import { eventActionLabel } from "./actionRegistry";
import { parseScriptMarkerInstances } from "./scriptMarkers";
import type {
  ActionSequenceStep,
  EventOutgoingLink,
  ExperienceEvent,
} from "./types";
import {
  conditionRecordSummary,
  stringConfigValue,
} from "./runtimeUtils";


export function isDynamicRouteTarget(value: string) {
  return value.includes("{{");
}


export function eventTargetForRoute(
  events: ExperienceEvent[],
  targetSlug: string,
) {
  return events.find(
    (event) => event.slug === targetSlug || event.id === targetSlug,
  );
}


export function eventListLabel(events: ExperienceEvent[], event: ExperienceEvent) {
  const title = event.title.trim();
  const fallbackLabel = event.slug || event.id;
  const label = title || fallbackLabel;
  const hasDuplicateTitle =
    title.length > 0 &&
    events.filter((candidate) => candidate.title.trim() === title).length > 1;
  if (!hasDuplicateTitle) return label;

  const detail = event.slug || event.id.slice(0, 8);
  return detail ? `${label} (${detail})` : label;
}


export function eventTitleForTrigger(
  events: ExperienceEvent[],
  eventSlug: string,
) {
  const target = eventTargetForRoute(events, eventSlug);
  return target ? eventListLabel(events, target) : eventSlug;
}


export function actionSequenceOutgoingLinks(
  steps: ActionSequenceStep[] = [],
  sourcePrefix = "Action",
) {
  const links: EventOutgoingLink[] = [];
  for (const step of steps) {
    const condition = conditionRecordSummary(step.condition);
    if (step.actionType === "script") {
      const markers = parseScriptMarkerInstances(
        stringConfigValue(step.config, "text"),
      );
      const fallbackDestination = stringConfigValue(
        step.config,
        "triggersEvent",
      ).trim();
      markers.forEach((marker) => {
        if (marker.type !== "interactive" && marker.type !== "interactive_update") {
          return;
        }
        const markerDestination = (marker.argList[2] ?? "").trim();
        const triggersEvent = markerDestination || fallbackDestination;
        if (!triggersEvent) return;
        links.push({
          condition,
          kind: marker.type === "interactive" ? "App submit" : "App update submit",
          slug: triggersEvent,
          source: `${sourcePrefix}: ${step.label || "Script"} / ${
            marker.detail || marker.marker
          }`,
          sourceItemId: step.id,
        });
      });
    }

    if (
      step.actionType !== "set_ui_trigger" &&
      step.actionType !== "goto_event" &&
      step.actionType !== "button_choice" &&
      step.actionType !== "interactive" &&
      step.actionType !== "interactive_update"
    ) {
      continue;
    }
    const triggersEvent = stringConfigValue(step.config, "triggersEvent").trim();
    if (!triggersEvent) continue;
    links.push({
      condition,
      kind: eventActionLabel(step.actionType),
      slug: triggersEvent,
      source: `${sourcePrefix}: ${step.label || eventActionLabel(step.actionType)}`,
      sourceItemId: step.id,
    });
  }
  return links;
}


export function eventOutgoingLinks(event: ExperienceEvent) {
  const links = actionSequenceOutgoingLinks(event.steps, "On entry");
  for (const tool of event.chatTools) {
    const triggersEvent = tool.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition: "function called",
        kind: "FC route",
        slug: triggersEvent,
        source: tool.description || tool.name,
        sourceItemId: tool.id,
      });
    }
    links.push(
      ...actionSequenceOutgoingLinks(tool.handlerActions, `FC route ${tool.name}`),
    );
  }
  for (const check of event.conversationChecks ?? []) {
    const triggersEvent = check.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition: "check matched",
        kind: "Check",
        slug: triggersEvent,
        source: check.title || "Conversation check",
        sourceItemId: check.id,
      });
    }
    links.push(
      ...actionSequenceOutgoingLinks(check.handlerActions, `Check ${check.title}`),
    );
  }
  for (const group of event.classifierGroups ?? []) {
    const triggersEvent = group.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition:
          conditionRecordSummary(group.condition) || "classifier matched",
        kind: "Classifiers",
        slug: triggersEvent,
        source: group.title || "Classifier group",
        sourceItemId: group.id,
      });
    }
    links.push(
      ...actionSequenceOutgoingLinks(group.handlerActions, `Classifiers ${group.title}`),
    );
  }
  for (const choice of event.conversationChoices ?? []) {
    const triggersEvent = choice.triggersEvent.trim();
    if (!triggersEvent) continue;
    links.push({
      condition: "shown after entry",
      kind: "Choice",
      slug: triggersEvent,
      source: choice.label || "Conversation choice",
      sourceItemId: choice.id,
    });
  }
  return links;
}


export function routeKindCounts(links: EventOutgoingLink[]) {
  const counts = new Map<string, number>();
  links.forEach((link) => {
    counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
  });
  return [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}


export function eventTransitionStats(
  events: ExperienceEvent[],
  event: ExperienceEvent,
) {
  const outgoingLinks = eventOutgoingLinks(event);
  const incomingCount = events.reduce((total, candidate) => {
    if (candidate.id === event.id) return total;
    return (
      total +
      eventOutgoingLinks(candidate).filter(
        (link) => link.slug === event.slug || link.slug === event.id,
      ).length
    );
  }, 0);
  const unresolvedCount = outgoingLinks.filter(
    (link) =>
      !isDynamicRouteTarget(link.slug) && !eventTargetForRoute(events, link.slug),
  ).length;

  return {
    incomingCount,
    isUnlinked: !event.isStart && incomingCount === 0,
    outgoingCount: outgoingLinks.length,
    unresolvedCount,
  };
}
