import { useEffect, useRef, useState } from "react";

import {
  checkpointRecordingModeLabel,
  checkpointTimeLabel,
} from "../runtimeUtils";
import { normalizeCheckpointRecordingMode } from "../persistence";
import type { CheckpointRecordingMode, EventCheckpoint } from "../types";

export function EventRunControls({
  checkpointMode,
  checkpoints,
  error,
  hasSelectedEvent,
  isRunning,
  onChangeCheckpointMode,
  onRefreshCheckpoints,
  onRun,
  selectedEventId,
  selectedEventTitle,
  status,
}: {
  checkpointMode: CheckpointRecordingMode;
  checkpoints: EventCheckpoint[];
  error: string;
  hasSelectedEvent: boolean;
  isRunning: boolean;
  onChangeCheckpointMode: (mode: CheckpointRecordingMode) => void;
  onRefreshCheckpoints: () => void;
  onRun: (checkpointId: string) => void;
  selectedEventId: string;
  selectedEventTitle: string;
  status: "idle" | "loading" | "error";
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const latestCheckpoint = checkpoints[0] ?? null;
  const primaryTitle = latestCheckpoint
    ? `Run ${selectedEventTitle || "this event"} from the latest saved state.`
    : `Run ${selectedEventTitle || "this event"} from a cold state.`;

  useEffect(() => {
    if (!isMenuOpen) return;

    function closeOnPointerDown(event: globalThis.MouseEvent) {
      const target = event.target;
      if (target instanceof Node && controlRef.current?.contains(target)) {
        return;
      }

      setIsMenuOpen(false);
    }

    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);

    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [selectedEventId]);

  function refreshAndToggleMenu() {
    setIsMenuOpen((current) => !current);
    if (hasSelectedEvent) {
      onRefreshCheckpoints();
    }
  }

  return (
    <div className="event-run-control" ref={controlRef}>
      <button
        className="event-run-primary"
        disabled={!hasSelectedEvent || isRunning}
        onClick={() => onRun(latestCheckpoint?.id ?? "")}
        title={primaryTitle}
        type="button"
      >
        Run from here
      </button>
      <button
        aria-expanded={isMenuOpen}
        aria-label="Run from here options"
        className="event-run-menu-toggle"
        disabled={!hasSelectedEvent || isRunning}
        onClick={refreshAndToggleMenu}
        title="Choose a saved state and checkpoint recording mode."
        type="button"
      >
        ▾
      </button>
      {isMenuOpen ? (
        <div className="event-run-menu">
          <label className="event-run-recording-row">
            <span>Recording</span>
            <select
              aria-label="Checkpoint recording mode"
              onChange={(event) =>
                onChangeCheckpointMode(
                  normalizeCheckpointRecordingMode(event.target.value),
                )
              }
              value={checkpointMode}
            >
              <option value="structural">Structural</option>
              <option value="full">Full</option>
              <option value="off">Off</option>
            </select>
          </label>
          <button
            className="event-run-menu-option"
            onClick={() => onRun("")}
            type="button"
          >
            <span>Start cold</span>
            <small>Run this event with no restored context.</small>
          </button>
          <button
            className="event-run-menu-option"
            disabled={!latestCheckpoint}
            onClick={() => onRun(latestCheckpoint?.id ?? "")}
            type="button"
          >
            <span>Latest saved state</span>
            <small>
              {latestCheckpoint ? latestCheckpoint.label : "No saved state yet"}
            </small>
          </button>
          <div className="event-run-saved-states">
            <div className="event-run-saved-heading">
              <span>Saved states</span>
              <button
                className="event-text-button"
                onClick={onRefreshCheckpoints}
                type="button"
              >
                Refresh
              </button>
            </div>
            {status === "loading" ? (
              <p className="event-run-empty">Loading...</p>
            ) : null}
            {status === "error" ? (
              <p className="event-run-empty error">{error}</p>
            ) : null}
            {status !== "loading" && !checkpoints.length ? (
              <p className="event-run-empty">
                No saved states for this event yet.
              </p>
            ) : null}
            {checkpoints.map((checkpoint) => (
              <button
                className="event-run-checkpoint"
                key={checkpoint.id}
                onClick={() => onRun(checkpoint.id)}
                type="button"
              >
                <span>{checkpointTimeLabel(checkpoint.lastUsedAt)}</span>
                <strong>{checkpoint.label}</strong>
                <small>
                  {checkpoint.fingerprintMode} · {checkpoint.messageCount} messages
                  · used {checkpoint.runCount}x
                </small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <label className="event-recording-compact">
        <span>Recording</span>
        <select
          aria-label="Checkpoint recording mode"
          onChange={(event) =>
            onChangeCheckpointMode(
              normalizeCheckpointRecordingMode(event.target.value),
            )
          }
          title="Controls whether editor runs save reusable event-entry states."
          value={checkpointMode}
        >
          <option value="structural">
            {checkpointRecordingModeLabel("structural")}
          </option>
          <option value="full">{checkpointRecordingModeLabel("full")}</option>
          <option value="off">{checkpointRecordingModeLabel("off")}</option>
        </select>
      </label>
    </div>
  );
}
