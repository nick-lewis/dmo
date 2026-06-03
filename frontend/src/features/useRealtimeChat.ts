import {
  type Dispatch,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import {
  DluRealtimeConnection,
  type RealtimeModelId,
  type RealtimeStatus,
  type RealtimeToolCall,
  type RealtimeVoiceId,
} from "../realtime";
import { apiFetch } from "../api";
import type {
  ChatMessage,
  ConversationCheckPayload,
  ExperienceEvent,
  RuntimeUiState,
  StartEventPayload,
  TutoringSession,
} from "../types";

function localMessageId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => left.sequence - right.sequence);
}

type UseRealtimeChatOptions = {
  applyRuntimeActions: (actions: Array<Record<string, unknown>>) => void;
  conversationChoiceActionsFromRanEvents: (
    ranEvents?: ExperienceEvent[],
    event?: ExperienceEvent,
  ) => Array<Record<string, unknown>>;
  currentRuntimeUiState: () => RuntimeUiState;
  queueScriptMessages: (
    session: TutoringSession,
    messages?: ChatMessage[],
    deferredActions?: Array<Record<string, unknown>>,
  ) => void;
  selectedModel: RealtimeModelId;
  selectedVoice: RealtimeVoiceId;
  session: TutoringSession | null;
  setChatError: (value: string) => void;
  setChatStatus: (value: "loading" | "ready" | "error") => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  setSession: Dispatch<SetStateAction<TutoringSession | null>>;
  setTurnAnchorMessageId: (messageId: string) => void;
};

