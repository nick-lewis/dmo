import { type Dispatch, type SetStateAction, useEffect } from "react";

import { apiFetch } from "../api";
import { writeSelectedExperienceId } from "../persistence";
import type {
  ApiUser,
  Experience,
  ExperiencesPayload,
} from "../types";

export function useExperienceEditorLoader({
  applyExperience,
  experienceId,
  loadExperienceSnapshots,
  loadScriptAudioItems,
  setError,
  setStatus,
  setUser,
}: {
  applyExperience: (experience: Experience) => void;
  experienceId: string;
  loadExperienceSnapshots: (experienceId: string) => Promise<void>;
  loadScriptAudioItems: (experienceId: string) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<"loading" | "ready" | "error">>;
  setUser: Dispatch<SetStateAction<ApiUser | null>>;
}) {
  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      setError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const nextExperience =
          payload.experiences.find((candidate) => candidate.id === experienceId) ??
          null;

        if (!nextExperience) {
          throw new Error("Experience not found.");
        }

        if (isCancelled) return;

        setUser(me.user);
        applyExperience(nextExperience);
        writeSelectedExperienceId(nextExperience.id);
        void loadScriptAudioItems(nextExperience.id);
        void loadExperienceSnapshots(nextExperience.id);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load experience.",
        );
      }
    }

    loadEditor();

    return () => {
      isCancelled = true;
    };
  }, [experienceId]);
}
