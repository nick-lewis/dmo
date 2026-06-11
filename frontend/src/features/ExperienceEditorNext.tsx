import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  apiFetch,
  experienceNextEditPath,
  experienceRunPath,
} from "../api";
import {
  HelpIcon,
  TrashIcon,
} from "../components/Icons";
import {
  readCheckpointRecordingMode,
  writeCheckpointRecordingMode,
  writeSelectedExperienceId,
} from "../persistence";
import {
  defaultChoiceIconBackground,
  resizeTextareaToContent,
} from "../uiHelpers";
import { defaultGlowColor, glowTargets } from "../glowTargets";
import { stringConfigValue } from "../runtimeUtils";
import {
  sidePanelMetadataDefinitions,
  type SidePanelOverride,
} from "../sidePanelMetadata";
import {
  appendScriptMarkerTimelineArg,
  buildScriptMarker,
  displayTranscriptSlotsFromText,
  normalizeScriptAudioText,
  parseScriptMarkerInstances,
  scriptSoundOptions,
  spokenTextFromMarkedScript,
  type ScriptMarkerInstance,
  type ScriptSlidePreview,
} from "../scriptMarkers";
import {
  scriptAudioItemIsReady,
  scriptAudioItemNeedsGeneration,
  scriptAudioMissingItems,
} from "../scriptAudio";
import type {
  ApiUser,
  CheckpointRecordingMode,
  EventActionStep,
  Experience,
  ExperienceEvent,
  ExperienceForm,
  ResolvedSlide,
  ScriptAudioItem,
  SessionPayload,
  TutorSettings,
} from "../types";
import { experienceAutosaveDelayMs } from "./eventEditorUtils";
import type { PythonDslScriptAction } from "./PythonDslEditor";
import {
  hasCommentedScriptAction,
  parsePythonDslStepActions,
  pythonDslSourceFromEventSteps,
} from "./pythonDslActions";
import {
  displayBreakCount,
  displayBreaksAreEqual,
  displayDraftKey,
  displaySlotsAreEqual,
  normalizeDisplayBreaks,
  scriptAudioDisplayBaseSlots,
  scriptAudioPersistedDisplayBreaks,
  scriptAudioPersistedDisplaySlots,
} from "./scriptAudioDisplayUtils";
import { useEditorScriptAudio } from "./useEditorScriptAudio";
import {
  useOverviewAutosave,
  useTutorAutosave,
} from "./useExperienceAutosave";
import { ExperienceEventFlow } from "./ExperienceEventFlow";
import { ScriptActionReadOnlyView } from "./ScriptActionReadOnlyView";
import { ScriptAudioEditorPanel } from "./ScriptAudioEditorPanel";
import {
  DisplayTextEditor,
  displayBreaksFromText,
  displayTextFromSlots,
  type DisplayDocumentDraft,
} from "./DisplayTextEditor";
import {
  markerEditKey,
  markerEditKeyFrom,
  projectScriptActionsToDisplayText,
  sourceMarkerForView,
  viewMarkerEditKey,
  type ScriptActionViewMarker,
} from "./scriptActionProjection";
import { NextEditorOverviewHeader } from "./NextEditorOverviewHeader";
import { clampFloatingMenuPosition } from "./floatingMenuPosition";
import { useFloatingMenuDrag } from "./useFloatingMenuDrag";
import { useFloatingMenuLifecycle } from "./useFloatingMenuLifecycle";
import { NextFineTuningPanel } from "./NextFineTuningPanel";
import {
  NextScriptActionMenuPortal,
  NextScriptAudioMenuPortal,
  type ScriptActionMenuState,
  type ScriptAudioMenuState,
} from "./NextScriptMenus";
import { NextScriptWorkspace } from "./NextScriptWorkspace";
import { alignScriptWordsToDisplaySlots } from "./scriptDisplayTiming";
import {
  clamp,
  isSlideMarker,
  nextSlideRefAfterInsertion,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import {
  displayBreakDraftForItem,
  insertScriptMarkerAt,
  mergeMarkersIntoSpokenText,
  removeScriptMarker,
  replaceScriptMarker,
  scriptAudioItemForScriptText,
} from "./nextEditorScriptUtils";
import { useScriptActionHistory } from "./useScriptActionHistory";
import { useScriptImageLibrary } from "./useScriptImageLibrary";
import {
  conversationChoiceDslSourceFromChoices,
  conversationChoicesFromDslSource,
} from "./nextEditorConversationDsl";
import {
  activeScriptActionFromStored,
  readLocationNextEditorUiState,
  readStoredNextEditorUiState,
  scriptDetailTabFromStored,
  selectedEventIdFromStored,
  sortedEventSteps,
  sortedScriptSteps,
  writeLocationNextEditorUiState,
  writeStoredNextEditorUiState,
  type ActiveScriptAction,
  type ScriptDetailTab,
} from "./nextEditorUiState";
import {
  defaultScriptSideImagePath,
  scriptSideImageArgsFromState,
  scriptSideImageStateFromArgs,
} from "./scriptMarkerActionMetadata";
import { useExperienceSnapshotContextMenu } from "./useExperienceSnapshotContextMenu";
import { useVoiceSample } from "./useVoiceSample";
import {
  clampScriptTextAudioRevealSpeed,
  readScriptTextAudioRevealSpeed,
  writeScriptTextAudioRevealSpeed,
} from "./useScriptAudioPlayback";
import { useNextEditorAutosaveTimers } from "./useNextEditorAutosaveTimers";

const PythonDslEditor = lazy(() =>
  import("./PythonDslEditor").then((module) => ({
    default: module.PythonDslEditor,
  })),
);

type PendingScriptDisplayDraft = {
  displayBreaks: number[];
  text: string;
};

type AudioPreparationState = {
  completed: number;
  message: string;
  total: number;
};

type AudioScriptDraft = {
  stepId: string;
  text: string;
};

type AudioScriptSelection = {
  direction: "backward" | "forward" | "none";
  end: number;
  start: number;
  stepId: string;
};

const onEntryScriptActionPattern = /\bscript\s*\([^)]*\)/;
const onEntryDslStepSource = "next-on-entry-dsl";
const conversationDslStepSource = "next-conversation-dsl";
const displayTranscriptAutosaveDelayMs = 700;

function defaultTutorSettings(): TutorSettings {
  return {
    assistantName: "dee-lou",
    avatarPath: defaultScriptSideImagePath,
    choiceIconBackground: defaultChoiceIconBackground,
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  };
}

function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function replaceExperienceEvent(
  experience: Experience,
  nextEvent: ExperienceEvent,
) {
  return {
    ...experience,
    events: sortedExperienceEvents(
      experience.events.map((event) =>
        event.id === nextEvent.id ? nextEvent : event,
      ),
    ),
  };
}

function firstTopLevelScriptActionFromDsl(
  source: string,
): PythonDslScriptAction | null {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  let lineStart = 0;

  for (const [lineIndex, line] of normalizedSource.split("\n").entries()) {
    const trimmed = line.trimStart();
    if (trimmed && !/^\s/.test(line) && !trimmed.startsWith("#")) {
      const match = onEntryScriptActionPattern.exec(line);
      if (match?.[0] && typeof match.index === "number") {
        const from = lineStart + match.index;
        return {
          actionIndex: 0,
          from,
          lineNumber: lineIndex + 1,
          source: match[0],
          to: from + match[0].length,
        };
      }
    }

    lineStart += line.length + 1;
  }

  return null;
}

function scriptActionAutoOpenKey(
  eventId: string,
  action: PythonDslScriptAction | null,
) {
  return action
    ? `${eventId}:${action.actionIndex}:${action.lineNumber}:${action.from}:${action.source}`
    : "";
}

function plainValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => plainValuesEqual(value, right[index]))
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every((key) => plainValuesEqual(leftRecord[key], rightRecord[key]))
  );
}

function replaceEventStep(
  event: ExperienceEvent,
  nextStep: EventActionStep,
): ExperienceEvent {
  return {
    ...event,
    steps: sortedEventSteps(
      event.steps.map((step) => (step.id === nextStep.id ? nextStep : step)),
    ),
  };
}

