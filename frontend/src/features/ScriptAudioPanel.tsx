import { useEffect, useRef, useState } from "react";

import { RefreshIcon, PlayIcon, StopIcon } from "../components/Icons";
import { scriptAudioPlaybackRateOptions } from "../scriptAudio";
import type { ScriptAudioDisplayPayload, ScriptAudioItem } from "../types";
import {
  displayBreaksAreEqual,
  displayDraftKey,
  displaySlotsAreEqual,
  normalizeDisplayBreaks,
  scriptAudioDisplayBaseSlots,
  scriptAudioPersistedDisplayBreaks,
  scriptAudioPersistedDisplaySlots,
} from "./scriptAudioDisplayUtils";
import { ScriptAudioDisplayEditor } from "./ScriptAudioDisplayEditor";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatScriptAudioDuration(durationSeconds: number | null) {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return "";
  if (durationSeconds < 60) return `${durationSeconds.toFixed(1)}s`;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimelineSeconds(durationSeconds: number | null) {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return "0.00s";
  if (durationSeconds < 60) return `${durationSeconds.toFixed(2)}s`;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

export function formatTimelineSecondsInput(durationSeconds: number) {
  return Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds).toFixed(2)
    : "0.00";
}

function scriptAudioMetadataText(item: ScriptAudioItem) {
  const pieces = [
    formatScriptAudioDuration(item.durationSeconds),
    item.wordCount ? `${item.wordCount} words` : "",
    item.voice ? item.voice : "",
  ].filter(Boolean);
  return pieces.length ? pieces.join(" / ") : "---";
}

function scriptAudioSourceList(item: ScriptAudioItem) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  const normalizedSources = sources
    .map((source) => (typeof source === "string" ? source.trim() : ""))
    .filter(Boolean);
  if (!normalizedSources.length && item.source) return [item.source];
  return [...new Set(normalizedSources)];
}

function scriptAudioItemIsReady(item: ScriptAudioItem) {
  return item.cached && item.wordsCached;
}

function scriptAudioItemNeedsGeneration(item: ScriptAudioItem) {
  return item.canGenerate && !scriptAudioItemIsReady(item);
}

function scriptAudioArtifactTags(item: ScriptAudioItem) {
  return [
    item.ttsModel ? `tts ${item.ttsModel}` : "",
    item.timingModel ? `timing ${item.timingModel}` : "",
    item.realtimeModel ? `chat ${item.realtimeModel}` : "",
    item.hasDisplayTranscript ? "display override" : "",
    item.markerCount ? `${item.markerCount} timed actions` : "",
    item.timedMarkerCount ? `${item.timedMarkerCount} aligned` : "",
    item.characterCount ? `${item.characterCount} chars` : "",
    item.cacheKey ? `cache ${item.cacheKey.slice(0, 10)}` : "",
  ].filter(Boolean);
}

function scriptAudioTimingPreviewText(item: ScriptAudioItem) {
  const words = item.timingPreview ?? [];
  if (!words.length) return "";

  return words
    .map((word) => {
      const start = Number.isFinite(word.start) ? word.start.toFixed(2) : "0.00";
      return `${word.word} ${start}s`;
    })
    .join(" / ");
}

function scriptAudioSpokenText(item: ScriptAudioItem) {
  return item.script || item.preview || "";
}

