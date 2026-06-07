import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { publicAsset } from "../assets";
import { SendIcon } from "../components/Icons";
import type { RealtimeStatus } from "../realtime";
import {
  displayTextFromScriptAudioMessage,
  scriptAudioSources,
} from "../scriptAudio";
import { choiceIconBackgroundStyle } from "../uiHelpers";
import type {
  ApiUser,
  ChatMessage,
  RuntimeButton,
  RuntimeOverlay,
  RuntimeSideImage,
  TutoringSession,
} from "../types";


type ChatPanelContentProps = {
  assistantName: string;
  avatarPath: string;
  avatarVisible: boolean;
  choiceIconBackground: string;
  error: string;
  isChatEnabled: boolean;
  isSending: boolean;
  isTurnLocked: boolean;
  messages: ChatMessage[];
  onChooseRuntimeButton: (button: RuntimeButton) => void;
  onSendMessage: (content: string) => Promise<void>;
  realtimeStatus: RealtimeStatus;
  runtimeButtons: RuntimeButton[];
  runtimeOverlays: RuntimeOverlay[];
  runtimeSideImages: RuntimeSideImage[];
  session: TutoringSession | null;
  status: "loading" | "ready" | "error";
  turnAnchorMessageId: string | null;
  user: ApiUser | null;
};

type ScriptDisplayChunkView = {
  active: boolean;
  complete: boolean;
  fullText: string;
  id: string;
  index: number;
  streaming: boolean;
  text: string;
  visible: boolean;
};

type RenderedChatItem = {
  active: boolean;
  author: string;
  body: string;
  id: string;
  streaming: boolean;
  topAnchor: boolean;
  tone: "student" | "tutor";
};

const chatAutoScrollResumeThresholdPx = 28;
const chatProgrammaticScrollIgnoreMs = 520;
const chatUserScrollIntentMs = 900;

function isScrolledNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    chatAutoScrollResumeThresholdPx
  );
}

function scriptDisplayChunksFromMetadata(
  metadata: Record<string, unknown> | undefined,
) {
  const rawChunks = metadata?.scriptDisplayChunks;
  if (!Array.isArray(rawChunks)) return [];

  return rawChunks
    .map((rawChunk): ScriptDisplayChunkView | null => {
      if (!rawChunk || typeof rawChunk !== "object" || Array.isArray(rawChunk)) {
        return null;
      }

      const chunk = rawChunk as Record<string, unknown>;
      const id = typeof chunk.id === "string" ? chunk.id : "";
      const index = Number(chunk.index);
      if (!id || !Number.isInteger(index)) return null;

      return {
        active: Boolean(chunk.active),
        complete: Boolean(chunk.complete),
        fullText:
          typeof chunk.fullText === "string" ? chunk.fullText : "",
        id,
        index,
        streaming: Boolean(chunk.streaming),
        text: typeof chunk.text === "string" ? chunk.text : "",
        visible: Boolean(chunk.visible),
      };
    })
    .filter((chunk): chunk is ScriptDisplayChunkView => Boolean(chunk))
    .sort((left, right) => left.index - right.index);
}

