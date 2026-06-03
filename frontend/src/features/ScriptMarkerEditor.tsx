import type { ReactNode } from "react";

import {
  getMainPanelAppDefinition,
  mainPanelAppDefinitions,
} from "../mainPanelApps";
import {
  customSoundOptionValue,
  parseScriptMarkerArgs,
  scriptMarkerEditKey,
  scriptMarkerIcon,
  scriptSoundOptions,
  type ScriptMarkerInstance,
} from "../scriptMarkers";
import { tutorAvatarOptions } from "../tutorAssets";
import {
  PlayIcon,
  StopIcon,
  TrashIcon,
} from "../components/Icons";
import { isSlideMarker } from "./scriptActionEditorUtils";

type ScriptMarkerEditorProps = {
  marker: ScriptMarkerInstance;
  onClose: () => void;
  onFocusText: (marker: ScriptMarkerInstance) => void;
  onPlaySoundPreview: (
    soundPath: string,
    rawVolume: string,
    previewKey: string,
  ) => void;
  onRemove: (marker: ScriptMarkerInstance) => void;
  onReplaceArgs: (marker: ScriptMarkerInstance, args: string[]) => void;
  soundPreviewKey: string | null;
};

export function ScriptMarkerEditor({
  marker,
  onClose,
  onFocusText,
  onPlaySoundPreview,
  onRemove,
  onReplaceArgs,
  soundPreviewKey,
}: ScriptMarkerEditorProps) {
  const args = marker.argList;
  const closeButton = (
    <button
      aria-label="Close marker editor"
      className="script-marker-editor-close"
      onClick={onClose}
      title="Close"
      type="button"
    >
      ×
    </button>
  );
  const textButton = (
    <button
      className="event-text-button"
      onClick={() => onFocusText(marker)}
      title="Show this marker in the raw script text."
      type="button"
    >
      Text
    </button>
  );
  const deleteButton = (
    <button
      aria-label={`Remove ${marker.label} marker`}
      className="script-marker-editor-delete"
      onClick={() => onRemove(marker)}
      title={`Remove ${marker.label}`}
      type="button"
    >
      <TrashIcon />
    </button>
  );
  let controls: ReactNode;

  if (isSlideMarker(marker)) {
    controls = (
      <div className="script-marker-controls slide-marker-controls">
        <span className="event-detail-label">SLIDE</span>
        <input
          aria-label="Slide reference"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          placeholder="1"
          type="text"
          value={args[0] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "play_sound") {
    const currentSoundPath = args[0]?.trim() || scriptSoundOptions[0].path;
    const currentVolume = args[1]?.trim() || "0.5";
    const currentSoundPreviewKey = scriptMarkerEditKey(marker);
    const isPreviewingSound = soundPreviewKey === currentSoundPreviewKey;
    const isKnownSound = scriptSoundOptions.some(
      (option) => option.path === currentSoundPath,
    );
    controls = (
      <div className="script-marker-controls sound-marker-controls">
        <span className="event-detail-label">SOUND</span>
        <select
          aria-label="Sound effect"
          onChange={(event) => {
            if (event.target.value === customSoundOptionValue) {
              onReplaceArgs(marker, [args[0] ?? "", currentVolume]);
              return;
            }
            onReplaceArgs(marker, [event.target.value, currentVolume]);
          }}
          value={isKnownSound ? currentSoundPath : customSoundOptionValue}
        >
          {scriptSoundOptions.map((option) => (
            <option key={option.path} value={option.path}>
              {option.label}
            </option>
          ))}
          <option value={customSoundOptionValue}>Custom</option>
        </select>
        <span className="event-detail-label">VOL</span>
        <input
          aria-label="Sound volume"
          max="1"
          min="0"
          onChange={(event) =>
            onReplaceArgs(marker, [currentSoundPath, event.target.value])
          }
          step="0.05"
          type="number"
          value={currentVolume}
        />
        <button
          aria-label={isPreviewingSound ? "Stop sound preview" : "Play sound preview"}
          className="script-sound-preview-button"
          onClick={() =>
            onPlaySoundPreview(
              currentSoundPath,
              currentVolume,
              currentSoundPreviewKey,
            )
          }
          title={isPreviewingSound ? "Stop sound preview" : "Play sound preview"}
          type="button"
        >
          {isPreviewingSound ? <StopIcon /> : <PlayIcon />}
        </button>
        {!isKnownSound ? (
          <>
            <span className="event-detail-label">PATH</span>
            <input
              aria-label="Custom sound path"
              onChange={(event) =>
                onReplaceArgs(marker, [event.target.value, currentVolume])
              }
              placeholder="sounds/thud.mp3"
              type="text"
              value={currentSoundPath}
            />
          </>
        ) : null}
      </div>
    );
  } else if (marker.type === "show_image") {
    const currentImagePath = args[0]?.trim() || tutorAvatarOptions[0].path;
    controls = (
      <div className="script-marker-controls image-marker-controls">
        <span className="event-detail-label">IMAGE</span>
        <select
          aria-label="Image path"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          value={currentImagePath}
        >
          {tutorAvatarOptions.map((option) => (
            <option key={option.path} value={option.path}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  } else if (marker.type === "overlay") {
    controls = (
      <div className="script-marker-controls overlay-marker-controls">
        <span className="event-detail-label">ID</span>
        <input
          aria-label="Overlay id"
          onChange={(event) =>
            onReplaceArgs(marker, [event.target.value, args[1] ?? ""])
          }
          placeholder="guide"
          type="text"
          value={args[0] ?? ""}
        />
        <span className="event-detail-label">IMAGE</span>
        <input
          aria-label="Overlay image path"
          onChange={(event) =>
            onReplaceArgs(marker, [args[0] ?? "", event.target.value])
          }
          placeholder="test-images/dLU-left.png"
          type="text"
          value={args[1] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "overlay_off") {
    controls = (
      <div className="script-marker-controls">
        <span className="event-detail-label">ID</span>
        <input
          aria-label="Overlay id to clear"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          placeholder="all"
          type="text"
          value={args[0] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "highlight_on" || marker.type === "highlight") {
    controls = (
      <div className="script-marker-controls highlight-marker-controls">
        <span className="event-detail-label">SELECTOR</span>
        <input
          aria-label="Highlight selector"
          onChange={(event) =>
            onReplaceArgs(marker, [event.target.value, args[1] ?? ""])
          }
          placeholder=".target"
          type="text"
          value={args[0] ?? ""}
        />
        <span className="event-detail-label">COLOR</span>
        <input
          aria-label="Highlight color"
          onChange={(event) =>
            onReplaceArgs(marker, [args[0] ?? "", event.target.value])
          }
          placeholder="rgba(59, 130, 246, 0.6)"
          type="text"
          value={args[1] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "highlight_off") {
    controls = (
      <div className="script-marker-controls">
        <span className="event-detail-label">SELECTOR</span>
        <input
          aria-label="Highlight selector to clear"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          placeholder=".target"
          type="text"
          value={args[0] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "add_note") {
    controls = (
      <div className="script-marker-controls note-marker-controls">
        <span className="event-detail-label">NOTE</span>
        <input
          aria-label="Runtime note"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          placeholder="Remember this moment"
          type="text"
          value={args[0] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "pause") {
    controls = (
      <div className="script-marker-controls">
        <span className="event-detail-label">MS</span>
        <input
          aria-label="Pause duration milliseconds"
          min="0"
          onChange={(event) => onReplaceArgs(marker, [event.target.value])}
          step="100"
          type="number"
          value={args[0] ?? ""}
        />
      </div>
    );
  } else if (marker.type === "interactive" || marker.type === "interactive_update") {
    const currentApp = args[0] ?? "";
    const appDefinition = getMainPanelAppDefinition(currentApp);
    const currentView = args[1] ?? appDefinition?.defaultView ?? "";
    controls = (
      <div className="script-marker-controls interactive-marker-controls">
        <span className="event-detail-label">APP</span>
        <select
          aria-label="Main panel app"
          onChange={(event) => {
            const nextApp = event.target.value;
            const nextDefinition = getMainPanelAppDefinition(nextApp);
            onReplaceArgs(marker, [
              nextApp,
              nextDefinition?.defaultView ?? "",
              args[2] ?? "",
            ]);
          }}
          value={currentApp}
        >
          <option value="">Choose</option>
          {mainPanelAppDefinitions.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.label}
            </option>
          ))}
        </select>
        <span className="event-detail-label">VIEW</span>
        <select
          aria-label="Main panel app view"
          onChange={(event) =>
            onReplaceArgs(marker, [currentApp, event.target.value, args[2] ?? ""])
          }
          value={currentView}
        >
          {(appDefinition?.views ?? []).map((view) => (
            <option key={view.id} value={view.id}>
              {view.label}
            </option>
          ))}
        </select>
        <span className="event-detail-label">GO</span>
        <input
          aria-label="Event route on submit"
          onChange={(event) =>
            onReplaceArgs(marker, [currentApp, currentView, event.target.value])
          }
          placeholder="event slug"
          type="text"
          value={args[2] ?? ""}
        />
      </div>
    );
  } else {
    controls = marker.args ? (
      <div className="script-marker-controls">
        <span className="event-detail-label">ARGS</span>
        <input
          aria-label="Marker arguments"
          onChange={(event) =>
            onReplaceArgs(marker, parseScriptMarkerArgs(event.target.value))
          }
          placeholder="arguments"
          type="text"
          value={marker.args}
        />
      </div>
    ) : (
      <div className="script-marker-empty-controls">No settings for this marker.</div>
    );
  }

  return (
    <div className="script-marker-editor">
      <div className="script-marker-editor-head">
        <span className="script-marker-chip-icon">{scriptMarkerIcon(marker.type)}</span>
        <strong>{marker.label}</strong>
        <code>{marker.detail || ""}</code>
        <span className="script-marker-editor-actions">
          {textButton}
          {deleteButton}
          {closeButton}
        </span>
      </div>
      {controls}
    </div>
  );
}