export function ScriptAudioPanel({
  error,
  isBusy,
  items,
  onGenerateAll,
  onGenerateOne,
  onPlay,
  onRegenerateAll,
  onRegenerateOne,
  onSaveDisplayTranscript,
  onStop,
  playingId,
  playbackRate,
  onPlaybackRateChange,
  status,
}: {
  error: string;
  isBusy: boolean;
  items: ScriptAudioItem[];
  onGenerateAll: () => void;
  onGenerateOne: (scriptId: string) => void;
  onPlay: (item: ScriptAudioItem) => void;
  onRegenerateAll: () => void;
  onRegenerateOne: (scriptId: string) => void;
  onSaveDisplayTranscript: (
    scriptId: string,
    displaySlots: string[],
    displayBreaks: number[],
  ) => Promise<ScriptAudioDisplayPayload>;
  onStop: () => void;
  playingId: string;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  status: "idle" | "loading" | "generating";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState("");
  const [displaySlotDrafts, setDisplaySlotDrafts] = useState<
    Record<string, string[]>
  >({});
  const [displayBreakDrafts, setDisplayBreakDrafts] = useState<
    Record<string, number[]>
  >({});
  const [savingDisplayId, setSavingDisplayId] = useState("");
  const saveDisplayTranscriptRef = useRef(onSaveDisplayTranscript);
  const failedDisplayAutosavesRef = useRef<Record<string, string>>({});
  const readyCount = items.filter(scriptAudioItemIsReady).length;
  const dynamicCount = items.filter((item) => !item.canGenerate).length;
  const generatableCount = items.filter((item) => item.canGenerate).length;
  const missingCount = items.filter(scriptAudioItemNeedsGeneration).length;
  const statusLabel =
    status === "generating"
      ? "Generating"
      : status === "loading"
        ? "Loading"
        : `${items.length} scripts`;
  const peekItem = items.find((item) => item.preview || item.source);
  const panelClassName = [
    "script-audio-panel",
    items.length ? "has-items" : "",
    isExpanded ? "is-expanded" : "is-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    saveDisplayTranscriptRef.current = onSaveDisplayTranscript;
  }, [onSaveDisplayTranscript]);

  useEffect(() => {
    if (savingDisplayId) return undefined;

    const pendingItem = items.find((item) => {
      const baseSlots = scriptAudioDisplayBaseSlots(item);
      const expectedSlotCount =
        baseSlots.length ||
        item.displayExpectedWordCount ||
        item.timingWordCount ||
        item.wordCount ||
        0;
      const persistedSlots = scriptAudioPersistedDisplaySlots(item);
      const persistedBreaks = scriptAudioPersistedDisplayBreaks(item);
      const draftSlots = displaySlotDrafts[item.id] ?? persistedSlots;
      const draftBreaks = normalizeDisplayBreaks(
        displayBreakDrafts[item.id] ?? persistedBreaks,
        draftSlots.length,
      );
      if (expectedSlotCount && draftSlots.length !== expectedSlotCount) {
        return false;
      }
      const draftKey = displayDraftKey(draftSlots, draftBreaks);
      if (failedDisplayAutosavesRef.current[item.id] === draftKey) {
        return false;
      }
      return (
        !displaySlotsAreEqual(draftSlots, persistedSlots) ||
        !displayBreaksAreEqual(draftBreaks, persistedBreaks)
      );
    });

    if (!pendingItem) return undefined;

    const scriptId = pendingItem.id;
    const persistedSlots = scriptAudioPersistedDisplaySlots(pendingItem);
    const persistedBreaks = scriptAudioPersistedDisplayBreaks(pendingItem);
    const draftSlots = displaySlotDrafts[scriptId] ?? persistedSlots;
    const draftBreaks = normalizeDisplayBreaks(
      displayBreakDrafts[scriptId] ?? persistedBreaks,
      draftSlots.length,
    );
    const draftKey = displayDraftKey(draftSlots, draftBreaks);
    const timeoutId = window.setTimeout(() => {
      setSavingDisplayId(scriptId);
      delete failedDisplayAutosavesRef.current[scriptId];
      void saveDisplayTranscriptRef.current(scriptId, draftSlots, draftBreaks)
        .then((payload) => {
          const savedSlots = scriptAudioPersistedDisplaySlots(payload);
          const savedBreaks = scriptAudioPersistedDisplayBreaks(payload);
          setDisplaySlotDrafts((current) => {
            const currentSlots = current[scriptId];
            if (!currentSlots || !displaySlotsAreEqual(currentSlots, draftSlots)) {
              return current;
            }
            return {
              ...current,
              [scriptId]: savedSlots,
            };
          });
          setDisplayBreakDrafts((current) => {
            const currentBreaks = normalizeDisplayBreaks(
              current[scriptId] ?? draftBreaks,
              savedSlots.length,
            );
            if (!displayBreaksAreEqual(currentBreaks, draftBreaks)) {
              return current;
            }
            return {
              ...current,
              [scriptId]: savedBreaks,
            };
          });
        })
        .catch(() => {
          failedDisplayAutosavesRef.current[scriptId] = draftKey;
        })
        .finally(() =>
          setSavingDisplayId((current) => (current === scriptId ? "" : current)),
        );
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [displayBreakDrafts, displaySlotDrafts, items, savingDisplayId]);

  return (
    <div className={panelClassName}>
      <div className="script-audio-topline">
        <button
          aria-expanded={isExpanded}
          className="script-audio-overview"
          onClick={() => setIsExpanded((current) => !current)}
          title={isExpanded ? "Collapse script audio list" : "Expand script audio list"}
          type="button"
        >
          <div className="script-audio-header-copy">
            <span>Script audio</span>
            <strong>{statusLabel}</strong>
            <em aria-hidden="true">{isExpanded ? "−" : "+"}</em>
          </div>
          <div className="script-audio-summary">
            <span>{readyCount}/{items.length} ready</span>
            {missingCount ? <span>{missingCount} missing</span> : null}
            {dynamicCount ? (
              <span title="Dynamic scripts contain template variables and are skipped by pregeneration for now.">
                {dynamicCount} dynamic
              </span>
            ) : null}
            {playingId ? <span>playing</span> : null}
          </div>
          {!isExpanded && peekItem ? (
            <div className="script-audio-peek">
              <strong>{peekItem.source}</strong>
              <span>{peekItem.preview || peekItem.script || "---"}</span>
            </div>
          ) : null}
        </button>
        <div className="script-audio-actions">
          {playingId ? (
            <button
              className="header-action secondary"
              onClick={onStop}
              title="Stop the current cached audio preview. Escape also stops playback."
              type="button"
            >
              Stop preview
            </button>
          ) : null}
          <label className="script-audio-speed">
            <span>Speed</span>
            <select
              aria-label="Script audio preview speed"
              onChange={(event) =>
                onPlaybackRateChange(Number(event.target.value) || 1)
              }
              value={String(playbackRate)}
            >
              {scriptAudioPlaybackRateOptions.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </label>
          <button
            className="header-action"
            disabled={isBusy || !missingCount}
            onClick={onGenerateAll}
            title={
              missingCount
                ? "Generate only scripts missing audio or word timing."
                : "No static scripts are missing audio or word timing."
            }
            type="button"
          >
            Generate missing
          </button>
          <button
            className="header-action secondary"
            disabled={isBusy || !generatableCount}
            onClick={onRegenerateAll}
            title="Regenerate every static script's audio and word timing from the current tutor settings."
            type="button"
          >
            Regenerate all
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="script-audio-list">
          {items.map((item) => {
            const isPlaying = playingId === item.id;
            const isReady = scriptAudioItemIsReady(item);
            const needsGeneration = scriptAudioItemNeedsGeneration(item);
            const preview = item.preview || "---";
            const artifactTags = scriptAudioArtifactTags(item);
            const isDetailExpanded = expandedItemId === item.id;
            const timingPreviewText = scriptAudioTimingPreviewText(item);
            const sources = scriptAudioSourceList(item);
            const sourceCount = item.sourceCount ?? sources.length;
            const spokenText = scriptAudioSpokenText(item);
            const displayBaseSlots = scriptAudioDisplayBaseSlots(item);
            const persistedDisplaySlots = scriptAudioPersistedDisplaySlots(item);
            const persistedDisplayBreaks = scriptAudioPersistedDisplayBreaks(item);
            const displaySlotDraft =
              displaySlotDrafts[item.id] ?? persistedDisplaySlots;
            const displayBreakDraft = normalizeDisplayBreaks(
              displayBreakDrafts[item.id] ?? persistedDisplayBreaks,
              displaySlotDraft.length,
            );
            const expectedDisplayWordCount =
              displayBaseSlots.length ||
              item.displayExpectedWordCount ||
              item.timingWordCount ||
              item.wordCount ||
              0;
            const visibleDisplayWordCount = displaySlotDraft.filter((slot) =>
              slot.trim(),
            ).length;
            const displayWordCountMatches =
              !expectedDisplayWordCount ||
              displaySlotDraft.length === expectedDisplayWordCount;
            const displayHasChanges =
              !displaySlotsAreEqual(displaySlotDraft, persistedDisplaySlots) ||
              !displayBreaksAreEqual(displayBreakDraft, persistedDisplayBreaks);
            const isSavingDisplay = savingDisplayId === item.id;
            const sourceLabel =
              sourceCount > 1
                ? `${item.source} +${sourceCount - 1}`
                : item.source;
            const toggleDisplayBreak = (slotIndex: number) => {
              setDisplayBreakDrafts((current) => {
                const currentBreaks = normalizeDisplayBreaks(
                  current[item.id] ?? displayBreakDraft,
                  displaySlotDraft.length,
                );
                const nextBreaks = [...currentBreaks, slotIndex].sort(
                  (left, right) => left - right,
                );
                return {
                  ...current,
                  [item.id]: nextBreaks,
                };
              });
            };
            const removeDisplayBreak = (slotIndex: number) => {
              setDisplayBreakDrafts((current) => {
                const currentBreaks = normalizeDisplayBreaks(
                  current[item.id] ?? displayBreakDraft,
                  displaySlotDraft.length,
                );
                const breakIndexToRemove = currentBreaks.indexOf(slotIndex);
                if (breakIndexToRemove === -1) {
                  return current;
                }
                const nextBreaks = currentBreaks.filter(
                  (_, breakIndex) => breakIndex !== breakIndexToRemove,
                );
                return {
                  ...current,
                  [item.id]: nextBreaks,
                };
              });
            };
            return (
              <div
                className={[
                  "script-audio-row",
                  isPlaying ? "is-playing" : "",
                  isDetailExpanded ? "is-expanded" : "",
                  item.canGenerate ? "" : "is-dynamic",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
              >
                <span
                  className="script-audio-source"
                  title={sources.join("\n")}
                >
                  {sourceLabel}
                </span>
                <span className="script-audio-preview" title={item.script || preview}>
                  {preview}
                </span>
                <span className="script-audio-meta">
                  {scriptAudioMetadataText(item)}
                </span>
                <button
                  aria-expanded={isDetailExpanded}
                  className="script-audio-detail-toggle"
                  onClick={() =>
                    setExpandedItemId((current) =>
                      current === item.id ? "" : item.id,
                    )
                  }
                  title="Show script text, cached artifact metadata, and timing preview."
                  type="button"
                >
                  {isDetailExpanded ? "Hide" : "Details"}
                </button>
                <button
                  aria-label={
                    isPlaying ? "Stop script audio preview" : "Play script audio preview"
                  }
                  className="event-icon-button"
                  disabled={!item.audioUrl}
                  onClick={() => (isPlaying ? onStop() : onPlay(item))}
                  title={
                    isPlaying
                      ? "Stop cached audio preview."
                      : "Play cached audio. Press Escape to stop."
                  }
                  type="button"
                >
                  {isPlaying ? <StopIcon /> : <PlayIcon />}
                </button>
                <button
                  aria-label={
                    isReady
                      ? "Regenerate script audio and timing"
                      : item.cached
                        ? "Generate missing word timing"
                        : "Generate script audio and timing"
                  }
                  className="event-icon-button"
                  disabled={isBusy || !item.canGenerate}
                  onClick={() =>
                    isReady ? onRegenerateOne(item.id) : onGenerateOne(item.id)
                  }
                  title={
                    isReady
                      ? "Regenerate this script's audio and timing"
                      : needsGeneration
                        ? "Generate this script's missing audio or word timing"
                        : item.generationReason ||
                          "Dynamic scripts cannot be pregenerated yet."
                  }
                  type="button"
                >
                  <RefreshIcon />
                </button>
                {isDetailExpanded ? (
                  <div className="script-audio-details">
                    <div className="script-audio-detail-grid">
                      <span>
                        <strong>Markers</strong>
                        {item.markerCount || 0}
                      </span>
                      <span>
                        <strong>Aligned</strong>
                        {item.timedMarkerCount || 0}/{item.markerCount || 0}
                      </span>
                      <span>
                        <strong>Words</strong>
                        {item.timingWordCount || item.wordCount || 0}
                      </span>
                      <span>
                        <strong>Subtitle source</strong>
                        {item.hasDisplayTranscript
                          ? "display override"
                          : item.timingWordCount
                            ? "timed words"
                            : "spoken script"}
                      </span>
                    </div>
                    {artifactTags.length ? (
                      <div className="script-audio-artifacts">
                        {artifactTags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {sources.length > 1 ? (
                      <div
                        aria-label="Script audio source locations"
                        className="script-audio-artifacts"
                      >
                        {sources.map((source) => (
                          <span key={source}>{source}</span>
                        ))}
                      </div>
                    ) : null}
                    <p className="script-audio-script-text">
                      {spokenText || preview}
                    </p>
                    <ScriptAudioDisplayEditor
                      displayBaseSlots={displayBaseSlots}
                      displayBreakDraft={displayBreakDraft}
                      displayHasChanges={displayHasChanges}
                      displaySlotDraft={displaySlotDraft}
                      displayWordCountMatches={displayWordCountMatches}
                      expectedDisplayWordCount={expectedDisplayWordCount}
                      isSavingDisplay={isSavingDisplay}
                      item={item}
                      onRemoveBreak={removeDisplayBreak}
                      onReset={() => {
                        setDisplaySlotDrafts((current) => ({
                          ...current,
                          [item.id]: displayBaseSlots,
                        }));
                        setDisplayBreakDrafts((current) => ({
                          ...current,
                          [item.id]: [],
                        }));
                        if (item.hasDisplayTranscript) {
                          setSavingDisplayId(item.id);
                          void onSaveDisplayTranscript(item.id, displayBaseSlots, [])
                            .then((payload) => {
                              setDisplaySlotDrafts((current) => ({
                                ...current,
                                [item.id]: scriptAudioPersistedDisplaySlots(payload),
                              }));
                              setDisplayBreakDrafts((current) => ({
                                ...current,
                                [item.id]: scriptAudioPersistedDisplayBreaks(payload),
                              }));
                            })
                            .catch(() => {
                              failedDisplayAutosavesRef.current[item.id] =
                                displayDraftKey(displayBaseSlots, []);
                            })
                            .finally(() =>
                              setSavingDisplayId((current) =>
                                current === item.id ? "" : current,
                              ),
                            );
                        }
                      }}
                      onSlotChange={(index, nextValue) => {
                        setDisplaySlotDrafts((current) => {
                          const nextSlots = [
                            ...(current[item.id] ?? displaySlotDraft),
                          ];
                          nextSlots[index] = nextValue;
                          return {
                            ...current,
                            [item.id]: nextSlots,
                          };
                        });
                      }}
                      onToggleBreak={toggleDisplayBreak}
                      visibleDisplayWordCount={visibleDisplayWordCount}
                    />
                    {timingPreviewText ? (
                      <code className="script-audio-timing-preview">
                        {timingPreviewText}
                      </code>
                    ) : (
                      <p className="script-audio-no-timing">
                        Word timing appears here after audio timing is generated.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!items.length ? <div className="script-audio-empty">---</div> : null}
        </div>
      ) : null}
      {error ? <p className="control-error">{error}</p> : null}
    </div>
  );
}
