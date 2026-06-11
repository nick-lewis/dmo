import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../api";
import { MicIcon, StopIcon, TrashIcon } from "../components/Icons";
import {
  type RealtimeModelId,
  type RealtimeVoiceId,
  realtimeModelOptions,
  realtimeVoiceOptions,
} from "../realtime";
import type {
  ApiUser,
  VoicePersonalityLabGroup,
  VoicePersonalityLabPayload,
  VoicePersonalityLabSample,
} from "../types";


type LabStatus = "loading" | "ready" | "saving" | "generating" | "deleting" | "error";


function voiceLabel(voice: RealtimeVoiceId) {
  return realtimeVoiceOptions.find((option) => option.id === voice)?.label ?? voice;
}


function formatDuration(seconds: number | null) {
  if (!Number.isFinite(seconds) || !seconds) return "Ready";
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}


function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}


function buildRealtimeScriptInstructions(voiceInstructions: string) {
  const sections = [
    [
      "# Role and Objective",
      "You are a scripted realtime speech renderer for a tutoring assistant. Your only objective is to speak the script text exactly as provided inside <script_to_speak>...</script_to_speak>.",
    ].join("\n"),
    [
      "# Script Rules",
      "Speak all non-direction text inside <script_to_speak> verbatim, from the first character through the last. Do not speak the script boundary tags. Do not answer, confirm, summarize, rewrite, add greetings, add sign-offs, add labels, add commentary, or add extra words. If the script asks a question such as 'sound good?' or 'does that make sense?', speak that question exactly and then stop. Treat text in curly braces as private performance direction, not spoken text.",
    ].join("\n"),
  ];
  const trimmedInstructions = voiceInstructions.trim();
  if (trimmedInstructions) {
    sections.push(["# Personality and Tone", trimmedInstructions].join("\n"));
  }
  return sections.join("\n\n");
}


function realtimeScriptInput(script: string) {
  return `<script_to_speak>\n${script.trim()}\n</script_to_speak>`;
}


function selectedGroupFromPayload(
  payload: VoicePersonalityLabPayload | null,
  selectedGroupId: string,
) {
  if (!payload) return null;
  return (
    payload.groups.find((group) => group.id === selectedGroupId) ??
    payload.groups.find((group) => group.id === payload.activeGroupId) ??
    payload.groups[0] ??
    null
  );
}


function nextSelectedGroupId(
  payload: VoicePersonalityLabPayload,
  currentGroupId = "",
) {
  if (payload.activeGroupId) return payload.activeGroupId;
  if (currentGroupId && payload.groups.some((group) => group.id === currentGroupId)) {
    return currentGroupId;
  }
  return payload.groups[0]?.id ?? "";
}


