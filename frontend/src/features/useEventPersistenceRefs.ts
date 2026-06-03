import { useRef } from "react";

import type { ExperienceEvent } from "../types";

export function useEventPersistenceRefs() {
  const eventStepIdRemap = useRef<Map<string, string>>(new Map());
  const eventToolIdRemap = useRef<Map<string, string>>(new Map());
  const eventCheckIdRemap = useRef<Map<string, string>>(new Map());
  const eventGroupIdRemap = useRef<Map<string, string>>(new Map());
  const eventClassifierIdRemap = useRef<Map<string, string>>(new Map());
  const lastPersistedEvent = useRef<ExperienceEvent | null>(null);

  function setLastPersistedEvent(event: ExperienceEvent | null) {
    lastPersistedEvent.current = event;
  }

  function resolveStepId(stepId: string) {
    return eventStepIdRemap.current.get(stepId) ?? stepId;
  }

  function resolveToolId(toolId: string) {
    return eventToolIdRemap.current.get(toolId) ?? toolId;
  }

  function resolveCheckId(checkId: string) {
    return eventCheckIdRemap.current.get(checkId) ?? checkId;
  }

  function resolveGroupId(groupId: string) {
    return eventGroupIdRemap.current.get(groupId) ?? groupId;
  }

  function resolveClassifierId(groupId: string, classifierId: string) {
    const resolvedGroupId = resolveGroupId(groupId);
    const classifierKey = `${groupId}:${classifierId}`;
    return {
      classifierKey,
      resolvedClassifierId:
        eventClassifierIdRemap.current.get(classifierKey) ?? classifierId,
      resolvedGroupId,
    };
  }

  function forgetStepId(stepId: string) {
    const resolvedStepId = resolveStepId(stepId);
    eventStepIdRemap.current.delete(stepId);
    eventStepIdRemap.current.delete(resolvedStepId);
    return resolvedStepId;
  }

  function forgetToolId(toolId: string) {
    const resolvedToolId = resolveToolId(toolId);
    eventToolIdRemap.current.delete(toolId);
    eventToolIdRemap.current.delete(resolvedToolId);
    return resolvedToolId;
  }

  function forgetCheckId(checkId: string) {
    const resolvedCheckId = resolveCheckId(checkId);
    eventCheckIdRemap.current.delete(checkId);
    eventCheckIdRemap.current.delete(resolvedCheckId);
    return resolvedCheckId;
  }

  function forgetGroupId(groupId: string) {
    const resolvedGroupId = resolveGroupId(groupId);
    eventGroupIdRemap.current.delete(groupId);
    eventGroupIdRemap.current.delete(resolvedGroupId);
    return resolvedGroupId;
  }

  function forgetClassifierId(groupId: string, classifierId: string) {
    const { classifierKey, resolvedClassifierId, resolvedGroupId } =
      resolveClassifierId(groupId, classifierId);
    eventClassifierIdRemap.current.delete(classifierKey);
    eventClassifierIdRemap.current.delete(
      `${resolvedGroupId}:${resolvedClassifierId}`,
    );
    return { resolvedClassifierId, resolvedGroupId };
  }

  return {
    eventCheckIdRemap,
    eventClassifierIdRemap,
    eventGroupIdRemap,
    eventStepIdRemap,
    eventToolIdRemap,
    forgetCheckId,
    forgetClassifierId,
    forgetGroupId,
    forgetStepId,
    forgetToolId,
    lastPersistedEvent,
    resolveCheckId,
    resolveClassifierId,
    resolveGroupId,
    resolveStepId,
    resolveToolId,
    setLastPersistedEvent,
  };
}
