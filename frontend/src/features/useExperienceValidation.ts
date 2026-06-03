import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../api";
import type {
  ExperienceEvent,
  ExperienceValidation,
  ExperienceValidationPayload,
} from "../types";

export function useExperienceValidation({
  events,
  experienceId,
  isGraphOpen,
  isReady,
}: {
  events: ExperienceEvent[] | undefined;
  experienceId: string;
  isGraphOpen: boolean;
  isReady: boolean;
}) {
  const [experienceValidation, setExperienceValidation] =
    useState<ExperienceValidation | null>(null);
  const [experienceValidationStatus, setExperienceValidationStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [experienceValidationError, setExperienceValidationError] = useState("");
  const experienceValidationVersion = useRef(0);

  async function loadExperienceValidation(
    targetExperienceId = experienceId,
    showLoading = true,
  ) {
    if (!targetExperienceId) return;

    const version = experienceValidationVersion.current + 1;
    experienceValidationVersion.current = version;
    if (showLoading) {
      setExperienceValidationStatus("loading");
    }
    setExperienceValidationError("");

    try {
      const payload = await apiFetch<ExperienceValidationPayload>(
        `/api/experiences/${targetExperienceId}/validation/`,
      );
      if (experienceValidationVersion.current !== version) return;
      setExperienceValidation(payload.validation);
      setExperienceValidationStatus("idle");
    } catch (loadError) {
      if (experienceValidationVersion.current !== version) return;
      setExperienceValidationStatus("error");
      setExperienceValidationError(
        loadError instanceof Error
          ? loadError.message
          : "Could not validate experience.",
      );
    }
  }

  function resetExperienceValidation() {
    setExperienceValidation(null);
    setExperienceValidationError("");
    setExperienceValidationStatus("idle");
  }

  useEffect(() => {
    if (!experienceId || !isGraphOpen || !isReady) return;

    const timer = window.setTimeout(() => {
      void loadExperienceValidation(experienceId, !experienceValidation);
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [experienceId, events, isGraphOpen, isReady]);

  return {
    experienceValidation,
    experienceValidationError,
    experienceValidationStatus,
    loadExperienceValidation,
    resetExperienceValidation,
  };
}