export function VoicePersonalityLab() {
  const navigate = useNavigate();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [payload, setPayload] = useState<VoicePersonalityLabPayload | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [realtimeModel, setRealtimeModel] =
    useState<RealtimeModelId>("gpt-realtime-2");
  const [voiceInstructions, setVoiceInstructions] = useState("");
  const [status, setStatus] = useState<LabStatus>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [playingCacheKey, setPlayingCacheKey] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedGroup = selectedGroupFromPayload(payload, selectedGroupId);
  const promptPreviewScript = payload?.script ?? "";
  const isBusy =
    status === "loading" ||
    status === "saving" ||
    status === "generating" ||
    status === "deleting";

  useEffect(() => {
    let isCancelled = false;

    async function loadLab() {
      setStatus("loading");
      setError("");

      try {
        const [me, labPayload] = await Promise.all([
          apiFetch<{ user: ApiUser }>("/api/auth/me/"),
          apiFetch<VoicePersonalityLabPayload>("/api/voice-personality-lab/"),
        ]);
        if (isCancelled) return;

        setUser(me.user);
        setPayload(labPayload);
        setRealtimeModel(labPayload.defaultRealtimeModel);
        setSelectedGroupId(nextSelectedGroupId(labPayload));
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load voice lab.",
        );
      }
    }

    void loadLab();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function applyPayload(nextPayload: VoicePersonalityLabPayload, groupId = "") {
    setPayload(nextPayload);
    setSelectedGroupId(nextSelectedGroupId(nextPayload, groupId || selectedGroupId));
    if (nextPayload.errors?.length) {
      setNotice(nextPayload.errors.join(" "));
    } else if (typeof nextPayload.generated === "number") {
      setNotice(
        nextPayload.generated > 0
          ? `Rendered ${nextPayload.generated} audio files.`
          : "All audio files were already cached.",
      );
    } else {
      setNotice("");
    }
  }

  async function savePersonality() {
    if (isBusy) return;

    setStatus("saving");
    setError("");
    setNotice("");

    try {
      const nextPayload = await apiFetch<VoicePersonalityLabPayload>(
        "/api/voice-personality-lab/",
        {
          method: "POST",
          body: JSON.stringify({
            realtimeModel,
            voiceInstructions,
          }),
        },
      );
      applyPayload(nextPayload);
      setStatus("ready");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save personality.",
      );
      setStatus("ready");
    }
  }

  async function generateGroup(group: VoicePersonalityLabGroup, force = false) {
    if (isBusy) return;

    setStatus("generating");
    setError("");
    setNotice("");

    try {
      const nextPayload = await apiFetch<VoicePersonalityLabPayload>(
        `/api/voice-personality-lab/${encodeURIComponent(group.id)}/generate/`,
        {
          method: "POST",
          body: JSON.stringify({ force }),
        },
      );
      applyPayload(nextPayload, group.id);
      setStatus("ready");
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not render voice samples.",
      );
      setStatus("ready");
    }
  }

  async function deleteGroup(group: VoicePersonalityLabGroup) {
    if (isBusy) return;
    if (!window.confirm("Delete this saved personality?")) return;

    setStatus("deleting");
    setError("");
    setNotice("");

    try {
      const nextPayload = await apiFetch<VoicePersonalityLabPayload>(
        `/api/voice-personality-lab/${encodeURIComponent(group.id)}/`,
        {
          method: "DELETE",
        },
      );
      applyPayload(nextPayload);
      setStatus("ready");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete personality.",
      );
      setStatus("ready");
    }
  }

  async function playSample(sample: VoicePersonalityLabSample) {
    if (!sample.audioUrl) return;

    if (playingCacheKey === sample.cacheKey) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingCacheKey("");
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(sample.audioUrl);
    audioRef.current = audio;
    setPlayingCacheKey(sample.cacheKey);
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCacheKey("");
      }
    };
    audio.onerror = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCacheKey("");
        setError("Could not play the cached audio file.");
      }
    };

    try {
      await audio.play();
    } catch {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCacheKey("");
      }
      setError("Could not play the cached audio file.");
    }
  }

  function loadGroupAsDraft(group: VoicePersonalityLabGroup) {
    setRealtimeModel(group.realtimeModel);
    setVoiceInstructions(group.voiceInstructions);
    setSelectedGroupId(group.id);
  }

  return (
    <main
      className="panel-study voice-lab-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">dLU</p>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action secondary"
            onClick={() => navigate("/experiences")}
            type="button"
          >
            Experiences
          </button>
        </div>
      </header>

      <section className="voice-lab">
        <div className="voice-lab-title">
          <h1>Voice Lab</h1>
          {payload ? (
            <span>
              {payload.totalGroups} saved
            </span>
          ) : null}
        </div>

        <div className="voice-lab-grid">
          <section className="voice-lab-composer" aria-label="New personality">
            <label className="control-field">
              <span>Model</span>
              <select
                disabled={isBusy}
                onChange={(event) =>
                  setRealtimeModel(event.target.value as RealtimeModelId)
                }
                value={realtimeModel}
              >
                {realtimeModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Personality and tone</span>
              <textarea
                className="prompt-textarea voice-lab-textarea"
                disabled={isBusy}
                onChange={(event) => setVoiceInstructions(event.target.value)}
                placeholder="Warm, curious, direct..."
                rows={7}
                value={voiceInstructions}
              />
            </label>

            <div className="voice-lab-script">
              <span>Phrase</span>
              <p>{payload?.script ?? ""}</p>
            </div>

            <div className="voice-lab-prompt-preview">
              <span>Prompt</span>
              <label>
                <strong>Instructions</strong>
                <pre>{buildRealtimeScriptInstructions(voiceInstructions)}</pre>
              </label>
              <label>
                <strong>Input</strong>
                <pre>{realtimeScriptInput(promptPreviewScript)}</pre>
              </label>
            </div>

            <button
              className="header-action voice-lab-save"
              disabled={isBusy}
              onClick={() => void savePersonality()}
              type="button"
            >
              {status === "saving" ? "Rendering..." : "Save and Render"}
            </button>
          </section>

          <section className="voice-lab-library" aria-label="Saved personalities">
            {status === "loading" ? (
              <div className="experience-state">Loading voice lab...</div>
            ) : null}
            {status === "error" ? (
              <div className="experience-state error">{error}</div>
            ) : null}
            {status !== "loading" && payload && payload.groups.length === 0 ? (
              <div className="experience-state">No saved personalities yet.</div>
            ) : null}

            <div className="voice-lab-group-list">
              {payload?.groups.map((group) => {
                const isSelected = selectedGroup?.id === group.id;

                return (
                  <div
                    className={`voice-lab-group-row${isSelected ? " is-selected" : ""}`}
                    key={group.id}
                  >
                    <button
                      className="voice-lab-group-main"
                      onClick={() => setSelectedGroupId(group.id)}
                      type="button"
                    >
                      <span className="voice-lab-group-meta">
                        {group.realtimeModel} · {group.cachedCount}/{group.sampleCount}
                      </span>
                      <strong>
                        {group.voiceInstructions || "No extra personality text"}
                      </strong>
                      <span>{formatTimestamp(group.updatedAt)}</span>
                    </button>
                    <div className="voice-lab-group-actions">
                      <button
                        className="header-action secondary"
                        disabled={isBusy}
                        onClick={() => loadGroupAsDraft(group)}
                        type="button"
                      >
                        Load
                      </button>
                      <button
                        className="header-action secondary"
                        disabled={isBusy}
                        onClick={() => void generateGroup(group)}
                        type="button"
                      >
                        {status === "generating" && isSelected ? "Rendering..." : "Render"}
                      </button>
                      <button
                        aria-label="Delete personality"
                        className="experience-delete-button voice-lab-delete"
                        disabled={isBusy}
                        onClick={() => void deleteGroup(group)}
                        title="Delete personality"
                        type="button"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {selectedGroup ? (
          <section className="voice-lab-samples" aria-label="Voice samples">
            <div className="voice-lab-samples-head">
              <div>
                <span>{selectedGroup.realtimeModel}</span>
                <strong>
                  {selectedGroup.cachedCount}/{selectedGroup.sampleCount} ready
                </strong>
              </div>
              <button
                className="header-action secondary"
                disabled={isBusy}
                onClick={() => void generateGroup(selectedGroup)}
                type="button"
              >
                {status === "generating" ? "Rendering..." : "Render Missing"}
              </button>
            </div>

            <div className="voice-lab-sample-grid">
              {selectedGroup.samples.map((sample) => {
                const isPlaying = playingCacheKey === sample.cacheKey;
                const sampleStatus = sample.error
                  ? "Error"
                  : sample.cached
                    ? formatDuration(sample.durationSeconds)
                    : "Missing";

                return (
                  <button
                    aria-label={`${isPlaying ? "Stop" : "Play"} ${voiceLabel(sample.voice)}`}
                    className={`voice-lab-sample-button${isPlaying ? " is-playing" : ""}`}
                    disabled={!sample.audioUrl || Boolean(sample.error)}
                    key={sample.voice}
                    onClick={() => void playSample(sample)}
                    title={sample.error || sampleStatus}
                    type="button"
                  >
                    {isPlaying ? <StopIcon /> : <MicIcon />}
                    <span>{voiceLabel(sample.voice)}</span>
                    <small>{sampleStatus}</small>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {notice ? <p className="voice-lab-notice">{notice}</p> : null}
        {error && status !== "error" ? (
          <p className="control-error voice-lab-error">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
