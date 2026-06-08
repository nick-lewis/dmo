import type {
  PointerEventHandler,
  Ref,
  TouchEventHandler,
  UIEventHandler,
  WheelEventHandler,
} from "react";

import { RefreshIcon } from "../components/Icons";
import type { ScriptSlidePreview } from "../scriptMarkers";
import type { ScriptDisplayChunkState } from "./useScriptAudioPlayback";

type NextFineTuningPlaybackPreviewProps = {
  activeChatChunkId: string;
  canRefreshSlides: boolean;
  chatPreviewPlaceholder: string;
  chatPreviewRef: Ref<HTMLDivElement>;
  deckUrl: string;
  isRefreshingSlides: boolean;
  onChatPointerDown: PointerEventHandler<HTMLDivElement>;
  onChatScroll: UIEventHandler<HTMLDivElement>;
  onChatTouchStart: TouchEventHandler<HTMLDivElement>;
  onChatWheel: WheelEventHandler<HTMLDivElement>;
  onRefreshSlides: () => void;
  registerChatChunkRef: (
    chunkId: string,
    element: HTMLDivElement | null,
  ) => void;
  slidePreview: ScriptSlidePreview | null;
  slideRef: string;
  visibleChatChunks: ScriptDisplayChunkState[];
};

function FineTuningChatBubble({
  chunk,
  registerRef,
}: {
  chunk: ScriptDisplayChunkState;
  registerRef: (element: HTMLDivElement | null) => void;
}) {
  const body =
    chunk.text || (chunk.streaming || chunk.active ? "..." : chunk.fullText);

  return (
    <div
      className={[
        "next-fine-chat-bubble",
        chunk.active ? "is-active" : "",
        chunk.streaming ? "is-streaming" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={registerRef}
    >
      {body}
    </div>
  );
}

export function NextFineTuningPlaybackPreview({
  activeChatChunkId,
  canRefreshSlides,
  chatPreviewPlaceholder,
  chatPreviewRef,
  deckUrl,
  isRefreshingSlides,
  onChatPointerDown,
  onChatScroll,
  onChatTouchStart,
  onChatWheel,
  onRefreshSlides,
  registerChatChunkRef,
  slidePreview,
  slideRef,
  visibleChatChunks,
}: NextFineTuningPlaybackPreviewProps) {
  return (
    <section className="next-fine-preview" aria-label="Playback preview">
      <div className="next-fine-slide-preview" aria-label="Main panel preview">
        <button
          aria-label="Refresh slide previews"
          className="next-fine-slide-refresh-button"
          disabled={!canRefreshSlides || isRefreshingSlides}
          onClick={onRefreshSlides}
          title={
            canRefreshSlides
              ? "Refresh slide previews from the deck"
              : "Add a slides link and slide action first"
          }
          type="button"
        >
          <RefreshIcon />
        </button>
        {slidePreview?.status === "ready" && slidePreview.imageUrl ? (
          <img alt={slideRef ? `Slide ${slideRef}` : ""} src={slidePreview.imageUrl} />
        ) : (
          <span>
            {!slideRef
              ? "No slide"
              : !deckUrl.trim()
                ? "Deck URL needed"
                : slidePreview?.status === "loading"
                  ? "Loading"
                  : slidePreview?.detail || `Slide ${slideRef}`}
          </span>
        )}
      </div>
      <div className="next-fine-chat-preview" aria-label="Chat simulator">
        <div
          className={[
            "next-fine-chat-scroll",
            activeChatChunkId ? "is-turn-anchored" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={onChatPointerDown}
          onScroll={onChatScroll}
          onTouchStart={onChatTouchStart}
          onWheel={onChatWheel}
          ref={chatPreviewRef}
        >
          {visibleChatChunks.length ? (
            visibleChatChunks.map((chunk) => (
              <FineTuningChatBubble
                chunk={chunk}
                key={chunk.id}
                registerRef={(element) =>
                  registerChatChunkRef(chunk.id, element)
                }
              />
            ))
          ) : (
            <div className="next-fine-chat-empty">{chatPreviewPlaceholder}</div>
          )}
        </div>
      </div>
    </section>
  );
}
