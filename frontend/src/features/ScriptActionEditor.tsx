import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiFetch } from "../api";
import { publicAsset } from "../assets";
import {
  appendScriptMarkerTimelineArg,
  buildScriptMarker,
  countScriptWords,
  normalizeScriptAudioText,
  parseScriptMarkerInstances,
  scriptMarkerDragDataType,
  scriptMarkerIcon,
  scriptMarkerOptions,
  scriptMarkerEditKey,
  scriptMarkerEditKeyFrom,
  spokenTextFromMarkedScript,
  type ScriptEditorViewMode,
  type ScriptMarkerInstance,
  type ScriptSlidePreview,
} from "../scriptMarkers";
import {
  formatTimelineSeconds,
  formatTimelineSecondsInput,
} from "./ScriptAudioPanel";
import {
  scriptAudioPlaybackRateOptions,
} from "../scriptAudio";
import { resizeTextareaToContent } from "../uiHelpers";
import type { ResolvedSlide, ScriptAudioItem } from "../types";
import {
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "../components/Icons";
import { ScriptMarkerEditor } from "./ScriptMarkerEditor";
import {
  clamp,
  clickIndexForTextTarget,
  dropIndexForTextTarget,
  isSlideMarker,
  isVisualPanelMarker,
  markerTimelineTimeSeconds,
  menuCoordinate,
  nextAvailableSlideRef,
  scriptSlideTextareaMaxHeightPx,
  scriptSlideTextareaMinHeightPx,
  scriptTextareaMaxHeightPx,
  scriptTextareaMinHeightPx,
  slidePreviewKeyForDeck,
  timelinePointerTime,
} from "./scriptActionEditorUtils";
import {
  ScriptActionMenu,
  type ScriptActionMenuState,
} from "./ScriptActionMenu";

export function ScriptActionEditor({
  deckUrl,
  onDeckUrlChange,
  onTextChange,
  scriptAudioItems = [],
  text,
}: {
  deckUrl: string;
  onDeckUrlChange: (value: string) => void;
  onTextChange: (value: string) => void;
  scriptAudioItems?: ScriptAudioItem[];
  text: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chipViewRef = useRef<HTMLDivElement | null>(null);
  const slideTableRef = useRef<HTMLDivElement | null>(null);
  const timelineAudioRef = useRef<HTMLAudioElement | null>(null);
  const timelineRailRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuTextInputRef = useRef<HTMLInputElement | null>(null);
  const [viewMode, setViewMode] = useState<ScriptEditorViewMode>(() => {
    try {
      const saved = window.localStorage.getItem("dlu.script-editor-view.v1");
      if (saved === "chips" || saved === "slides" || saved === "timeline") {
        return saved;
      }
    } catch {
      // Ignore storage failures.
    }
    return "chips";
  });
  const [slidePreviews, setSlidePreviews] = useState<
    Record<string, ScriptSlidePreview>
  >({});
  const [editingMarkerKey, setEditingMarkerKey] = useState<string | null>(null);
  const [draggingMarkerKey, setDraggingMarkerKey] = useState<string | null>(null);
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(
    null,
  );
  const [scriptInsertionIndex, setScriptInsertionIndex] = useState<number | null>(
    null,
  );
  const [scriptActionMenu, setScriptActionMenu] =
    useState<ScriptActionMenuState | null>(null);
  const [scriptActionMenuText, setScriptActionMenuText] = useState("");
  const [soundPreviewKey, setSoundPreviewKey] = useState<string | null>(null);
  const [timelineCurrentTime, setTimelineCurrentTime] = useState(0);
  const [timelineDraggingIndex, setTimelineDraggingIndex] = useState<number | null>(
    null,
  );
  const [timelineDraggingTimeSeconds, setTimelineDraggingTimeSeconds] =
    useState<number | null>(null);
  const [timelineIsPlaying, setTimelineIsPlaying] = useState(false);
  const [timelineSeekableAudioUrl, setTimelineSeekableAudioUrl] = useState("");
  const [timelinePlaybackRate, setTimelinePlaybackRate] = useState(() => {
    try {
      const saved = Number(
        window.localStorage.getItem("dlu.script-timeline-speed.v1"),
      );
      return scriptAudioPlaybackRateOptions.includes(
        saved as (typeof scriptAudioPlaybackRateOptions)[number],
      )
        ? saved
        : 1;
    } catch {
      return 1;
    }
  });
  const [timelineScrubTime, setTimelineScrubTime] = useState<number | null>(null);
  const soundPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const timelineDraggingRef = useRef(false);
  const timelineMarkerDragOffsetRef = useRef(0);
  const timelineMarkerDragMovedRef = useRef(false);
  const timelineScrubTimeRef = useRef(0);
  const timelineScrubbingRef = useRef(false);
  const markers = parseScriptMarkerInstances(text);
  const spokenTimelineText = spokenTextFromMarkedScript(text);
  const spokenTimelineWordCount = countScriptWords(spokenTimelineText);
  const timelineAudioItem =
    scriptAudioItems.find(
      (item) => normalizeScriptAudioText(item.script || "") === spokenTimelineText,
    ) ?? null;
  const timelineWords = timelineAudioItem?.timingWords ?? [];
  const timelineAudioUrl = timelineAudioItem?.audioUrl ?? "";
  const timelineAudioSrc = timelineSeekableAudioUrl || timelineAudioUrl;
  const timelineDurationSeconds = Math.max(
    0,
    timelineAudioItem?.durationSeconds ||
      timelineWords[timelineWords.length - 1]?.end ||
      0,
  );
  const editingMarker =
    editingMarkerKey === null
      ? null
      : markers.find((marker) => scriptMarkerEditKey(marker) === editingMarkerKey) ??
        null;
  const slidePreviewRefs = Array.from(
    new Set(
      markers
        .filter((marker) => isSlideMarker(marker))
        .map((marker) => marker.argList[0]?.trim() || "1"),
    ),
  );
  const slidePreviewKey = slidePreviewRefs.join("\u001f");

  useEffect(() => {
    if (viewMode !== "text") return;

    let firstFrame = 0;
    let secondFrame = 0;
    const resizeScriptTextarea = () =>
      resizeTextareaToContent(textareaRef.current, {
        maxHeight: scriptTextareaMaxHeightPx,
        minHeight: scriptTextareaMinHeightPx,
      });

    resizeScriptTextarea();
    firstFrame = window.requestAnimationFrame(() => {
      resizeScriptTextarea();
      secondFrame = window.requestAnimationFrame(resizeScriptTextarea);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [text, viewMode]);

  useEffect(() => {
    if (viewMode !== "slides") return;

    let firstFrame = 0;
    let secondFrame = 0;
    const resizeSlideTextareas = () => {
      slideTableRef.current
        ?.querySelectorAll<HTMLTextAreaElement>(".script-slide-textarea")
        .forEach((textarea) =>
          resizeTextareaToContent(textarea, {
            maxHeight: scriptSlideTextareaMaxHeightPx,
            minHeight: scriptSlideTextareaMinHeightPx,
          }),
        );
    };

    resizeSlideTextareas();
    firstFrame = window.requestAnimationFrame(() => {
      resizeSlideTextareas();
      secondFrame = window.requestAnimationFrame(resizeSlideTextareas);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [text, viewMode]);

  useEffect(() => {
    return () => {
      soundPreviewAudioRef.current?.pause();
      soundPreviewAudioRef.current = null;
      timelineAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = "";
    setTimelineSeekableAudioUrl("");

    if (!timelineAudioUrl) return undefined;

    void fetch(timelineAudioUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load timeline audio.");
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setTimelineSeekableAudioUrl(objectUrl);
      })
      .catch(() => {
        if (!isCancelled) setTimelineSeekableAudioUrl(timelineAudioUrl);
      });

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [timelineAudioUrl]);

  useEffect(() => {
    const audio = timelineAudioRef.current;
    if (!audio) return undefined;
    audio.playbackRate = timelinePlaybackRate;

    const syncTime = () => {
      if (timelineScrubbingRef.current || timelineDraggingRef.current) return;
      if (audio.paused) return;
      setTimelineCurrentTime(audio.currentTime || 0);
    };
    const syncPlayState = () => setTimelineIsPlaying(!audio.paused);
    const handleEnded = () => {
      setTimelineIsPlaying(false);
      setTimelineCurrentTime(
        clamp(
          audio.currentTime ||
            (Number.isFinite(audio.duration) ? audio.duration : timelineDurationSeconds),
          0,
          timelineDurationSeconds || 0,
        ),
      );
    };

    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("loadedmetadata", syncTime);
    audio.addEventListener("play", syncPlayState);
    audio.addEventListener("pause", syncPlayState);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("loadedmetadata", syncTime);
      audio.removeEventListener("play", syncPlayState);
      audio.removeEventListener("pause", syncPlayState);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [timelineAudioUrl, timelineDurationSeconds, timelinePlaybackRate, viewMode]);

  useEffect(() => {
    const audio = timelineAudioRef.current;
    if (audio) {
      audio.playbackRate = timelinePlaybackRate;
    }
    try {
      window.localStorage.setItem(
        "dlu.script-timeline-speed.v1",
        String(timelinePlaybackRate),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [timelinePlaybackRate]);

  useEffect(() => {
    const audio = timelineAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setTimelineCurrentTime(0);
    setTimelineIsPlaying(false);
    setTimelineDraggingIndex(null);
    setTimelineDraggingTimeSeconds(null);
    setTimelineScrubTime(null);
    timelineDraggingRef.current = false;
    timelineMarkerDragOffsetRef.current = 0;
    timelineMarkerDragMovedRef.current = false;
    timelineScrubTimeRef.current = 0;
    timelineScrubbingRef.current = false;
  }, [timelineAudioUrl]);

  useEffect(() => {
    if (!scriptActionMenu) return;

    const focusFrame = window.requestAnimationFrame(() => {
      const menu = actionMenuRef.current;
      if (menu) {
        const rect = menu.getBoundingClientRect();
        const nextViewportX = menuCoordinate(rect.x, rect.width, window.innerWidth);
        const nextViewportY = menuCoordinate(rect.y, rect.height, window.innerHeight);
        const nextX = Math.round(scriptActionMenu.x + nextViewportX - rect.x);
        const nextY = Math.round(scriptActionMenu.y + nextViewportY - rect.y);
        if (nextX !== scriptActionMenu.x || nextY !== scriptActionMenu.y) {
          setScriptActionMenu((current) =>
            current
              ? {
                  ...current,
                  x: nextX,
                  y: nextY,
                }
              : current,
          );
        }
      }
      actionMenuTextInputRef.current?.focus({ preventScroll: true });
    });

    function closeFromOutside(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && actionMenuRef.current?.contains(target)) {
        return;
      }
      setScriptActionMenu(null);
      setScriptActionMenuText("");
    }

    function closeFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setScriptActionMenu(null);
      setScriptActionMenuText("");
    }

    function closeFromLayoutChange() {
      setScriptActionMenu(null);
      setScriptActionMenuText("");
    }

    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromEscape);
    window.addEventListener("resize", closeFromLayoutChange);
    window.addEventListener("scroll", closeFromLayoutChange, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromEscape);
      window.removeEventListener("resize", closeFromLayoutChange);
      window.removeEventListener("scroll", closeFromLayoutChange, true);
    };
  }, [scriptActionMenu]);

  useEffect(() => {
    if (scriptInsertionIndex === null || scriptInsertionIndex <= text.length) return;
    setScriptInsertionIndex(text.length);
  }, [scriptInsertionIndex, text.length]);

  useEffect(() => {
    if (editingMarkerKey !== null && editingMarker === null) {
      setEditingMarkerKey(null);
    }
  }, [editingMarker, editingMarkerKey]);

  useEffect(() => {
    if (viewMode === "text" || !deckUrl.trim() || !slidePreviewRefs.length) {
      return;
    }

    let isCancelled = false;
    slidePreviewRefs.forEach((slideRef) => {
      const key = slidePreviewKeyForDeck(deckUrl, slideRef);
      setSlidePreviews((current) => ({
        ...current,
        [key]: current[key]?.status === "ready" ? current[key] : { status: "loading" },
      }));
      void resolveSlidePreview(slideRef).catch(() => {
        if (isCancelled) return;
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [deckUrl, slidePreviewKey, viewMode]);

  function changeViewMode(nextMode: ScriptEditorViewMode) {
    setViewMode(nextMode);
    try {
      window.localStorage.setItem("dlu.script-editor-view.v1", nextMode);
    } catch {
      // Ignore storage failures.
    }
  }

  async function resolveSlidePreview(slideRef: string, forceRefresh = false) {
    const normalizedSlideRef = slideRef.trim() || "1";
    const key = slidePreviewKeyForDeck(deckUrl, normalizedSlideRef);
    if (!deckUrl.trim()) {
      setSlidePreviews((current) => ({
        ...current,
        [key]: { detail: "No deck URL", status: "idle" },
      }));
      return;
    }

    setSlidePreviews((current) => ({
      ...current,
      [key]: { status: "loading" },
    }));

    try {
      const payload = await apiFetch<ResolvedSlide>("/api/slides/resolve/", {
        method: "POST",
        body: JSON.stringify({
          deckUrl,
          forceRefresh,
          slideRef: normalizedSlideRef,
        }),
      });
      setSlidePreviews((current) => ({
        ...current,
        [key]: {
          detail: payload.pageId,
          imageUrl: `${payload.imageUrl}?v=${Date.now()}`,
          status: "ready",
        },
      }));
    } catch (error) {
      setSlidePreviews((current) => ({
        ...current,
        [key]: {
          detail: error instanceof Error ? error.message : "Slide unavailable",
          status: "error",
        },
      }));
    }
  }

  function currentScriptInsertionIndex() {
    const textarea = textareaRef.current;
    if (viewMode === "text" && textarea) {
      return Math.round(clamp(textarea.selectionStart ?? text.length, 0, text.length));
    }
    return Math.round(clamp(scriptInsertionIndex ?? text.length, 0, text.length));
  }

  function insertMarker(marker: string, insertionIndex?: number) {
    const textarea = textareaRef.current;
    const isTextMode = viewMode === "text";
    const hasExplicitInsertionIndex = typeof insertionIndex === "number";
    const start = hasExplicitInsertionIndex
      ? Math.round(clamp(insertionIndex, 0, text.length))
      : currentScriptInsertionIndex();
    const end =
      isTextMode && !hasExplicitInsertionIndex
        ? textarea?.selectionEnd ?? start
        : start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = after && !/^\s/.test(after) ? " " : "";
    const inserted = `${lead}${marker}${tail}`;
    const nextText = `${before}${inserted}${after}`;
    const markerStart = before.length + lead.length;
    const markerEnd = markerStart + marker.length;
    const nextCursor = before.length + inserted.length;

    onTextChange(nextText);
    setScriptInsertionIndex(markerEnd);
    setEditingMarkerKey(scriptMarkerEditKeyFrom(markerStart, markerEnd, marker));
    if (!isTextMode) {
      return;
    }

    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(nextTextarea, {
        maxHeight: scriptTextareaMaxHeightPx,
        minHeight: scriptTextareaMinHeightPx,
      });
    });
  }

  function insertPlainScriptText(snippet: string, insertionIndex: number) {
    const cleanSnippet = snippet.trim();
    if (!cleanSnippet) return;

    const start = Math.round(clamp(insertionIndex, 0, text.length));
    const before = text.slice(0, start);
    const after = text.slice(start);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = after && !/^\s/.test(after) ? " " : "";
    const inserted = `${lead}${cleanSnippet}${tail}`;
    const nextText = `${before}${inserted}${after}`;
    const nextCursor = before.length + inserted.length;

    onTextChange(nextText);
    setEditingMarkerKey(null);
    setScriptInsertionIndex(nextCursor);

    if (viewMode !== "text") return;
    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(nextTextarea, {
        maxHeight: scriptTextareaMaxHeightPx,
        minHeight: scriptTextareaMinHeightPx,
      });
    });
  }

  function replaceScriptRange(start: number, end: number, nextValue: string) {
    const safeStart = Math.round(clamp(start, 0, text.length));
    const safeEnd = Math.round(clamp(end, safeStart, text.length));
    const nextText = `${text.slice(0, safeStart)}${nextValue}${text.slice(
      safeEnd,
    )}`;
    onTextChange(nextText);
    setScriptInsertionIndex(safeStart + nextValue.length);
  }

  function markerContainingIndex(index: number) {
    return markers.find((marker) => index > marker.start && index < marker.end);
  }

  function normalizeEditableScriptIndex(
    index: number,
    bias: "before" | "after" = "after",
  ) {
    const safeIndex = Math.round(clamp(index, 0, text.length));
    const containingMarker = markerContainingIndex(safeIndex);
    if (!containingMarker) return safeIndex;
    return bias === "before" ? containingMarker.start : containingMarker.end;
  }

  function previousEditableScriptIndex(index: number) {
    const safeIndex = normalizeEditableScriptIndex(index, "before");
    if (safeIndex <= 0) return 0;

    const markerBefore = markers.find((marker) => marker.end === safeIndex);
    if (markerBefore) return markerBefore.start;

    const candidate = safeIndex - 1;
    const containingMarker = markers.find(
      (marker) => candidate >= marker.start && candidate < marker.end,
    );
    return containingMarker ? containingMarker.start : candidate;
  }

  function nextEditableScriptIndex(index: number) {
    const safeIndex = normalizeEditableScriptIndex(index, "after");
    if (safeIndex >= text.length) return text.length;

    const markerAfter = markers.find((marker) => marker.start === safeIndex);
    if (markerAfter) return markerAfter.end;

    const candidate = safeIndex + 1;
    const containingMarker = markers.find(
      (marker) => candidate > marker.start && candidate <= marker.end,
    );
    return containingMarker ? containingMarker.end : candidate;
  }

  function focusChipView() {
    chipViewRef.current?.focus({ preventScroll: true });
  }

  function setChipInsertionIndex(index: number, bias: "before" | "after" = "after") {
    setScriptInsertionIndex(normalizeEditableScriptIndex(index, bias));
    setEditingMarkerKey(null);
  }

  function insertTextAtChipCursor(insertedText: string) {
    if (!insertedText) return;
    const insertionIndex = normalizeEditableScriptIndex(
      scriptInsertionIndex ?? text.length,
    );
    const nextText = `${text.slice(0, insertionIndex)}${insertedText}${text.slice(
      insertionIndex,
    )}`;
    onTextChange(nextText);
    setScriptInsertionIndex(insertionIndex + insertedText.length);
    setEditingMarkerKey(null);
  }

  function backspaceChipText() {
    const cursor = normalizeEditableScriptIndex(
      scriptInsertionIndex ?? text.length,
      "before",
    );
    if (cursor <= 0) return;

    const markerBefore = markers.find((marker) => marker.end === cursor);
    if (markerBefore) {
      setChipInsertionIndex(markerBefore.start, "before");
      return;
    }

    const previousIndex = previousEditableScriptIndex(cursor);
    onTextChange(`${text.slice(0, previousIndex)}${text.slice(cursor)}`);
    setScriptInsertionIndex(previousIndex);
    setEditingMarkerKey(null);
  }

  function deleteChipText() {
    const cursor = normalizeEditableScriptIndex(
      scriptInsertionIndex ?? text.length,
    );
    if (cursor >= text.length) return;

    const markerAfter = markers.find((marker) => marker.start === cursor);
    if (markerAfter) {
      setChipInsertionIndex(markerAfter.end);
      return;
    }

    const nextIndex = nextEditableScriptIndex(cursor);
    onTextChange(`${text.slice(0, cursor)}${text.slice(nextIndex)}`);
    setScriptInsertionIndex(cursor);
    setEditingMarkerKey(null);
  }

  function handleChipViewKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setChipInsertionIndex(
        previousEditableScriptIndex(scriptInsertionIndex ?? text.length),
        "before",
      );
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setChipInsertionIndex(nextEditableScriptIndex(scriptInsertionIndex ?? 0));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setChipInsertionIndex(0, "before");
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setChipInsertionIndex(text.length);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      backspaceChipText();
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      deleteChipText();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      insertTextAtChipCursor("\n");
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      insertTextAtChipCursor(event.key);
    }
  }

  function handleChipViewPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) return;

    event.preventDefault();
    insertTextAtChipCursor(pastedText);
  }

  function editMarker(marker: ScriptMarkerInstance) {
    setEditingMarkerKey(scriptMarkerEditKey(marker));
  }

  function replaceMarker(marker: ScriptMarkerInstance, nextMarker: string) {
    const nextText = `${text.slice(0, marker.start)}${nextMarker}${text.slice(
      marker.end,
    )}`;
    onTextChange(nextText);
    setScriptInsertionIndex(marker.start + nextMarker.length);
    setEditingMarkerKey(
      scriptMarkerEditKeyFrom(
        marker.start,
        marker.start + nextMarker.length,
        nextMarker,
      ),
    );
  }

  function replaceMarkerArgs(marker: ScriptMarkerInstance, args: string[]) {
    replaceMarker(
      marker,
      buildScriptMarker(marker.type, appendScriptMarkerTimelineArg(args, marker.timeMs)),
    );
  }

  function replaceMarkerTimelineTime(markerIndex: number, nextTimeMs: number) {
    const marker = markers[markerIndex];
    if (!marker) return;
    const normalizedTimeMs = Math.max(0, Math.round(nextTimeMs));
    replaceMarker(
      marker,
      buildScriptMarker(
        marker.type,
        appendScriptMarkerTimelineArg(marker.argList, normalizedTimeMs),
      ),
    );
  }

  function markerTimelineDisplayTimeSeconds(
    marker: ScriptMarkerInstance,
    markerIndex: number,
  ) {
    if (
      timelineDraggingIndex === markerIndex &&
      typeof timelineDraggingTimeSeconds === "number"
    ) {
      return timelineDraggingTimeSeconds;
    }
    return markerTimelineTimeSeconds(
      marker,
      timelineWords,
      timelineDurationSeconds,
      spokenTimelineWordCount,
    );
  }

  function timelineTimeFromClientX(clientX: number) {
    const rect = timelineRailRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !timelineDurationSeconds) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * timelineDurationSeconds;
  }

  function seekTimeline(seconds: number) {
    const nextTime = clamp(seconds, 0, timelineDurationSeconds || 0);
    setTimelineCurrentTime(nextTime);
    if (timelineAudioRef.current) {
      timelineAudioRef.current.currentTime = nextTime;
    }
  }

  function beginTimelineMarkerDrag(
    markerIndex: number,
    markerTimeSeconds: number,
    clientX: number,
  ) {
    const pointerSeconds = timelineTimeFromClientX(clientX);
    timelineMarkerDragOffsetRef.current = markerTimeSeconds - pointerSeconds;
    timelineMarkerDragMovedRef.current = false;
    timelineDraggingRef.current = true;
    setTimelineDraggingIndex(markerIndex);
    setTimelineDraggingTimeSeconds(markerTimeSeconds);
    setTimelineCurrentTime(markerTimeSeconds);
  }

  function updateTimelineMarkerFromClientX(markerIndex: number, clientX: number) {
    const seconds = clamp(
      timelineTimeFromClientX(clientX) + timelineMarkerDragOffsetRef.current,
      0,
      timelineDurationSeconds || 0,
    );
    timelineDraggingRef.current = true;
    timelineMarkerDragMovedRef.current = true;
    setTimelineDraggingIndex(markerIndex);
    setTimelineDraggingTimeSeconds(seconds);
    setTimelineCurrentTime(seconds);
  }

  function finishTimelineMarkerDrag() {
    if (
      timelineDraggingIndex !== null &&
      typeof timelineDraggingTimeSeconds === "number"
    ) {
      replaceMarkerTimelineTime(timelineDraggingIndex, timelineDraggingTimeSeconds * 1000);
      seekTimeline(timelineDraggingTimeSeconds);
    }
    timelineDraggingRef.current = false;
    timelineMarkerDragOffsetRef.current = 0;
    setTimelineDraggingIndex(null);
    setTimelineDraggingTimeSeconds(null);
  }

  function beginTimelineScrub(nextTime = timelineCurrentTime) {
    const normalizedTime = clamp(nextTime, 0, timelineDurationSeconds || 0);
    timelineScrubbingRef.current = true;
    timelineScrubTimeRef.current = normalizedTime;
    setTimelineScrubTime(normalizedTime);
    setTimelineCurrentTime(normalizedTime);
  }

  function updateTimelineScrub(nextTime: number) {
    const normalizedTime = clamp(nextTime, 0, timelineDurationSeconds || 0);
    if (timelineScrubbingRef.current) {
      timelineScrubTimeRef.current = normalizedTime;
      setTimelineScrubTime(normalizedTime);
      setTimelineCurrentTime(normalizedTime);
      return;
    }
    seekTimeline(normalizedTime);
  }

  function finishTimelineScrub(nextTimeOverride?: number) {
    if (typeof nextTimeOverride === "number" && Number.isFinite(nextTimeOverride)) {
      timelineScrubTimeRef.current = clamp(
        nextTimeOverride,
        0,
        timelineDurationSeconds || 0,
      );
    } else if (!timelineScrubbingRef.current && timelineScrubTime === null) {
      return;
    }
    const nextTime = timelineScrubTimeRef.current;
    timelineScrubbingRef.current = false;
    setTimelineScrubTime(null);
    seekTimeline(nextTime);
  }

  function moveTimelineByKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!timelineAudioUrl) return;
    const baseTime = timelineScrubTime ?? timelineCurrentTime;
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTimeline(baseTime - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTimeline(baseTime + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTimeline(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTimeline(timelineDurationSeconds);
    }
  }

  function toggleTimelinePlayback() {
    const audio = timelineAudioRef.current;
    if (!audio || !timelineAudioUrl) return;
    audio.playbackRate = timelinePlaybackRate;
    if (audio.paused) {
      void audio.play().catch(() => setTimelineIsPlaying(false));
      return;
    }
    audio.pause();
  }

  function timelinePreviewState(atTime = timelineCurrentTime) {
    const elapsed = atTime + 0.001;
    let currentVisualMarker: ScriptMarkerInstance | null = null;
    let agentImageVisible = true;
    const overlays: Array<{ id: string; imagePath: string }> = [];
    const overlayMap = new Map<string, string>();

    markers.forEach((marker, index) => {
      if (markerTimelineDisplayTimeSeconds(marker, index) > elapsed) return;
      if (isSlideMarker(marker) || marker.type === "show_image") {
        currentVisualMarker = marker;
      }
      if (marker.type === "agent_image_off") {
        agentImageVisible = false;
      }
      if (marker.type === "agent_image_on") {
        agentImageVisible = true;
      }
      if (marker.type === "overlay") {
        const overlayId = marker.argList[1] ? marker.argList[0] || "default" : "default";
        const imagePath = marker.argList[1] || marker.argList[0] || "";
        if (imagePath) overlayMap.set(overlayId, imagePath);
      }
      if (marker.type === "overlay_off") {
        const overlayId = marker.argList[0] || "";
        if (overlayId) overlayMap.delete(overlayId);
        else overlayMap.clear();
      }
    });

    overlayMap.forEach((imagePath, id) => overlays.push({ id, imagePath }));
    return { agentImageVisible, currentVisualMarker, overlays };
  }

  function renderTimelineView() {
    const duration = timelineDurationSeconds || 1;
    const visibleTimelineTime = timelineScrubTime ?? timelineCurrentTime;
    const timelineMarkers = markers.map((marker, index) => {
      const timeSeconds = markerTimelineDisplayTimeSeconds(marker, index);
      const timeMs = Math.round(timeSeconds * 1000);
      const stackedIndex = markers
        .slice(0, index)
        .filter(
          (previous, previousIndex) =>
            Math.round(
              markerTimelineDisplayTimeSeconds(previous, previousIndex) * 1000,
            ) === timeMs,
        ).length;
      return {
        index,
        lane: stackedIndex,
        marker,
        timeMs,
        timeSeconds,
      };
    });
    const laneCount = Math.max(1, ...timelineMarkers.map((item) => item.lane + 1));
    const preview = timelinePreviewState(visibleTimelineTime);
    const timelineProgressPercent =
      duration > 0 ? clamp((visibleTimelineTime / duration) * 100, 0, 100) : 0;
    const currentWordIndex = timelineWords.findIndex(
      (word) => visibleTimelineTime >= word.start && visibleTimelineTime <= word.end,
    );
    const currentWord =
      currentWordIndex >= 0 ? timelineWords[currentWordIndex]?.word : "";
    const waveformBars = Array.from({ length: 72 }, (_, index) => {
      const height = 18 + Math.round(Math.abs(Math.sin(index * 1.7)) * 28);
      return <span key={index} style={{ height: `${height}px` }} />;
    });

    return (
      <div className="script-timeline-view">
        <audio preload="auto" ref={timelineAudioRef} src={timelineAudioSrc} />
        <div className="script-timeline-stage">
          <div className="script-timeline-main-preview">
            {preview.currentVisualMarker ? (
              renderSlideVisual(preview.currentVisualMarker)
            ) : (
              <span className="script-slide-placeholder">No visual yet</span>
            )}
            {preview.overlays.map((overlay) => (
              <img
                alt=""
                className="script-timeline-overlay-preview"
                key={overlay.id}
                src={publicAsset(overlay.imagePath)}
              />
            ))}
          </div>
          <div className="script-timeline-chat-preview">
            <div
              className={[
                "script-timeline-agent-preview",
                preview.agentImageVisible ? "" : "is-hidden",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <img alt="" src={publicAsset("test-images/dLU-right.png")} />
            </div>
            <div className="script-timeline-now">
              <span>{formatTimelineSeconds(visibleTimelineTime)}</span>
              <strong>{currentWord || "---"}</strong>
            </div>
          </div>
        </div>

        <div className="script-timeline-transport">
          <button
            className="event-icon-button"
            disabled={!timelineAudioUrl}
            onClick={toggleTimelinePlayback}
            title={timelineIsPlaying ? "Pause timeline audio" : "Play timeline audio"}
            type="button"
          >
            {timelineIsPlaying ? <StopIcon /> : <PlayIcon />}
          </button>
          <div
            aria-label="Timeline playback position"
            aria-disabled={!timelineAudioUrl}
            aria-valuemax={Math.round(duration * 1000)}
            aria-valuemin={0}
            aria-valuenow={Math.round(visibleTimelineTime * 1000)}
            className={[
              "script-timeline-scrubber",
              timelineAudioUrl ? "" : "is-disabled",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={(event) => {
              if (!timelineAudioUrl) return;
              seekTimeline(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onKeyDown={moveTimelineByKeyboard}
            onMouseDown={(event) => {
              if (!timelineAudioUrl) return;
              beginTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onMouseMove={(event) => {
              if (!timelineScrubbingRef.current) return;
              updateTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onMouseUp={(event) => {
              if (!timelineAudioUrl) return;
              finishTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onPointerCancel={(event) =>
              finishTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              )
            }
            onPointerDown={(event) => {
              if (!timelineAudioUrl) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              beginTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onPointerMove={(event) => {
              if (!timelineScrubbingRef.current) return;
              updateTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            onPointerUp={(event) => {
              if (!timelineAudioUrl) return;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              finishTimelineScrub(
                timelinePointerTime(
                  event.currentTarget,
                  event.clientX,
                  timelineDurationSeconds,
                  timelineCurrentTime,
                ),
              );
            }}
            role="slider"
            tabIndex={timelineAudioUrl ? 0 : -1}
          >
            <span className="script-timeline-scrubber-track">
              <span
                className="script-timeline-scrubber-fill"
                style={{ width: `${timelineProgressPercent}%` }}
              />
            </span>
            <span
              className="script-timeline-scrubber-thumb"
              style={{ left: `${timelineProgressPercent}%` }}
            />
          </div>
          <span>
            {formatTimelineSeconds(visibleTimelineTime)} /{" "}
            {formatTimelineSeconds(timelineDurationSeconds)}
          </span>
          <label className="script-timeline-speed">
            <span>Speed</span>
            <select
              aria-label="Timeline playback speed"
              disabled={!timelineAudioUrl}
              onChange={(event) =>
                setTimelinePlaybackRate(Number(event.target.value) || 1)
              }
              value={String(timelinePlaybackRate)}
            >
              {scriptAudioPlaybackRateOptions.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="script-timeline-rail"
          onPointerCancel={finishTimelineMarkerDrag}
          onPointerLeave={finishTimelineMarkerDrag}
          onPointerMove={(event) => {
            if (timelineDraggingIndex === null) return;
            event.preventDefault();
            updateTimelineMarkerFromClientX(timelineDraggingIndex, event.clientX);
          }}
          onPointerUp={finishTimelineMarkerDrag}
          ref={timelineRailRef}
          style={{ minHeight: `${72 + laneCount * 28}px` }}
        >
          <div className="script-timeline-waveform">{waveformBars}</div>
          <div
            className="script-timeline-playhead"
            style={{ left: `${(visibleTimelineTime / duration) * 100}%` }}
          />
          {timelineMarkers.map(({ index, lane, marker, timeSeconds }) => (
            <button
              className={[
                "script-timeline-marker",
                `marker-${marker.type}`,
                editingMarkerKey === scriptMarkerEditKey(marker) ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${marker.id}-${index}`}
              onClick={(event) => {
                if (timelineMarkerDragMovedRef.current) {
                  event.preventDefault();
                  timelineMarkerDragMovedRef.current = false;
                  return;
                }
                editMarker(marker);
                seekTimeline(timeSeconds);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                beginTimelineMarkerDrag(index, timeSeconds, event.clientX);
              }}
              style={{
                left: `${(timeSeconds / duration) * 100}%`,
                top: `${42 + lane * 28}px`,
              }}
              title={`${marker.label} at ${formatTimelineSeconds(timeSeconds)}`}
              type="button"
            >
              <span>{scriptMarkerIcon(marker.type)}</span>
              <strong>{marker.detail || marker.label}</strong>
            </button>
          ))}
        </div>

        <div className="script-timeline-marker-list">
          {timelineMarkers.map(({ index, marker, timeSeconds }) => (
            <div
              className="script-timeline-marker-row"
              key={`${marker.id}-${index}`}
              onClick={() =>
                replaceMarkerTimelineTime(index, Math.round(visibleTimelineTime * 1000))
              }
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                replaceMarkerTimelineTime(index, Math.round(visibleTimelineTime * 1000));
              }}
              role="button"
              tabIndex={0}
              title={`Place ${marker.label} at the current playhead time.`}
            >
              <span className="script-marker-chip-icon">
                {scriptMarkerIcon(marker.type)}
              </span>
              <strong>{marker.label}</strong>
              <small>{marker.detail || "---"}</small>
              <span className="script-timeline-time-field">
                <input
                  aria-label={`${marker.label} timing in seconds`}
                  min="0"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextSeconds = Number.parseFloat(event.target.value);
                    replaceMarkerTimelineTime(
                      index,
                      Number.isFinite(nextSeconds) ? nextSeconds * 1000 : 0,
                    );
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  step="0.01"
                  type="number"
                  value={formatTimelineSecondsInput(timeSeconds)}
                />
                <span>s</span>
              </span>
            </div>
          ))}
          {!timelineMarkers.length ? (
            <p className="script-timeline-empty">No timed actions in this script.</p>
          ) : null}
        </div>

        {!timelineAudioUrl ? (
          <p className="script-timeline-empty">
            Generate script audio first to scrub this timeline against the real track.
          </p>
        ) : null}
      </div>
    );
  }

  function stopSoundPreview() {
    soundPreviewAudioRef.current?.pause();
    soundPreviewAudioRef.current = null;
    setSoundPreviewKey(null);
  }

  function playSoundPreview(soundPath: string, rawVolume: string, previewKey: string) {
    const normalizedPath = soundPath.trim();
    if (!normalizedPath) return;

    if (soundPreviewKey === previewKey && soundPreviewAudioRef.current) {
      stopSoundPreview();
      return;
    }

    stopSoundPreview();
    const parsedVolume = Number.parseFloat(rawVolume);
    const audio = new Audio(publicAsset(normalizedPath));
    audio.preload = "auto";
    audio.volume = Number.isFinite(parsedVolume) ? clamp(parsedVolume, 0, 1) : 1;
    soundPreviewAudioRef.current = audio;
    setSoundPreviewKey(previewKey);

    const cleanup = () => {
      if (soundPreviewAudioRef.current === audio) {
        soundPreviewAudioRef.current = null;
        setSoundPreviewKey(null);
      }
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    void audio.play().catch(cleanup);
  }

  function dragDataMarkerKey(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.getData(scriptMarkerDragDataType) ||
      event.dataTransfer.getData("text/plain") ||
      draggingMarkerKey ||
      ""
    );
  }

  function startMarkerDrag(
    marker: ScriptMarkerInstance,
    event: DragEvent<HTMLButtonElement>,
  ) {
    const markerKey = scriptMarkerEditKey(marker);
    setDraggingMarkerKey(markerKey);
    setDropInsertionIndex(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(scriptMarkerDragDataType, markerKey);
    event.dataTransfer.setData("text/plain", markerKey);
  }

  function endMarkerDrag() {
    setDraggingMarkerKey(null);
    setDropInsertionIndex(null);
  }

  function moveMarkerToIndex(marker: ScriptMarkerInstance, insertionIndex: number) {
    if (insertionIndex >= marker.start && insertionIndex <= marker.end) {
      endMarkerDrag();
      return;
    }

    const withoutMarker = `${text.slice(0, marker.start)}${text.slice(marker.end)}`;
    const adjustedInsertionIndex =
      insertionIndex > marker.start
        ? insertionIndex - marker.marker.length
        : insertionIndex;
    const nextStart = Math.round(
      clamp(adjustedInsertionIndex, 0, withoutMarker.length),
    );
    const nextText = `${withoutMarker.slice(0, nextStart)}${marker.marker}${withoutMarker.slice(
      nextStart,
    )}`;

    onTextChange(nextText);
    setEditingMarkerKey(
      scriptMarkerEditKeyFrom(nextStart, nextStart + marker.marker.length, marker.marker),
    );
    setScriptInsertionIndex(nextStart + marker.marker.length);
    endMarkerDrag();
  }

  function handleMarkerDrop(
    insertionIndex: number,
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const markerKey = dragDataMarkerKey(event);
    const sourceMarker = markers.find(
      (marker) => scriptMarkerEditKey(marker) === markerKey,
    );
    if (!sourceMarker) {
      endMarkerDrag();
      return;
    }
    moveMarkerToIndex(sourceMarker, insertionIndex);
  }

  function placeScriptInsertionIndex(insertionIndex: number) {
    setScriptInsertionIndex(Math.round(clamp(insertionIndex, 0, text.length)));
  }

  function renderMarkerDropTarget(insertionIndex: number, key: string) {
    const isInsertionCursor = scriptInsertionIndex === insertionIndex;
    return (
      <span
        aria-hidden="true"
        className={[
          "script-chip-drop-target",
          draggingMarkerKey ? "visible" : "",
          isInsertionCursor ? "cursor" : "",
          dropInsertionIndex === insertionIndex ? "active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={key}
        onClick={(event) => {
          event.stopPropagation();
          focusChipView();
          setChipInsertionIndex(insertionIndex);
        }}
        onContextMenu={(event) => openScriptActionMenu(event, insertionIndex)}
        onDragEnter={(event) => {
          event.preventDefault();
          setDropInsertionIndex(insertionIndex);
        }}
        onDragLeave={() => {
          setDropInsertionIndex((current) =>
            current === insertionIndex ? null : current,
          );
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (dropInsertionIndex !== insertionIndex) {
            setDropInsertionIndex(insertionIndex);
          }
        }}
        onDrop={(event) => handleMarkerDrop(insertionIndex, event)}
      />
    );
  }

  function handleTextTargetDragOver(
    beforeIndex: number,
    afterIndex: number,
    event: DragEvent<HTMLElement>,
  ) {
    if (!draggingMarkerKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const insertionIndex = dropIndexForTextTarget(
      event.currentTarget,
      beforeIndex,
      afterIndex,
      event.clientX,
    );
    if (dropInsertionIndex !== insertionIndex) {
      setDropInsertionIndex(insertionIndex);
    }
  }

  function handleTextTargetDrop(
    beforeIndex: number,
    afterIndex: number,
    event: DragEvent<HTMLElement>,
  ) {
    if (!draggingMarkerKey) return;
    const insertionIndex = dropIndexForTextTarget(
      event.currentTarget,
      beforeIndex,
      afterIndex,
      event.clientX,
    );
    handleMarkerDrop(insertionIndex, event);
  }

  function handleTextTargetClick(
    beforeIndex: number,
    afterIndex: number,
    event: MouseEvent<HTMLElement>,
  ) {
    event.stopPropagation();
    focusChipView();
    setChipInsertionIndex(
      clickIndexForTextTarget(
        event.currentTarget,
        beforeIndex,
        afterIndex,
        event.clientX,
      ),
    );
  }

  function focusMarker(marker: ScriptMarkerInstance) {
    if (viewMode !== "text") {
      changeViewMode("text");
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(marker.start, marker.end);
      });
    });
  }

  function removeMarker(marker: ScriptMarkerInstance) {
    const before = text.slice(0, marker.start);
    const after = text.slice(marker.end);
    const nextText =
      /[ \t]$/.test(before) && /^[ \t]/.test(after)
        ? `${before.replace(/[ \t]+$/, " ")}${after.replace(/^[ \t]+/, "")}`
        : `${before}${after}`;
    const nextCursor = Math.min(before.length, nextText.length);

    onTextChange(nextText);
    if (editingMarkerKey === scriptMarkerEditKey(marker)) {
      setEditingMarkerKey(null);
    }
    setScriptInsertionIndex(nextCursor);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(textarea, {
        maxHeight: scriptTextareaMaxHeightPx,
        minHeight: scriptTextareaMinHeightPx,
      });
    });
  }

  function slidePreviewFor(marker: ScriptMarkerInstance) {
    const slideRef = marker.argList[0]?.trim() || "1";
    return (
      slidePreviews[slidePreviewKeyForDeck(deckUrl, slideRef)] ?? { status: "idle" }
    );
  }

  function markerTextForOption(option: (typeof scriptMarkerOptions)[number]) {
    if (option.marker === "[gslide: 1]") {
      return `[gslide: ${nextAvailableSlideRef(markers)}]`;
    }
    return option.marker;
  }

  function closeScriptActionMenu() {
    setScriptActionMenu(null);
    setScriptActionMenuText("");
  }

  function openScriptActionMenu(
    event: MouseEvent<HTMLElement>,
    insertionIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const normalizedInsertionIndex = Math.round(clamp(insertionIndex, 0, text.length));
    placeScriptInsertionIndex(normalizedInsertionIndex);
    setScriptActionMenu({
      insertionIndex: normalizedInsertionIndex,
      x: menuCoordinate(event.clientX, 380, window.innerWidth),
      y: menuCoordinate(event.clientY, 420, window.innerHeight),
    });
    setScriptActionMenuText("");
  }

  function openScriptActionMenuFromButton(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const insertionIndex = currentScriptInsertionIndex();
    placeScriptInsertionIndex(insertionIndex);
    setScriptActionMenu({
      insertionIndex,
      x: menuCoordinate(rect.left, 380, window.innerWidth),
      y: menuCoordinate(rect.bottom + 7, 420, window.innerHeight),
    });
    setScriptActionMenuText("");
  }

  function chooseScriptMarkerOption(option: (typeof scriptMarkerOptions)[number]) {
    if (!scriptActionMenu) return;
    insertMarker(markerTextForOption(option), scriptActionMenu.insertionIndex);
    closeScriptActionMenu();
  }

  function submitScriptActionMenuText() {
    if (!scriptActionMenu) return;
    insertPlainScriptText(scriptActionMenuText, scriptActionMenu.insertionIndex);
    closeScriptActionMenu();
  }

  function renderMarkerChip(marker: ScriptMarkerInstance) {
    const detail = marker.detail || marker.argList.join(", ");
    const imagePath =
      marker.type === "show_image"
        ? marker.argList[0]
        : marker.type === "overlay"
          ? marker.argList[1]
          : "";
    const preview = isSlideMarker(marker) ? slidePreviewFor(marker) : null;
    const imageUrl =
      preview?.status === "ready"
        ? preview.imageUrl
        : imagePath
          ? publicAsset(imagePath)
          : "";

    return (
      <button
        className={[
          "script-marker-chip",
          `marker-${marker.type}`,
          imageUrl ? "has-thumbnail" : "",
          editingMarkerKey === scriptMarkerEditKey(marker) ? "selected" : "",
          draggingMarkerKey === scriptMarkerEditKey(marker) ? "dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable
        onDragEnd={endMarkerDrag}
        onDragStart={(event) => startMarkerDrag(marker, event)}
        key={marker.id}
        onClick={() => editMarker(marker)}
        onContextMenu={(event) => openScriptActionMenu(event, marker.end)}
        title={`Drag to move. Click to edit ${marker.label}.`}
        type="button"
      >
        {imageUrl ? (
          <img
            alt=""
            className="script-marker-thumbnail"
            src={imageUrl}
          />
        ) : (
          <span className="script-marker-chip-icon">
            {scriptMarkerIcon(marker.type)}
          </span>
        )}
        <span className="script-marker-chip-text">
          {detail || marker.label}
        </span>
      </button>
    );
  }

  function renderInlineScriptParts(
    sourceText: string,
    offset = 0,
    emptyFallback = "---",
  ) {
    const localMarkers = parseScriptMarkerInstances(sourceText);
    if (!sourceText && !localMarkers.length) {
      return (
        <>
          {renderMarkerDropTarget(offset, `drop-empty-${offset}`)}
          <span className="script-empty-text">{emptyFallback}</span>
        </>
      );
    }

    const parts: ReactNode[] = [];

    function renderTextSlice(slice: string, sliceStart: number, keyPrefix: string) {
      const textParts: ReactNode[] = [];
      const tokenPattern = /\s+|\S+/g;
      let cursor = 0;
      let hasVisibleToken = false;

      for (const match of slice.matchAll(tokenPattern)) {
        const token = match[0];
        const tokenStart = match.index ?? 0;
        const tokenEnd = tokenStart + token.length;
        if (tokenStart > cursor) {
          textParts.push(
            <Fragment key={`${keyPrefix}-gap-${cursor}`}>
              {slice.slice(cursor, tokenStart)}
            </Fragment>,
          );
        }

        if (/\S/.test(token)) {
          hasVisibleToken = true;
          textParts.push(
            renderMarkerDropTarget(
              offset + sliceStart + tokenStart,
              `${keyPrefix}-drop-before-${tokenStart}`,
            ),
          );
          textParts.push(
            <span
              className={[
                "script-chip-word-drop-zone",
                scriptInsertionIndex === offset + sliceStart + tokenStart ||
                scriptInsertionIndex === offset + sliceStart + tokenEnd
                  ? "cursor"
                  : "",
                dropInsertionIndex === offset + sliceStart + tokenStart
                  ? "drop-before"
                  : "",
                dropInsertionIndex === offset + sliceStart + tokenEnd
                  ? "drop-after"
                  : "",
                dropInsertionIndex === offset + sliceStart + tokenStart ||
                dropInsertionIndex === offset + sliceStart + tokenEnd
                  ? "active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${keyPrefix}-token-${tokenStart}`}
              onClick={(event) =>
                handleTextTargetClick(
                  offset + sliceStart + tokenStart,
                  offset + sliceStart + tokenEnd,
                  event,
                )
              }
              onContextMenu={(event) => {
                const insertionIndex = clickIndexForTextTarget(
                  event.currentTarget,
                  offset + sliceStart + tokenStart,
                  offset + sliceStart + tokenEnd,
                  event.clientX,
                );
                openScriptActionMenu(event, insertionIndex);
              }}
              onDragOver={(event) =>
                handleTextTargetDragOver(
                  offset + sliceStart + tokenStart,
                  offset + sliceStart + tokenEnd,
                  event,
                )
              }
              onDrop={(event) =>
                handleTextTargetDrop(
                  offset + sliceStart + tokenStart,
                  offset + sliceStart + tokenEnd,
                  event,
                )
              }
            >
              {token}
            </span>,
          );
          textParts.push(
            renderMarkerDropTarget(
              offset + sliceStart + tokenEnd,
              `${keyPrefix}-drop-after-${tokenEnd}`,
            ),
          );
        } else {
          textParts.push(
            <Fragment key={`${keyPrefix}-space-${tokenStart}`}>{token}</Fragment>,
          );
        }
        cursor = tokenEnd;
      }

      if (cursor < slice.length) {
        textParts.push(
          <Fragment key={`${keyPrefix}-tail-${cursor}`}>{slice.slice(cursor)}</Fragment>,
        );
      }

      if (!hasVisibleToken && slice.length) {
        textParts.push(
          renderMarkerDropTarget(
            offset + sliceStart,
            `${keyPrefix}-blank-drop-start`,
          ),
        );
        textParts.push(
          <Fragment key={`${keyPrefix}-blank-text`}>{slice}</Fragment>,
        );
        textParts.push(
          renderMarkerDropTarget(
            offset + sliceStart + slice.length,
            `${keyPrefix}-blank-drop-end`,
          ),
        );
      }

      return textParts;
    }

    let cursor = 0;
    localMarkers.forEach((marker) => {
      if (marker.start > cursor) {
        parts.push(
          ...renderTextSlice(
            sourceText.slice(cursor, marker.start),
            cursor,
            `text-${offset}-${cursor}`,
          ),
        );
      }
      parts.push(
        renderMarkerDropTarget(
          offset + marker.start,
          `drop-before-marker-${offset}-${marker.id}`,
        ),
      );
      parts.push(
        renderMarkerChip({
          ...marker,
          end: marker.end + offset,
          id: `${offset}-${marker.id}`,
          start: marker.start + offset,
        }),
      );
      parts.push(
        renderMarkerDropTarget(
          offset + marker.end,
          `drop-after-marker-${offset}-${marker.id}`,
        ),
      );
      cursor = marker.end;
    });
    if (cursor < sourceText.length) {
      parts.push(
        ...renderTextSlice(
          sourceText.slice(cursor),
          cursor,
          `text-${offset}-${cursor}`,
        ),
      );
    }
    return parts;
  }

  function visualSegments() {
    const visualMarkers = markers.filter(isVisualPanelMarker);
    const segments: Array<{
      content: string;
      contentOffset: number;
      key: string;
      marker: ScriptMarkerInstance | null;
    }> = [];
    let currentMarker: ScriptMarkerInstance | null = null;
    let cursor = 0;

    visualMarkers.forEach((marker) => {
      const content = text.slice(cursor, marker.start);
      if (content.trim() || currentMarker) {
        segments.push({
          content,
          contentOffset: cursor,
          key: `${currentMarker?.id ?? "intro"}-${cursor}`,
          marker: currentMarker,
        });
      }
      currentMarker = marker;
      cursor = marker.end;
    });

    const trailingContent = text.slice(cursor);
    if (trailingContent.trim() || currentMarker || !segments.length) {
      const markerId = (currentMarker as ScriptMarkerInstance | null)?.id ?? "empty";
      segments.push({
        content: trailingContent,
        contentOffset: cursor,
        key: `${markerId}-${cursor}`,
        marker: currentMarker,
      });
    }

    return segments;
  }

  function googleSlideUrl(marker: ScriptMarkerInstance) {
    const trimmedDeckUrl = deckUrl.trim();
    if (!trimmedDeckUrl) return "";

    const baseUrl = trimmedDeckUrl.split("#")[0];
    const preview = slidePreviewFor(marker);
    const fallbackSlideRef = marker.argList[0]?.trim() || "";
    const pageId =
      preview.status === "ready" && preview.detail
        ? preview.detail.trim()
        : /^\D/.test(fallbackSlideRef)
          ? fallbackSlideRef
          : "";

    if (!pageId) return baseUrl;
    return `${baseUrl}#slide=id.${pageId.replace(/^id\./, "")}`;
  }

  function renderSlideNarrationEditor(segment: {
    content: string;
    contentOffset: number;
  }) {
    const segmentEnd = segment.contentOffset + segment.content.length;
    const placeCaret = (textarea: HTMLTextAreaElement) => {
      placeScriptInsertionIndex(segment.contentOffset + textarea.selectionStart);
    };

    return (
      <textarea
        aria-label="Slide narration"
        className="script-slide-textarea"
        onChange={(event) =>
          replaceScriptRange(
            segment.contentOffset,
            segmentEnd,
            event.target.value,
          )
        }
        onClick={(event) => placeCaret(event.currentTarget)}
        onContextMenu={(event) =>
          openScriptActionMenu(
            event,
            segment.contentOffset + event.currentTarget.selectionStart,
          )
        }
        onInput={(event) =>
          resizeTextareaToContent(event.currentTarget, {
            maxHeight: scriptSlideTextareaMaxHeightPx,
            minHeight: scriptSlideTextareaMinHeightPx,
          })
        }
        onKeyUp={(event) => placeCaret(event.currentTarget)}
        onSelect={(event) => placeCaret(event.currentTarget)}
        placeholder="Spoken words for this visual..."
        value={segment.content}
      />
    );
  }

  function renderSlideVisual(marker: ScriptMarkerInstance | null) {
    if (!marker) {
      return <span className="script-slide-placeholder">No visual</span>;
    }

    if (isSlideMarker(marker)) {
      const slideRef = marker.argList[0]?.trim() || "1";
      const preview = slidePreviewFor(marker);
      const slideHref = googleSlideUrl(marker);
      return (
        <div className="script-slide-preview">
          <a
            aria-label={`Open slide ${slideRef} in Google Slides`}
            className={`script-slide-open${slideHref ? "" : " disabled"}`}
            href={slideHref || undefined}
            onClick={(event) => {
              if (!slideHref) event.preventDefault();
            }}
            rel="noreferrer"
            target="_blank"
            title="Open this slide in Google Slides."
          >
            {preview.status === "ready" && preview.imageUrl ? (
              <img alt={`Slide ${slideRef}`} src={preview.imageUrl} />
            ) : (
              <span className="script-slide-placeholder">
                {preview.status === "loading"
                  ? "Loading slide..."
                  : `Slide ${slideRef}`}
              </span>
            )}
          </a>
          <div className="script-slide-controls">
            <label>
              <span>Slide</span>
              <input
                aria-label="Slide reference"
                onChange={(event) => replaceMarkerArgs(marker, [event.target.value])}
                type="text"
                value={slideRef}
              />
            </label>
            <button
              disabled={!deckUrl.trim() || preview.status === "loading"}
              onClick={() => void resolveSlidePreview(slideRef, true)}
              title="Refresh this slide thumbnail."
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }

    const imagePath = marker.argList[0]?.trim() || "";
    if (!imagePath) {
      return <span className="script-slide-placeholder">Image</span>;
    }
    return (
      <div className="script-slide-preview">
        <img alt="" src={publicAsset(imagePath)} />
      </div>
    );
  }

  return (
      <div
        className={`script-action-editor${draggingMarkerKey ? " dragging-marker" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            placeScriptInsertionIndex(text.length);
          }
        }}
      >
      <div className="script-action-toolbar">
        <button
          className="script-action-menu-trigger"
          onClick={openScriptActionMenuFromButton}
          title="Add text or a timed action at the current script cursor. You can also right-click in the script."
          type="button"
        >
          <PlusIcon />
          Add
        </button>
        <div className="script-view-switch" role="tablist" aria-label="Script view">
          {(["text", "chips", "slides", "timeline"] as const).map((mode) => (
            <button
              aria-selected={viewMode === mode}
              className={viewMode === mode ? "selected" : ""}
              key={mode}
              onClick={() => changeViewMode(mode)}
              role="tab"
              type="button"
            >
              {mode === "text"
                ? "Text"
                : mode === "chips"
                  ? "Chips"
                  : mode === "slides"
                    ? "Slides"
                    : "Timeline"}
            </button>
          ))}
        </div>
      </div>
      {scriptActionMenu ? (
        <ScriptActionMenu
          inputRef={actionMenuTextInputRef}
          menu={scriptActionMenu}
          menuRef={actionMenuRef}
          onChooseOption={chooseScriptMarkerOption}
          onSubmitText={submitScriptActionMenuText}
          onTextChange={setScriptActionMenuText}
          scriptLength={text.length}
          text={scriptActionMenuText}
        />
      ) : null}

      {viewMode === "text" ? (
        <textarea
          aria-label="Speech text"
          className="event-script-textarea"
          onChange={(event) => onTextChange(event.target.value)}
          onContextMenu={(event) =>
            openScriptActionMenu(event, event.currentTarget.selectionStart ?? text.length)
          }
          onInput={(event) =>
            resizeTextareaToContent(event.currentTarget, {
              maxHeight: scriptTextareaMaxHeightPx,
              minHeight: scriptTextareaMinHeightPx,
            })
          }
          placeholder="What the agent says... [gslide: 1]"
          ref={textareaRef}
          value={text}
        />
      ) : viewMode === "chips" ? (
        <div
          className="script-chip-view"
          aria-label="Script with marker chips"
          aria-multiline="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              focusChipView();
              setChipInsertionIndex(text.length);
            }
          }}
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              openScriptActionMenu(event, text.length);
            }
          }}
          onKeyDown={handleChipViewKeyDown}
          onPaste={handleChipViewPaste}
          ref={chipViewRef}
          role="textbox"
          tabIndex={0}
        >
          {renderInlineScriptParts(text, 0, "No script text")}
        </div>
      ) : viewMode === "timeline" ? (
        renderTimelineView()
      ) : (
        <div
          className="script-slide-table"
          aria-label="Script slide table"
          ref={slideTableRef}
        >
          {visualSegments().map((segment) => (
            <div className="script-slide-row" key={segment.key}>
              <div className="script-slide-cell">
                {renderSlideVisual(segment.marker)}
              </div>
              <div
                className="script-slide-script"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    placeScriptInsertionIndex(
                      segment.contentOffset + segment.content.length,
                    );
                  }
                }}
                onContextMenu={(event) => {
                  if (event.target === event.currentTarget) {
                    openScriptActionMenu(
                      event,
                      segment.contentOffset + segment.content.length,
                    );
                  }
                }}
              >
                {renderSlideNarrationEditor(segment)}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingMarker ? (
        <ScriptMarkerEditor
          marker={editingMarker}
          onClose={() => setEditingMarkerKey(null)}
          onFocusText={focusMarker}
          onPlaySoundPreview={playSoundPreview}
          onRemove={removeMarker}
          onReplaceArgs={replaceMarkerArgs}
          soundPreviewKey={soundPreviewKey}
        />
      ) : null}

      <div className="event-context-line single-value script-deck-line">
        <span className="event-detail-label">DECK</span>
        <input
          aria-label="Script Google Slides deck URL"
          onChange={(event) => onDeckUrlChange(event.target.value)}
          placeholder="Google Slides URL"
          type="text"
          value={deckUrl}
        />
      </div>
    </div>
  );
}
