import { publicAsset } from "../assets";
import { scriptSoundOptions, type ScriptMarkerInstance } from "../scriptMarkers";
import { isSlideMarker } from "./scriptActionEditorUtils";
import {
  defaultScriptSideImagePath,
  markerSupportsFineTuningSettings,
  normalizeScriptSideImageScale,
  scriptSideImageArgsFromState,
  scriptSideImageScaleMax,
  scriptSideImageScaleMin,
  scriptSideImageStateFromMarker,
  type ScriptSideImageState,
} from "./scriptMarkerActionMetadata";

type FineTuningMarkerSettingsEditorProps = {
  marker: ScriptMarkerInstance;
  markerIndex: number;
  onUpdateMarkerArgs: (
    markerIndex: number,
    nextArgs: string[],
    nextType?: string,
  ) => void;
};

export function FineTuningMarkerSettingsEditor({
  marker,
  markerIndex,
  onUpdateMarkerArgs,
}: FineTuningMarkerSettingsEditorProps) {
  if (!markerSupportsFineTuningSettings(marker)) return null;

  if (isSlideMarker(marker)) {
    return (
      <div className="next-fine-context-editor">
        <div className="next-fine-context-title">Settings</div>
        <label>
          <span>Slide</span>
          <input
            aria-label="Slide reference"
            onChange={(event) =>
              onUpdateMarkerArgs(markerIndex, [event.target.value])
            }
            value={marker.argList[0] ?? ""}
          />
        </label>
      </div>
    );
  }

  if (
    marker.type === "side_image" ||
    marker.type === "show_image" ||
    marker.type === "agent_image_on" ||
    marker.type === "agent_image_off"
  ) {
    const imageState = scriptSideImageStateFromMarker(marker);
    const updateImageState = (nextState: ScriptSideImageState) =>
      onUpdateMarkerArgs(
        markerIndex,
        scriptSideImageArgsFromState(nextState),
        "side_image",
      );

    return (
      <div className="next-fine-context-editor">
        <div className="next-fine-context-title">Interface image</div>
        <label>
          <span>Side</span>
          <select
            aria-label="Interface image side"
            onChange={(event) =>
              updateImageState({
                ...imageState,
                side: event.target.value === "right" ? "right" : "left",
              })
            }
            value={imageState.side}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          <span>State</span>
          <select
            aria-label="Interface image state"
            onChange={(event) =>
              updateImageState({
                ...imageState,
                visible: event.target.value !== "hide",
              })
            }
            value={imageState.visible ? "show" : "hide"}
          >
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </label>
        <div className="next-fine-image-field">
          <span>Image</span>
          <div className="next-fine-image-control">
            <div className="next-fine-image-preview" aria-hidden="true">
              {imageState.imagePath ? (
                <img alt="" src={publicAsset(imageState.imagePath)} />
              ) : (
                <span>No image</span>
              )}
            </div>
            <input
              aria-label="Interface image path"
              onChange={(event) =>
                updateImageState({
                  ...imageState,
                  imagePath: event.target.value,
                })
              }
              placeholder={defaultScriptSideImagePath}
              value={imageState.imagePath}
            />
          </div>
        </div>
        <label>
          <span>Scale</span>
          <input
            aria-label="Interface image scale"
            inputMode="decimal"
            max={scriptSideImageScaleMax}
            min={scriptSideImageScaleMin}
            onChange={(event) =>
              updateImageState({
                ...imageState,
                scale: normalizeScriptSideImageScale(event.target.value),
                scaleText: event.target.value,
              })
            }
            step="0.05"
            type="text"
            value={imageState.scaleText}
          />
        </label>
      </div>
    );
  }

  if (marker.type === "play_sound") {
    const soundPath = marker.argList[0] || scriptSoundOptions[0]?.path || "";
    const volume = marker.argList[1] || "0.5";
    const isKnownSound = scriptSoundOptions.some(
      (option) => option.path === soundPath,
    );

    return (
      <div className="next-fine-context-editor">
        <div className="next-fine-context-title">Sound</div>
        <label>
          <span>Sound</span>
          <select
            aria-label="Sound effect"
            onChange={(event) =>
              onUpdateMarkerArgs(markerIndex, [
                event.target.value === "custom" ? soundPath : event.target.value,
                volume,
              ])
            }
            value={isKnownSound ? soundPath : "custom"}
          >
            {scriptSoundOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <span>Volume</span>
          <input
            aria-label="Sound volume"
            max="1"
            min="0"
            onChange={(event) =>
              onUpdateMarkerArgs(markerIndex, [soundPath, event.target.value])
            }
            step="0.05"
            type="number"
            value={volume}
          />
        </label>
        {!isKnownSound ? (
          <label>
            <span>Path</span>
            <input
              aria-label="Custom sound path"
              onChange={(event) =>
                onUpdateMarkerArgs(markerIndex, [event.target.value, volume])
              }
              value={soundPath}
            />
          </label>
        ) : null}
      </div>
    );
  }

  return null;
}