export function ExperienceEditorNext({ experienceId }: { experienceId: string }) {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [experienceForm, setExperienceForm] = useState<ExperienceForm>({
    description: "",
    title: "",
  });
  const [tutorForm, setTutorForm] = useState<TutorSettings>(defaultTutorSettings);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [isTutorSettingsOpen, setIsTutorSettingsOpen] = useState(false);
  const [isTutorAvatarPickerOpen, setIsTutorAvatarPickerOpen] = useState(false);
  const [isUploadingTutorAvatar, setIsUploadingTutorAvatar] = useState(false);
  const [activeScriptAction, setActiveScriptAction] =
    useState<ActiveScriptAction | null>(null);
  const [activeScriptDetailTab, setActiveScriptDetailTab] =
    useState<ScriptDetailTab>("audio");
  const [displaySlotDrafts, setDisplaySlotDrafts] = useState<
    Record<string, string[]>
  >({});
  const [displayBreakDrafts, setDisplayBreakDrafts] = useState<
    Record<string, number[]>
  >({});
  const [audioPreparation, setAudioPreparation] =
    useState<AudioPreparationState | null>(null);
  const [scriptTextRevealSpeed, setScriptTextRevealSpeed] = useState(() =>
    readScriptTextAudioRevealSpeed(),
  );
  const [scriptTextRevealSpeedDraft, setScriptTextRevealSpeedDraft] = useState(
    () => String(readScriptTextAudioRevealSpeed()),
  );
  const [checkpointRecordingMode, setCheckpointRecordingMode] =
    useState<CheckpointRecordingMode>(() => readCheckpointRecordingMode());
  const [runningEventId, setRunningEventId] = useState("");
  const [scriptActionMenu, setScriptActionMenu] =
    useState<ScriptActionMenuState | null>(null);
  const [scriptAudioMenu, setScriptAudioMenu] =
    useState<ScriptAudioMenuState | null>(null);
  const [isScriptImagePickerOpen, setIsScriptImagePickerOpen] = useState(false);
  const [isUploadingScriptImage, setIsUploadingScriptImage] = useState(false);
  const [scriptSlidePreviews, setScriptSlidePreviews] = useState<
    Record<string, ScriptSlidePreview>
  >({});
  const [isRefreshingScriptSlides, setIsRefreshingScriptSlides] =
    useState(false);
  const [savingDisplayTextId, setSavingDisplayTextId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [onEntryDrafts, setOnEntryDrafts] = useState<Record<string, string>>({});
  const [conversationDrafts, setConversationDrafts] = useState<
    Record<string, string>
  >({});
  const [audioScriptDraft, setAudioScriptDraft] = useState<AudioScriptDraft>({
    stepId: "",
    text: "",
  });
  const [isAudioVoiceSettingsOpen, setIsAudioVoiceSettingsOpen] =
    useState(false);
  const [audioVoiceInstructionsDraft, setAudioVoiceInstructionsDraft] =
    useState("");
  const pendingScriptDisplayDraftsRef = useRef<
    Record<string, PendingScriptDisplayDraft>
  >({});
  const autosaveFlushQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const failedDisplayAutosavesRef = useRef<Record<string, string>>({});
  const autoOpenedScriptActionKeyRef = useRef("");
  const scriptActionMenuRef = useRef<HTMLDivElement | null>(null);
  const scriptAudioMenuRef = useRef<HTMLDivElement | null>(null);
  const audioScriptTextareaFocusedRef = useRef(false);
  const audioScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const audioVoiceInstructionsRef = useRef<HTMLInputElement | null>(null);
  const pendingAudioScriptSelectionRef = useRef<AudioScriptSelection | null>(
    null,
  );
  const selectedEventChatInstructionsRef = useRef<HTMLTextAreaElement | null>(
    null,
  );
  const selectedEventDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const scriptImageFileInputRef = useRef<HTMLInputElement | null>(null);
  // Script step IDs queued for deletion by editor chip removals, applied on
  // the next on-entry autosave flush. Keyed by event ID.
  const pendingScriptStepRemovalsRef = useRef(new Map<string, string[]>());
  // Recently deleted script step payloads so an undone script() line gets its
  // content back instead of coming back empty. Keyed by event ID.
  const scriptStepStashRef = useRef(
    new Map<
      string,
      Array<{
        condition: Record<string, unknown>;
        config: Record<string, unknown>;
        index: number;
        label: string;
      }>
    >(),
  );
  const {
    clearConversationAutosaveTimer,
    clearEventAutosaveTimer,
    clearNextEditorAutosaveTimers,
    clearOnEntryAutosaveTimer,
    clearScriptTextAutosaveTimer,
    pendingConversationAutosaveRef,
    pendingEventAutosaveRef,
    pendingOnEntryAutosaveRef,
    pendingScriptTextAutosaveRef,
    scheduleConversationAutosave,
    scheduleEventAutosave,
    scheduleOnEntryAutosave,
    scheduleScriptTextAutosave,
  } = useNextEditorAutosaveTimers({
    delayMs: experienceAutosaveDelayMs,
    flushConversationAutosave,
    flushEventAutosave,
    flushOnEntryAutosave,
    flushScriptTextAutosave,
  });

  const {
    deleteScriptImageFile,
    deletingScriptImagePath,
    isLoadingScriptImages,
    loadScriptImages,
    scriptImageOptions,
    uploadScriptImageFile,
  } = useScriptImageLibrary({
    experienceId: experience?.id ?? "",
    setError,
  });
  const {
    clearOverviewAutosaveTimer,
    flushOverviewAutosave,
    updateOverviewDraft,
  } = useOverviewAutosave({
    delayMs: experienceAutosaveDelayMs,
    experience,
    experienceForm,
    setError,
    setExperience,
    setExperienceForm,
  });
  const {
    generateScriptAudio,
    isScriptAudioInventoryLoaded,
    loadScriptAudioItems,
    playScriptAudioPreview,
    playingScriptAudioId,
    saveScriptAudioDisplayTranscript,
    saveScriptAudioVoiceInstructionsOverride,
    scriptAudioError,
    scriptAudioItems,
    scriptAudioStatus,
    stopScriptAudioPreview,
  } = useEditorScriptAudio({
    experience,
    flushEditorAutosave: flushNextEditorAutosave,
  });
  const saveDisplayTranscriptRef = useRef(saveScriptAudioDisplayTranscript);
  const {
    clearTutorAutosaveTimer,
    flushTutorAutosave,
    updateTutorDraft,
    updateTutorModelDraft,
  } = useTutorAutosave({
    delayMs: experienceAutosaveDelayMs,
    experience,
    loadScriptAudioItems,
    setError,
    setExperience,
    setTutorForm,
    tutorForm,
  });
  const { playVoiceSample, voiceSampleStatus } = useVoiceSample({
    experience,
    setError,
    tutor: tutorForm,
  });
  const selectedEvent =
    experience?.events.find((event) => event.id === selectedEventId) ?? null;
  const activeScriptStep =
    selectedEvent && activeScriptAction?.eventId === selectedEvent.id
      ? (sortedScriptSteps(selectedEvent)[activeScriptAction.actionIndex] ?? null)
      : null;
  const activeScriptText = activeScriptStep
    ? stringConfigValue(activeScriptStep.config, "text")
    : "";
  const activeScriptDeckUrl = activeScriptStep
    ? stringConfigValue(activeScriptStep.config, "deckUrl")
    : "";
  const activeScriptMarkers = useMemo(
    () => parseScriptMarkerInstances(activeScriptText),
    [activeScriptText],
  );
  const activeAudioScriptText = spokenTextFromMarkedScript(activeScriptText);
  const activeScriptAudioItem = scriptAudioItemForScriptText(
    scriptAudioItems,
    activeAudioScriptText,
  );
  const activeAudioDefaultVoiceInstructions =
    activeScriptAudioItem?.defaultVoiceInstructions ?? tutorForm.voiceInstructions;
  const activeAudioVoiceInstructionsOverride =
    activeScriptAudioItem?.voiceInstructionsOverride ?? "";
  const activeAudioVoiceInstructions =
    activeAudioVoiceInstructionsOverride || activeAudioDefaultVoiceInstructions;
  const activeAudioVoiceSettingsStepId = activeScriptStep?.id ?? "";
  const activeAudioHasCustomVoiceInstructions = Boolean(
    activeScriptAudioItem?.hasVoiceInstructionsOverride,
  );
  const activeScriptAudioNeedsGeneration = activeScriptAudioItem
    ? scriptAudioItemNeedsGeneration(activeScriptAudioItem)
    : false;
  const activeScriptAudioReady = activeScriptAudioItem
    ? scriptAudioItemIsReady(activeScriptAudioItem)
    : false;
  const isActiveScriptAudioPlaying =
    Boolean(activeScriptAudioItem) &&
    playingScriptAudioId === activeScriptAudioItem?.id;
  const missingScriptAudioCount =
    scriptAudioMissingItems(scriptAudioItems).length;
  const activePendingDisplayDraft = activeScriptStep
    ? pendingScriptDisplayDraftsRef.current[activeScriptStep.id]
    : null;
  const activePendingDisplayDraftMatches =
    activePendingDisplayDraft &&
    normalizeScriptAudioText(activePendingDisplayDraft.text) ===
      activeAudioScriptText;
  const activeDisplayBreaks = activePendingDisplayDraftMatches
    ? normalizeDisplayBreaks(
        activePendingDisplayDraft.displayBreaks,
        displayTranscriptSlotsFromText(activeAudioScriptText).length,
      )
    : displayBreakDraftForItem(activeScriptAudioItem, displayBreakDrafts);
  const activeDisplaySlots = activeScriptAudioItem
    ? (displaySlotDrafts[activeScriptAudioItem.id] ??
      scriptAudioPersistedDisplaySlots(activeScriptAudioItem))
    : [];
  const activeDisplayBaseSlots = activeScriptAudioItem
    ? scriptAudioDisplayBaseSlots(activeScriptAudioItem)
    : [];
  const activeDisplayEditorBreaks = activeScriptAudioItem
    ? normalizeDisplayBreaks(
        displayBreakDrafts[activeScriptAudioItem.id] ??
          scriptAudioPersistedDisplayBreaks(activeScriptAudioItem),
        activeDisplaySlots.length,
      )
    : [];
  const activeDisplayCueOffsets = activeScriptAudioItem?.displayCueOffsets ?? [];
  const activeScriptActionViewKey = displayDraftKey(
    activeDisplaySlots,
    activeDisplayEditorBreaks,
  );
  // Both memos key on activeScriptActionViewKey instead of the slot/break
  // arrays: those arrays are rebuilt every render, so the derived string key
  // is what prevents memo thrash.
  const activeScriptActionTimingWords = useMemo(
    () =>
      alignScriptWordsToDisplaySlots(
        activeDisplaySlots,
        activeScriptAudioItem?.timingWords ?? [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeScriptActionViewKey, activeScriptAudioItem?.timingWords],
  );
  const activeScriptActionView = useMemo(
    () =>
      projectScriptActionsToDisplayText({
        displayBreaks: activeDisplayEditorBreaks,
        displaySlots: activeDisplaySlots,
        markers: activeScriptMarkers,
        sourceText: activeScriptText,
        timingWords: activeScriptActionTimingWords,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeScriptActionViewKey,
      activeScriptMarkers,
      activeScriptActionTimingWords,
      activeScriptText,
    ],
  );
  const activeScriptSlideRefs = useMemo(
    () =>
      Array.from(
        new Set(
          activeScriptActionView.rows
            .map((row) => row.slideRef.trim())
            .filter(Boolean),
        ),
      ),
    [activeScriptActionView.rows],
  );
  const canRefreshActiveScriptSlides =
    Boolean(activeScriptDeckUrl.trim()) && activeScriptSlideRefs.length > 0;
  const activeAudioScriptVisualText =
    activeDisplayBreaks.length && activeAudioScriptText
      ? displayTextFromSlots(
          displayTranscriptSlotsFromText(activeAudioScriptText),
          activeDisplayBreaks,
        )
      : activeAudioScriptText;
  const activeAudioScriptDraftStepId = activeScriptStep?.id ?? "";
  const activeAudioScriptTextareaValue =
    audioScriptDraft.stepId === activeAudioScriptDraftStepId
      ? audioScriptDraft.text
      : activeAudioScriptVisualText;
  const { recordHistory: recordScriptActionHistory } = useScriptActionHistory({
    activeStepId: activeScriptStep?.id ?? "",
    activeText: activeScriptText,
    isEnabled:
      activeScriptDetailTab === "script" &&
      Boolean(activeScriptAction) &&
      Boolean(activeScriptStep),
    onApplyHistory: (text) => {
      setScriptActionMenu(null);
      updateActiveScriptMarkedText(text, false);
    },
  });
  const snapshotContextMenu = useExperienceSnapshotContextMenu({
    actions: [
      {
        disabled: scriptAudioStatus === "generating" || !experience,
        label:
          scriptAudioStatus === "generating"
            ? "Generating audio..."
            : missingScriptAudioCount
              ? `Generate all audio (${missingScriptAudioCount} missing)`
              : "Generate all audio",
        onSelect: generateAllExperienceAudio,
      },
    ],
    experience,
    flushEditorAutosave: flushNextEditorAutosave,
    isReady: status === "ready",
    restorePath: experienceNextEditPath,
  });

  useEffect(() => {
    writeCheckpointRecordingMode(checkpointRecordingMode);
  }, [checkpointRecordingMode]);

  useEffect(() => {
    setAudioScriptDraft((current) => {
      if (!activeAudioScriptDraftStepId) {
        return current.stepId || current.text
          ? { stepId: "", text: "" }
          : current;
      }

      const isFocusedDraft =
        current.stepId === activeAudioScriptDraftStepId &&
        audioScriptTextareaFocusedRef.current &&
        document.activeElement === audioScriptTextareaRef.current;

      if (isFocusedDraft) return current;

      if (
        current.stepId === activeAudioScriptDraftStepId &&
        current.text === activeAudioScriptVisualText
      ) {
        return current;
      }

      return {
        stepId: activeAudioScriptDraftStepId,
        text: activeAudioScriptVisualText,
      };
    });
  }, [
    activeAudioScriptDraftStepId,
    activeAudioScriptText,
    activeAudioScriptVisualText,
  ]);

  useEffect(() => {
    setAudioVoiceInstructionsDraft(activeAudioVoiceInstructions);
  }, [
    activeAudioVoiceInstructions,
    activeAudioVoiceSettingsStepId,
    activeScriptAudioItem?.id,
  ]);

  useLayoutEffect(() => {
    const pendingSelection = pendingAudioScriptSelectionRef.current;
    const textarea = audioScriptTextareaRef.current;
    if (!pendingSelection || !textarea) return;
    if (pendingSelection.stepId !== activeAudioScriptDraftStepId) return;
    if (document.activeElement !== textarea) return;

    pendingAudioScriptSelectionRef.current = null;
    const textLength = textarea.value.length;
    textarea.setSelectionRange(
      Math.min(pendingSelection.start, textLength),
      Math.min(pendingSelection.end, textLength),
      pendingSelection.direction,
    );
  }, [activeAudioScriptDraftStepId, activeAudioScriptTextareaValue]);

  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      setError("");

      try {
        await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<{ experience: Experience }>(
          `/api/experiences/${encodeURIComponent(experienceId)}/`,
        );
        const nextExperience = payload.experience;

        if (isCancelled) return;

        const locationUiState = readLocationNextEditorUiState();
        const storedUiState = readStoredNextEditorUiState(nextExperience.id);
        const uiState =
          selectedEventIdFromStored(locationUiState, nextExperience.events)
            ? locationUiState
            : storedUiState;
        const restoredSelectedEventId = selectedEventIdFromStored(
          uiState,
          nextExperience.events,
        );
        const restoredActiveScriptAction = activeScriptActionFromStored(
          uiState,
          nextExperience.events,
        );
        const restoredScriptDetailTab =
          restoredActiveScriptAction?.eventId === restoredSelectedEventId
            ? scriptDetailTabFromStored(uiState)
            : "audio";

        setExperience(nextExperience);
        setExperienceForm({
          description: nextExperience.description,
          title: nextExperience.title,
        });
        setTutorForm(nextExperience.tutor);
        setSelectedEventId(restoredSelectedEventId);
        setActiveScriptAction(
          restoredActiveScriptAction?.eventId === restoredSelectedEventId
            ? restoredActiveScriptAction
            : null,
        );
        setActiveScriptDetailTab(restoredScriptDetailTab);
        writeSelectedExperienceId(nextExperience.id);
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
      clearNextEditorAutosaveTimers();
      clearOverviewAutosaveTimer();
      clearTutorAutosaveTimer();
    };
    // The load runs once per experience; the timer-clearing callbacks are
    // re-created each render and only matter during cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experienceId]);

  useEffect(() => {
    resizeTextareaToContent(selectedEventDescriptionRef.current);
  }, [selectedEvent?.description, selectedEvent?.id]);

  useEffect(() => {
    resizeTextareaToContent(selectedEventChatInstructionsRef.current);
  }, [selectedEvent?.chatInstructions, selectedEvent?.id]);

  useEffect(() => {
    if (!selectedEventId) {
      setActiveScriptAction(null);
      return;
    }

    setActiveScriptAction((current) =>
      current && current.eventId !== selectedEventId ? null : current,
    );
  }, [selectedEventId]);

  useEffect(() => {
    if (!experience || status !== "ready") return;

    const nextUiState = {
      activeScriptAction:
        activeScriptAction && activeScriptAction.eventId === selectedEventId
          ? {
              actionIndex: activeScriptAction.actionIndex,
              eventId: activeScriptAction.eventId,
              lineNumber: activeScriptAction.lineNumber,
              source: activeScriptAction.source,
            }
          : null,
      scriptDetailTab: activeScriptAction ? activeScriptDetailTab : "audio",
      selectedEventId,
    };
    writeStoredNextEditorUiState(experience.id, nextUiState);
    writeLocationNextEditorUiState(nextUiState);
  }, [
    activeScriptAction,
    activeScriptDetailTab,
    experience,
    selectedEventId,
    status,
  ]);

  // The two loaders below run once per experience id; depending on the
  // experience object or loader identity would re-fetch on every edit.
  useEffect(() => {
    if (!experience || status !== "ready") return;

    void loadScriptAudioItems(experience.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experience?.id, status]);

  useEffect(() => {
    if (!experience || status !== "ready") return;

    void loadScriptImages(experience.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experience?.id, status]);

  useEffect(() => {
    setScriptActionMenu(null);
  }, [activeScriptStep?.id]);

  const editingScriptMarkerKey =
    scriptActionMenu?.mode === "edit" ? scriptActionMenu.markerKey : "";
  useEffect(() => {
    setIsScriptImagePickerOpen(false);
  }, [scriptActionMenu?.mode, editingScriptMarkerKey]);

  useFloatingMenuLifecycle({
    isOpen: Boolean(scriptActionMenu),
    menuRef: scriptActionMenuRef,
    onClose: () => setScriptActionMenu(null),
    position: scriptActionMenu,
    setPosition: setScriptActionMenu,
    updateDependencies: [
      isLoadingScriptImages,
      isScriptImagePickerOpen,
      scriptImageOptions.length,
    ],
  });

  const {
    beginDrag: beginScriptActionMenuDrag,
    endDrag: endScriptActionMenuDrag,
    moveDrag: moveScriptActionMenuDrag,
  } = useFloatingMenuDrag({
    fallbackHeight: 260,
    fallbackWidth: 290,
    menuRef: scriptActionMenuRef,
    position: scriptActionMenu,
    setPosition: setScriptActionMenu,
  });

  useFloatingMenuLifecycle({
    isOpen: Boolean(scriptAudioMenu),
    menuRef: scriptAudioMenuRef,
    onClose: () => setScriptAudioMenu(null),
    position: scriptAudioMenu,
    setPosition: setScriptAudioMenu,
  });

  function resolveScriptSlidePreview(
    deckUrl: string,
    slideRef: string,
    forceRefresh = false,
  ) {
    const previewKey = slidePreviewKeyForDeck(deckUrl, slideRef);
    setScriptSlidePreviews((current) => ({
      ...current,
      [previewKey]: { status: "loading" },
    }));

    return apiFetch<ResolvedSlide>("/api/slides/resolve/", {
      method: "POST",
      body: JSON.stringify({ deckUrl, forceRefresh, slideRef }),
    })
      .then((payload) => {
        setScriptSlidePreviews((current) => ({
          ...current,
          [previewKey]: {
            detail: payload.pageId,
            imageUrl: `${payload.imageUrl}?v=${Date.now()}`,
            status: "ready",
          },
        }));
      })
      .catch((error) => {
        setScriptSlidePreviews((current) => ({
          ...current,
          [previewKey]: {
            detail:
              error instanceof Error ? error.message : "Could not load slide.",
            status: "error",
          },
        }));
      });
  }

  async function refreshActiveScriptSlidePreviews() {
    const deckUrl = activeScriptDeckUrl.trim();
    if (!deckUrl || !activeScriptSlideRefs.length || isRefreshingScriptSlides) {
      return;
    }

    setIsRefreshingScriptSlides(true);
    try {
      await Promise.all(
        activeScriptSlideRefs.map((slideRef) =>
          resolveScriptSlidePreview(deckUrl, slideRef, true),
        ),
      );
    } finally {
      setIsRefreshingScriptSlides(false);
    }
  }

  useEffect(() => {
    if (
      activeScriptDetailTab !== "script" &&
      activeScriptDetailTab !== "fine-tuning"
    ) {
      return;
    }

    const deckUrl = activeScriptDeckUrl.trim();
    if (!deckUrl || !activeScriptSlideRefs.length) return;

    activeScriptSlideRefs.forEach((slideRef) => {
      const previewKey = slidePreviewKeyForDeck(deckUrl, slideRef);
      const currentPreview = scriptSlidePreviews[previewKey];
      if (
        currentPreview?.status === "loading" ||
        currentPreview?.status === "ready"
      ) {
        return;
      }

      void resolveScriptSlidePreview(deckUrl, slideRef);
    });
    // scriptSlidePreviews is read but deliberately omitted: this effect
    // writes to it, so depending on it would loop on every resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeScriptDeckUrl,
    activeScriptDetailTab,
    activeScriptSlideRefs,
  ]);

  useEffect(() => {
    if (!isScriptAudioInventoryLoaded) return;
    if (!activeScriptAudioItem) return;

    if (
      (activeScriptDetailTab === "display" ||
        activeScriptDetailTab === "fine-tuning") &&
      !activeScriptAudioReady
    ) {
      setActiveScriptDetailTab("audio");
    }
  }, [
    activeScriptAudioItem,
    activeScriptAudioReady,
    activeScriptDetailTab,
    isScriptAudioInventoryLoaded,
  ]);

  useEffect(() => {
    saveDisplayTranscriptRef.current = saveScriptAudioDisplayTranscript;
  }, [saveScriptAudioDisplayTranscript]);

  useEffect(() => {
    const item = activeScriptAudioItem;
    if (!item || !activeScriptStep) return;

    const pending = pendingScriptDisplayDraftsRef.current[activeScriptStep.id];
    if (
      !pending ||
      normalizeScriptAudioText(item.script || item.preview || "") !==
        pending.text
    ) {
      return;
    }

    const baseSlots = scriptAudioDisplayBaseSlots(item);
    if (!baseSlots.length) return;

    const nextBreaks = normalizeDisplayBreaks(
      pending.displayBreaks,
      baseSlots.length,
    );
    delete pendingScriptDisplayDraftsRef.current[activeScriptStep.id];
    delete failedDisplayAutosavesRef.current[item.id];

    setDisplaySlotDrafts((current) => ({
      ...current,
      [item.id]: baseSlots,
    }));
    setDisplayBreakDrafts((current) => ({
      ...current,
      [item.id]: nextBreaks,
    }));
  }, [activeScriptAudioItem, activeScriptStep]);

  useEffect(() => {
    const item = activeScriptAudioItem;
    if (!item || savingDisplayTextId) return undefined;

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
      return undefined;
    }

    const draftKey = displayDraftKey(draftSlots, draftBreaks);
    if (failedDisplayAutosavesRef.current[item.id] === draftKey) {
      return undefined;
    }

    if (
      displaySlotsAreEqual(draftSlots, persistedSlots) &&
      displayBreaksAreEqual(draftBreaks, persistedBreaks)
    ) {
      return undefined;
    }

    const scriptId = item.id;
    const timeoutId = window.setTimeout(() => {
      setSavingDisplayTextId(scriptId);
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
          setSavingDisplayTextId((current) =>
            current === scriptId ? "" : current,
          ),
        );
    }, displayTranscriptAutosaveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeScriptAudioItem,
    displayBreakDrafts,
    displaySlotDrafts,
    savingDisplayTextId,
  ]);

  function saveScriptTextRevealSpeed(value: number) {
    const nextSpeed = clampScriptTextAudioRevealSpeed(value);
    setScriptTextRevealSpeed(nextSpeed);
    writeScriptTextAudioRevealSpeed(nextSpeed);
    return nextSpeed;
  }

  function changeScriptTextRevealSpeed(value: string) {
    setScriptTextRevealSpeedDraft(value);

    const parsedSpeed = Number.parseFloat(value);
    if (!Number.isFinite(parsedSpeed)) return;

    saveScriptTextRevealSpeed(parsedSpeed);
  }

  function normalizeScriptTextRevealSpeedDraft() {
    const parsedSpeed = Number.parseFloat(scriptTextRevealSpeedDraft);
    const nextSpeed = saveScriptTextRevealSpeed(
      Number.isFinite(parsedSpeed) ? parsedSpeed : scriptTextRevealSpeed,
    );
    setScriptTextRevealSpeedDraft(String(nextSpeed));
  }

  // Event, on-entry, conversation, and script-text saves can all touch the
  // same event's steps, so their flushes run one at a time through a queue.
  function enqueueAutosaveFlush(flush: () => Promise<boolean>) {
    const run = autosaveFlushQueueRef.current.then(flush, flush);
    autosaveFlushQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function flushEventAutosave() {
    return enqueueAutosaveFlush(flushEventAutosaveNow);
  }

  async function flushEventAutosaveNow() {
    const pending = pendingEventAutosaveRef.current;
    if (!experience || !pending) return true;

    clearEventAutosaveTimer();
    pendingEventAutosaveRef.current = null;

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(pending.eventId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            chatInstructions: pending.chatInstructions,
            description: pending.description,
            title: pending.title,
          }),
        },
      );

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, payload.event)
          : current,
      );
      return true;
    } catch (saveError) {
      pendingEventAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save event.",
      );
      return false;
    }
  }

  function stashScriptStep(eventId: string, index: number, step: EventActionStep) {
    const stash = scriptStepStashRef.current.get(eventId) ?? [];
    stash.push({
      condition: step.condition,
      config: step.config,
      index,
      label: step.label,
    });
    while (stash.length > 20) stash.shift();
    scriptStepStashRef.current.set(eventId, stash);
  }

  function takeStashedScriptStep(eventId: string, index: number) {
    const stash = scriptStepStashRef.current.get(eventId);
    if (!stash?.length) return null;

    for (let position = stash.length - 1; position >= 0; position -= 1) {
      if (stash[position].index === index) {
        return stash.splice(position, 1)[0];
      }
    }
    return stash.pop() ?? null;
  }

  function queueOnEntryScriptRemovals(
    indices: number[],
    totalScriptActions: number,
  ) {
    if (!selectedEvent) return;

    const eventId = selectedEvent.id;
    const pending = pendingScriptStepRemovalsRef.current.get(eventId) ?? [];
    const pendingSet = new Set(pending);
    const remaining = sortedScriptSteps(selectedEvent).filter(
      (step) => !pendingSet.has(step.id),
    );
    // Editor indices are only trustworthy when its view of the script list
    // matches ours; on mismatch the count-based sync fallback applies instead.
    if (remaining.length !== totalScriptActions) return;

    const targets = indices.flatMap((index) => {
      const step = remaining[index];
      return step ? [{ index, step }] : [];
    });
    for (const { index, step } of targets) {
      pending.push(step.id);
      stashScriptStep(eventId, index, step);
    }
    pendingScriptStepRemovalsRef.current.set(eventId, pending);
  }

  async function syncDslActionStepsFromSource({
    eventId,
    eventPathId,
    experiencePathId,
    includeChatActions = false,
    includeScriptActions = false,
    latestEvent,
    source,
    sourceLabel,
  }: {
    eventId: string;
    eventPathId: string;
    experiencePathId: string;
    includeChatActions?: boolean;
    includeScriptActions?: boolean;
    latestEvent: ExperienceEvent;
    source: string;
    sourceLabel: string;
  }) {
    const nextActions = parsePythonDslStepActions(source).filter((action) => {
      if (action.actionType === "chat_availability") return includeChatActions;
      if (action.actionType === "script") return includeScriptActions;
      return true;
    });
    const existingContextSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "set_context" &&
        step.config.source === sourceLabel,
    );
    const existingGotoSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "goto_event" &&
        step.config.source === sourceLabel,
    );
    const existingChatSteps = includeChatActions
      ? sortedEventSteps(latestEvent.steps).filter(
          (step) => step.actionType === "chat_availability",
        )
      : [];
    const existingScriptSteps = includeScriptActions
      ? sortedScriptSteps(latestEvent)
      : [];
    const existingPanelSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "side_panel" && step.config.source === sourceLabel,
    );
    const existingGlowOnSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "highlight_on" &&
        step.config.source === sourceLabel,
    );
    const existingGlowOffSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "highlight_off" &&
        step.config.source === sourceLabel,
    );
    let contextIndex = 0;
    let gotoIndex = 0;
    let chatIndex = 0;
    let scriptIndex = 0;
    let panelIndex = 0;
    let glowOnIndex = 0;
    let glowOffIndex = 0;
    let nextEvent = latestEvent;
    const desiredStepIds: string[] = [];

    async function upsertDslStep(
      existingStep: EventActionStep | undefined,
      stepPayload: {
        actionType: EventActionStep["actionType"];
        condition: Record<string, unknown>;
        config: Record<string, unknown>;
        enabled: boolean;
        label: string;
      },
    ) {
      if (existingStep) {
        const isUnchanged =
          existingStep.actionType === stepPayload.actionType &&
          existingStep.enabled === stepPayload.enabled &&
          existingStep.label === stepPayload.label &&
          plainValuesEqual(existingStep.condition, stepPayload.condition) &&
          plainValuesEqual(existingStep.config, stepPayload.config);
        if (isUnchanged) return existingStep;

        const payload = await apiFetch<{ step: EventActionStep }>(
          `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
            existingStep.id,
          )}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...stepPayload,
              sortOrder: existingStep.sortOrder,
            }),
          },
        );
        nextEvent = replaceEventStep(nextEvent, payload.step);
        return payload.step;
      }

      const payload = await apiFetch<{
        event: ExperienceEvent;
        step: EventActionStep;
      }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
        method: "POST",
        body: JSON.stringify(stepPayload),
      });
      nextEvent = payload.event;
      return payload.step;
    }

    for (const action of nextActions) {
      if (action.actionType === "script") {
        const existingStep = existingScriptSteps[scriptIndex];
        // A script() line without a matching step usually means an undone
        // deletion; restore the stashed content instead of creating empty.
        const stashedStep = existingStep
          ? null
          : takeStashedScriptStep(eventId, scriptIndex);
        scriptIndex += 1;
        const step = await upsertDslStep(existingStep, {
          actionType: "script",
          condition: existingStep?.condition ?? stashedStep?.condition ?? {},
          config: existingStep?.config ??
            stashedStep?.config ?? { deckUrl: "", text: "" },
          enabled: true,
          label: existingStep?.label || stashedStep?.label || "Script",
        });
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "chat_availability") {
        const step = await upsertDslStep(existingChatSteps[chatIndex], {
          actionType: "chat_availability",
          condition: {},
          config: { enabled: action.enabled },
          enabled: true,
          label: "Set chat availability",
        });
        chatIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "set_context") {
        const step = await upsertDslStep(existingContextSteps[contextIndex], {
          actionType: "set_context",
          condition: {},
          config: {
            key: action.key,
            source: sourceLabel,
            value: action.value,
          },
          enabled: true,
          label: `Set ${action.key}`,
        });
        contextIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "goto_event") {
        const step = await upsertDslStep(existingGotoSteps[gotoIndex], {
          actionType: "goto_event",
          condition: {},
          config: {
            source: sourceLabel,
            triggersEvent: action.triggersEvent,
          },
          enabled: true,
          label: `Go to ${action.triggersEvent}`,
        });
        gotoIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "side_panel") {
        const step = await upsertDslStep(existingPanelSteps[panelIndex], {
          actionType: "side_panel",
          condition: {},
          config: {
            mode: action.mode,
            panelId: action.panelId,
            source: sourceLabel,
          },
          enabled: true,
          label: `Panel ${action.panelId} ${action.mode}`,
        });
        panelIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "highlight_on") {
        const step = await upsertDslStep(existingGlowOnSteps[glowOnIndex], {
          actionType: "highlight_on",
          condition: {},
          config: {
            color: action.color,
            selector: action.selector,
            source: sourceLabel,
          },
          enabled: true,
          label: "Glow",
        });
        glowOnIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "highlight_off") {
        const step = await upsertDslStep(existingGlowOffSteps[glowOffIndex], {
          actionType: "highlight_off",
          condition: {},
          config: {
            selector: action.selector,
            source: sourceLabel,
          },
          enabled: true,
          label: "Clear glow",
        });
        glowOffIndex += 1;
        desiredStepIds.push(step.id);
      }
    }

    // Commented "# script()" lines keep owning their step, so surplus script
    // deletion is only safe while none are present in the source.
    const surplusScriptSteps =
      includeScriptActions && !hasCommentedScriptAction(source)
        ? existingScriptSteps.slice(scriptIndex)
        : [];
    surplusScriptSteps.forEach((step, offset) =>
      stashScriptStep(eventId, scriptIndex + offset, step),
    );
    const extraSteps = [
      ...existingChatSteps.slice(chatIndex),
      ...existingContextSteps.slice(contextIndex),
      ...existingGotoSteps.slice(gotoIndex),
      ...existingPanelSteps.slice(panelIndex),
      ...existingGlowOnSteps.slice(glowOnIndex),
      ...existingGlowOffSteps.slice(glowOffIndex),
      ...surplusScriptSteps,
    ];

    if (
      !desiredStepIds.length &&
      extraSteps.length > 0 &&
      extraSteps.length === nextEvent.steps.length
    ) {
      const payload = await apiFetch<{
        event: ExperienceEvent;
        step: EventActionStep;
      }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
        method: "POST",
        body: JSON.stringify({
          actionType: "script",
          condition: {},
          config: { deckUrl: "", text: "" },
          enabled: true,
          label: "Script",
        }),
      });
      nextEvent = payload.event;
    }

    for (const extraStep of extraSteps) {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
          extraStep.id,
        )}/`,
        { method: "DELETE" },
      );
      nextEvent = payload.event;
    }

    if (desiredStepIds.length) {
      const desiredStepIdSet = new Set(desiredStepIds);
      const currentStepIds = sortedEventSteps(nextEvent.steps).map(
        (step) => step.id,
      );
      const remainingStepIds = currentStepIds.filter(
        (stepId) => !desiredStepIdSet.has(stepId),
      );
      const orderedStepIds = [...desiredStepIds, ...remainingStepIds];
      const isAlreadyOrdered =
        currentStepIds.length === orderedStepIds.length &&
        currentStepIds.every(
          (stepId, index) => stepId === orderedStepIds[index],
        );

      if (!isAlreadyOrdered) {
        const payload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/reorder/`,
          {
            method: "POST",
            body: JSON.stringify({ stepIds: orderedStepIds }),
          },
        );
        nextEvent = payload.event;
      }
    }

    return nextEvent;
  }

  function flushOnEntryAutosave() {
    return enqueueAutosaveFlush(flushOnEntryAutosaveNow);
  }

  async function flushOnEntryAutosaveNow() {
    const pending = pendingOnEntryAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    if (!targetEvent) {
      pendingOnEntryAutosaveRef.current = null;
      return true;
    }

    clearOnEntryAutosaveTimer();
    pendingOnEntryAutosaveRef.current = null;

    const experiencePathId = encodeURIComponent(experience.id);
    const eventPathId = encodeURIComponent(pending.eventId);
    const removalStepIds =
      pendingScriptStepRemovalsRef.current.get(pending.eventId) ?? [];
    pendingScriptStepRemovalsRef.current.delete(pending.eventId);
    const remainingRemovalStepIds = [...removalStepIds];
    let latestEvent = targetEvent;

    try {
      const sourcePayload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ onEntryDslSource: pending.source }),
        },
      );
      latestEvent = sourcePayload.event;

      while (remainingRemovalStepIds.length) {
        const stepId = remainingRemovalStepIds[0];
        if (latestEvent.steps.some((step) => step.id === stepId)) {
          const payload = await apiFetch<{ event: ExperienceEvent }>(
            `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
              stepId,
            )}/`,
            { method: "DELETE" },
          );
          latestEvent = payload.event;
        }
        remainingRemovalStepIds.shift();
      }

      latestEvent = await syncDslActionStepsFromSource({
        eventId: pending.eventId,
        eventPathId,
        experiencePathId,
        includeChatActions: true,
        includeScriptActions: true,
        latestEvent,
        source: pending.source,
        sourceLabel: onEntryDslStepSource,
      });

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, latestEvent)
          : current,
      );
      return true;
    } catch (saveError) {
      if (remainingRemovalStepIds.length) {
        pendingScriptStepRemovalsRef.current.set(pending.eventId, [
          ...remainingRemovalStepIds,
          ...(pendingScriptStepRemovalsRef.current.get(pending.eventId) ?? []),
        ]);
      }
      pendingOnEntryAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save On entry.",
      );
      return false;
    }
  }

  function flushConversationAutosave() {
    return enqueueAutosaveFlush(flushConversationAutosaveNow);
  }

  async function flushConversationAutosaveNow() {
    const pending = pendingConversationAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    if (!targetEvent) {
      pendingConversationAutosaveRef.current = null;
      return true;
    }

    clearConversationAutosaveTimer();
    pendingConversationAutosaveRef.current = null;

    const conversationChoices = conversationChoicesFromDslSource(
      pending.source,
      targetEvent.conversationChoices ?? [],
    );
    let latestEvent = targetEvent;

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(pending.eventId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            conversationChoices,
            conversationDslSource: pending.source,
          }),
        },
      );
      latestEvent = payload.event;

      latestEvent = await syncDslActionStepsFromSource({
        eventId: pending.eventId,
        eventPathId: encodeURIComponent(pending.eventId),
        experiencePathId: encodeURIComponent(experience.id),
        latestEvent,
        source: pending.source,
        sourceLabel: conversationDslStepSource,
      });

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, latestEvent)
          : current,
      );
      return true;
    } catch (saveError) {
      pendingConversationAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save In Conversation.",
      );
      return false;
    }
  }

  function flushScriptTextAutosave() {
    return enqueueAutosaveFlush(flushScriptTextAutosaveNow);
  }

  async function flushScriptTextAutosaveNow() {
    const pending = pendingScriptTextAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    const targetStep = targetEvent?.steps.find(
      (step) => step.id === pending.stepId,
    );
    if (!targetEvent || !targetStep) {
      pendingScriptTextAutosaveRef.current = null;
      return true;
    }

    clearScriptTextAutosaveTimer();
    pendingScriptTextAutosaveRef.current = null;
    const nextConfig = { ...targetStep.config };
    const didUpdateScriptText = pending.text !== undefined;
    if (pending.text !== undefined) {
      nextConfig.text = pending.text;
    }
    if (pending.deckUrl !== undefined) {
      nextConfig.deckUrl = pending.deckUrl;
    }

    try {
      const payload = await apiFetch<{ step: EventActionStep }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(
          pending.eventId,
        )}/steps/${encodeURIComponent(pending.stepId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            actionType: targetStep.actionType,
            condition: targetStep.condition,
            config: nextConfig,
            enabled: targetStep.enabled,
            label: targetStep.label,
            sortOrder: targetStep.sortOrder,
          }),
        },
      );

      setExperience((current) => {
        if (!current || current.id !== experience.id) return current;

        const currentEvent = current.events.find(
          (event) => event.id === pending.eventId,
        );
        if (!currentEvent) return current;

        return replaceExperienceEvent(
          current,
          replaceEventStep(currentEvent, payload.step),
        );
      });
      if (didUpdateScriptText) {
        void loadScriptAudioItems(experience.id, false);
      }
      return true;
    } catch (saveError) {
      pendingScriptTextAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save script.",
      );
      return false;
    }
  }

  function updateSelectedEventDraft(
    field: "chatInstructions" | "description" | "title",
    value: string,
  ) {
    if (!experience || !selectedEvent) return;

    const eventId = selectedEvent.id;
    const pending =
      pendingEventAutosaveRef.current?.eventId === eventId
        ? pendingEventAutosaveRef.current
        : {
            chatInstructions: selectedEvent.chatInstructions ?? "",
            description: selectedEvent.description,
            eventId,
            title: selectedEvent.title,
          };
    const nextPending = {
      ...pending,
      [field]: value,
    };

    pendingEventAutosaveRef.current = nextPending;
    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find((event) => event.id === eventId);
      if (!currentEvent) return current;

      return replaceExperienceEvent(current, {
        ...currentEvent,
        [field]: value,
      });
    });

    scheduleEventAutosave();
  }

  function updateSelectedEventOnEntryDraft(value: string) {
    if (!selectedEvent) return;

    const eventId = selectedEvent.id;
    setOnEntryDrafts((current) => ({
      ...current,
      [eventId]: value,
    }));
    pendingOnEntryAutosaveRef.current = { eventId, source: value };

    scheduleOnEntryAutosave();
  }

  function updateSelectedEventConversationDraft(value: string) {
    if (!experience || !selectedEvent) return;

    const eventId = selectedEvent.id;
    const conversationChoices = conversationChoicesFromDslSource(
      value,
      selectedEvent.conversationChoices ?? [],
    );

    setConversationDrafts((current) => ({
      ...current,
      [eventId]: value,
    }));
    pendingConversationAutosaveRef.current = { eventId, source: value };

    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find((event) => event.id === eventId);
      if (!currentEvent) return current;

      return replaceExperienceEvent(current, {
        ...currentEvent,
        conversationDslSource: value,
        conversationChoices,
      });
    });

    scheduleConversationAutosave();
  }

  function openSelectedEventScriptAction(action: PythonDslScriptAction) {
    if (!selectedEvent) return;

    setActiveScriptAction((current) => {
      const nextAction = {
        ...action,
        eventId: selectedEvent.id,
      };
      const isSameAction =
        current?.eventId === nextAction.eventId &&
        current.actionIndex === nextAction.actionIndex;

      return isSameAction ? null : nextAction;
    });
  }

  function queueActiveScriptTextChange(
    nextMarkedScriptText: string,
    displayTextForBreaks?: string,
  ) {
    if (!experience || !selectedEvent || !activeScriptStep) return;

    const nextAudioScriptText = spokenTextFromMarkedScript(nextMarkedScriptText);
    const scriptId =
      activeScriptAudioItem && nextAudioScriptText === activeAudioScriptText
        ? activeScriptAudioItem.id
        : "";

    if (displayTextForBreaks !== undefined) {
      const nextDisplayBreaks = displayBreaksFromText(displayTextForBreaks);
      pendingScriptDisplayDraftsRef.current[activeScriptStep.id] = {
        displayBreaks: nextDisplayBreaks,
        text: nextAudioScriptText,
      };

      if (scriptId) {
        delete failedDisplayAutosavesRef.current[scriptId];
        setDisplayBreakDrafts((current) => ({
          ...current,
          [scriptId]: nextDisplayBreaks,
        }));
      }
    }

    const currentPending = pendingScriptTextAutosaveRef.current;
    const pendingForStep =
      currentPending?.eventId === selectedEvent.id &&
      currentPending.stepId === activeScriptStep.id
        ? currentPending
        : null;
    pendingScriptTextAutosaveRef.current = {
      ...pendingForStep,
      eventId: selectedEvent.id,
      stepId: activeScriptStep.id,
      text: nextMarkedScriptText,
    };

    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find(
        (event) => event.id === selectedEvent.id,
      );
      if (!currentEvent) return current;

      const currentStep = currentEvent.steps.find(
        (step) => step.id === activeScriptStep.id,
      );
      if (!currentStep) return current;

      return replaceExperienceEvent(
        current,
        replaceEventStep(currentEvent, {
          ...currentStep,
          config: { ...currentStep.config, text: nextMarkedScriptText },
        }),
      );
    });

    scheduleScriptTextAutosave();
  }

  function updateActiveScriptDeckUrl(value: string) {
    if (!experience || !selectedEvent || !activeScriptStep) return;

    const currentPending = pendingScriptTextAutosaveRef.current;
    const pendingForStep =
      currentPending?.eventId === selectedEvent.id &&
      currentPending.stepId === activeScriptStep.id
        ? currentPending
        : null;
    pendingScriptTextAutosaveRef.current = {
      ...pendingForStep,
      deckUrl: value,
      eventId: selectedEvent.id,
      stepId: activeScriptStep.id,
    };

    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find(
        (event) => event.id === selectedEvent.id,
      );
      if (!currentEvent) return current;

      const currentStep = currentEvent.steps.find(
        (step) => step.id === activeScriptStep.id,
      );
      if (!currentStep) return current;

      return replaceExperienceEvent(
        current,
        replaceEventStep(currentEvent, {
          ...currentStep,
          config: { ...currentStep.config, deckUrl: value },
        }),
      );
    });

    scheduleScriptTextAutosave();
  }

  function focusActiveScriptText(value: string) {
    audioScriptTextareaFocusedRef.current = true;
    if (!activeAudioScriptDraftStepId) return;

    setAudioScriptDraft((current) =>
      current.stepId === activeAudioScriptDraftStepId
        ? current
        : { stepId: activeAudioScriptDraftStepId, text: value },
    );
  }

  function blurActiveScriptText() {
    audioScriptTextareaFocusedRef.current = false;
  }

  async function saveActiveAudioVoiceInstructionsOverride() {
    const item = activeScriptAudioItem;
    if (!item) return;

    const normalizedDraft = audioVoiceInstructionsDraft.trim();
    const normalizedDefault = activeAudioDefaultVoiceInstructions.trim();
    const currentOverride = activeAudioVoiceInstructionsOverride.trim();
    const nextOverride =
      normalizedDraft && normalizedDraft !== normalizedDefault
        ? normalizedDraft
        : "";
    if (nextOverride === currentOverride) return;

    await saveScriptAudioVoiceInstructionsOverride(item.id, nextOverride);
  }

  function changeActiveScriptText(
    value: string,
    selectionStart: number | null,
    selectionEnd: number | null,
    selectionDirection: "backward" | "forward" | "none" | null,
  ) {
    if (activeAudioScriptDraftStepId) {
      if (selectionStart !== null && selectionEnd !== null) {
        pendingAudioScriptSelectionRef.current = {
          direction: selectionDirection ?? "none",
          end: selectionEnd,
          start: selectionStart,
          stepId: activeAudioScriptDraftStepId,
        };
      }

      setAudioScriptDraft({
        stepId: activeAudioScriptDraftStepId,
        text: value,
      });
    }
    updateActiveScriptText(value);
  }

  function updateActiveScriptText(value: string) {
    const nextAudioScriptText = normalizeScriptAudioText(value);
    const nextMarkedScriptText = mergeMarkersIntoSpokenText(
      nextAudioScriptText,
      activeScriptMarkers,
    );
    queueActiveScriptTextChange(nextMarkedScriptText, value);
  }

  function updateActiveScriptMarkedText(value: string, recordHistory = true) {
    if (value === activeScriptText) return;

    if (recordHistory) {
      recordScriptActionHistory(activeScriptText, value);
    }
    queueActiveScriptTextChange(value);
  }

  function openScriptInsertMenu(
    insertionIndex: number,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!activeScriptStep) return;

    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 290, 180);
    setScriptActionMenu({
      insertionIndex,
      mode: "insert",
      ...position,
    });
  }

  function openScriptMarkerMenu(
    marker: ScriptMarkerInstance,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 320, 300);
    setScriptActionMenu({
      markerKey: markerEditKey(marker),
      mode: "edit",
      ...position,
    });
  }

  async function saveSidePanelOverrides(next: SidePanelOverride[]) {
    if (!experience) return;

    const experienceId = experience.id;
    setExperience((current) =>
      current && current.id === experienceId
        ? { ...current, sidePanels: next }
        : current,
    );
    try {
      await apiFetch(`/api/experiences/${encodeURIComponent(experienceId)}/`, {
        method: "PATCH",
        body: JSON.stringify({ sidePanels: next }),
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save side panels.",
      );
    }
  }

  function insertScriptAction(
    type: "glow" | "panel" | "slide" | "side-image" | "sound",
  ) {
    if (!activeScriptStep || scriptActionMenu?.mode !== "insert") return;

    let marker = buildScriptMarker("play_sound", [
      scriptSoundOptions[0].path,
      "0.5",
    ]);
    if (type === "slide") {
      marker = buildScriptMarker("gslide", [
        nextSlideRefAfterInsertion(
          activeScriptMarkers,
          scriptActionMenu.insertionIndex,
        ),
      ]);
    } else if (type === "side-image") {
      marker = buildScriptMarker("side_image", [
        "left",
        "show",
        tutorForm.avatarPath || defaultScriptSideImagePath,
      ]);
    } else if (type === "panel") {
      marker = buildScriptMarker("panel_on", [
        sidePanelMetadataDefinitions[0]?.id ?? "roadmap",
      ]);
    } else if (type === "glow") {
      const target = glowTargets()[0];
      marker = buildScriptMarker("highlight_on", [
        target?.selector ?? ".glow-chat-input",
        defaultGlowColor,
      ]);
    }
    updateActiveScriptMarkedText(
      insertScriptMarkerAt(
        activeScriptText,
        scriptActionMenu.insertionIndex,
        marker,
      ),
    );
    setActiveScriptDetailTab("script");
    setScriptActionMenu(null);
  }

  function replaceScriptActionMarker(
    marker: ScriptMarkerInstance,
    args: string[],
  ) {
    const nextMarker = buildScriptMarker(
      marker.type,
      appendScriptMarkerTimelineArg(args, marker.timeMs),
    );
    const currentMarkerKey = markerEditKey(marker);
    const nextMarkerKey = markerEditKeyFrom(
      marker.start,
      marker.start + nextMarker.length,
      nextMarker,
    );

    updateActiveScriptMarkedText(
      replaceScriptMarker(activeScriptText, marker, nextMarker),
    );
    setScriptActionMenu((current) => {
      if (
        current?.mode !== "edit" ||
        current.markerKey !== currentMarkerKey
      ) {
        return current;
      }

      return {
        ...current,
        markerKey: nextMarkerKey,
      };
    });
  }

  function moveScriptActionMarker(
    marker: ScriptActionViewMarker,
    targetSourceIndex: number,
  ) {
    if (!activeScriptStep) return null;

    const sourceMarker = sourceMarkerForView(marker);
    const insertionIndex = Math.round(
      clamp(targetSourceIndex, 0, activeScriptText.length),
    );
    if (
      insertionIndex >= sourceMarker.start &&
      insertionIndex <= sourceMarker.end
    ) {
      return viewMarkerEditKey(marker);
    }

    const markerWithoutTimeline = buildScriptMarker(
      sourceMarker.type,
      sourceMarker.argList,
    );
    const textWithoutMarker = `${activeScriptText.slice(
      0,
      sourceMarker.start,
    )}${activeScriptText.slice(sourceMarker.end)}`;
    const adjustedInsertionIndex =
      insertionIndex > sourceMarker.start
        ? insertionIndex - sourceMarker.marker.length
        : insertionIndex;
    const beforeInsertion = textWithoutMarker.slice(0, adjustedInsertionIndex);
    const afterInsertion = textWithoutMarker.slice(adjustedInsertionIndex);
    const prefix =
      beforeInsertion && !/\s$/.test(beforeInsertion) ? " " : "";
    const suffix =
      afterInsertion && !/^\s/.test(afterInsertion) ? " " : "";
    const nextMarkerStart = beforeInsertion.length + prefix.length;
    const nextMarkerEnd = nextMarkerStart + markerWithoutTimeline.length;

    updateActiveScriptMarkedText(
      `${beforeInsertion}${prefix}${markerWithoutTimeline}${suffix}${afterInsertion}`,
    );
    setScriptActionMenu(null);
    setActiveScriptDetailTab("script");
    return markerEditKeyFrom(
      nextMarkerStart,
      nextMarkerEnd,
      markerWithoutTimeline,
    );
  }

  function removeScriptActionMarker(marker: ScriptMarkerInstance) {
    updateActiveScriptMarkedText(removeScriptMarker(activeScriptText, marker));
    setScriptActionMenu(null);
  }

  function updateDisplayDocumentDraft(draft: DisplayDocumentDraft) {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    setDisplaySlotDrafts((current) => {
      return {
        ...current,
        [scriptId]: draft.displaySlots,
      };
    });
    setDisplayBreakDrafts((current) => {
      return {
        ...current,
        [scriptId]: normalizeDisplayBreaks(
          draft.displayBreaks,
          draft.displaySlots.length,
        ),
      };
    });
  }

  async function updateActiveDisplayCueOffsets(offsets: number[]) {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    setSavingDisplayTextId(scriptId);
    try {
      await saveDisplayTranscriptRef.current(
        scriptId,
        activeDisplaySlots,
        activeDisplayEditorBreaks,
        offsets,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save chat cue timing.",
      );
    } finally {
      setSavingDisplayTextId((current) => (current === scriptId ? "" : current));
    }
  }

  function resetDisplayTextToAudioScript() {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    delete failedDisplayAutosavesRef.current[scriptId];
    setDisplaySlotDrafts((current) => ({
      ...current,
      [scriptId]: scriptAudioDisplayBaseSlots(activeScriptAudioItem),
    }));
  }

  async function generateAllExperienceAudio() {
    const payload = await generateScriptAudio();
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
    }
  }

  async function playOrGenerateActiveScriptAudio() {
    const item = activeScriptAudioItem;
    if (!item) return;

    if (isActiveScriptAudioPlaying) {
      stopScriptAudioPreview();
      return;
    }

    if (item.audioUrl) {
      playScriptAudioPreview(item);
      return;
    }

    if (!item.canGenerate || scriptAudioStatus === "generating") return;

    const payload = await generateScriptAudio(item.id);
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
      return;
    }

    const nextItem = payload?.scripts.find(
      (candidate) => candidate.id === item.id,
    );
    if (!nextItem?.audioUrl) {
      setError(item.generationReason || "Could not generate this script's audio.");
    }
  }

  function openScriptAudioMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!activeScriptAudioItem) return;

    setScriptActionMenu(null);
    setScriptAudioMenu(
      clampFloatingMenuPosition(event.clientX, event.clientY, 220, 48),
    );
  }

  async function regenerateActiveScriptAudio() {
    setScriptAudioMenu(null);

    const item = activeScriptAudioItem;
    if (!item || !item.canGenerate || scriptAudioStatus === "generating") return;

    if (isActiveScriptAudioPlaying) {
      stopScriptAudioPreview();
    }

    const payload = await generateScriptAudio(item.id, true);
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
    }
  }

  function handleRegenerateScriptAudioMenuClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    void regenerateActiveScriptAudio();
  }

  async function generateMissingAudioBeforeRun() {
    if (!experience) return null;

    setAudioPreparation({
      completed: 0,
      message: "Generating missing audio",
      total: 0,
    });

    const inventoryPayload = await loadScriptAudioItems(experience.id, false);
    if (!inventoryPayload) {
      setAudioPreparation(null);
      setError("Could not check scripted audio before starting.");
      return null;
    }

    const inventoryItems = inventoryPayload.scripts;
    const missingItems = scriptAudioMissingItems(inventoryItems);
    if (!missingItems.length) {
      setAudioPreparation(null);
      return 0;
    }

    setAudioPreparation({
      completed: 0,
      message: "Generating missing audio",
      total: missingItems.length,
    });

    const payload = await generateScriptAudio("", false);
    if (!payload) {
      setAudioPreparation(null);
      setError("Could not generate missing audio before starting.");
      return null;
    }

    const remainingCount = scriptAudioMissingItems(payload.scripts).length;
    const completedCount = Math.max(0, missingItems.length - remainingCount);
    setAudioPreparation({
      completed: remainingCount ? completedCount : missingItems.length,
      message: remainingCount
        ? "Generating missing audio"
        : "Preparing experience",
      total: missingItems.length,
    });

    if (payload.errors?.length || remainingCount) {
      setAudioPreparation(null);
      setError(
        payload.errors?.join(" ") ||
          `Could not generate ${remainingCount} audio item${
            remainingCount === 1 ? "" : "s"
          }.`,
      );
      return null;
    }

    return missingItems.length;
  }

  async function flushNextEditorAutosave() {
    const didSaveOverview = await flushOverviewAutosave();
    const didSaveTutor = await flushTutorAutosave();
    const didSaveEvent = await flushEventAutosave();
    const didSaveOnEntry = await flushOnEntryAutosave();
    const didSaveConversation = await flushConversationAutosave();
    const didSaveScriptText = await flushScriptTextAutosave();
    return (
      didSaveOverview &&
      didSaveTutor &&
      didSaveEvent &&
      didSaveOnEntry &&
      didSaveConversation &&
      didSaveScriptText
    );
  }

  async function returnToExperiences() {
    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    window.location.assign("/experiences");
  }

  async function openDesignLab() {
    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    window.location.assign("/run-design");
  }

  async function runEvent(eventId: string) {
    if (!experience || runningEventId) return;

    setRunningEventId(eventId);
    const didSave = await flushNextEditorAutosave();
    if (!didSave) {
      setRunningEventId("");
      return;
    }

    const preparedAudioTotal = await generateMissingAudioBeforeRun();
    if (preparedAudioTotal === null) {
      setRunningEventId("");
      return;
    }

    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({
          eventId,
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

    setAudioPreparation({
      completed: preparedAudioTotal,
      message: "Preparing experience",
      total: preparedAudioTotal,
    });
    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceRunPath(experience.id));
  }

  async function createEvent() {
    if (!experience) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    setError("");
    setIsCreatingEvent(true);

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/events/`,
        {
          method: "POST",
          body: JSON.stringify({ description: "", title: "New event" }),
        },
      );

      setExperience((current) => {
        if (!current || current.id !== experience.id) return current;

        return {
          ...current,
          events: sortedExperienceEvents([...current.events, payload.event]),
        };
      });
      setSelectedEventId(payload.event.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create event.",
      );
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function deleteEvent(eventId: string) {
    if (!experience || deletingEventId) return;

    const targetEvent = experience.events.find((event) => event.id === eventId);
    if (!targetEvent) return;

    if (experience.events.length <= 1) {
      setError("An experience needs at least one event.");
      return;
    }

    const label = targetEvent.title || targetEvent.slug || "Untitled event";
    if (!window.confirm(`Delete event "${label}"?`)) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    setError("");
    setDeletingEventId(eventId);

    if (pendingEventAutosaveRef.current?.eventId === eventId) {
      pendingEventAutosaveRef.current = null;
    }
    if (pendingOnEntryAutosaveRef.current?.eventId === eventId) {
      pendingOnEntryAutosaveRef.current = null;
    }
    if (pendingConversationAutosaveRef.current?.eventId === eventId) {
      pendingConversationAutosaveRef.current = null;
    }
    if (pendingScriptTextAutosaveRef.current?.eventId === eventId) {
      pendingScriptTextAutosaveRef.current = null;
    }
    pendingScriptStepRemovalsRef.current.delete(eventId);
    scriptStepStashRef.current.delete(eventId);
    for (const step of targetEvent.steps) {
      delete pendingScriptDisplayDraftsRef.current[step.id];
    }

    try {
      const payload = await apiFetch<{ events: ExperienceEvent[] }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(eventId)}/`,
        { method: "DELETE" },
      );
      const nextEvents = sortedExperienceEvents(payload.events);

      setExperience((current) =>
        current && current.id === experience.id
          ? { ...current, events: nextEvents }
          : current,
      );
      setOnEntryDrafts((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      setConversationDrafts((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      setSelectedEventId((current) => {
        if (current && nextEvents.some((event) => event.id === current)) {
          return current;
        }

        return (
          nextEvents.find((event) => event.isStart)?.id ??
          nextEvents[0]?.id ??
          ""
        );
      });
      setActiveScriptAction(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event.",
      );
    } finally {
      setDeletingEventId(null);
    }
  }

  function selectScriptImage(imagePath: string) {
    if (!editingScriptMarker || !editingSideImageState) return;

    replaceScriptActionMarker(
      editingScriptMarker,
      scriptSideImageArgsFromState({
        ...editingSideImageState,
        imagePath,
      }),
    );
    setIsScriptImagePickerOpen(false);
  }

  function selectTutorAvatar(imagePath: string) {
    updateTutorDraft("avatarPath", imagePath);
    setIsTutorAvatarPickerOpen(false);
  }

  async function uploadScriptImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !experience) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }

    setError("");
    setIsUploadingScriptImage(true);
    const imagePath = await uploadScriptImageFile(
      file,
      "Could not upload script image.",
    );
    setIsUploadingScriptImage(false);
    event.target.value = "";
    if (imagePath === null) return;

    if (editingScriptMarker && editingSideImageState) {
      replaceScriptActionMarker(
        editingScriptMarker,
        scriptSideImageArgsFromState({
          ...editingSideImageState,
          imagePath,
        }),
      );
    }
    setIsScriptImagePickerOpen(false);
  }

  async function uploadTutorAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !experience) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }

    setError("");
    setIsUploadingTutorAvatar(true);
    const imagePath = await uploadScriptImageFile(
      file,
      "Could not upload tutor image.",
    );
    setIsUploadingTutorAvatar(false);
    event.target.value = "";
    if (imagePath === null) return;

    updateTutorDraft("avatarPath", imagePath);
    setIsTutorAvatarPickerOpen(false);
  }

  async function deleteUploadedScriptImage(imagePath: string, label: string) {
    if (!experience || !imagePath) return;

    const didConfirm = window.confirm(
      `Delete "${label || imagePath}" from uploaded images? Existing scripts that use it may need a new image.`,
    );
    if (!didConfirm) return;

    setError("");
    const didDelete = await deleteScriptImageFile(imagePath);
    if (!didDelete) return;

    if (editingScriptMarker && editingSideImageState?.imagePath === imagePath) {
      replaceScriptActionMarker(
        editingScriptMarker,
        scriptSideImageArgsFromState({
          ...editingSideImageState,
          imagePath: "",
        }),
      );
    }
    if (tutorForm.avatarPath === imagePath) {
      updateTutorDraft("avatarPath", defaultScriptSideImagePath);
    }
  }

  const selectedEventOnEntrySource = selectedEvent
    ? (onEntryDrafts[selectedEvent.id] ??
      (selectedEvent.onEntryDslSource ||
        pythonDslSourceFromEventSteps(selectedEvent.steps)))
    : "";
  const selectedEventInConversationSource = selectedEvent
    ? (conversationDrafts[selectedEvent.id] ??
      (selectedEvent.conversationDslSource ||
        conversationChoiceDslSourceFromChoices(
          selectedEvent.conversationChoices ?? [],
        )))
    : "";
  const firstSelectedEventScriptAction = useMemo(
    () => firstTopLevelScriptActionFromDsl(selectedEventOnEntrySource),
    [selectedEventOnEntrySource],
  );
  const firstSelectedEventScriptActionKey = selectedEvent
    ? scriptActionAutoOpenKey(selectedEvent.id, firstSelectedEventScriptAction)
    : "";

  useEffect(() => {
    if (!selectedEvent || status !== "ready") return;

    if (activeScriptAction?.eventId === selectedEvent.id) {
      autoOpenedScriptActionKeyRef.current = firstSelectedEventScriptActionKey;
      return;
    }

    if (
      !firstSelectedEventScriptAction ||
      !firstSelectedEventScriptActionKey ||
      !sortedScriptSteps(selectedEvent)[
        firstSelectedEventScriptAction.actionIndex
      ] ||
      autoOpenedScriptActionKeyRef.current === firstSelectedEventScriptActionKey
    ) {
      return;
    }

    autoOpenedScriptActionKeyRef.current = firstSelectedEventScriptActionKey;
    setActiveScriptAction({
      ...firstSelectedEventScriptAction,
      eventId: selectedEvent.id,
    });
  }, [
    activeScriptAction?.eventId,
    firstSelectedEventScriptAction,
    firstSelectedEventScriptActionKey,
    selectedEvent,
    status,
  ]);

  const eventInspector = selectedEvent ? (
    <div className="next-event-inspector">
      <div className="next-event-title-row">
        <input
          aria-label="Event title"
          className="next-event-title-text"
          onChange={(event) =>
            updateSelectedEventDraft("title", event.target.value)
          }
          placeholder="Untitled event"
          type="text"
          value={selectedEvent.title}
        />
        <button
          aria-label="Delete event"
          className="next-event-delete-button"
          disabled={
            deletingEventId === selectedEvent.id ||
            (experience?.events.length ?? 0) <= 1
          }
          onClick={() => void deleteEvent(selectedEvent.id)}
          title="Delete event"
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
      <textarea
        aria-label="Event description"
        className="next-event-description-text"
        onChange={(event) =>
          updateSelectedEventDraft("description", event.target.value)
        }
        onInput={(event) => resizeTextareaToContent(event.currentTarget)}
        placeholder="No description yet."
        ref={selectedEventDescriptionRef}
        rows={1}
        value={selectedEvent.description}
      />
      <section className="next-event-script-section">
        <div className="next-event-script-heading">
          <h3>On entry</h3>
          <button
            aria-label="On entry action help"
            className="next-event-script-help"
            data-tooltip="Ctrl-click chat actions to toggle on/off. Ctrl-click goto destinations to choose an event. Click script actions to open their panel."
            type="button"
          >
            <HelpIcon />
          </button>
        </div>
        <Suspense
          fallback={
            <div
              aria-label="Loading code editor"
              className="python-dsl-loading"
              role="status"
            />
          }
        >
          <PythonDslEditor
            activeScriptAction={
              activeScriptAction?.eventId === selectedEvent.id
                ? activeScriptAction
                : null
            }
            ariaLabel="On entry script"
            eventTargets={experience?.events ?? []}
            onChange={updateSelectedEventOnEntryDraft}
            onOpenScriptAction={openSelectedEventScriptAction}
            onRemoveScriptActions={queueOnEntryScriptRemovals}
            value={selectedEventOnEntrySource}
          />
        </Suspense>
      </section>
      <section className="next-event-script-section">
        <div className="next-event-script-heading">
          <h3>In Conversation</h3>
        </div>
        <label className="next-conversation-context-field">
          <span>extra conversation context</span>
          <textarea
            aria-label="Extra conversation context"
            className="next-conversation-context-text"
            onChange={(event) =>
              updateSelectedEventDraft("chatInstructions", event.target.value)
            }
            onInput={(event) => resizeTextareaToContent(event.currentTarget)}
            ref={selectedEventChatInstructionsRef}
            rows={1}
            value={selectedEvent.chatInstructions ?? ""}
          />
        </label>
        <Suspense
          fallback={
            <div
              aria-label="Loading code editor"
              className="python-dsl-loading"
              role="status"
            />
          }
        >
          <PythonDslEditor
            ariaLabel="In Conversation script"
            eventTargets={(experience?.events ?? []).filter(
              (event) => event.id !== selectedEvent.id,
            )}
            mode="conversation"
            onChange={updateSelectedEventConversationDraft}
            value={selectedEventInConversationSource}
          />
        </Suspense>
      </section>
    </div>
  ) : null;

  const isDisplayTextResetDisabled = activeScriptAudioItem
    ? displaySlotsAreEqual(
        activeDisplaySlots,
        activeDisplayBaseSlots,
      )
    : true;
  const activeScriptAudioPreviewDisabled =
    !activeScriptAudioItem ||
    scriptAudioStatus === "generating" ||
    (!activeScriptAudioItem.audioUrl && !activeScriptAudioItem.canGenerate);
  const activeScriptAudioRegenerateDisabled =
    !activeScriptAudioItem ||
    !activeScriptAudioItem.canGenerate ||
    scriptAudioStatus === "generating";
  const activeScriptAudioPreviewLabel = isActiveScriptAudioPlaying
    ? "Stop audio script preview"
    : activeScriptAudioItem?.audioUrl
      ? "Play audio script preview"
      : activeScriptAudioNeedsGeneration
        ? "Generate audio script"
        : "Audio script preview unavailable";
  const activeScriptAudioPreviewStateClass =
    scriptAudioStatus === "generating"
      ? "is-generating"
      : activeScriptAudioItem?.audioUrl
        ? "has-audio"
        : "is-empty";
  const editingScriptMarker =
    scriptActionMenu?.mode === "edit"
      ? (activeScriptMarkers.find(
          (marker) => markerEditKey(marker) === scriptActionMenu.markerKey,
        ) ?? null)
      : null;
  const editingSideImageState =
    editingScriptMarker?.type === "side_image"
      ? scriptSideImageStateFromArgs(editingScriptMarker.argList)
      : null;
  const scriptImagePickerOptions = (() => {
    const currentPath = editingSideImageState?.imagePath.trim() ?? "";
    if (
      !currentPath ||
      scriptImageOptions.some((option) => option.path === currentPath)
    ) {
      return scriptImageOptions;
    }

    return [
      {
        label: "Current image",
        path: currentPath,
        source: "Custom",
      },
      ...scriptImageOptions,
    ];
  })();
  const tutorAvatarPickerOptions = (() => {
    const currentPath = tutorForm.avatarPath.trim();
    if (
      !currentPath ||
      scriptImageOptions.some((option) => option.path === currentPath)
    ) {
      return scriptImageOptions;
    }

    return [
      {
        label: "Current image",
        path: currentPath,
        source: "Custom",
      },
      ...scriptImageOptions,
    ];
  })();
  const displayTextPanel = activeScriptAudioItem ? (
    <DisplayTextEditor
      baseSlots={activeDisplayBaseSlots}
      displayBreaks={activeDisplayEditorBreaks}
      displaySlots={activeDisplaySlots}
      isSaving={savingDisplayTextId === activeScriptAudioItem.id}
      item={activeScriptAudioItem}
      onChange={updateDisplayDocumentDraft}
      onReset={resetDisplayTextToAudioScript}
      resetDisabled={isDisplayTextResetDisabled}
    />
  ) : (
    <div
      aria-busy={scriptAudioStatus === "loading" ? "true" : "false"}
      aria-label="Display Text"
      className="next-display-text-empty"
    />
  );

  const audioScriptPanel = (
    <ScriptAudioEditorPanel
      audioText={activeAudioScriptTextareaValue}
      audioTextareaRef={audioScriptTextareaRef}
      hasCustomVoiceInstructions={activeAudioHasCustomVoiceInstructions}
      isAudioTextDisabled={!activeScriptStep}
      isVoiceSettingsDisabled={!activeScriptAudioItem}
      isVoiceSettingsOpen={isAudioVoiceSettingsOpen}
      onAudioTextBlur={blurActiveScriptText}
      onAudioTextChange={changeActiveScriptText}
      onAudioTextFocus={focusActiveScriptText}
      onSaveVoiceInstructions={saveActiveAudioVoiceInstructionsOverride}
      onToggleVoiceSettings={() =>
        setIsAudioVoiceSettingsOpen((current) => !current)
      }
      onVoiceInstructionsChange={setAudioVoiceInstructionsDraft}
      voiceInstructionsDraft={audioVoiceInstructionsDraft}
      voiceInstructionsRef={audioVoiceInstructionsRef}
    />
  );
  const scriptActionsPanel = (
    <ScriptActionReadOnlyView
      actionRows={activeScriptActionView.rows}
      canRefreshSlides={canRefreshActiveScriptSlides}
      deckUrl={activeScriptDeckUrl}
      displayBreaks={[]}
      isRefreshingSlides={isRefreshingScriptSlides}
      markers={activeScriptActionView.markers}
      onDeckUrlChange={updateActiveScriptDeckUrl}
      onOpenInsert={openScriptInsertMenu}
      onOpenMarker={openScriptMarkerMenu}
      onMoveMarker={moveScriptActionMarker}
      onRefreshSlides={refreshActiveScriptSlidePreviews}
      onRemoveMarker={removeScriptActionMarker}
      previews={scriptSlidePreviews}
      sourceIndexByTextIndex={activeScriptActionView.sourceIndexByTextIndex}
      text={activeScriptActionView.text}
    />
  );
  const fineTuningPanel = (
    <NextFineTuningPanel
      audioItem={activeScriptAudioItem}
      deckUrl={activeScriptDeckUrl}
      displayBreaks={activeDisplayEditorBreaks}
      displayCueOffsets={activeDisplayCueOffsets}
      displaySlots={activeDisplaySlots}
      canRefreshSlides={canRefreshActiveScriptSlides}
      isRefreshingSlides={isRefreshingScriptSlides}
      onBeforePlaybackStart={stopScriptAudioPreview}
      onDisplayCueOffsetsChange={(offsets) =>
        void updateActiveDisplayCueOffsets(offsets)
      }
      onMarkedTextChange={updateActiveScriptMarkedText}
      onRefreshSlides={refreshActiveScriptSlidePreviews}
      previews={scriptSlidePreviews}
      text={activeScriptText}
      textRevealSpeed={scriptTextRevealSpeed}
    />
  );

  const actionDetailPanel =
    activeScriptAction && selectedEvent?.id === activeScriptAction.eventId ? (
      <NextScriptWorkspace
        activeTab={activeScriptDetailTab}
        audioPanel={audioScriptPanel}
        canUseGeneratedAudioTabs={activeScriptAudioReady}
        displayPanel={displayTextPanel}
        fineTuningPanel={fineTuningPanel}
        isAudioPreviewDisabled={activeScriptAudioPreviewDisabled}
        isAudioPreviewPlaying={isActiveScriptAudioPlaying}
        onAudioPreview={() => void playOrGenerateActiveScriptAudio()}
        onAudioPreviewMenu={openScriptAudioMenu}
        onTabChange={setActiveScriptDetailTab}
        previewButtonClassName={activeScriptAudioPreviewStateClass}
        previewLabel={activeScriptAudioPreviewLabel}
        scriptAudioError={scriptAudioError}
        scriptPanel={scriptActionsPanel}
      >
        <NextScriptActionMenuPortal
          deletingScriptImagePath={deletingScriptImagePath}
          editingScriptMarker={editingScriptMarker}
          editingSideImageState={editingSideImageState}
          isLoadingScriptImages={isLoadingScriptImages}
          isScriptImagePickerOpen={isScriptImagePickerOpen}
          isUploadingScriptImage={isUploadingScriptImage}
          menu={scriptActionMenu}
          menuRef={scriptActionMenuRef}
          onBeginDrag={beginScriptActionMenuDrag}
          onDeleteImage={(path, label) =>
            void deleteUploadedScriptImage(path, label)
          }
          onEndDrag={endScriptActionMenuDrag}
          onInsertAction={insertScriptAction}
          onMoveDrag={moveScriptActionMenuDrag}
          onRemoveMarker={removeScriptActionMarker}
          onReplaceMarker={replaceScriptActionMarker}
          onSelectImage={selectScriptImage}
          onUploadImage={(event) => void uploadScriptImage(event)}
          scriptImageFileInputRef={scriptImageFileInputRef}
          scriptImagePickerOptions={scriptImagePickerOptions}
          setIsScriptImagePickerOpen={setIsScriptImagePickerOpen}
        />
        <NextScriptAudioMenuPortal
          disabled={activeScriptAudioRegenerateDisabled}
          menu={scriptAudioMenu}
          menuRef={scriptAudioMenuRef}
          onRegenerate={handleRegenerateScriptAudioMenuClick}
        />
      </NextScriptWorkspace>
    ) : null;

  return (
    <main
      className="panel-study experience-editor-page experience-editor-next-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
      onContextMenu={snapshotContextMenu.onContextMenu}
    >
      {audioPreparation ? (
        <div
          aria-label="Generating missing audio"
          aria-live="polite"
          className="next-audio-prep-overlay"
          role="status"
        >
          <div className="next-audio-prep-dialog">
            <span>{audioPreparation.message}</span>
            <strong>
              {audioPreparation.total
                ? `${audioPreparation.completed}/${audioPreparation.total}`
                : "Checking audio"}
            </strong>
            <div
              className={[
                "next-audio-prep-meter",
                audioPreparation.total ? "" : "is-indeterminate",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <i
                style={{
                  width: audioPreparation.total
                    ? `${Math.round(
                        (audioPreparation.completed /
                          audioPreparation.total) *
                          100,
                      )}%`
                    : undefined,
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
      <header className="study-header">
        <div className="study-actions">
          <button
            className="header-action secondary"
            onClick={() => void returnToExperiences()}
            type="button"
          >
            Experiences
          </button>
          <button
            className="header-action secondary"
            onClick={() => void openDesignLab()}
            type="button"
          >
            Design lab
          </button>
        </div>
      </header>

      <section className="experience-editor experience-editor-next">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}
        {status === "ready" && error ? (
          <div className="experience-state error next-editor-error-banner" role="alert">
            <span>{error}</span>
            <button
              aria-label="Dismiss error"
              className="next-editor-error-dismiss"
              onClick={() => setError("")}
              type="button"
            >
              &times;
            </button>
          </div>
        ) : null}

        {experience ? (
          <NextEditorOverviewHeader
            deletingScriptImagePath={deletingScriptImagePath}
            experienceForm={experienceForm}
            isLoadingScriptImages={isLoadingScriptImages}
            isTutorAvatarPickerOpen={isTutorAvatarPickerOpen}
            isTutorSettingsOpen={isTutorSettingsOpen}
            isUploadingTutorAvatar={isUploadingTutorAvatar}
            onDeleteUploadedImage={(path, label) =>
              void deleteUploadedScriptImage(path, label)
            }
            onFlushTutorAutosave={flushTutorAutosave}
            onLoadScriptImages={() => void loadScriptImages(experience.id)}
            onPlayVoiceSample={playVoiceSample}
            onScriptTextRevealSpeedBlur={normalizeScriptTextRevealSpeedDraft}
            onScriptTextRevealSpeedChange={changeScriptTextRevealSpeed}
            onSelectTutorAvatar={selectTutorAvatar}
            onTutorAvatarUpload={(event) => void uploadTutorAvatar(event)}
            onTutorDraftChange={updateTutorDraft}
            onTutorModelDraftChange={updateTutorModelDraft}
            onUpdateOverviewDraft={updateOverviewDraft}
            scriptImageOptions={scriptImageOptions}
            scriptTextRevealSpeedDraft={scriptTextRevealSpeedDraft}
            setIsTutorAvatarPickerOpen={setIsTutorAvatarPickerOpen}
            setIsTutorSettingsOpen={setIsTutorSettingsOpen}
            tutorAvatarPickerOptions={tutorAvatarPickerOptions}
            tutorForm={tutorForm}
            voiceSampleStatus={voiceSampleStatus}
          />
        ) : null}

        {/* Per-experience panel icon/title overrides are hidden for now:
            render <ExperiencePanelsEditor> here (wired to
            saveSidePanelOverrides) to bring the "Panels" settings back. */}

        {experience ? (
          <ExperienceEventFlow
            checkpointRecordingMode={checkpointRecordingMode}
            detailPanel={actionDetailPanel}
            events={experience.events}
            experienceId={experience.id}
            inspector={eventInspector}
            isCreatingEvent={isCreatingEvent}
            onCheckpointRecordingModeChange={setCheckpointRecordingMode}
            onCreateEvent={() => void createEvent()}
            onDeleteEvent={(eventId) => void deleteEvent(eventId)}
            onRunEvent={(eventId) => void runEvent(eventId)}
            onSelectEvent={setSelectedEventId}
            runningEventId={runningEventId}
            selectedEventId={selectedEventId}
          />
        ) : null}
      </section>
      {snapshotContextMenu.menu}
    </main>
  );
}
