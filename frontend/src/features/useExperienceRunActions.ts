import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  apiFetch,
  experienceRunPath,
} from "../api";
import { writeSelectedExperienceId } from "../persistence";
import type {
  CheckpointRecordingMode,
  Experience,
  SessionPayload,
} from "../types";
import { getSelectedExperienceEvent } from "./eventEditorUtils";

export function useExperienceRunActions({
  checkpointRecordingMode,
  experience,
  flushEditorAutosave,
  selectedEventId,
  setError,
}: {
  checkpointRecordingMode: CheckpointRecordingMode;
  experience: Experience | null;
  flushEditorAutosave: () => Promise<boolean>;
  selectedEventId: string;
  setError: (message: string) => void;
}) {
  const [runningEventId, setRunningEventId] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const navigate = useNavigate();

  async function runExperience() {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({
          experienceId: experience.id,
          recordingMode: checkpointRecordingMode,
        }),
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Could not start a fresh run.",
      );
      return;
    }

    writeSelectedExperienceId(experience.id);
    navigate(experienceRunPath(experience.id));
  }

  async function runSelectedEvent(checkpointId = "") {
    const selectedEvent = getSelectedExperienceEvent(experience, selectedEventId);
    if (!experience || !selectedEvent) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setRunningEventId(selectedEvent.id);
    setError("");
    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({
          checkpointId,
          eventId: selectedEvent.id,
          experienceId: experience.id,
          recordingMode: checkpointRecordingMode,
        }),
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Could not start from this event.",
      );
      setRunningEventId("");
      return;
    }

    writeSelectedExperienceId(experience.id);
    navigate(experienceRunPath(experience.id));
  }

  async function returnToExperiences() {
    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    navigate("/");
  }

  async function signOut() {
    await flushEditorAutosave();
    setIsSigningOut(true);

    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout/", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } finally {
      window.location.assign("/accounts/login/");
    }
  }

  return {
    isSigningOut,
    returnToExperiences,
    runExperience,
    runningEventId,
    runSelectedEvent,
    signOut,
  };
}