export function ChatPanelContent({
  assistantName,
  avatarPath,
  avatarVisible,
  choiceIconBackground,
  error,
  isChatEnabled,
  isSending,
  isTurnLocked,
  messages,
  onChooseRuntimeButton,
  onSendMessage,
  realtimeStatus,
  runtimeButtons,
  runtimeOverlays,
  runtimeSideImages,
  session,
  status,
  turnAnchorMessageId,
  user,
}: ChatPanelContentProps) {
  const [draft, setDraft] = useState("");
  const autoScrollRef = useRef(true);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const programmaticScrollIgnoreUntilRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const assistantDisplayName = assistantName.trim() || "dee-lou";
  const assistantAvatarPath = avatarPath.trim() || "test-images/dLU-right.png";
  const sideImageBySlot = new Map(
    runtimeSideImages.map((image) => [image.slot, image]),
  );
  const leftSideImage = sideImageBySlot.get("left");
  const rightSideImage = sideImageBySlot.get("right");
  const leftImagePath = leftSideImage
    ? leftSideImage.imagePath.trim()
    : assistantAvatarPath;
  const leftImageVisible = leftSideImage
    ? leftSideImage.visible && Boolean(leftImagePath)
    : avatarVisible;
  const rightImagePath = rightSideImage?.imagePath.trim() ?? "";
  const rightImageVisible = Boolean(rightSideImage?.visible && rightImagePath);
  const renderedMessages = messages.flatMap((message): RenderedChatItem[] => {
    if (message.metadata?.scriptHidden) return [];

    const tone = message.role === "user" ? "student" : "tutor";
    const author =
      message.role === "user"
        ? user?.displayName || "You"
        : message.role === "assistant"
          ? assistantDisplayName
          : "System";
    const isStreaming = Boolean(message.metadata?.streaming);
    const chunks = scriptDisplayChunksFromMetadata(message.metadata);

    if (chunks.length && message.role === "assistant") {
      return chunks
        .filter((chunk) => chunk.visible)
        .map((chunk) => ({
          active: chunk.active,
          author,
          body:
            chunk.text ||
            (chunk.streaming || chunk.active ? "..." : chunk.fullText),
          id: chunk.id,
          streaming: chunk.streaming,
          topAnchor: true,
          tone,
        }));
    }

    const messageSource =
      typeof message.metadata?.source === "string"
        ? message.metadata.source
        : "";
    const isScriptAudioMessage =
      message.role === "assistant" && scriptAudioSources.has(messageSource);

    return [
      {
        active: false,
        author,
        body:
          (isStreaming
            ? message.content
            : displayTextFromScriptAudioMessage(message)) ||
          (isStreaming ? "..." : ""),
        id: message.id,
        streaming: isStreaming,
        topAnchor: isScriptAudioMessage,
        tone,
      },
    ];
  });
  const requestedTurnAnchorMessage = turnAnchorMessageId
    ? renderedMessages.find((message) => message.id === turnAnchorMessageId)
    : null;
  const activeTopAnchorMessage =
    renderedMessages.find((message) => message.topAnchor && message.active) ??
    [...renderedMessages]
      .reverse()
      .find((message) => message.topAnchor && message.streaming) ??
    null;
  const turnAnchorMessage = requestedTurnAnchorMessage ?? activeTopAnchorMessage;
  const effectiveTurnAnchorMessageId = turnAnchorMessage?.id ?? null;
  const turnAnchorIsStreaming = Boolean(
    turnAnchorMessage?.streaming,
  );
  const turnAnchorShouldTopAnchor = Boolean(turnAnchorMessage?.topAnchor);
  const turnAnchorIsVisible = Boolean(
    turnAnchorMessage,
  );
  const turnAnchorScrollKey = turnAnchorMessage
    ? `${turnAnchorMessage.id}:${turnAnchorMessage.body.length}`
    : "";
  const [turnAnchorSpacerHeight, setTurnAnchorSpacerHeight] = useState(0);
  const chatMessageListStyle = {
    "--turn-blank-space": `${turnAnchorSpacerHeight}px`,
  } as CSSProperties;
  const runtimeButtonsLayoutKey = runtimeButtons
    .map(
      (button) =>
        `${button.stepId || button.label}:${button.triggersEvent}:${button.label}`,
    )
    .join("|");
  const isInputDisabled =
    !session || status === "loading" || isTurnLocked || !isChatEnabled;
  const isSendDisabled = isInputDisabled || !draft.trim();

  useEffect(() => {
    if (!isInputDisabled) return;
    if (document.activeElement === composerInputRef.current) {
      composerInputRef.current?.blur();
    }
  }, [isInputDisabled]);

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    const target = effectiveTurnAnchorMessageId
      ? messageRefs.current.get(effectiveTurnAnchorMessageId)
      : null;
    if (!messageList || !target || !turnAnchorShouldTopAnchor) {
      setTurnAnchorSpacerHeight(0);
      return;
    }

    const updateSpacerHeight = () => {
      const nextHeight = Math.max(
        0,
        messageList.clientHeight - target.offsetHeight + 12,
      );
      setTurnAnchorSpacerHeight((currentHeight) =>
        Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight,
      );
    };

    updateSpacerHeight();

    const resizeObserver = new ResizeObserver(updateSpacerHeight);
    resizeObserver.observe(messageList);
    resizeObserver.observe(target);
    return () => resizeObserver.disconnect();
  }, [
    effectiveTurnAnchorMessageId,
    turnAnchorScrollKey,
    turnAnchorShouldTopAnchor,
  ]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    if (!autoScrollRef.current) return;

    let firstFrame = 0;
    let secondFrame = 0;

    const scrollMessageList = (options: ScrollToOptions) => {
      programmaticScrollIgnoreUntilRef.current =
        window.performance.now() + chatProgrammaticScrollIgnoreMs;
      messageList.scrollTo(options);
    };

    const scrollToAnchor = () => {
      if (effectiveTurnAnchorMessageId) {
        const target = messageRefs.current.get(effectiveTurnAnchorMessageId);
        if (target) {
          if (turnAnchorIsStreaming) {
            if (turnAnchorShouldTopAnchor) {
              scrollMessageList({
                top: Math.max(0, target.offsetTop - 2),
              });
              return;
            }

            scrollMessageList({
              top: Math.max(
                0,
                target.offsetTop +
                  target.offsetHeight -
                  messageList.clientHeight +
                  12,
              ),
            });
            return;
          }

          scrollMessageList({
            behavior: "smooth",
            top: Math.max(0, target.offsetTop - 2),
          });
        }
        return;
      }

      scrollMessageList({
        top: messageList.scrollHeight,
      });
    };

    firstFrame = window.requestAnimationFrame(() => {
      scrollToAnchor();
      secondFrame = window.requestAnimationFrame(scrollToAnchor);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    messages.length,
    runtimeButtonsLayoutKey,
    turnAnchorShouldTopAnchor,
    turnAnchorIsStreaming,
    turnAnchorIsVisible,
    effectiveTurnAnchorMessageId,
    turnAnchorScrollKey,
    turnAnchorSpacerHeight,
  ]);

  function handleMessageListScroll() {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const now = window.performance.now();
    const hasUserScrollIntent = now < userScrollIntentUntilRef.current;
    if (
      !hasUserScrollIntent &&
      now < programmaticScrollIgnoreUntilRef.current
    ) {
      return;
    }

    autoScrollRef.current = isScrolledNearBottom(messageList);
  }

  function markMessageListUserScrollIntent() {
    userScrollIntentUntilRef.current =
      window.performance.now() + chatUserScrollIntentMs;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMessage = draft.trim();
    if (
      !nextMessage ||
      !session ||
      isSending ||
      isTurnLocked ||
      !isChatEnabled ||
      status === "loading"
    ) {
      return;
    }

    setDraft("");
    autoScrollRef.current = true;

    try {
      await onSendMessage(nextMessage);
    } catch {
      // Keep the draft available when saving fails.
      setDraft(nextMessage);
    }
  }

  const inputPlaceholder = !isChatEnabled
    ? "Chat is paused"
    : isTurnLocked
      ? `${assistantDisplayName} is responding...`
      : `Message ${assistantDisplayName}...`;
  const sendButtonLabel =
    !isChatEnabled
      ? "Chat paused"
      : realtimeStatus === "streaming" || isSending || isTurnLocked
        ? "dLU is responding"
        : "Send message";

  return (
    <div className="chat-stage">
      <div className="chat-thread">
        <div
          className={[
            "chat-message-list",
            turnAnchorShouldTopAnchor ? "turn-anchored" : "",
            runtimeButtons.length ? "has-runtime-choices" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-live="polite"
          onPointerDown={markMessageListUserScrollIntent}
          onScroll={handleMessageListScroll}
          onTouchStart={markMessageListUserScrollIntent}
          onWheel={markMessageListUserScrollIntent}
          ref={messageListRef}
          style={chatMessageListStyle}
        >
          {status === "loading" ? (
            <div className="chat-status">Loading session...</div>
          ) : null}
          {status === "error" ? (
            <div className="chat-status error">{error}</div>
          ) : null}
          {renderedMessages.map((message) => {
            return (
              <div
                className={`chat-message ${message.tone}`}
                key={message.id}
                ref={(element) => {
                  if (element) {
                    messageRefs.current.set(message.id, element);
                  } else {
                    messageRefs.current.delete(message.id);
                  }
                }}
              >
                <span>{message.author}</span>
                <p>{message.body}</p>
              </div>
            );
          })}
        </div>

        {runtimeButtons.length ? (
          <div className="runtime-choice-row" aria-label="Runtime choices">
            {runtimeButtons.map((button) => (
              <button
                className={`runtime-choice-button${button.iconPath ? " has-icon" : ""}`}
                key={button.stepId || `${button.label}-${button.triggersEvent}`}
                onClick={() => onChooseRuntimeButton(button)}
                type="button"
              >
                {button.iconPath ? (
                  <span
                    className="runtime-choice-icon-slot"
                    aria-hidden="true"
                    style={choiceIconBackgroundStyle(
                      button.iconBackground || choiceIconBackground,
                    )}
                  >
                    <img alt="" src={publicAsset(button.iconPath)} />
                  </span>
                ) : null}
                <span className="runtime-choice-label">{button.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <form
          aria-disabled={isInputDisabled}
          className={`composer-row${isInputDisabled ? " is-disabled" : ""}`}
          onSubmit={sendMessage}
        >
          <input
            aria-label={`Message ${assistantDisplayName}`}
            disabled={isInputDisabled}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={inputPlaceholder}
            ref={composerInputRef}
            tabIndex={isInputDisabled ? -1 : 0}
            type="text"
            value={draft}
          />
          <button
            aria-label={sendButtonLabel}
            disabled={isSendDisabled}
            title={sendButtonLabel}
            type="submit"
          >
            <SendIcon />
          </button>
        </form>
      </div>

      {leftImageVisible ? (
        <img
          alt={assistantDisplayName}
          className="chat-side-image chat-side-image-left"
          src={publicAsset(leftImagePath)}
        />
      ) : null}
      {rightImageVisible ? (
        <img
          alt=""
          aria-hidden="true"
          className="chat-side-image chat-side-image-right"
          src={publicAsset(rightImagePath)}
        />
      ) : null}
      {runtimeOverlays.map((overlay) => (
        <img
          alt=""
          aria-hidden="true"
          className="chat-visual-overlay"
          key={overlay.id}
          src={publicAsset(overlay.imagePath)}
        />
      ))}
    </div>
  );
}
