import type {
  ChangeEvent,
  Dispatch,
  MouseEvent,
  PointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import { publicAsset } from "../assets";
import { defaultGlowColor, glowTargets } from "../glowTargets";
import {
  customSoundOptionValue,
  scriptSoundOptions,
  type ScriptMarkerInstance,
} from "../scriptMarkers";
import { sidePanelMetadataDefinitions } from "../sidePanelMetadata";
import { ImageLibraryPicker, type ImageLibraryOption } from "./ImageLibraryPicker";
import { isSlideMarker } from "./scriptActionEditorUtils";
import {
  defaultScriptSideImagePath,
  normalizeScriptSideImageScale,
  scriptSideImageArgsFromState,
  scriptSideImageScaleMax,
  scriptSideImageScaleMin,
  type ScriptSideImageState,
} from "./scriptMarkerActionMetadata";

export type ScriptActionMenuState =
  | {
      insertionIndex: number;
      mode: "insert";
      x: number;
      y: number;
    }
  | {
      markerKey: string;
      mode: "edit";
      x: number;
      y: number;
    };

export type ScriptAudioMenuState = {
  x: number;
  y: number;
};

type ScriptActionInsertKind =
  | "glow"
  | "panel"
  | "side-image"
  | "slide"
  | "sound";

type NextScriptActionMenuPortalProps = {
  deletingScriptImagePath: string;
  editingScriptMarker: ScriptMarkerInstance | null;
  editingSideImageState: ScriptSideImageState | null;
  isLoadingScriptImages: boolean;
  isScriptImagePickerOpen: boolean;
  isUploadingScriptImage: boolean;
  menu: ScriptActionMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  onBeginDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onDeleteImage: (path: string, label: string) => void;
  onEndDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onInsertAction: (kind: ScriptActionInsertKind) => void;
  onMoveDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onRemoveMarker: (marker: ScriptMarkerInstance) => void;
  onReplaceMarker: (marker: ScriptMarkerInstance, args: string[]) => void;
  onSelectImage: (path: string) => void;
  onUploadImage: (event: ChangeEvent<HTMLInputElement>) => void;
  scriptImageFileInputRef: RefObject<HTMLInputElement>;
  scriptImagePickerOptions: ImageLibraryOption[];
  setIsScriptImagePickerOpen: Dispatch<SetStateAction<boolean>>;
};

export function NextScriptActionMenuPortal({
  deletingScriptImagePath,
  editingScriptMarker,
  editingSideImageState,
  isLoadingScriptImages,
  isScriptImagePickerOpen,
  isUploadingScriptImage,
  menu,
  menuRef,
  onBeginDrag,
  onDeleteImage,
  onEndDrag,
  onInsertAction,
  onMoveDrag,
  onRemoveMarker,
  onReplaceMarker,
  onSelectImage,
  onUploadImage,
  scriptImageFileInputRef,
  scriptImagePickerOptions,
  setIsScriptImagePickerOpen,
}: NextScriptActionMenuPortalProps) {
  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="next-script-action-popover"
      ref={menuRef}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        aria-label="Move action menu"
        className="next-script-action-popover-grip"
        onPointerCancel={onEndDrag}
        onPointerDown={onBeginDrag}
        onPointerMove={onMoveDrag}
        onPointerUp={onEndDrag}
        title="Drag to move"
        type="button"
      >
        <span aria-hidden="true" />
      </button>
      {menu.mode === "insert" ? (
        <>
          <button
            className="next-script-action-menu-item is-slide"
            onClick={() => onInsertAction("slide")}
            role="menuitem"
            type="button"
          >
            Slide
          </button>
          <button
            className="next-script-action-menu-item is-action"
            onClick={() => onInsertAction("side-image")}
            role="menuitem"
            type="button"
          >
            Interface image
          </button>
          <button
            className="next-script-action-menu-item is-action"
            onClick={() => onInsertAction("sound")}
            role="menuitem"
            type="button"
          >
            Sound
          </button>
          <button
            className="next-script-action-menu-item is-action"
            onClick={() => onInsertAction("panel")}
            role="menuitem"
            type="button"
          >
            Panel
          </button>
          <button
            className="next-script-action-menu-item is-action"
            onClick={() => onInsertAction("glow")}
            role="menuitem"
            type="button"
          >
            Glow
          </button>
        </>
      ) : editingScriptMarker ? (
        <div className="next-script-action-editor">
          <div className="next-script-action-editor-head">
            <strong>{editingScriptMarker.label}</strong>
            <button
              onClick={() => onRemoveMarker(editingScriptMarker)}
              type="button"
            >
              Delete
            </button>
          </div>
          <ScriptActionMarkerFields
            deletingScriptImagePath={deletingScriptImagePath}
            editingScriptMarker={editingScriptMarker}
            editingSideImageState={editingSideImageState}
            isLoadingScriptImages={isLoadingScriptImages}
            isScriptImagePickerOpen={isScriptImagePickerOpen}
            isUploadingScriptImage={isUploadingScriptImage}
            onDeleteImage={onDeleteImage}
            onReplaceMarker={onReplaceMarker}
            onSelectImage={onSelectImage}
            onUploadImage={onUploadImage}
            scriptImageFileInputRef={scriptImageFileInputRef}
            scriptImagePickerOptions={scriptImagePickerOptions}
            setIsScriptImagePickerOpen={setIsScriptImagePickerOpen}
          />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

type ScriptActionMarkerFieldsProps = Omit<
  NextScriptActionMenuPortalProps,
  | "editingScriptMarker"
  | "menu"
  | "menuRef"
  | "onBeginDrag"
  | "onEndDrag"
  | "onInsertAction"
  | "onMoveDrag"
  | "onRemoveMarker"
> & {
  editingScriptMarker: ScriptMarkerInstance;
};

function ScriptActionMarkerFields({
  deletingScriptImagePath,
  editingScriptMarker,
  editingSideImageState,
  isLoadingScriptImages,
  isScriptImagePickerOpen,
  isUploadingScriptImage,
  onDeleteImage,
  onReplaceMarker,
  onSelectImage,
  onUploadImage,
  scriptImageFileInputRef,
  scriptImagePickerOptions,
  setIsScriptImagePickerOpen,
}: ScriptActionMarkerFieldsProps) {
  if (isSlideMarker(editingScriptMarker)) {
    return (
      <label>
        <span>Slide</span>
        <input
          aria-label="Slide reference"
          onChange={(event) =>
            onReplaceMarker(editingScriptMarker, [event.target.value])
          }
          value={editingScriptMarker.argList[0] ?? ""}
        />
      </label>
    );
  }

  if (
    editingScriptMarker.type === "highlight" ||
    editingScriptMarker.type === "highlight_on" ||
    editingScriptMarker.type === "highlight_off"
  ) {
    const isGlowOff = editingScriptMarker.type === "highlight_off";
    const currentSelector = editingScriptMarker.argList[0] ?? "";
    const currentColor = editingScriptMarker.argList[1] ?? "";
    const targets = glowTargets();
    const isKnownTarget = targets.some(
      (target) => target.selector === currentSelector,
    );
    return (
      <>
        <label>
          <span>Target</span>
          <select
            aria-label="Glow target"
            onChange={(event) =>
              onReplaceMarker(
                editingScriptMarker,
                isGlowOff
                  ? [event.target.value]
                  : [event.target.value, currentColor || defaultGlowColor],
              )
            }
            value={currentSelector}
          >
            {!isKnownTarget && currentSelector ? (
              <option value={currentSelector}>{currentSelector}</option>
            ) : null}
            {targets.map((target) => (
              <option key={target.id} value={target.selector}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
        {!isGlowOff ? (
          <label>
            <span>Color</span>
            <input
              aria-label="Glow color"
              onChange={(event) =>
                onReplaceMarker(editingScriptMarker, [
                  currentSelector,
                  event.target.value,
                ])
              }
              placeholder={defaultGlowColor}
              value={currentColor}
            />
          </label>
        ) : null}
      </>
    );
  }

  if (
    editingScriptMarker.type === "panel_on" ||
    editingScriptMarker.type === "panel_off"
  ) {
    const isPanelOff = editingScriptMarker.type === "panel_off";
    const currentPanelId = editingScriptMarker.argList[0] ?? "";
    const currentMode =
      (editingScriptMarker.argList[1] ?? "").toLowerCase() === "available"
        ? "available"
        : "open";
    const isKnownPanel = sidePanelMetadataDefinitions.some(
      (panel) => panel.id === currentPanelId,
    );
    return (
      <>
        <label>
          <span>Panel</span>
          <select
            aria-label="Side panel"
            onChange={(event) =>
              onReplaceMarker(
                editingScriptMarker,
                isPanelOff
                  ? [event.target.value]
                  : currentMode === "available"
                    ? [event.target.value, "available"]
                    : [event.target.value],
              )
            }
            value={currentPanelId}
          >
            {!isKnownPanel && currentPanelId ? (
              <option value={currentPanelId}>{currentPanelId}</option>
            ) : null}
            {sidePanelMetadataDefinitions.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.label}
              </option>
            ))}
          </select>
        </label>
        {!isPanelOff ? (
          <label>
            <span>Mode</span>
            <select
              aria-label="Panel mode"
              onChange={(event) =>
                onReplaceMarker(
                  editingScriptMarker,
                  event.target.value === "available"
                    ? [currentPanelId, "available"]
                    : [currentPanelId],
                )
              }
              value={currentMode}
            >
              <option value="open">Open window</option>
              <option value="available">Icon only</option>
            </select>
          </label>
        ) : null}
      </>
    );
  }

  if (editingScriptMarker.type === "side_image" && editingSideImageState) {
    return (
      <>
        <label>
          <span>Side</span>
          <select
            aria-label="Interface image side"
            onChange={(event) =>
              onReplaceMarker(
                editingScriptMarker,
                scriptSideImageArgsFromState({
                  ...editingSideImageState,
                  side: event.target.value === "right" ? "right" : "left",
                }),
              )
            }
            value={editingSideImageState.side}
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
              onReplaceMarker(
                editingScriptMarker,
                scriptSideImageArgsFromState({
                  ...editingSideImageState,
                  visible: event.target.value !== "hide",
                }),
              )
            }
            value={editingSideImageState.visible ? "show" : "hide"}
          >
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </label>
        <div className="next-script-image-field">
          <span>Image</span>
          <div className="next-script-image-control">
            <button
              aria-expanded={isScriptImagePickerOpen}
              aria-label="Choose interface image"
              className="next-script-image-preview-button"
              onClick={() => setIsScriptImagePickerOpen((isOpen) => !isOpen)}
              title="Choose interface image"
              type="button"
            >
              {editingSideImageState.imagePath ? (
                <img alt="" src={publicAsset(editingSideImageState.imagePath)} />
              ) : (
                <span>No image</span>
              )}
            </button>
            <input
              aria-label="Interface image path"
              className="next-script-image-path-input"
              onChange={(event) =>
                onReplaceMarker(
                  editingScriptMarker,
                  scriptSideImageArgsFromState({
                    ...editingSideImageState,
                    imagePath: event.target.value,
                  }),
                )
              }
              placeholder={defaultScriptSideImagePath}
              value={editingSideImageState.imagePath}
            />
            <button
              className="next-script-image-upload-button"
              disabled={isUploadingScriptImage}
              onClick={() => scriptImageFileInputRef.current?.click()}
              type="button"
            >
              {isUploadingScriptImage ? "Uploading" : "Upload"}
            </button>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="next-script-image-file-input"
              onChange={onUploadImage}
              ref={scriptImageFileInputRef}
              type="file"
            />
            {isScriptImagePickerOpen ? (
              <ImageLibraryPicker
                ariaLabel="Interface image options"
                classNames={{
                  deleteButton: "next-script-image-delete-button",
                  empty: "next-script-image-picker-empty",
                  option: "next-script-image-option",
                  optionMain: "next-script-image-option-main",
                  picker: "next-script-image-picker",
                }}
                deletingPath={deletingScriptImagePath}
                emptyLabel="No images yet"
                isLoading={isLoadingScriptImages}
                onDelete={onDeleteImage}
                onSelect={onSelectImage}
                options={scriptImagePickerOptions}
                selectedPath={editingSideImageState.imagePath}
              />
            ) : null}
          </div>
        </div>
        <label>
          <span>Scale</span>
          <input
            aria-label="Interface image scale"
            max={scriptSideImageScaleMax}
            min={scriptSideImageScaleMin}
            onChange={(event) =>
              onReplaceMarker(
                editingScriptMarker,
                scriptSideImageArgsFromState({
                  ...editingSideImageState,
                  scale: normalizeScriptSideImageScale(event.target.value),
                  scaleText: event.target.value,
                }),
              )
            }
            inputMode="decimal"
            step="0.05"
            type="text"
            value={editingSideImageState.scaleText}
          />
        </label>
      </>
    );
  }

  if (editingScriptMarker.type === "play_sound") {
    return (
      <>
        <label>
          <span>Sound</span>
          <select
            aria-label="Sound effect"
            onChange={(event) => {
              const currentVolume =
                editingScriptMarker.argList[1]?.trim() || "0.5";
              onReplaceMarker(editingScriptMarker, [
                event.target.value === customSoundOptionValue
                  ? editingScriptMarker.argList[0] || ""
                  : event.target.value,
                currentVolume,
              ]);
            }}
            value={
              scriptSoundOptions.some(
                (option) => option.path === editingScriptMarker.argList[0],
              )
                ? editingScriptMarker.argList[0]
                : customSoundOptionValue
            }
          >
            {scriptSoundOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
            <option value={customSoundOptionValue}>Custom</option>
          </select>
        </label>
        <label>
          <span>Volume</span>
          <input
            aria-label="Sound volume"
            max="1"
            min="0"
            onChange={(event) =>
              onReplaceMarker(editingScriptMarker, [
                editingScriptMarker.argList[0] || scriptSoundOptions[0].path,
                event.target.value,
              ])
            }
            step="0.05"
            type="number"
            value={editingScriptMarker.argList[1] ?? "0.5"}
          />
        </label>
        {!scriptSoundOptions.some(
          (option) => option.path === editingScriptMarker.argList[0],
        ) ? (
          <label>
            <span>Path</span>
            <input
              aria-label="Custom sound path"
              onChange={(event) =>
                onReplaceMarker(editingScriptMarker, [
                  event.target.value,
                  editingScriptMarker.argList[1] || "0.5",
                ])
              }
              value={editingScriptMarker.argList[0] ?? ""}
            />
          </label>
        ) : null}
      </>
    );
  }

  return (
    <label>
      <span>Args</span>
      <input
        aria-label="Action arguments"
        onChange={(event) =>
          onReplaceMarker(
            editingScriptMarker,
            event.target.value
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          )
        }
        value={editingScriptMarker.args}
      />
    </label>
  );
}

type NextScriptAudioMenuPortalProps = {
  disabled: boolean;
  menu: ScriptAudioMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  onRegenerate: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function NextScriptAudioMenuPortal({
  disabled,
  menu,
  menuRef,
  onRegenerate,
}: NextScriptAudioMenuPortalProps) {
  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-label="Audio options"
      className="next-script-audio-menu"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        disabled={disabled}
        onClick={onRegenerate}
        role="menuitem"
        type="button"
      >
        {disabled ? "Regenerate unavailable" : "Regenerate audio"}
      </button>
    </div>,
    document.body,
  );
}
