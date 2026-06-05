import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { publicAsset } from "../assets";
import { SendIcon } from "../components/Icons";
import type { RealtimeStatus } from "../realtime";
import { displayTextFromScriptAudioMessage } from "../scriptAudio";
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
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
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
  const turnAnchorMessage = turnAnchorMessageId
    ? messages.find((message) => message.id === turnAnchorMessageId)
    : null;
  const turnAnchorIsVisible = Boolean(
    turnAnchorMessage && !turnAnchorMessage.metadata?.scriptHidden,
  );
  const turnAnchorScrollKey = turnAnchorMessage
    ? `${turnAnchorMessage.id}:${turnAnchorMessage.metadata?.scriptHidden ? "hidden" : "visible"}:${turnAnchorMessage.content.length}`
    : "";
  const runtimeButtonsLayoutKey = runtimeButtons
    .map(
      (button) =>
        `${button.stepId || button.label}:${button.triggersEvent}:${button.label}`,
    )
    .join("|");

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;

    let firstFrame = 0;
    let secondFrame = 0;

    const scrollToAnchor = () => {
      if (turnAnchorMessageId) {
        const target = messageRefs.current.get(turnAnchorMessageId);
        if (target) {
          messageList.scrollTo({
            behavior: "smooth",
            top: Math.max(0, target.offsetTop - 2),
          });
        }
        return;
      }

      messageList.scrollTo({
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
    turnAnchorIsVisible,
    turnAnchorMessageId,
    turnAnchorScrollKey,
  ]);

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

    try {
      await onSendMessage(nextMessage);
    } catch {
      // Keep the draft available when saving fails.
      setDraft(nextMessage);
    }
  }

  const isInputDisabled =
    !session || status === "loading" || isTurnLocked || !isChatEnabled;
  const isSendDisabled = isInputDisabled || !draft.trim();
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
            turnAnchorMessageId ? "turn-anchored" : "",
            runtimeButtons.length ? "has-runtime-choices" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-live="polite"
          ref={messageListRef}
        >
          {status === "loading" ? (
            <div className="chat-status">Loading session...</div>
          ) : null}
          {status === "error" ? (
            <div className="chat-status error">{error}</div>
          ) : null}
          {messages.map((message) => {
            if (message.metadata?.scriptHidden) return null;

            const tone = message.role === "user" ? "student" : "tutor";
            const author =
              message.role === "user"
                ? user?.displayName || "You"
                : message.role === "assistant"
                  ? assistantDisplayName
                  : "System";
            const body =
              (message.metadata?.streaming
                ? message.content
                : displayTextFromScriptAudioMessage(message)) ||
              (message.metadata?.streaming ? "..." : "");

            return (
              <div
                className={`chat-message ${tone}`}
                key={message.id}
                ref={(element) => {
                  if (element) {
                    messageRefs.current.set(message.id, element);
                  } else {
                    messageRefs.current.delete(message.id);
                  }
                }}
              >
                <span>{author}</span>
                <p>{body}</p>
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

        <form className="composer-row" onSubmit={sendMessage}>
          <input
            aria-label={`Message ${assistantDisplayName}`}
            disabled={isInputDisabled}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={inputPlaceholder}
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
