import {
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import type { ScriptMarkerInstance } from "../scriptMarkers";
import { formatTimelineSeconds } from "./ScriptAudioPanel";
import { FineTuningMarkerSettingsEditor } from "./FineTuningMarkerSettingsEditor";
import type { TimelineContextMenuState } from "./useFineTuningTimelineState";

type NextFineTuningContextMenuProps = {
  canLink: boolean;
  hasEditor: boolean;
  isLinked: boolean;
  marker: ScriptMarkerInstance | null;
  menu: TimelineContextMenuState | null;
  menuRef: Ref<HTMLDivElement>;
  onAddMarker: (type: "slide" | "side-image" | "sound") => void;
  onDelete: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onLink: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMoveToCurrentTime: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onUnlink: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onUpdateMarkerArgs: (
    markerIndex: number,
    nextArgs: string[],
    nextType?: string,
  ) => void;
};

export function NextFineTuningContextMenu({
  canLink,
  hasEditor,
  isLinked,
  marker,
  menu,
  menuRef,
  onAddMarker,
  onDelete,
  onLink,
  onMoveToCurrentTime,
  onUnlink,
  onUpdateMarkerArgs,
}: NextFineTuningContextMenuProps) {
  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={[
        "next-fine-context-menu",
        hasEditor ? "is-editor" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onMouseUp={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      ref={menuRef}
      role="menu"
      style={{
        left: `${menu.x}px`,
        top: `${menu.y}px`,
      }}
    >
      {menu.kind === "insert" ? (
        <>
          <button
            className="next-fine-context-action"
            onClick={() => onAddMarker("slide")}
            role="menuitem"
            type="button"
          >
            Add slide at {formatTimelineSeconds(menu.targetTimeSeconds)}
          </button>
          <button
            className="next-fine-context-action"
            onClick={() => onAddMarker("side-image")}
            role="menuitem"
            type="button"
          >
            Add interface image
          </button>
          <button
            className="next-fine-context-action"
            onClick={() => onAddMarker("sound")}
            role="menuitem"
            type="button"
          >
            Add sound
          </button>
        </>
      ) : (
        <>
          <button
            className="next-fine-context-action"
            onClick={onMoveToCurrentTime}
            role="menuitem"
            type="button"
          >
            Move to {formatTimelineSeconds(menu.targetTimeSeconds)}
          </button>
          {menu.kind === "marker" && canLink ? (
            <button
              className="next-fine-context-action"
              onClick={onLink}
              role="menuitem"
              type="button"
            >
              Link to selected chip
            </button>
          ) : null}
          {menu.kind === "marker" && marker?.linkId ? (
            <button
              className="next-fine-context-action"
              onClick={onUnlink}
              role="menuitem"
              type="button"
            >
              {isLinked ? "Unlink action" : "Clear link"}
            </button>
          ) : null}
          {menu.kind === "marker" ? (
            <button
              className="next-fine-context-action is-danger"
              onClick={onDelete}
              role="menuitem"
              type="button"
            >
              Delete action
            </button>
          ) : null}
          {menu.kind === "marker" && marker ? (
            <FineTuningMarkerSettingsEditor
              marker={marker}
              markerIndex={menu.index}
              onUpdateMarkerArgs={onUpdateMarkerArgs}
            />
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}
