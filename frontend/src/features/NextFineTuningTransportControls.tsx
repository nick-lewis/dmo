import { MicIcon, StopIcon } from "../components/Icons";
import { formatTimelineSeconds } from "./ScriptAudioPanel";
import type {
  FineTuningTimelineLayer,
  FineTuningTimelineVisibility,
} from "./fineTuningTimelineLayout";

type NextFineTuningTransportControlsProps = {
  canPlay: boolean;
  currentWord: string;
  durationSeconds: number;
  isPlaying: boolean;
  onCyclePlaybackRate: () => void;
  onToggleLayer: (layer: FineTuningTimelineLayer) => void;
  onTogglePlayback: () => void;
  playbackRate: number;
  timelineVisibility: FineTuningTimelineVisibility;
  visibleTime: number;
};

function layerButtonClass(
  layerClassName: string,
  isVisible: boolean,
) {
  return [
    layerClassName,
    isVisible ? "is-active" : "is-inactive",
  ].join(" ");
}

export function NextFineTuningTransportControls({
  canPlay,
  currentWord,
  durationSeconds,
  isPlaying,
  onCyclePlaybackRate,
  onToggleLayer,
  onTogglePlayback,
  playbackRate,
  timelineVisibility,
  visibleTime,
}: NextFineTuningTransportControlsProps) {
  return (
    <div className="next-fine-transport">
      <button
        aria-label={isPlaying ? "Pause fine tuning audio" : "Play fine tuning audio"}
        className="next-script-audio-preview-button has-audio"
        disabled={!canPlay}
        onClick={onTogglePlayback}
        title={isPlaying ? "Pause" : "Play"}
        type="button"
      >
        {isPlaying ? <StopIcon /> : <MicIcon />}
      </button>
      <button
        className="next-fine-speed-button"
        disabled={!canPlay}
        onClick={onCyclePlaybackRate}
        title="Playback speed"
        type="button"
      >
        {playbackRate}x
      </button>
      <div className="next-fine-mode-toggle" role="group" aria-label="Timeline layers">
        <button
          aria-label={
            timelineVisibility.slides ? "Slides visible" : "Slides hidden"
          }
          aria-pressed={timelineVisibility.slides}
          className={layerButtonClass("is-slides", timelineVisibility.slides)}
          onClick={() => onToggleLayer("slides")}
          title={timelineVisibility.slides ? "Slides visible" : "Slides hidden"}
          type="button"
        >
          <span aria-hidden="true" className="next-fine-layer-dot" />
          <span>Slides</span>
          <span className="next-fine-layer-state">
            {timelineVisibility.slides ? "On" : "Off"}
          </span>
        </button>
        <button
          aria-label={
            timelineVisibility.actions ? "Actions visible" : "Actions hidden"
          }
          aria-pressed={timelineVisibility.actions}
          className={layerButtonClass("is-actions", timelineVisibility.actions)}
          onClick={() => onToggleLayer("actions")}
          title={
            timelineVisibility.actions ? "Actions visible" : "Actions hidden"
          }
          type="button"
        >
          <span aria-hidden="true" className="next-fine-layer-dot" />
          <span>Actions</span>
          <span className="next-fine-layer-state">
            {timelineVisibility.actions ? "On" : "Off"}
          </span>
        </button>
        <button
          aria-label={
            timelineVisibility.chatCues
              ? "Chat cues visible"
              : "Chat cues hidden"
          }
          aria-pressed={timelineVisibility.chatCues}
          className={layerButtonClass(
            "is-chat-cues",
            timelineVisibility.chatCues,
          )}
          onClick={() => onToggleLayer("chatCues")}
          title={
            timelineVisibility.chatCues
              ? "Chat cues visible"
              : "Chat cues hidden"
          }
          type="button"
        >
          <span aria-hidden="true" className="next-fine-layer-dot" />
          <span>Chat cues</span>
          <span className="next-fine-layer-state">
            {timelineVisibility.chatCues ? "On" : "Off"}
          </span>
        </button>
      </div>
      <span className="next-fine-time">
        {formatTimelineSeconds(visibleTime)} / {formatTimelineSeconds(durationSeconds)}
      </span>
      <strong className="next-fine-current-word">{currentWord || "---"}</strong>
    </div>
  );
}
