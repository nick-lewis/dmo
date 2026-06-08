import { useEffect, useRef } from "react";

export type PendingEventAutosave = {
  chatInstructions: string;
  description: string;
  eventId: string;
  title: string;
};

export type PendingOnEntryAutosave = {
  eventId: string;
  source: string;
};

export type PendingConversationAutosave = {
  eventId: string;
  source: string;
};

export type PendingScriptTextAutosave = {
  deckUrl?: string;
  eventId: string;
  stepId: string;
  text?: string;
};

type FlushAutosave = () => Promise<boolean>;

type UseNextEditorAutosaveTimersOptions = {
  delayMs: number;
  flushConversationAutosave: FlushAutosave;
  flushEventAutosave: FlushAutosave;
  flushOnEntryAutosave: FlushAutosave;
  flushScriptTextAutosave: FlushAutosave;
};

export function useNextEditorAutosaveTimers({
  delayMs,
  flushConversationAutosave,
  flushEventAutosave,
  flushOnEntryAutosave,
  flushScriptTextAutosave,
}: UseNextEditorAutosaveTimersOptions) {
  const eventAutosaveTimerRef = useRef<number | null>(null);
  const onEntryAutosaveTimerRef = useRef<number | null>(null);
  const conversationAutosaveTimerRef = useRef<number | null>(null);
  const scriptTextAutosaveTimerRef = useRef<number | null>(null);
  const pendingEventAutosaveRef = useRef<PendingEventAutosave | null>(null);
  const pendingOnEntryAutosaveRef =
    useRef<PendingOnEntryAutosave | null>(null);
  const pendingConversationAutosaveRef =
    useRef<PendingConversationAutosave | null>(null);
  const pendingScriptTextAutosaveRef =
    useRef<PendingScriptTextAutosave | null>(null);
  const flushEventAutosaveRef = useRef(flushEventAutosave);
  const flushOnEntryAutosaveRef = useRef(flushOnEntryAutosave);
  const flushConversationAutosaveRef = useRef(flushConversationAutosave);
  const flushScriptTextAutosaveRef = useRef(flushScriptTextAutosave);

  useEffect(() => {
    flushEventAutosaveRef.current = flushEventAutosave;
    flushOnEntryAutosaveRef.current = flushOnEntryAutosave;
    flushConversationAutosaveRef.current = flushConversationAutosave;
    flushScriptTextAutosaveRef.current = flushScriptTextAutosave;
  });

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimerRef.current) return;

    window.clearTimeout(eventAutosaveTimerRef.current);
    eventAutosaveTimerRef.current = null;
  }

  function clearOnEntryAutosaveTimer() {
    if (!onEntryAutosaveTimerRef.current) return;

    window.clearTimeout(onEntryAutosaveTimerRef.current);
    onEntryAutosaveTimerRef.current = null;
  }

  function clearConversationAutosaveTimer() {
    if (!conversationAutosaveTimerRef.current) return;

    window.clearTimeout(conversationAutosaveTimerRef.current);
    conversationAutosaveTimerRef.current = null;
  }

  function clearScriptTextAutosaveTimer() {
    if (!scriptTextAutosaveTimerRef.current) return;

    window.clearTimeout(scriptTextAutosaveTimerRef.current);
    scriptTextAutosaveTimerRef.current = null;
  }

  function clearNextEditorAutosaveTimers() {
    clearEventAutosaveTimer();
    clearOnEntryAutosaveTimer();
    clearConversationAutosaveTimer();
    clearScriptTextAutosaveTimer();
  }

  function scheduleEventAutosave() {
    clearEventAutosaveTimer();
    eventAutosaveTimerRef.current = window.setTimeout(() => {
      void flushEventAutosaveRef.current();
    }, delayMs);
  }

  function scheduleOnEntryAutosave() {
    clearOnEntryAutosaveTimer();
    onEntryAutosaveTimerRef.current = window.setTimeout(() => {
      void flushOnEntryAutosaveRef.current();
    }, delayMs);
  }

  function scheduleConversationAutosave() {
    clearConversationAutosaveTimer();
    conversationAutosaveTimerRef.current = window.setTimeout(() => {
      void flushConversationAutosaveRef.current();
    }, delayMs);
  }

  function scheduleScriptTextAutosave() {
    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosaveRef.current();
    }, delayMs);
  }

  return {
    clearConversationAutosaveTimer,
    clearEventAutosaveTimer,
    clearNextEditorAutosaveTimers,
    clearOnEntryAutosaveTimer,
    clearScriptTextAutosaveTimer,
    pendingConversationAutosaveRef,
    pendingEventAutosaveRef,
    pendingOnEntryAutosaveRef,
    pendingScriptTextAutosaveRef,
    scheduleConversationAutosave,
    scheduleEventAutosave,
    scheduleOnEntryAutosave,
    scheduleScriptTextAutosave,
  };
}
