import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiFetch } from "../api";
import { writeSelectedExperienceId } from "../persistence";
import type {
  Experience,
  ExperienceSnapshot,
  ExperienceSnapshotsPayload,
} from "../types";

type SnapshotMenuView = "root" | "save" | "load";

type SnapshotMenuState = {
  x: number;
  y: number;
};

type UseExperienceSnapshotContextMenuOptions = {
  actions?: SnapshotContextMenuAction[];
  experience: Experience | null;
  flushEditorAutosave: () => Promise<boolean>;
  isReady: boolean;
  restorePath: (experienceId: string) => string;
};

type SnapshotContextMenuAction = {
  disabled?: boolean;
  label: string;
  onSelect: () => void | Promise<void>;
};

function snapshotDateTime(value = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function snapshotTitleFromName(name: string) {
  const trimmed = name.trim();
  const timestamp = snapshotDateTime();
  return (trimmed ? `${trimmed} - ${timestamp}` : timestamp).slice(0, 160);
}

function snapshotCreatedAtText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return snapshotDateTime(date);
}

export function useExperienceSnapshotContextMenu({
  actions = [],
  experience,
  flushEditorAutosave,
  isReady,
  restorePath,
}: UseExperienceSnapshotContextMenuOptions) {
  const [menuState, setMenuState] = useState<SnapshotMenuState | null>(null);
  const [view, setView] = useState<SnapshotMenuView>("root");
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshots, setSnapshots] = useState<ExperienceSnapshot[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  function closeMenu() {
    setMenuState(null);
    setView("root");
    setSnapshotName("");
    setError("");
    setStatus("");
    setRestoringSnapshotId("");
  }

  async function loadSnapshots(showLoading = true) {
    if (!experience) return;

    if (showLoading) setIsLoading(true);
    setError("");

    try {
      const payload = await apiFetch<ExperienceSnapshotsPayload>(
        `/api/experiences/${encodeURIComponent(experience.id)}/snapshots/`,
      );
      setSnapshots(payload.snapshots);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load snapshots.",
      );
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }

  async function saveSnapshot(name = snapshotName) {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      const payload = await apiFetch<{ snapshot: ExperienceSnapshot }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/snapshots/`,
        {
          method: "POST",
          body: JSON.stringify({ title: snapshotTitleFromName(name) }),
        },
      );
      setSnapshots((current) => [
        payload.snapshot,
        ...current.filter((snapshot) => snapshot.id !== payload.snapshot.id),
      ]);
      setSnapshotName("");
      setStatus(`Saved ${payload.snapshot.title}`);
      setView("root");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save snapshot.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function restoreSnapshot(snapshot: ExperienceSnapshot) {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setRestoringSnapshotId(snapshot.id);
    setError("");
    setStatus("Saving current state...");

    try {
      await apiFetch<{ snapshot: ExperienceSnapshot }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/snapshots/`,
        {
          method: "POST",
          body: JSON.stringify({
            title: snapshotTitleFromName(`Before loading ${snapshot.title}`),
          }),
        },
      );

      setStatus("Loading snapshot...");
      const payload = await apiFetch<{
        experience: Experience;
        snapshot: ExperienceSnapshot;
      }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/snapshots/${encodeURIComponent(snapshot.id)}/restore/`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      writeSelectedExperienceId(payload.experience.id);
      window.location.assign(restorePath(payload.experience.id));
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Could not load snapshot.",
      );
      setStatus("");
      setRestoringSnapshotId("");
    }
  }

  function openContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (event.defaultPrevented || !isReady || !experience) return;

    event.preventDefault();
    setMenuState({
      x: Math.min(event.clientX, window.innerWidth - 336),
      y: Math.min(event.clientY, window.innerHeight - 420),
    });
    setView("root");
    setError("");
    setStatus("");
  }

  function openLoadView() {
    setView("load");
    void loadSnapshots();
  }

  function runAction(action: SnapshotContextMenuAction) {
    if (action.disabled) return;

    closeMenu();
    void action.onSelect();
  }

  useEffect(() => {
    if (!menuState) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      closeMenu();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuState]);

  const menu = menuState ? (
    <div
      aria-label="Snapshot menu"
      className="app-context-menu snapshot-context-menu"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: menuState.x, top: menuState.y }}
    >
      {view === "root" ? (
        <>
          {actions.map((action) => (
            <button
              disabled={action.disabled}
              key={action.label}
              onClick={() => runAction(action)}
              role="menuitem"
              type="button"
            >
              {action.label}
            </button>
          ))}
          {actions.length ? <div className="app-context-menu-separator" /> : null}
          <button
            onClick={() => setView("save")}
            role="menuitem"
            type="button"
          >
            Save snapshot
          </button>
          <button onClick={openLoadView} role="menuitem" type="button">
            Load snapshot
          </button>
        </>
      ) : null}

      {view === "save" ? (
        <div className="snapshot-context-panel">
          <label>
            <span>Name</span>
            <input
              autoFocus
              onChange={(event) => setSnapshotName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveSnapshot();
              }}
              placeholder={snapshotDateTime()}
              type="text"
              value={snapshotName}
            />
          </label>
          <div className="snapshot-context-actions">
            <button onClick={() => setView("root")} type="button">
              Back
            </button>
            <button disabled={isSaving} onClick={() => void saveSnapshot()} type="button">
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {view === "load" ? (
        <div className="snapshot-context-panel">
          <div className="snapshot-context-heading">
            <span>Saved snapshots</span>
            <button
              disabled={isLoading}
              onClick={() => void loadSnapshots()}
              type="button"
            >
              Refresh
            </button>
          </div>
          <div className="snapshot-context-list">
            {isLoading ? <span className="snapshot-context-empty">Loading...</span> : null}
            {!isLoading && !snapshots.length ? (
              <span className="snapshot-context-empty">No snapshots yet.</span>
            ) : null}
            {snapshots.map((snapshot) => (
              <button
                disabled={Boolean(restoringSnapshotId)}
                key={snapshot.id}
                onClick={() => void restoreSnapshot(snapshot)}
                type="button"
              >
                <strong>{snapshot.title}</strong>
                <span>
                  {snapshotCreatedAtText(snapshot.createdAt)} - {snapshot.eventCount} events
                </span>
                {restoringSnapshotId === snapshot.id ? <em>Loading...</em> : null}
              </button>
            ))}
          </div>
          <div className="snapshot-context-actions">
            <button onClick={() => setView("root")} type="button">
              Back
            </button>
          </div>
        </div>
      ) : null}

      {status ? <div className="snapshot-context-status">{status}</div> : null}
      {error ? <div className="snapshot-context-error">{error}</div> : null}
    </div>
  ) : null;

  return {
    menu,
    onContextMenu: openContextMenu,
  };
}
