import { useState } from "react";

import { TrashIcon } from "../components/Icons";
import type { ExperienceSnapshot } from "../types";

function snapshotCreatedAtText(value: string) {
  if (!value) return "---";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export function ExperienceSnapshotsPanel({
  deletingId,
  error,
  exportingId,
  isCreating,
  isLoading,
  onCreate,
  onDelete,
  onExport,
  onRefresh,
  onRestore,
  restoringId,
  snapshots,
}: {
  deletingId: string;
  error: string;
  exportingId: string;
  isCreating: boolean;
  isLoading: boolean;
  onCreate: () => void;
  onDelete: (snapshot: ExperienceSnapshot) => void;
  onExport: (snapshot: ExperienceSnapshot) => void;
  onRefresh: () => void;
  onRestore: (snapshot: ExperienceSnapshot) => void;
  restoringId: string;
  snapshots: ExperienceSnapshot[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const latestSnapshot = snapshots[0] ?? null;
  const statusLabel = isLoading
    ? "Loading"
    : snapshots.length
      ? `${snapshots.length} saved`
      : "None yet";

  return (
    <div className="snapshot-panel">
      <div className="snapshot-header">
        <div>
          <span>Snapshots</span>
          <strong>{statusLabel}</strong>
          {latestSnapshot ? (
            <em>{snapshotCreatedAtText(latestSnapshot.createdAt)}</em>
          ) : null}
        </div>
        <div className="snapshot-actions">
          <button
            className="header-action secondary"
            disabled={isLoading}
            onClick={onRefresh}
            title="Reload saved snapshots for this experience."
            type="button"
          >
            Refresh
          </button>
          <button
            className="header-action"
            disabled={isCreating}
            onClick={onCreate}
            title="Save a versioned copy of the current experience authoring state."
            type="button"
          >
            {isCreating ? "Creating..." : "Create snapshot"}
          </button>
          <button
            aria-expanded={isExpanded}
            className="header-action secondary"
            disabled={!snapshots.length}
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {latestSnapshot && !isExpanded ? (
        <div className="snapshot-summary">
          <span>{latestSnapshot.title}</span>
          <span>{latestSnapshot.eventCount} events</span>
          <span>v{latestSnapshot.version ?? "?"}</span>
        </div>
      ) : null}

      {isExpanded ? (
        <div className="snapshot-list">
          {snapshots.map((snapshot) => (
            <div className="snapshot-row" key={snapshot.id}>
              <div className="snapshot-copy">
                <strong>{snapshot.title}</strong>
                <span>
                  {snapshotCreatedAtText(snapshot.createdAt)} ·{" "}
                  {snapshot.eventCount} events · v{snapshot.version ?? "?"}
                </span>
                {snapshot.note ? <p>{snapshot.note}</p> : null}
              </div>
              <div className="snapshot-row-actions">
                <button
                  className="event-text-button"
                  disabled={exportingId === snapshot.id}
                  onClick={() => onExport(snapshot)}
                  title="Download this stored snapshot payload."
                  type="button"
                >
                  {exportingId === snapshot.id ? "Exporting..." : "Export"}
                </button>
                <button
                  className="event-text-button"
                  disabled={restoringId === snapshot.id}
                  onClick={() => onRestore(snapshot)}
                  title="Restore this snapshot as a new editable experience copy."
                  type="button"
                >
                  {restoringId === snapshot.id ? "Restoring..." : "Restore as copy"}
                </button>
                <button
                  aria-label={`Delete snapshot ${snapshot.title}`}
                  className="event-icon-button"
                  disabled={deletingId === snapshot.id}
                  onClick={() => onDelete(snapshot)}
                  title="Delete this snapshot."
                  type="button"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
          {!snapshots.length ? <div className="snapshot-empty">---</div> : null}
        </div>
      ) : null}
      {error ? <p className="control-error">{error}</p> : null}
    </div>
  );
}
