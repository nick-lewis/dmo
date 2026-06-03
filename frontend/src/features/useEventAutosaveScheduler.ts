import { useEffect, useRef } from "react";

import type { EventDraft } from "../types";

export function useEventAutosaveScheduler({
  currentDraft,
  delayMs,
  hasChanges,
  persist,
}: {
  currentDraft: EventDraft;
  delayMs: number;
  hasChanges: (draft: EventDraft) => boolean;
  persist: (
    draft: EventDraft,
    version: number,
    isCurrentVersion: (version: number) => boolean,
  ) => Promise<boolean>;
}) {
  const eventAutosaveTimer = useRef<number | null>(null);
  const eventAutosaveVersion = useRef(0);
  const eventAutosaveInFlight = useRef<Promise<boolean> | null>(null);

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimer.current) return;
    window.clearTimeout(eventAutosaveTimer.current);
    eventAutosaveTimer.current = null;
  }

  function nextEventAutosaveVersion() {
    eventAutosaveVersion.current += 1;
    return eventAutosaveVersion.current;
  }

  function isCurrentEventAutosaveVersion(version: number) {
    return eventAutosaveVersion.current === version;
  }

  async function runEventAutosave(draft: EventDraft, version: number) {
    const persistPromise = persist(draft, version, isCurrentEventAutosaveVersion);
    eventAutosaveInFlight.current = persistPromise;
    const didSave = await persistPromise;
    if (eventAutosaveInFlight.current === persistPromise) {
      eventAutosaveInFlight.current = null;
    }
    return didSave;
  }

  function queueEventAutosave(draft: EventDraft) {
    clearEventAutosaveTimer();

    if (!draft.title.trim() || !hasChanges(draft)) return;

    const version = nextEventAutosaveVersion();
    eventAutosaveTimer.current = window.setTimeout(() => {
      eventAutosaveTimer.current = null;
      void runEventAutosave(draft, version);
    }, delayMs);
  }

  async function flushEventAutosave() {
    clearEventAutosaveTimer();

    if (eventAutosaveInFlight.current) {
      const didSaveInFlight = await eventAutosaveInFlight.current;
      if (!didSaveInFlight) return false;
    }

    if (!hasChanges(currentDraft)) return true;

    const version = nextEventAutosaveVersion();
    return runEventAutosave(currentDraft, version);
  }

  useEffect(() => {
    return () => {
      clearEventAutosaveTimer();
    };
  }, []);

  return {
    clearEventAutosaveTimer,
    flushEventAutosave,
    queueEventAutosave,
  };
}
