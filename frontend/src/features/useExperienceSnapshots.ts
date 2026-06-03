import { useEffect, useState } from "react";

import {
  apiFetch,
  experienceEditPath,
  getCurrentPath,
} from "../api";
import {
  readCheckpointRecordingMode,
  writeCheckpointRecordingMode,
  writeSelectedExperienceId,
} from "../persistence";
import type {
  CheckpointRecordingMode,
  EventCheckpoint,
  EventCheckpointsPayload,
  Experience,
  ExperienceSnapshot,
  ExperienceSnapshotsPayload,
} from "../types";

type EventCheckpointStatus = "idle" | "loading" | "error";

export function useExperienceSnapshots({
  experience,
  flushEditorAutosave,
  isReady,
  selectedEventId,
}: {
  experience: Experience | null;
  flushEditorAutosave: () => Promise<boolean>;
  isReady: boolean;
  selectedEventId: string;
}) {
  const [checkpointRecordingMode, setCheckpointRecordingMode] =
    useState<CheckpointRecordingMode>(() => readCheckpointRecordingMode());
  const [eventCheckpoints, setEventCheckpoints] = useState<EventCheckpoint[]>([]);
  const [eventCheckpointStatus, setEventCheckpointStatus] =
    useState<EventCheckpointStatus>("idle");
  const [eventCheckpointError, setEventCheckpointError] = useState("");
  const [experienceSnapshots, setExperienceSnapshots] = useState<
    ExperienceSnapshot[]
  >([]);
  const [snapshotError, setSnapshotError] = useState("");
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState("");
  const [exportingSnapshotId, setExportingSnapshotId] = useState("");
  const [restoringSnapshotId, setRestoringSnapshotId] = useState("");

  async function loadExperienceSnapshots(
    targetExperienceId = experience?.id ?? "",
    showLoading = true,
  ) {
    if (!targetExperienceId) return;

    if (showLoading) {
      setIsLoadingSnapshots(true);
    }
    setSnapshotError("");

    try {
      const payload = await apiFetch<ExperienceSnapshotsPayload>(
        `/api/experiences/${targetExperienceId}/snapshots/`,
      );
      setExperienceSnapshots(payload.snapshots);
    } catch (loadError) {
      setSnapshotError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load snapshots.",
      );
    } finally {
      if (showLoading) {
        setIsLoadingSnapshots(false);
      }
    }
  }

  async function loadEventCheckpoints(
    targetEventId = selectedEventId,
    showLoading = true,
  ) {
    if (!experience?.id || !targetEventId) return;

    if (showLoading) {
      setEventCheckpointStatus("loading");
    }
    setEventCheckpointError("");
    try {
      const payload = await apiFetch<EventCheckpointsPayload>(
        `/api/experiences/${experience.id}/events/${targetEventId}/checkpoints/`,
      );
      setEventCheckpoints(payload.checkpoints);
      setEventCheckpointStatus("idle");
    } catch (loadError) {
      setEventCheckpoints([]);
      setEventCheckpointStatus("error");
      setEventCheckpointError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load saved event states.",
      );
    }
  }

  function resetSnapshotsAndCheckpoints() {
    setExperienceSnapshots([]);
    setEventCheckpoints([]);
    setEventCheckpointError("");
    setEventCheckpointStatus("idle");
    setSnapshotError("");
  }

  async function createExperienceSnapshot() {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setIsCreatingSnapshot(true);
    setSnapshotError("");
    try {
      const payload = await apiFetch<{ snapshot: ExperienceSnapshot }>(
        `/api/experiences/${experience.id}/snapshots/`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setExperienceSnapshots((current) => [
        payload.snapshot,
        ...current.filter((snapshot) => snapshot.id !== payload.snapshot.id),
      ]);
    } catch (snapshotCreateError) {
      setSnapshotError(
        snapshotCreateError instanceof Error
          ? snapshotCreateError.message
          : "Could not create snapshot.",
      );
    } finally {
      setIsCreatingSnapshot(false);
    }
  }

  async function exportExperienceSnapshot(snapshot: ExperienceSnapshot) {
    if (!experience) return;

    setExportingSnapshotId(snapshot.id);
    setSnapshotError("");
    try {
      const response = await fetch(
        `/api/experiences/${experience.id}/snapshots/${snapshot.id}/export/`,
        {
          credentials: "same-origin",
          headers: {
            "X-Current-Path": getCurrentPath(),
          },
        },
      );
      if (response.status === 401) {
        window.location.assign("/accounts/login/");
        throw new Error("Authentication required.");
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        throw new Error(
          typeof payload?.detail === "string"
            ? payload.detail
            : "Could not export snapshot.",
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${experience.slug || "experience"}-${snapshot.id.slice(
        0,
        8,
      )}.dlu-experience.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (snapshotExportError) {
      setSnapshotError(
        snapshotExportError instanceof Error
          ? snapshotExportError.message
          : "Could not export snapshot.",
      );
    } finally {
      setExportingSnapshotId("");
    }
  }

  async function deleteExperienceSnapshot(snapshot: ExperienceSnapshot) {
    if (!experience) return;

    const didConfirm = window.confirm(`Delete snapshot "${snapshot.title}"?`);
    if (!didConfirm) return;

    setDeletingSnapshotId(snapshot.id);
    setSnapshotError("");
    try {
      const payload = await apiFetch<ExperienceSnapshotsPayload>(
        `/api/experiences/${experience.id}/snapshots/${snapshot.id}/`,
        {
          method: "DELETE",
        },
      );
      setExperienceSnapshots(payload.snapshots);
    } catch (snapshotDeleteError) {
      setSnapshotError(
        snapshotDeleteError instanceof Error
          ? snapshotDeleteError.message
          : "Could not delete snapshot.",
      );
    } finally {
      setDeletingSnapshotId("");
    }
  }

  async function restoreExperienceSnapshot(snapshot: ExperienceSnapshot) {
    if (!experience) return;

    const didConfirm = window.confirm(
      `Restore "${snapshot.title}" as a new editable copy?`,
    );
    if (!didConfirm) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setRestoringSnapshotId(snapshot.id);
    setSnapshotError("");
    try {
      const payload = await apiFetch<{
        experience: Experience;
        snapshot: ExperienceSnapshot;
      }>(`/api/experiences/${experience.id}/snapshots/${snapshot.id}/restore/`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      writeSelectedExperienceId(payload.experience.id);
      window.location.assign(experienceEditPath(payload.experience.id));
    } catch (snapshotRestoreError) {
      setSnapshotError(
        snapshotRestoreError instanceof Error
          ? snapshotRestoreError.message
          : "Could not restore snapshot.",
      );
    } finally {
      setRestoringSnapshotId("");
    }
  }

  useEffect(() => {
    writeCheckpointRecordingMode(checkpointRecordingMode);
  }, [checkpointRecordingMode]);

  useEffect(() => {
    if (!experience?.id || !selectedEventId || !isReady) return;
    void loadEventCheckpoints(selectedEventId, false);
  }, [experience?.id, selectedEventId, isReady]);

  return {
    checkpointRecordingMode,
    createExperienceSnapshot,
    deleteExperienceSnapshot,
    deletingSnapshotId,
    eventCheckpointError,
    eventCheckpointStatus,
    eventCheckpoints,
    experienceSnapshots,
    exportExperienceSnapshot,
    exportingSnapshotId,
    isCreatingSnapshot,
    isLoadingSnapshots,
    loadEventCheckpoints,
    loadExperienceSnapshots,
    resetSnapshotsAndCheckpoints,
    restoreExperienceSnapshot,
    restoringSnapshotId,
    setCheckpointRecordingMode,
    snapshotError,
  };
}
