import { useRef } from "react";

import type { RuntimeInteractive } from "../mainPanelApps";
import { apiFetch } from "../api";
import type {
  ChatMessage,
  ExperienceEvent,
  InteractiveRuntimePayload,
  TutoringSession,
} from "../types";

type RuntimeInteractivePersistenceOptions = {
  applyRuntimeActions: (actions: Array<Record<string, unknown>>) => void;
  conversationChoiceActionsFromRanEvents: (
    ranEvents?: ExperienceEvent[],
  ) => Array<Record<string, unknown>>;
  queueScriptMessages: (
    session: TutoringSession,
    messages?: ChatMessage[],
    deferredActions?: Array<Record<string, unknown>>,
  ) => void;
  runtimeInteractive: RuntimeInteractive | null;
  runtimeInteractiveState: Record<string, unknown>;
  session: TutoringSession | null;
  setChatError: (value: string) => void;
  setChatStatus: (value: "loading" | "ready" | "error") => void;
  setMessages: (messages: ChatMessage[]) => void;
  setRuntimeInteractiveState: (state: Record<string, unknown>) => void;
  setSession: (session: TutoringSession) => void;
  setTurnAnchorMessageId: (messageId: string) => void;
};

export function useRuntimeInteractivePersistence({
  applyRuntimeActions,
  conversationChoiceActionsFromRanEvents,
  queueScriptMessages,
  runtimeInteractive,
  runtimeInteractiveState,
  session,
  setChatError,
  setChatStatus,
  setMessages,
  setRuntimeInteractiveState,
  setSession,
  setTurnAnchorMessageId,
}: RuntimeInteractivePersistenceOptions) {
  const interactiveSaveTimerRef = useRef<number | null>(null);
  const interactiveSaveVersionRef = useRef(0);

  function clearInteractiveSaveTimer() {
    if (interactiveSaveTimerRef.current !== null) {
      window.clearTimeout(interactiveSaveTimerRef.current);
      interactiveSaveTimerRef.current = null;
    }
  }

  async function persistRuntimeInteractiveState(
    interactiveId: string,
    nextState: Record<string, unknown>,
    context: Record<string, unknown> = {},
    actions: Array<Record<string, unknown>> = [],
  ) {
    if (!session || !interactiveId) return false;

    const version = interactiveSaveVersionRef.current + 1;
    interactiveSaveVersionRef.current = version;

    try {
      const payload = await apiFetch<InteractiveRuntimePayload>(
        `/api/sessions/${session.id}/interactive/`,
        {
          method: "POST",
          body: JSON.stringify({
            actions,
            context,
            interactiveId,
            state: nextState,
          }),
        },
      );

      if (interactiveSaveVersionRef.current !== version) return;

      setSession(payload.session);
      setMessages(payload.messages);
      applyRuntimeActions(payload.actions);
      if (payload.ranMessages?.[0]) {
        setTurnAnchorMessageId(payload.ranMessages[0].id);
      }
      queueScriptMessages(
        payload.session,
        payload.ranMessages,
        conversationChoiceActionsFromRanEvents(payload.ranEvents),
      );
      return true;
    } catch (error) {
      if (interactiveSaveVersionRef.current !== version) return false;

      setChatStatus("error");
      setChatError(
        error instanceof Error
          ? error.message
          : "Could not save the main-panel app state.",
      );
      return false;
    }
  }

  function queueRuntimeInteractiveSave(nextState: Record<string, unknown>) {
    if (!runtimeInteractive) return;

    const interactiveId = runtimeInteractive.interactiveId;
    clearInteractiveSaveTimer();
    interactiveSaveTimerRef.current = window.setTimeout(() => {
      interactiveSaveTimerRef.current = null;
      void persistRuntimeInteractiveState(interactiveId, nextState);
    }, 350);
  }

  function changeRuntimeInteractiveState(nextState: Record<string, unknown>) {
    setRuntimeInteractiveState(nextState);
    queueRuntimeInteractiveSave(nextState);
  }

  async function saveRuntimeInteractiveContext(
    values: Record<string, unknown>,
    state = runtimeInteractiveState,
  ) {
    if (!runtimeInteractive) return;
    clearInteractiveSaveTimer();
    await persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      state,
      values,
    );
  }

  function emitRuntimeInteractiveActions(
    actions: Array<Record<string, unknown>>,
    state = runtimeInteractiveState,
  ) {
    if (!runtimeInteractive || !actions.length) return;
    clearInteractiveSaveTimer();
    void persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      state,
      {},
      actions,
    );
  }

  return {
    changeRuntimeInteractiveState,
    clearInteractiveSaveTimer,
    emitRuntimeInteractiveActions,
    persistRuntimeInteractiveState,
    saveRuntimeInteractiveContext,
  };
}
