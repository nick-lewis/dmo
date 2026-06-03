import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../api";
import type {
  Experience,
  TutorSettings,
  VoiceSamplePayload,
  VoiceSampleStatus,
} from "../types";

export function useVoiceSample({
  experience,
  setError,
  tutor,
}: {
  experience: Experience | null;
  setError: (message: string) => void;
  tutor: TutorSettings;
}) {
  const [voiceSampleStatus, setVoiceSampleStatus] =
    useState<VoiceSampleStatus>("idle");
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);

  async function playVoiceSample() {
    if (!experience) return;

    if (voiceSampleStatus !== "idle") {
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;
      setVoiceSampleStatus("idle");
      return;
    }

    const sampleTutor = tutor;
    setVoiceSampleStatus("loading");
    setError("");

    try {
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;

      const payload = await apiFetch<VoiceSamplePayload>(
        `/api/experiences/${experience.id}/voice-sample/`,
        {
          method: "POST",
          body: JSON.stringify({
            model: sampleTutor.realtimeModel,
            tutor: sampleTutor,
            voice: sampleTutor.voice,
          }),
        },
      );

      const audio = new Audio(payload.audioUrl);
      voiceSampleAudioRef.current = audio;
      setVoiceSampleStatus("playing");
      audio.onended = () => {
        if (voiceSampleAudioRef.current === audio) {
          voiceSampleAudioRef.current = null;
          setVoiceSampleStatus("idle");
        }
      };
      audio.onerror = () => {
        if (voiceSampleAudioRef.current === audio) {
          voiceSampleAudioRef.current = null;
          setVoiceSampleStatus("idle");
          setError("Could not play the cached voice sample.");
        }
      };
      await audio.play();
    } catch (sampleError) {
      const message =
        sampleError instanceof Error
          ? sampleError.message
          : "Could not play voice sample.";
      setError(message);
      voiceSampleAudioRef.current = null;
      setVoiceSampleStatus("idle");
    }
  }

  useEffect(() => {
    return () => {
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;
    };
  }, []);

  return {
    playVoiceSample,
    voiceSampleStatus,
  };
}
