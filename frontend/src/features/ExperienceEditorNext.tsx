import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
import { stringConfigValue } from "../runtimeUtils";
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
  ExperiencesPayload,
  ResolvedSlide,
  ScriptAudioItem,
  SessionPayload,
  TutorSettings,
} from "../types";
import { experienceAutosaveDelayMs } from "./eventEditorUtils";
import type { PythonDslScriptAction } from "./PythonDslEditor";
import {
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
import type { ImageLibraryOption } from "./ImageLibraryPicker";
import { NextEditorOverviewHeader } from "./NextEditorOverviewHeader";
import { clampFloatingMenuPosition } from "./floatingMenuPosition";
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
  appendScriptActionHistoryEntry,
  displayBreakDraftForItem,
  insertScriptMarkerAt,
  isNativeUndoTarget,
  mergeMarkersIntoSpokenText,
  removeScriptMarker,
  replaceScriptMarker,
  scriptAudioItemForScriptText,
} from "./nextEditorScriptUtils";
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

const PythonDslEditor = lazy(() =>
  import("./PythonDslEditor").then((module) => ({
    default: module.PythonDslEditor,
  })),
);

type PendingEventAutosave = {
  chatInstructions: string;
  description: string;
  eventId: string;
  title: string;
};

type PendingOnEntryAutosave = {
  eventId: string;
  source: string;
};

type PendingConversationAutosave = {
  eventId: string;
  source: string;
};

type PendingScriptTextAutosave = {
  deckUrl?: string;
  eventId: string;
  stepId: string;
  text?: string;
};

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

type ScriptActionMenuDragState = {
  menuX: number;
  menuY: number;
  pointerId: number;
  startX: number;
  startY: number;
};