export function useRealtimeChat({
  applyRuntimeActions,
  conversationChoiceActionsFromRanEvents,
  currentRuntimeUiState,
  queueScriptMessages,
  selectedModel,
  selectedVoice,
  session,
  setChatError,
  setChatStatus,
  setMessages,
  setRealtimeStatus,
  setSession,
  setTurnAnchorMessageId,
}: UseRealtimeChatOptions) {
  const realtimeConnectionRef = useRef<DluRealtimeConnection | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  function closeRealtimeConnection(reason?: RealtimeStatus) {
    realtimeConnectionRef.current?.close(reason);
    realtimeConnectionRef.current = null;
  }

  async function getRealtimeConnection(
    activeSession: TutoringSession,
    excludeMessageId?: string,
  ) {
    const currentConnection = realtimeConnectionRef.current;
    if (
      currentConnection?.matches(
        activeSession.id,
        selectedModel,
        selectedVoice,
      )
    ) {
      return currentConnection;
    }

    closeRealtimeConnection();

    const connection = await DluRealtimeConnection.connect(
      {
        fetchClientSecret: ({ sessionId, model, voice }) =>
          apiFetch<unknown>("/api/realtime/client-secret/", {
            method: "POST",
            body: JSON.stringify({ excludeMessageId, sessionId, model, voice }),
          }),
        model: selectedModel,
        sessionId: activeSession.id,
        voice: selectedVoice,
      },
      {
        onError: (message) => {
          setChatError(message);
          setChatStatus("error");
        },
        onStatusChange: setRealtimeStatus,
      },
    );

    realtimeConnectionRef.current = connection;
    return connection;
  }

  async function runChatToolCall(
    activeSession: TutoringSession,
    toolCall: RealtimeToolCall,
  ) {
    closeRealtimeConnection();

    const payload = await apiFetch<StartEventPayload>(
      `/api/sessions/${activeSession.id}/chat-tool/`,
      {
        method: "POST",
        body: JSON.stringify({
          arguments: toolCall.arguments,
          toolCallId: toolCall.callId,
          toolName: toolCall.name,
          uiState: currentRuntimeUiState(),
        }),
      },
    );

    setSession(payload.session);
    setMessages(payload.messages);
    applyRuntimeActions(payload.actions);
    if (payload.ranMessages?.[0]) {
      setTurnAnchorMessageId(payload.ranMessages[0].id);
    }
    queueScriptMessages(
      payload.session,
      payload.ranMessages,
      conversationChoiceActionsFromRanEvents(payload.ranEvents, payload.event),
    );
  }

  async function runConversationChecks(activeSession: TutoringSession) {
    const payload = await apiFetch<ConversationCheckPayload>(
      `/api/sessions/${activeSession.id}/conversation-checks/run/`,
      {
        method: "POST",
        body: JSON.stringify({
          uiState: currentRuntimeUiState(),
        }),
      },
    );

    setSession(payload.session);
    setMessages(payload.messages);
    applyRuntimeActions(payload.actions);

    if (payload.handled) {
      closeRealtimeConnection();
      if (payload.ranMessages?.[0]) {
        setTurnAnchorMessageId(payload.ranMessages[0].id);
      }
      queueScriptMessages(
        payload.session,
        payload.ranMessages,
        conversationChoiceActionsFromRanEvents(payload.ranEvents),
      );
    }

    return {
      handled: payload.handled,
      session: payload.session,
    };
  }

  async function saveSessionMessage(
    activeSession: TutoringSession,
    content: string,
    role: ChatMessage["role"] = "user",
    metadata: Record<string, unknown> = {},
  ) {
    return apiFetch<{
      session: TutoringSession;
      message: ChatMessage;
    }>(`/api/sessions/${activeSession.id}/messages/`, {
      method: "POST",
      body: JSON.stringify({ content, metadata, role }),
    });
  }

  async function sendChatMessage(content: string) {
    if (!session || isSendingMessage) return;

    setIsSendingMessage(true);
    setChatError("");

    let pendingAssistantId = "";

    try {
      const payload = await saveSessionMessage(session, content);
      let activeSession = payload.session;
      setSession(activeSession);
      setMessages((current) => sortMessages([...current, payload.message]));
      setTurnAnchorMessageId(payload.message.id);
      setChatStatus("ready");

      const checkResult = await runConversationChecks(activeSession);
      activeSession = checkResult.session;
      if (checkResult.handled) {
        return;
      }

      const assistantMessageId = localMessageId("assistant");
      pendingAssistantId = assistantMessageId;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        sequence: payload.message.sequence + 0.5,
        createdAt: new Date().toISOString(),
        metadata: {
          model: selectedModel,
          source: "openai-realtime",
          streaming: true,
          voice: selectedVoice,
        },
      };

      setMessages((current) =>
        sortMessages([...current, assistantMessage]),
      );

      const connection = await getRealtimeConnection(
        activeSession,
        payload.message.id,
      );
      const turnResult = await connection.sendUserText(content, (delta) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: `${message.content}${delta}`,
                }
              : message,
          ),
        );
      });

      const finalContent = turnResult.text.trim();
      if (!finalContent && !turnResult.toolCall) {
        const diagnosticsVersion = "realtime-diagnostics-2026-05-30-b";
        const eventSummaries = Array.isArray(turnResult.eventSummaries)
          ? turnResult.eventSummaries
          : [];
        const recentEvents =
          eventSummaries.slice(-12).join(" | ") || "no client events captured";
        console.warn(
          "Realtime turn ended without transcript or tool call.",
          {
            diagnosticsVersion,
            eventSummaries,
            turnResult,
          },
        );
        throw new Error(
          `dLU responded with audio but no text transcript. Diagnostics ${diagnosticsVersion}: ${recentEvents}`,
        );
      }

      let nextActiveSession = activeSession;
      if (finalContent) {
        const assistantPayload = await saveSessionMessage(
          activeSession,
          finalContent,
          "assistant",
          {
            model: selectedModel,
            source: "openai-realtime",
            voice: selectedVoice,
          },
        );
        nextActiveSession = assistantPayload.session;
        setSession(assistantPayload.session);
        setMessages((current) =>
          sortMessages(
            current.map((message) =>
              message.id === assistantMessageId
                ? assistantPayload.message
                : message,
            ),
          ),
        );
      } else {
        setMessages((current) =>
          current.filter((message) => message.id !== assistantMessageId),
        );
      }

      if (turnResult.toolCall) {
        await runChatToolCall(nextActiveSession, turnResult.toolCall);
      }
    } catch (error) {
      closeRealtimeConnection("error");
      const detail =
        error instanceof Error ? error.message : "Could not get a dLU response.";
      setChatStatus("error");
      setChatError(detail);
      if (pendingAssistantId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  role: message.content ? "assistant" : "error",
                  content: message.content || detail,
                  metadata: {
                    ...message.metadata,
                    error: detail,
                    streaming: false,
                  },
                }
              : message,
          ),
        );
      }
      throw error;
    } finally {
      setIsSendingMessage(false);
    }
  }

  return {
    closeRealtimeConnection,
    isSendingMessage,
    sendChatMessage,
  };
}
