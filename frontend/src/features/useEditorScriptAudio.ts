import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../api";
import type {
  Experience,
  ScriptAudioDisplayPayload,
  ScriptAudioItem,
  ScriptAudioPayload,
} from "../types";

export function useEditorScriptAudio({
  experience,
  flushEditorAutosave,
}: {
  experience: Experience | null;
  flushEditorAutosave: () => Promise<boolean>;
}) {
  const [scriptAudioItems, setScriptAudioItems] = useState<ScriptAudioItem[]>([]);
  const [scriptAudioStatus, setScriptAudioStatus] = useState<
    "idle" | "loading" | "generating"
  >("idle");
  const [scriptAudioError, setScriptAudioError] = useState("");
  const [playingScriptAudioId, setPlayingScriptAudioId] = useState("");
  const [scriptAudioPlaybackRate, setScriptAudioPlaybackRate] = useState(1);
  const scriptAudioPreviewRef = useRef<HTMLAudioElement | null>(null);

  async function loadScriptAudioItems(
    targetExperienceId = experience?.id ?? "",
    showLoading = true,
  ) {
    if (!targetExperienceId) return null;

    if (showLoading) {
      setScriptAudioStatus("loading");
    }
    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioPayload>(
        `/api/experiences/${targetExperienceId}/script-audio/`,
      );
      setScriptAudioItems(payload.scripts);
      return payload;
    } catch (loadError) {
      setScriptAudioError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load scripted audio.",
      );
      return null;
    } finally {
      if (showLoading) {
        setScriptAudioStatus("idle");
      }
    }
  }

  async function generateScriptAudio(scriptId = "", force = false) {
    if (!experience) return null;

    const didSave = await flushEditorAutosave();
    if (!didSave) return null;

    setScriptAudioStatus("generating");
    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioPayload>(
        `/api/experiences/${experience.id}/script-audio/`,
        {
          method: "POST",
          body: JSON.stringify({
            force,
            scriptId,
          }),
        },
      );
      setScriptAudioItems(payload.scripts);
      if (payload.errors?.length) {
        setScriptAudioError(payload.errors.join(" "));
      }
      return payload;
    } catch (generateError) {
      setScriptAudioError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate scripted audio.",
      );
      return null;
    } finally {
      setScriptAudioStatus("idle");
    }
  }

  async function saveScriptAudioDisplayTranscript(
    scriptId: string,
    displaySlots: string[],
    displayBreaks: number[],
    displayCueOffsets?: number[],
  ) {
    if (!experience) {
      throw new Error("Experience is not loaded.");
    }

    const didSave = await flushEditorAutosave();
    if (!didSave) {
      throw new Error("Could not save the current editor draft.");
    }

    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioDisplayPayload>(
        `/api/experiences/${experience.id}/script-audio/${scriptId}/display/`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayBreaks,
            ...(displayCueOffsets ? { displayCueOffsets } : {}),
            displaySlots,
          }),
        },
      );
      setScriptAudioItems((current) =>
        current.map((item) =>
          item.id === scriptId
            ? {
                ...item,
                defaultVoiceInstructions: payload.defaultVoiceInstructions,
                displayBaseSlots: payload.displayBaseSlots,
                displayBaseText: payload.displayBaseText,
                displayExpectedWordCount: payload.displayExpectedWordCount,
                displaySlotCount: payload.displaySlotCount,
                displaySlots: payload.displaySlots,
                displayBreaks: payload.displayBreaks,
                displayCueOffsets: payload.displayCueOffsets,
                displayText: payload.displayText,
                displayWordCount: payload.displayWordCount,
                hasDisplayTranscript: payload.hasDisplayTranscript,
                hasVoiceInstructionsOverride: payload.hasVoiceInstructionsOverride,
                voiceInstructions: payload.voiceInstructions,
                voiceInstructionsOverride: payload.voiceInstructionsOverride,
              }
            : item,
        ),
      );
      return payload;
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Could not save display transcript.";
      setScriptAudioError(message);
      throw saveError;
    }
  }

  async function saveScriptAudioVoiceInstructionsOverride(
    scriptId: string,
    voiceInstructionsOverride: string,
  ) {
    if (!experience) {
      throw new Error("Experience is not loaded.");
    }

    const didSave = await flushEditorAutosave();
    if (!didSave) {
      throw new Error("Could not save the current editor draft.");
    }

    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioDisplayPayload>(
        `/api/experiences/${experience.id}/script-audio/${scriptId}/display/`,
        {
          method: "PUT",
          body: JSON.stringify({
            voiceInstructionsOverride,
          }),
        },
      );
      setScriptAudioItems((current) =>
        current.map((item) =>
          item.id === scriptId
            ? {
                ...item,
                audioUrl: "",
                cached: false,
                defaultVoiceInstructions: payload.defaultVoiceInstructions,
                durationSeconds: null,
                hasVoiceInstructionsOverride: payload.hasVoiceInstructionsOverride,
                timingPreview: [],
                timingWords: [],
                timingWordCount: 0,
                voiceInstructions: payload.voiceInstructions,
                voiceInstructionsOverride: payload.voiceInstructionsOverride,
                wordsCached: false,
              }
            : item,
        ),
      );
      void loadScriptAudioItems(experience.id, false);
      return payload;
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Could not save script voice instructions.";
      setScriptAudioError(message);
      throw saveError;
    }
  }

  function stopScriptAudioPreview(resetState = true) {
    scriptAudioPreviewRef.current?.pause();
    scriptAudioPreviewRef.current = null;
    if (resetState) {
      setPlayingScriptAudioId("");
    }
  }

  function playScriptAudioPreview(item: ScriptAudioItem) {
    if (!item.audioUrl) return;

    stopScriptAudioPreview();
    const audio = new Audio(item.audioUrl);
    audio.defaultPlaybackRate = scriptAudioPlaybackRate;
    audio.playbackRate = scriptAudioPlaybackRate;
    scriptAudioPreviewRef.current = audio;
    setPlayingScriptAudioId(item.id);
    audio.onended = () => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
      }
    };
    audio.onerror = () => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
        setScriptAudioError("Could not play cached scripted audio.");
      }
    };
    void audio.play().catch(() => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
        setScriptAudioError("Could not play cached scripted audio.");
      }
    });
  }

  useEffect(() => {
    return () => {
      scriptAudioPreviewRef.current?.pause();
      scriptAudioPreviewRef.current = null;
    };
  }, []);

  useEffect(() => {
    function handleScriptAudioPreviewEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !scriptAudioPreviewRef.current) return;

      stopScriptAudioPreview();
      event.preventDefault();
    }

    document.addEventListener("keydown", handleScriptAudioPreviewEscape, true);
    return () =>
      document.removeEventListener("keydown", handleScriptAudioPreviewEscape, true);
  }, []);

  useEffect(() => {
    if (!scriptAudioPreviewRef.current) return;
    scriptAudioPreviewRef.current.playbackRate = scriptAudioPlaybackRate;
  }, [scriptAudioPlaybackRate]);

  return {
    generateScriptAudio,
    loadScriptAudioItems,
    playScriptAudioPreview,
    playingScriptAudioId,
    saveScriptAudioDisplayTranscript,
    saveScriptAudioVoiceInstructionsOverride,
    scriptAudioError,
    scriptAudioItems,
    scriptAudioPlaybackRate,
    scriptAudioStatus,
    setScriptAudioPlaybackRate,
    stopScriptAudioPreview,
  };
}