const onEntryScriptActionPattern = /\bscript\s*\([^)]*\)/g;
const onEntryDslStepSource = "next-on-entry-dsl";
const conversationDslStepSource = "next-conversation-dsl";

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
      onEntryScriptActionPattern.lastIndex = 0;
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
  const [scriptImageOptions, setScriptImageOptions] = useState<
    ImageLibraryOption[]
  >([]);
  const [deletingScriptImagePath, setDeletingScriptImagePath] = useState("");
  const [isLoadingScriptImages, setIsLoadingScriptImages] = useState(false);
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
  const eventAutosaveTimerRef = useRef<number | null>(null);
  const onEntryAutosaveTimerRef = useRef<number | null>(null);
  const conversationAutosaveTimerRef = useRef<number | null>(null);
  const scriptTextAutosaveTimerRef = useRef<number | null>(null);
  const pendingEventAutosaveRef = useRef<PendingEventAutosave | null>(null);
  const pendingOnEntryAutosaveRef = useRef<PendingOnEntryAutosave | null>(null);
  const pendingConversationAutosaveRef =
    useRef<PendingConversationAutosave | null>(null);
  const pendingScriptTextAutosaveRef =
    useRef<PendingScriptTextAutosave | null>(null);
  const pendingScriptDisplayDraftsRef = useRef<
    Record<string, PendingScriptDisplayDraft>
  >({});
  const failedDisplayAutosavesRef = useRef<Record<string, string>>({});
  const autoOpenedScriptActionKeyRef = useRef("");
  const scriptActionHistoryStepIdRef = useRef("");
  const scriptActionRedoStackRef = useRef<string[]>([]);
  const scriptActionUndoStackRef = useRef<string[]>([]);
  const scriptActionMenuDragRef = useRef<ScriptActionMenuDragState | null>(null);
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
  const activeScriptActionTimingWords = useMemo(
    () =>
      alignScriptWordsToDisplaySlots(
        activeDisplaySlots,
        activeScriptAudioItem?.timingWords ?? [],
      ),
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
    const stepId = activeScriptStep?.id ?? "";
    if (scriptActionHistoryStepIdRef.current === stepId) return;

    scriptActionHistoryStepIdRef.current = stepId;
    scriptActionRedoStackRef.current = [];
    scriptActionUndoStackRef.current = [];
  }, [activeScriptStep?.id]);

  useEffect(() => {
    function handleScriptActionHistoryShortcut(
      event: globalThis.KeyboardEvent,
    ) {
      if (
        activeScriptDetailTab !== "script" ||
        !activeScriptAction ||
        !activeScriptStep ||
        isNativeUndoTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const isMod = event.ctrlKey || event.metaKey;
      const isRedo =
        isMod &&
        !event.altKey &&
        (key === "y" || (key === "z" && event.shiftKey));
      const isUndo =
        isMod && !event.altKey && key === "z" && !event.shiftKey;
      if (!isRedo && !isUndo) return;

      const stack = isRedo
        ? scriptActionRedoStackRef.current
        : scriptActionUndoStackRef.current;
      if (!stack.length) return;

      event.preventDefault();
      event.stopPropagation();
      applyScriptActionHistory(isRedo ? "redo" : "undo");
    }

    document.addEventListener("keydown", handleScriptActionHistoryShortcut);
    return () =>
      document.removeEventListener(
        "keydown",
        handleScriptActionHistoryShortcut,
      );
  }, [
    activeScriptAction,
    activeScriptDetailTab,
    activeScriptStep,
    activeScriptText,
  ]);

  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      setError("");

      try {
        await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const nextExperience =
          payload.experiences.find((candidate) => candidate.id === experienceId) ??
          null;

        if (!nextExperience) {
          throw new Error("Experience not found.");
        }

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
      clearEventAutosaveTimer();
      clearOnEntryAutosaveTimer();
      clearConversationAutosaveTimer();
      clearScriptTextAutosaveTimer();
      clearOverviewAutosaveTimer();
      clearTutorAutosaveTimer();
    };
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

  useEffect(() => {
    if (!experience || status !== "ready") return;

    void loadScriptAudioItems(experience.id, false);
  }, [experience?.id, status]);

  useEffect(() => {
    if (!experience || status !== "ready") return;

    void loadScriptImages(experience.id);
  }, [experience?.id, status]);

  useEffect(() => {
    setScriptActionMenu(null);
  }, [activeScriptStep?.id]);

  useEffect(() => {
    setIsScriptImagePickerOpen(false);
  }, [
    scriptActionMenu?.mode,
    scriptActionMenu?.mode === "edit" ? scriptActionMenu.markerKey : "",
  ]);

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

  useEffect(() => {
    if (!scriptActionMenu) return;

    function moveWhileDragging(event: PointerEvent) {
      const dragState = scriptActionMenuDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      moveScriptActionMenuToPointer(event.clientX, event.clientY);
    }

    function stopDragging(event: PointerEvent) {
      const dragState = scriptActionMenuDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      scriptActionMenuDragRef.current = null;
    }

    window.addEventListener("pointermove", moveWhileDragging);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", moveWhileDragging);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [scriptActionMenu]);

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
    }, 700);

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

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimerRef.current) return;

    window.clearTimeout(eventAutosaveTimerRef.current);
    eventAutosaveTimerRef.current = null;
  }

  function clearOnEntryAutosaveTimer() {
    if (!onEntryAutosaveTimerRef.current) return;

    window.clearTimeout(onEntryAutosaveTimerRef.current);
    onEntryAutosaveTimerRef.current = null;
  }

  function clearConversationAutosaveTimer() {
    if (!conversationAutosaveTimerRef.current) return;

    window.clearTimeout(conversationAutosaveTimerRef.current);
    conversationAutosaveTimerRef.current = null;
  }

  function clearScriptTextAutosaveTimer() {
    if (!scriptTextAutosaveTimerRef.current) return;

    window.clearTimeout(scriptTextAutosaveTimerRef.current);
    scriptTextAutosaveTimerRef.current = null;
  }

  async function flushEventAutosave() {
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

  async function syncDslActionStepsFromSource({
    eventPathId,
    experiencePathId,
    includeChatActions = false,
    includeScriptActions = false,
    latestEvent,
    source,
    sourceLabel,
  }: {
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
    let contextIndex = 0;
    let gotoIndex = 0;
    let chatIndex = 0;
    let scriptIndex = 0;
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
        scriptIndex += 1;
        const step = await upsertDslStep(existingStep, {
          actionType: "script",
          condition: existingStep?.condition ?? {},
          config: existingStep?.config ?? { deckUrl: "", text: "" },
          enabled: true,
          label: existingStep?.label || "Script",
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
      }
    }

    const extraSteps = [
      ...existingChatSteps.slice(chatIndex),
      ...existingContextSteps.slice(contextIndex),
      ...existingGotoSteps.slice(gotoIndex),
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
      const remainingStepIds = sortedEventSteps(nextEvent.steps)
        .map((step) => step.id)
        .filter((stepId) => !desiredStepIdSet.has(stepId));
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/reorder/`,
        {
          method: "POST",
          body: JSON.stringify({
            stepIds: [...desiredStepIds, ...remainingStepIds],
          }),
        },
      );
      nextEvent = payload.event;
    }

    return nextEvent;
  }

  async function flushOnEntryAutosave() {
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

      latestEvent = await syncDslActionStepsFromSource({
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
      pendingOnEntryAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save On entry.",
      );
      return false;
    }
  }

  async function flushConversationAutosave() {
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

  async function flushScriptTextAutosave() {
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

    clearEventAutosaveTimer();
    eventAutosaveTimerRef.current = window.setTimeout(() => {
      void flushEventAutosave();
    }, experienceAutosaveDelayMs);
  }

  function updateSelectedEventOnEntryDraft(value: string) {
    if (!selectedEvent) return;

    const eventId = selectedEvent.id;
    setOnEntryDrafts((current) => ({
      ...current,
      [eventId]: value,
    }));
    pendingOnEntryAutosaveRef.current = { eventId, source: value };

    clearOnEntryAutosaveTimer();
    onEntryAutosaveTimerRef.current = window.setTimeout(() => {
      void flushOnEntryAutosave();
    }, experienceAutosaveDelayMs);
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

    clearConversationAutosaveTimer();
    conversationAutosaveTimerRef.current = window.setTimeout(() => {
      void flushConversationAutosave();
    }, experienceAutosaveDelayMs);
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

    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosave();
    }, experienceAutosaveDelayMs);
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

    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosave();
    }, experienceAutosaveDelayMs);
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

  function recordScriptActionHistory(previousText: string, nextText: string) {
    if (!activeScriptStep || previousText === nextText) return;

    scriptActionUndoStackRef.current = appendScriptActionHistoryEntry(
      scriptActionUndoStackRef.current,
      previousText,
    );
    scriptActionRedoStackRef.current = [];
  }

  function updateActiveScriptMarkedText(value: string, recordHistory = true) {
    if (value === activeScriptText) return;

    if (recordHistory) {
      recordScriptActionHistory(activeScriptText, value);
    }
    queueActiveScriptTextChange(value);
  }

  function applyScriptActionHistory(direction: "redo" | "undo") {
    if (!activeScriptStep) return;

    const sourceStack =
      direction === "undo"
        ? scriptActionUndoStackRef.current
        : scriptActionRedoStackRef.current;
    let targetText = sourceStack.pop();
    while (targetText !== undefined && targetText === activeScriptText) {
      targetText = sourceStack.pop();
    }
    if (targetText === undefined) return;

    if (direction === "undo") {
      scriptActionUndoStackRef.current = sourceStack;
      scriptActionRedoStackRef.current = appendScriptActionHistoryEntry(
        scriptActionRedoStackRef.current,
        activeScriptText,
      );
    } else {
      scriptActionRedoStackRef.current = sourceStack;
      scriptActionUndoStackRef.current = appendScriptActionHistoryEntry(
        scriptActionUndoStackRef.current,
        activeScriptText,
      );
    }

    setScriptActionMenu(null);
    updateActiveScriptMarkedText(targetText, false);
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

  function beginScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!scriptActionMenu || event.button > 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scriptActionMenuDragRef.current = {
      menuX: scriptActionMenu.x,
      menuY: scriptActionMenu.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function moveScriptActionMenuToPointer(clientX: number, clientY: number) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState) return;

    const rect = scriptActionMenuRef.current?.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      dragState.menuX + clientX - dragState.startX,
      dragState.menuY + clientY - dragState.startY,
      rect?.width ?? 290,
      rect?.height ?? 260,
    );
    setScriptActionMenu((current) =>
      current
        ? {
            ...current,
            ...nextPosition,
          }
        : current,
    );
  }

  function moveScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    moveScriptActionMenuToPointer(event.clientX, event.clientY);
  }

  function endScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scriptActionMenuDragRef.current = null;
  }

  function insertScriptAction(type: "slide" | "side-image" | "sound") {
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

  async function loadScriptImages(targetExperienceId = experience?.id ?? "") {
    if (!targetExperienceId) return;

    setIsLoadingScriptImages(true);
    try {
      const payload = await apiFetch<{ images: ImageLibraryOption[] }>(
        `/api/experiences/${encodeURIComponent(targetExperienceId)}/script-images/`,
      );
      setScriptImageOptions(payload.images);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load script images.",
      );
    } finally {
      setIsLoadingScriptImages(false);
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

    try {
      const formData = new FormData();
      formData.append("image", file);
      const payload = await apiFetch<{
        imagePath: string;
        images: ImageLibraryOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "POST",
          body: formData,
        },
      );

      setScriptImageOptions(payload.images);
      if (editingScriptMarker && editingSideImageState) {
        replaceScriptActionMarker(
          editingScriptMarker,
          scriptSideImageArgsFromState({
            ...editingSideImageState,
            imagePath: payload.imagePath,
          }),
        );
      }
      setIsScriptImagePickerOpen(false);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload script image.",
      );
    } finally {
      setIsUploadingScriptImage(false);
      event.target.value = "";
    }
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

    try {
      const formData = new FormData();
      formData.append("image", file);
      const payload = await apiFetch<{
        imagePath: string;
        images: ImageLibraryOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "POST",
          body: formData,
        },
      );

      setScriptImageOptions(payload.images);
      updateTutorDraft("avatarPath", payload.imagePath);
      setIsTutorAvatarPickerOpen(false);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload tutor image.",
      );
    } finally {
      setIsUploadingTutorAvatar(false);
      event.target.value = "";
    }
  }

  async function deleteUploadedScriptImage(imagePath: string, label: string) {
    if (!experience || !imagePath) return;

    const didConfirm = window.confirm(
      `Delete "${label || imagePath}" from uploaded images? Existing scripts that use it may need a new image.`,
    );
    if (!didConfirm) return;

    setError("");
    setDeletingScriptImagePath(imagePath);
    try {
      const payload = await apiFetch<{
        deletedImagePath: string;
        images: ImageLibraryOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "DELETE",
          body: JSON.stringify({ imagePath }),
        },
      );

      setScriptImageOptions(payload.images);
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
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete script image.",
      );
    } finally {
      setDeletingScriptImagePath((current) =>
        current === imagePath ? "" : current,
      );
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
        </div>
      </header>

      <section className="experience-editor experience-editor-next">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
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
