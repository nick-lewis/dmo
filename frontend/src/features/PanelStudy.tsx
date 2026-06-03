import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type RealtimeModelId,
  type RealtimeStatus,
  type RealtimeVoiceId,
  isRealtimeVoiceSupported,
  realtimeVoiceOptionsForModel,
} from "../realtime";
import {
  type RuntimeInteractive,
} from "../mainPanelApps";
import {
  defaultPythonNotebookState,
  normalizePythonNotebookState,
} from "../PythonNotebookPanel";
import {
  apiFetch,
  experienceEditPath,
  experienceRunPath,
  getCurrentPath,
  routeExperience,
} from "../api";
import { publicAsset } from "../assets";
import {
  readSelectedExperienceId,
  readSlideSettings,
  writeSelectedExperienceId,
  writeSlideSettings,
} from "../persistence";
import {
  choiceIconBackgroundValue,
  defaultChoiceIconBackground,
} from "../uiHelpers";
import {
  recordFromUnknown,
  runtimeActionText,
  runtimeInteractiveFromRecord,
  runtimeNotesFromValue,
  runtimeOverlaysFromRecord,
  runtimeSlideFromRecord,
} from "../runtimeUtils";
import type {
  ApiUser,
  ChatMessage,
  EventActionStep,
  EventChatTool,
  EventClassifier,
  EventClassifierGroup,
  EventConversationCheck,
  EventConversationChoice,
  Experience,
  ExperienceForm,
  ExperiencesPayload,
  ExperienceEvent,
  ResolvedSlide,
  RuntimeActionLogEntry,
  RuntimeButton,
  RuntimeHighlight,
  RuntimeNote,
  RuntimeOverlay,
  RuntimeUiState,
  RuntimeUiTrigger,
  SessionPayload,
  SlideStatus,
  StartEventPayload,
  TutorSettings,
  TutoringSession,
  VoiceSamplePayload,
  VoiceSampleStatus,
} from "../types";
import {
  InspectorIcon,
} from "../components/Icons";
import { ChatPanelContent } from "./ChatPanelContent";
import {
  LeftPanelContent,
  leftPanels,
} from "./LeftPanelContent";
import { MainPanelContent } from "./MainPanelContent";
import { PanelWindow } from "./PanelWindow";
import { RuntimeInspectorPanel } from "./RuntimeInspectorPanel";
import { TutorControls } from "./TutorControls";
import { usePythonNotebookPersistence } from "./usePythonNotebookPersistence";
import { useRuntimeInteractivePersistence } from "./useRuntimeInteractivePersistence";
import { useRuntimeLayout } from "./useRuntimeLayout";
import { useRealtimeChat } from "./useRealtimeChat";
import { useScriptAudioPlayback } from "./useScriptAudioPlayback";
const sampleSlideDeckUrl =
  "https://docs.google.com/presentation/d/1laLiG097c6sTnRqTEMYSclNNgGPRqkvTVM_6BSUuj3k/";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}


function localMessageId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


export function PanelStudy({ initialExperienceId = "" }: { initialExperienceId?: string }) {
  const initialSlideSettings = useRef(readSlideSettings());
  const {
    dragLeftDivider,
    dragLowerDivider,
    dragWorkspaceDivider,
    isLeftOpen,
    lowerHeight,
    rightRef,
    setIsLeftOpen,
    shellRef,
    shellStyle,
  } = useRuntimeLayout({ initiallyOpen: !initialExperienceId });
  const startedSessionIds = useRef(new Set<string>());
  const runtimeSoundEffectsRef = useRef(new Set<HTMLAudioElement>());
  const suppressSlideControlResetRef = useRef(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [selectedExperienceId, setSelectedExperienceId] = useState("");
  const [experienceForm, setExperienceForm] = useState<ExperienceForm>({
    description: "",
    title: "",
  });
  const [tutorForm, setTutorForm] = useState<TutorSettings>({
    assistantName: "dee-lou",
    avatarPath: "test-images/dLU-right.png",
    choiceIconBackground: defaultChoiceIconBackground,
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  });
  const [session, setSession] = useState<TutoringSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] =
    useState<RealtimeModelId>("gpt-realtime-mini");
  const [selectedVoice, setSelectedVoice] = useState<RealtimeVoiceId>("ash");
  const [slideDeckUrl, setSlideDeckUrl] = useState(
    initialSlideSettings.current.deckUrl,
  );
  const [slideRef, setSlideRef] = useState(
    initialSlideSettings.current.slideRef,
  );
  const [resolvedSlide, setResolvedSlide] = useState<ResolvedSlide | null>(null);
  const [slideStatus, setSlideStatus] = useState<SlideStatus>("empty");
  const [slideError, setSlideError] = useState("");
  const [runtimeInteractive, setRuntimeInteractive] =
    useState<RuntimeInteractive | null>(null);
  const [runtimeInteractiveState, setRuntimeInteractiveState] = useState<
    Record<string, unknown>
  >({});
  const {
    changePythonNotebook,
    clearNotebookSaveTimer,
    clearPythonNotebookOutputs,
    formatPythonNotebookCell,
    pythonNotebook,
    pythonNotebookError,
    pythonNotebookStatus,
    runPythonNotebookAll,
    runPythonNotebookCell,
    setPythonNotebook,
    setPythonNotebookError,
    setPythonNotebookStatus,
  } = usePythonNotebookPersistence({
    applyRuntimeActions,
    session,
    setMessages,
    setSession,
  });
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [chatStatus, setChatStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [chatError, setChatError] = useState("");
  const [experienceError, setExperienceError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCreatingExperience, setIsCreatingExperience] = useState(false);
  const [isSavingExperience, setIsSavingExperience] = useState(false);
  const [isSavingTutor, setIsSavingTutor] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [turnAnchorMessageId, setTurnAnchorMessageId] = useState<string | null>(
    null,
  );
  const [notesVisible, setNotesVisible] = useState(false);
  const [runtimeNotes, setRuntimeNotes] = useState<RuntimeNote[]>([]);
  const [runtimeChatEnabled, setRuntimeChatEnabled] = useState(true);
  const [runtimeSoundCount, setRuntimeSoundCount] = useState(0);
  const [runtimeAvatarPath, setRuntimeAvatarPath] = useState("");
  const [runtimeAvatarVisible, setRuntimeAvatarVisible] = useState(true);
  const [runtimeHighlights, setRuntimeHighlights] = useState<
    Record<string, RuntimeHighlight>
  >({});
  const [runtimeOverlays, setRuntimeOverlays] = useState<
    Record<string, RuntimeOverlay>
  >({});
  const [runtimeButtons, setRuntimeButtons] = useState<RuntimeButton[]>([]);
  const [runtimeTriggers, setRuntimeTriggers] = useState<RuntimeUiTrigger[]>([]);
  const [runtimeActionLog, setRuntimeActionLog] = useState<
    RuntimeActionLogEntry[]
  >([]);
  const {
    conversationChoiceActionsFromRanEvents,
    isConversationChoiceDeferred,
    isScriptAudioPlaying,
    queueScriptMessages,
  } = useScriptAudioPlayback({
    activeSessionId: session?.id ?? "",
    applyRuntimeActions,
    choiceIconBackground: tutorForm.choiceIconBackground,
    selectedModel,
    selectedVoice,
    setChatError,
    setMessages,
    setRealtimeStatus,
    setTurnAnchorMessageId,
    stopRuntimeSoundEffects,
  });
  const {
    changeRuntimeInteractiveState,
    clearInteractiveSaveTimer,
    emitRuntimeInteractiveActions,
    persistRuntimeInteractiveState,
    saveRuntimeInteractiveContext,
  } = useRuntimeInteractivePersistence({
    applyRuntimeActions,
    conversationChoiceActionsFromRanEvents,
    queueScriptMessages,
    runtimeInteractive,
    runtimeInteractiveState,
    session,
    setChatError,
    setChatStatus,
    setMessages,
    setRuntimeInteractiveState,
    setSession,
    setTurnAnchorMessageId,
  });
  const {
    closeRealtimeConnection,
    isSendingMessage,
    sendChatMessage,
  } = useRealtimeChat({
    applyRuntimeActions,
    conversationChoiceActionsFromRanEvents,
    currentRuntimeUiState,
    queueScriptMessages,
    selectedModel,
    selectedVoice,
    session,
    setChatError,
    setChatStatus,
    setMessages,
    setRealtimeStatus,
    setSession,
    setTurnAnchorMessageId,
  });
  const selectedExperience =
    experiences.find((experience) => experience.id === selectedExperienceId) ?? null;
  const currentRuntimeEventId =
    typeof session?.runtimeState?.currentEventId === "string"
      ? session.runtimeState.currentEventId
      : "";
  const currentRuntimeEventSlug =
    typeof session?.runtimeState?.currentEventSlug === "string"
      ? session.runtimeState.currentEventSlug
      : "";
  const currentRuntimeEvent =
    selectedExperience?.events.find(
      (event) =>
        event.id === currentRuntimeEventId ||
        event.slug === currentRuntimeEventSlug,
    ) ?? null;

  function currentRuntimeUiState(
    overrides: Partial<RuntimeUiState> = {},
  ): RuntimeUiState {
    return {
      avatarPath: runtimeAvatarPath,
      avatarVisible: runtimeAvatarVisible,
      interactive: runtimeInteractiveState,
      leftPanels: {
        pythonNotebook,
      },
      notes: runtimeNotes,
      notesVisible,
      overlays: runtimeOverlays,
      ...overrides,
    };
  }

  function stopRuntimeSoundEffects() {
    runtimeSoundEffectsRef.current.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    runtimeSoundEffectsRef.current.clear();
    setRuntimeSoundCount(0);
  }

  function playRuntimeSoundEffect(action: Record<string, unknown>) {
    const soundPath =
      typeof action.soundPath === "string" ? action.soundPath.trim() : "";
    if (!soundPath) return;

    const rawVolume =
      typeof action.volume === "number"
        ? action.volume
        : Number.parseFloat(
            typeof action.volume === "string" ? action.volume : "",
          );
    const audio = new Audio(publicAsset(soundPath));
    audio.preload = "auto";
    audio.volume = Number.isFinite(rawVolume) ? clamp(rawVolume, 0, 1) : 1;
    runtimeSoundEffectsRef.current.add(audio);
    setRuntimeSoundCount(runtimeSoundEffectsRef.current.size);

    const cleanup = () => {
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
      runtimeSoundEffectsRef.current.delete(audio);
      setRuntimeSoundCount(runtimeSoundEffectsRef.current.size);
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    void audio.play().catch(cleanup);
  }

  function applyRuntimeActions(actions: Array<Record<string, unknown>>) {
    if (!actions.length) return;

    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setRuntimeActionLog((current) => [
      ...actions.map((action) => ({
        detail: runtimeActionText(action),
        id: localMessageId("runtime-action"),
        time: now,
        type: typeof action.type === "string" ? action.type : "action",
      })),
      ...current,
    ].slice(0, 48));

    for (const action of actions) {
      if (action.type === "gslide") {
        const slide = runtimeSlideFromRecord(action);
        if (!slide) continue;

        setResolvedSlide({
          cached: slide.cached,
          imageUrl: slide.imageUrl,
          pageId: slide.pageId,
          presentationId: slide.presentationId,
          slideRef: slide.slideRef,
        });
        suppressSlideControlResetRef.current = true;
        setSlideDeckUrl(slide.deckUrl);
        setSlideError("");
        setSlideRef(slide.slideRef);
        setSlideStatus("ready");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "slide_error") {
        setResolvedSlide(null);
        setSlideError(
          typeof action.detail === "string"
            ? action.detail
            : "Could not load that slide.",
        );
        setSlideStatus("error");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "interactive") {
        const interactive = runtimeInteractiveFromRecord(action);
        if (!interactive) continue;

        setRuntimeInteractive(interactive);
        setRuntimeInteractiveState(
          recordFromUnknown(action.state ?? interactive.config.initialState),
        );
        setResolvedSlide(null);
        setSlideError("");
        setSlideStatus("empty");
      }

      if (action.type === "interactive_state") {
        const state = recordFromUnknown(action.state);
        setRuntimeInteractiveState(state);
      }

      if (action.type === "interactive_error") {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
        setResolvedSlide(null);
        setSlideError(
          typeof action.detail === "string"
            ? action.detail
            : "Main-panel app is not registered.",
        );
        setSlideStatus("error");
      }

      if (action.type === "interactive_update") {
        const update = runtimeInteractiveFromRecord(action);
        if (!update) continue;

        setRuntimeInteractive((current) => {
          const base = current?.interactiveId === update.interactiveId ? current : update;
          return {
            ...base,
            config: {
              ...base.config,
              ...update.config,
            },
            mode: update.mode || base.mode,
            prompt: update.prompt || base.prompt,
            title: update.title || base.title,
            triggersEvent: update.triggersEvent || base.triggersEvent,
          };
        });
        if (Object.prototype.hasOwnProperty.call(action, "state")) {
          setRuntimeInteractiveState(recordFromUnknown(action.state));
        }
      }

      if (action.type === "interactive_clear") {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "python_notebook" && action.notebook) {
        setPythonNotebook(normalizePythonNotebookState(action.notebook));
      }

      if (action.type === "chat_availability") {
        setRuntimeChatEnabled(action.enabled !== false);
      }

      if (action.type === "show_image") {
        const imagePath =
          typeof action.imagePath === "string" ? action.imagePath.trim() : "";
        if (imagePath) {
          setRuntimeAvatarPath(imagePath);
          setRuntimeAvatarVisible(true);
        }
      }

      if (action.type === "agent_image_visibility") {
        setRuntimeAvatarVisible(action.visible !== false);
      }

      if (action.type === "overlay") {
        const imagePath =
          typeof action.imagePath === "string" ? action.imagePath.trim() : "";
        const overlayId =
          typeof action.overlayId === "string" && action.overlayId.trim()
            ? action.overlayId.trim()
            : "default";
        if (imagePath) {
          setRuntimeOverlays((current) => ({
            ...current,
            [overlayId]: { id: overlayId, imagePath },
          }));
        }
      }

      if (action.type === "overlay_off") {
        const overlayId =
          typeof action.overlayId === "string" ? action.overlayId.trim() : "";
        setRuntimeOverlays((current) => {
          if (!overlayId) return {};
          const next = { ...current };
          delete next[overlayId];
          return next;
        });
      }

      if (action.type === "add_note") {
        const text = typeof action.text === "string" ? action.text.trim() : "";
        if (!text) continue;

        const noteId =
          typeof action.noteId === "string" && action.noteId.trim()
            ? action.noteId.trim()
            : `note-${typeof action.source === "string" ? action.source : ""}-${text}`;
        setRuntimeNotes((current) => [
          ...current.filter((note) => note.id !== noteId),
          {
            id: noteId,
            source: typeof action.source === "string" ? action.source : "",
            text,
          },
        ].slice(-80));
      }

      if (action.type === "play_sound") {
        playRuntimeSoundEffect(action);
      }
    }

    setRuntimeButtons((current) => {
      let next = [...current];
      for (const action of actions) {
        if (action.type !== "button_choice") continue;
        const label =
          typeof action.label === "string" ? action.label.trim() : "";
        const triggersEvent =
          typeof action.triggersEvent === "string"
            ? action.triggersEvent.trim()
            : "";
        if (!label || !triggersEvent) continue;

        const stepId = typeof action.stepId === "string" ? action.stepId : "";
        next = next.filter((button) => button.stepId !== stepId);
        next.push({
          eventId: typeof action.eventId === "string" ? action.eventId : "",
          iconBackground:
            typeof action.iconBackground === "string"
              ? action.iconBackground
              : choiceIconBackgroundValue(tutorForm.choiceIconBackground),
          iconPath: typeof action.iconPath === "string" ? action.iconPath : "",
          label,
          source: typeof action.source === "string" ? action.source : "",
          stepId,
          triggersEvent,
        });
      }
      return next;
    });

    setRuntimeHighlights((current) => {
      const next = { ...current };
      for (const action of actions) {
        const type = action.type;
        const selector =
          typeof action.selector === "string" ? action.selector.trim() : "";
        if (!selector) continue;

        if (type === "highlight_on") {
          next[selector] = {
            color:
              typeof action.color === "string"
                ? action.color
                : "rgba(59, 130, 246, 0.6)",
            selector,
          };
        }
        if (type === "highlight_off") {
          delete next[selector];
        }
      }
      return next;
    });

    setRuntimeTriggers((current) => {
      let next = [...current];
      for (const action of actions) {
        if (action.type !== "set_ui_trigger") continue;
        const selector =
          typeof action.selector === "string" ? action.selector.trim() : "";
        const triggersEvent =
          typeof action.triggersEvent === "string"
            ? action.triggersEvent.trim()
            : "";
        if (!selector || !triggersEvent) continue;

        next = next.filter(
          (trigger) =>
            trigger.selector !== selector ||
            trigger.triggersEvent !== triggersEvent,
        );
        next.push({
          eventId: typeof action.eventId === "string" ? action.eventId : "",
          selector,
          stepId: typeof action.stepId === "string" ? action.stepId : "",
          triggersEvent,
        });
      }
      return next;
    });
  }

  function applySessionRuntimeEffects(activeSession: TutoringSession | null) {
    const uiRuntime =
      activeSession?.runtimeState &&
      typeof activeSession.runtimeState.uiRuntime === "object" &&
      activeSession.runtimeState.uiRuntime !== null
        ? (activeSession.runtimeState.uiRuntime as Record<string, unknown>)
        : {};
    const highlightsValue = uiRuntime.highlights;
    const buttonsValue = uiRuntime.buttons;
    const interactiveValue = uiRuntime.interactive;
    const interactiveStateValue = uiRuntime.interactiveState;
    const slideValue = uiRuntime.slide;
    const slideErrorValue = uiRuntime.slideError;
    const triggersValue = uiRuntime.triggers;
    const chatEnabledValue = uiRuntime.chatEnabled;
    const avatarPathValue = uiRuntime.avatarPath;
    const avatarVisibleValue = uiRuntime.avatarVisible;
    const overlaysValue = uiRuntime.overlays;
    const notesValue = uiRuntime.notes;
    const leftPanelsValue =
      uiRuntime.leftPanels &&
      typeof uiRuntime.leftPanels === "object" &&
      !Array.isArray(uiRuntime.leftPanels)
        ? (uiRuntime.leftPanels as Record<string, unknown>)
        : {};
    const nextHighlights: Record<string, RuntimeHighlight> = {};
    const nextButtons: RuntimeButton[] = [];

    if (
      highlightsValue &&
      typeof highlightsValue === "object" &&
      !Array.isArray(highlightsValue)
    ) {
      for (const [selector, value] of Object.entries(
        highlightsValue as Record<string, unknown>,
      )) {
        if (!selector || !value || typeof value !== "object") continue;
        const color =
          "color" in value && typeof value.color === "string"
            ? value.color
            : "rgba(59, 130, 246, 0.6)";
        nextHighlights[selector] = { color, selector };
      }
    }

    if (Array.isArray(buttonsValue)) {
      buttonsValue.forEach((value) => {
        if (!value || typeof value !== "object") return;
        const button = value as Record<string, unknown>;
        const label = typeof button.label === "string" ? button.label : "";
        const triggersEvent =
          typeof button.triggersEvent === "string" ? button.triggersEvent : "";
        const source = typeof button.source === "string" ? button.source : "";
        const stepId = typeof button.stepId === "string" ? button.stepId : "";
        if (!label || !triggersEvent) return;
        if (
          source === "conversation-choice" &&
          isConversationChoiceDeferred(stepId)
        ) {
          return;
        }
        nextButtons.push({
          eventId: typeof button.eventId === "string" ? button.eventId : "",
          iconBackground:
            typeof button.iconBackground === "string"
              ? button.iconBackground
              : choiceIconBackgroundValue(tutorForm.choiceIconBackground),
          iconPath: typeof button.iconPath === "string" ? button.iconPath : "",
          label,
          source,
          stepId,
          triggersEvent,
        });
      });
    }

    const nextTriggers: RuntimeUiTrigger[] = [];
    if (Array.isArray(triggersValue)) {
      triggersValue.forEach((value) => {
        if (!value || typeof value !== "object") return;
        const trigger = value as Record<string, unknown>;
        const selector =
          typeof trigger.selector === "string" ? trigger.selector : "";
        const triggersEvent =
          typeof trigger.triggersEvent === "string"
            ? trigger.triggersEvent
            : "";
        if (!selector || !triggersEvent) return;
        nextTriggers.push({
          eventId: typeof trigger.eventId === "string" ? trigger.eventId : "",
          selector,
          stepId: typeof trigger.stepId === "string" ? trigger.stepId : "",
          triggersEvent,
        });
      });
    }

    setRuntimeButtons(nextButtons);
    setRuntimeAvatarPath(
      typeof avatarPathValue === "string" ? avatarPathValue.trim() : "",
    );
    setRuntimeAvatarVisible(
      typeof avatarVisibleValue === "boolean" ? avatarVisibleValue : true,
    );
    setRuntimeChatEnabled(
      typeof chatEnabledValue === "boolean" ? chatEnabledValue : true,
    );
    setRuntimeHighlights(nextHighlights);
    setRuntimeNotes(runtimeNotesFromValue(notesValue));
    setRuntimeOverlays(runtimeOverlaysFromRecord(overlaysValue));
    setRuntimeTriggers(nextTriggers);
    setPythonNotebook(
      normalizePythonNotebookState(leftPanelsValue.pythonNotebook),
    );

    const nextInteractive = runtimeInteractiveFromRecord(interactiveValue);
    if (nextInteractive) {
      setRuntimeInteractive(nextInteractive);
      setRuntimeInteractiveState(
        recordFromUnknown(interactiveStateValue ?? nextInteractive.config.initialState),
      );
      setResolvedSlide(null);
      setSlideError("");
      setSlideStatus("empty");
      return;
    }

    const hasRuntimeSlideState =
      Object.prototype.hasOwnProperty.call(uiRuntime, "slide") ||
      Object.prototype.hasOwnProperty.call(uiRuntime, "slideError");

    if (hasRuntimeSlideState) {
      const nextSlide = runtimeSlideFromRecord(slideValue);
      const nextSlideError =
        typeof slideErrorValue === "string" ? slideErrorValue : "";
      if (nextSlide) {
        setResolvedSlide({
          cached: nextSlide.cached,
          imageUrl: nextSlide.imageUrl,
          pageId: nextSlide.pageId,
          presentationId: nextSlide.presentationId,
          slideRef: nextSlide.slideRef,
        });
        suppressSlideControlResetRef.current = true;
        setSlideDeckUrl(nextSlide.deckUrl);
        setSlideError("");
        setSlideRef(nextSlide.slideRef);
        setSlideStatus("ready");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      } else if (nextSlideError) {
        setResolvedSlide(null);
        setSlideError(nextSlideError);
        setSlideStatus("error");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      } else {
        setResolvedSlide(null);
        setSlideError("");
        setSlideStatus("empty");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(uiRuntime, "interactive")) {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }
    }
  }

  function applySelectedExperience(experience: Experience) {
    setSelectedExperienceId(experience.id);
    setExperienceForm({
      description: experience.description,
      title: experience.title,
    });
    setTutorForm(experience.tutor);
    setSelectedModel(experience.tutor.realtimeModel);
    setSelectedVoice(experience.tutor.voice);
  }

  async function loadCurrentSessionForExperience(experienceId: string) {
    const payload = await apiFetch<SessionPayload>(
      `/api/sessions/current/?experienceId=${encodeURIComponent(experienceId)}`,
    );
    setSession(payload.session);
    setMessages(payload.messages);
    setTurnAnchorMessageId(null);
    setChatStatus("ready");
  }

  useEffect(() => {
    writeSlideSettings({
      deckUrl: slideDeckUrl,
      slideRef,
    });
  }, [slideDeckUrl, slideRef]);

  useEffect(() => {
    writeSelectedExperienceId(selectedExperienceId);
  }, [selectedExperienceId]);

  useEffect(() => {
    clearInteractiveSaveTimer();
    clearNotebookSaveTimer();
    stopRuntimeSoundEffects();
    setNotesVisible(false);
    setRuntimeNotes([]);
    setRuntimeActionLog([]);
    setRuntimeAvatarVisible(true);
    setPythonNotebook(defaultPythonNotebookState());
    setPythonNotebookError("");
    setPythonNotebookStatus("idle");
    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }, [session?.id]);

  useEffect(() => {
    applySessionRuntimeEffects(session);
  }, [session?.runtimeState]);

  useEffect(() => {
    const highlightedElements: HTMLElement[] = [];

    for (const highlight of Object.values(runtimeHighlights)) {
      let targets: NodeListOf<Element>;
      try {
        targets = document.querySelectorAll(highlight.selector);
      } catch {
        continue;
      }

      targets.forEach((target) => {
        if (!(target instanceof HTMLElement)) return;
        target.classList.add("runtime-highlight");
        target.style.setProperty("--runtime-highlight-color", highlight.color);
        highlightedElements.push(target);
      });
    }

    return () => {
      highlightedElements.forEach((target) => {
        target.classList.remove("runtime-highlight");
        target.style.removeProperty("--runtime-highlight-color");
      });
    };
  }, [runtimeHighlights]);

  useEffect(() => {
    if (suppressSlideControlResetRef.current) {
      suppressSlideControlResetRef.current = false;
      return;
    }

    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }, [slideDeckUrl, slideRef]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspace() {
      setChatStatus("loading");
      setChatError("");
      setExperienceError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const experiencePayload = await apiFetch<ExperiencesPayload>(
          "/api/experiences/",
        );

        const savedExperienceId = readSelectedExperienceId();
        const chosenExperience =
          experiencePayload.experiences.find(
            (experience) => experience.id === initialExperienceId,
          ) ??
          experiencePayload.experiences.find(
            (experience) => experience.id === savedExperienceId,
          ) ??
          experiencePayload.experiences.find(
            (experience) =>
              experience.id === experiencePayload.currentExperienceId,
          ) ??
          experiencePayload.experiences[0];

        if (!chosenExperience) {
          throw new Error("Could not load an experience.");
        }

        const payload = await apiFetch<SessionPayload>(
          `/api/sessions/current/?experienceId=${encodeURIComponent(
            chosenExperience.id,
          )}`,
        );

        if (isCancelled) return;

        setUser(me.user);
        setExperiences(experiencePayload.experiences);
        applySelectedExperience(chosenExperience);
        setSession(payload.session);
        setMessages(payload.messages);
        setTurnAnchorMessageId(null);
        setChatStatus("ready");
      } catch (error) {
        if (isCancelled) return;

        setChatStatus("error");
        const detail =
          error instanceof Error ? error.message : "Could not load session.";
        setChatError(detail);
        setExperienceError(detail);
      }
    }

    void loadWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [initialExperienceId]);

  useEffect(() => {
    return () => {
      clearInteractiveSaveTimer();
      closeRealtimeConnection();
      stopRuntimeSoundEffects();
    };
  }, []);

  useEffect(() => {
    closeRealtimeConnection();
    setRealtimeStatus("idle");
  }, [currentRuntimeEventId, selectedModel, selectedVoice, session?.id]);

  useEffect(() => {
    if (!session || chatStatus !== "ready") return;
    const activeSession = session;
    if (startedSessionIds.current.has(activeSession.id)) return;

    startedSessionIds.current.add(activeSession.id);
    let isCancelled = false;

    async function runStartEventForSession() {
      try {
        const launch = recordFromUnknown(activeSession.runtimeState?.editorLaunch);
        const launchEventId =
          typeof launch.eventId === "string" ? launch.eventId.trim() : "";
        const payload = launchEventId
          ? await apiFetch<StartEventPayload>(
              `/api/sessions/${activeSession.id}/events/run/`,
              {
                method: "POST",
                body: JSON.stringify({
                  eventId: launchEventId,
                  uiState: currentRuntimeUiState(),
                }),
              },
            )
          : await apiFetch<StartEventPayload>(
              `/api/sessions/${activeSession.id}/start-event/`,
              {
                method: "POST",
                body: JSON.stringify({ uiState: currentRuntimeUiState() }),
              },
            );

        if (isCancelled) return;

        setSession(payload.session);
        setMessages(payload.messages);
        applyRuntimeActions(payload.actions);
        if (payload.ranMessages?.[0]) {
          setTurnAnchorMessageId(payload.ranMessages[0].id);
        }
        queueScriptMessages(
          payload.session,
          payload.ranMessages,
          conversationChoiceActionsFromRanEvents(payload.ranEvents, payload.event),
        );
      } catch (error) {
        if (isCancelled) return;

        startedSessionIds.current.delete(activeSession.id);
        setChatStatus("error");
        setChatError(
          error instanceof Error
            ? error.message
            : "Could not run the start event.",
        );
      }
    }

    void runStartEventForSession();

    return () => {
      isCancelled = true;
    };
  }, [chatStatus, session]);

  async function runSessionEventBySlug(
    eventSlug: string,
    uiState: RuntimeUiState,
    triggerSelector = "",
    options: { clearButtons?: boolean } = {},
  ) {
    if (!session) return;

    try {
      const payload = await apiFetch<StartEventPayload>(
        `/api/sessions/${session.id}/events/run/`,
        {
          method: "POST",
          body: JSON.stringify({
            clearButtons: Boolean(options.clearButtons),
            eventSlug,
            triggerSelector,
            uiState,
          }),
        },
      );

      setSession(payload.session);
      setMessages(payload.messages);
      applyRuntimeActions(payload.actions);
      if (payload.ranMessages?.[0]) {
        setTurnAnchorMessageId(payload.ranMessages[0].id);
      }
      queueScriptMessages(
        payload.session,
        payload.ranMessages,
        conversationChoiceActionsFromRanEvents(payload.ranEvents, payload.event),
      );
    } catch (error) {
      setChatStatus("error");
      setChatError(
        error instanceof Error ? error.message : "Could not run triggered event.",
      );
    }
  }

  function triggerRuntimeUiEvent(selector: string, uiState: RuntimeUiState) {
    const matchingTriggers = runtimeTriggers.filter(
      (trigger) => trigger.selector === selector,
    );
    if (!matchingTriggers.length) return;

    setRuntimeTriggers((current) =>
      current.filter((trigger) => trigger.selector !== selector),
    );
    matchingTriggers.forEach((trigger) => {
      void runSessionEventBySlug(trigger.triggersEvent, uiState, selector);
    });
  }

  function runRuntimeButton(button: RuntimeButton) {
    setRuntimeButtons([]);
    void runSessionEventBySlug(button.triggersEvent, currentRuntimeUiState(), "", {
      clearButtons: true,
    });
  }

  async function completeRuntimeInteractive(
    nextState = runtimeInteractiveState,
    context: Record<string, unknown> = {},
  ) {
    if (!runtimeInteractive) return;

    clearInteractiveSaveTimer();
    setRuntimeInteractiveState(nextState);
    const saved = await persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      nextState,
      context,
    );
    if (!saved) return;

    if (!runtimeInteractive.triggersEvent) return;

    void runSessionEventBySlug(
      runtimeInteractive.triggersEvent,
      currentRuntimeUiState({ interactive: nextState }),
    );
  }

  function runRuntimeInteractiveEvent(
    eventSlug: string,
    state = runtimeInteractiveState,
  ) {
    if (!eventSlug) return;
    void runSessionEventBySlug(
      eventSlug,
      currentRuntimeUiState({ interactive: state }),
    );
  }

  function toggleRuntimeNotes() {
    const nextNotesVisible = !notesVisible;
    const nextUiState = currentRuntimeUiState({
      notesVisible: nextNotesVisible,
    });

    setNotesVisible(nextNotesVisible);
    triggerRuntimeUiEvent(".runtime-notes-toggle", nextUiState);
  }

  async function resolveCurrentSlide(forceRefresh = false) {
    if (!slideDeckUrl.trim()) {
      setResolvedSlide(null);
      setSlideError("");
      setSlideStatus("empty");
      return;
    }

    setSlideStatus("loading");
    setSlideError("");

    try {
      const payload = await apiFetch<ResolvedSlide>("/api/slides/resolve/", {
        method: "POST",
        body: JSON.stringify({
          deckUrl: slideDeckUrl,
          forceRefresh,
          slideRef,
        }),
      });
      setResolvedSlide({
        ...payload,
        imageUrl: `${payload.imageUrl}?v=${Date.now()}`,
      });
      setSlideStatus("ready");
    } catch (error) {
      setSlideStatus("error");
      setSlideError(
        error instanceof Error ? error.message : "Could not load that slide.",
      );
    }
  }

  function loadSampleSlideDeck() {
    setSlideDeckUrl(sampleSlideDeckUrl);
    setSlideRef("1");
  }

  function clearSlides() {
    setSlideDeckUrl("");
    setSlideRef("1");
    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }

  async function selectExperience(experienceId: string) {
    const nextExperience =
      experiences.find((experience) => experience.id === experienceId) ?? null;
    if (!nextExperience || experienceId === selectedExperienceId) return;

    setChatStatus("loading");
    setChatError("");
    setExperienceError("");
    closeRealtimeConnection();

    try {
      applySelectedExperience(nextExperience);
      if (routeExperience(window.location.pathname).mode === "run") {
        window.history.replaceState(
          null,
          "",
          experienceRunPath(nextExperience.id),
        );
      }
      await loadCurrentSessionForExperience(nextExperience.id);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Could not switch experience.";
      setChatStatus("error");
      setChatError(detail);
      setExperienceError(detail);
    }
  }

  async function createExperience() {
    setIsCreatingExperience(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>("/api/experiences/", {
        method: "POST",
        body: JSON.stringify({
          description: "",
          title: "Untitled experience",
        }),
      });
      setExperiences((current) => [payload.experience, ...current]);
      applySelectedExperience(payload.experience);
      if (routeExperience(window.location.pathname).mode === "run") {
        window.history.replaceState(
          null,
          "",
          experienceRunPath(payload.experience.id),
        );
      }
      await loadCurrentSessionForExperience(payload.experience.id);
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not create experience.",
      );
    } finally {
      setIsCreatingExperience(false);
    }
  }

  async function saveExperienceDetails() {
    if (!selectedExperience) return;

    setIsSavingExperience(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${selectedExperience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify(experienceForm),
        },
      );
      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      applySelectedExperience(payload.experience);
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not save experience.",
      );
    } finally {
      setIsSavingExperience(false);
    }
  }

  async function saveTutorSettings() {
    if (!selectedExperience) return;

    setIsSavingTutor(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${selectedExperience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ tutor: tutorForm }),
        },
      );
      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      applySelectedExperience(payload.experience);
      closeRealtimeConnection();
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not save tutor settings.",
      );
    } finally {
      setIsSavingTutor(false);
    }
  }

  async function createNewSession() {
    setIsCreatingSession(true);
    setChatError("");

    try {
      const payload = await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({ experienceId: selectedExperienceId }),
      });
      setSession(payload.session);
      setMessages(payload.messages);
      setTurnAnchorMessageId(null);
      setRuntimeActionLog([]);
      setChatStatus("ready");
      if (routeExperience(window.location.pathname).mode === "run") {
        setIsLeftOpen(false);
      }
    } catch (error) {
      setChatStatus("error");
      setChatError(
        error instanceof Error ? error.message : "Could not create session.",
      );
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function signOut() {
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

  return (
    <main
      className="panel-study"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">
          {selectedExperience?.title || "Tutoring workspace"}
        </p>
        <div className="study-actions">
          <button
            className="header-action secondary"
            disabled={!selectedExperience}
            onClick={() => {
              if (selectedExperience) {
                window.location.assign(experienceEditPath(selectedExperience.id));
              }
            }}
            type="button"
          >
            Edit
          </button>
          <button
            className="header-action secondary"
            onClick={() => window.location.assign("/")}
            type="button"
          >
            Experiences
          </button>
        </div>
      </header>

      <section
        className={[
          "workspace-shell",
          isLeftOpen ? "drawer-open" : "drawer-closed",
          isInspectorOpen ? "inspector-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={shellRef}
        style={shellStyle}
      >
        <button
          aria-label={isLeftOpen ? "Hide left panels" : "Show left panels"}
          aria-pressed={isLeftOpen}
          className="left-panel-toggle"
          onClick={() => setIsLeftOpen((current) => !current)}
          type="button"
        >
          <span className="toggle-panel-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>

        <aside
          aria-hidden={!isLeftOpen}
          className="left-tools-drawer"
          aria-label="Panel stack"
        >
          <div className="left-stack-scroll">
            {leftPanels.map((panel) => (
              <PanelWindow
                ariaLabel={panel.label}
                density={panel.density}
                key={panel.label}
              >
                <LeftPanelContent
                  experience={{
                    chatStatus,
                    error: experienceError,
                    experienceForm,
                    experiences,
                    isCreatingSession,
                    isCreatingExperience,
                    isSavingExperience,
                    isSigningOut,
                    onCreateExperience: createExperience,
                    onCreateNewSession: createNewSession,
                    onExperienceFormChange: setExperienceForm,
                    onSaveExperience: saveExperienceDetails,
                    onSelectExperience: selectExperience,
                    onSignOut: signOut,
                    selectedExperienceId,
                    user,
                  }}
                  kind={panel.kind}
                  notebook={{
                    error: pythonNotebookError,
                    notebook: pythonNotebook,
                    onChange: changePythonNotebook,
                    onClearOutputs: clearPythonNotebookOutputs,
                    onFormatCell: formatPythonNotebookCell,
                    onRunAll: runPythonNotebookAll,
                    onRunCell: runPythonNotebookCell,
                    status: pythonNotebookStatus,
                  }}
                  runtime={{
                    notes: runtimeNotes,
                    notesVisible,
                    onToggleNotes: toggleRuntimeNotes,
                  }}
                  slides={{
                    deckUrl: slideDeckUrl,
                    error: slideError,
                    onClear: clearSlides,
                    onDeckUrlChange: setSlideDeckUrl,
                    onRefreshSlide: () => resolveCurrentSlide(true),
                    onResolveSlide: () => resolveCurrentSlide(false),
                    onSampleDeck: loadSampleSlideDeck,
                    onSlideRefChange: setSlideRef,
                    resolvedSlide,
                    slideRef,
                    status: slideStatus,
                  }}
                  tutor={{
                    avatarUrl: publicAsset(tutorForm.avatarPath),
                    error: experienceError,
                    isSaving: isSavingTutor,
                    onAvatarPathChange: (avatarPath) =>
                      setTutorForm((current) => ({
                        ...current,
                        avatarPath,
                      })),
                    onChoiceIconBackgroundChange: (choiceIconBackground) =>
                      setTutorForm((current) => ({
                        ...current,
                        choiceIconBackground,
                      })),
                    onClassificationModelChange: (classificationModel) =>
                      setTutorForm((current) => ({
                        ...current,
                        classificationModel,
                      })),
                    onModelChange: (model) => {
                      const nextVoice = isRealtimeVoiceSupported(
                        model,
                        selectedVoice,
                      )
                        ? selectedVoice
                        : (realtimeVoiceOptionsForModel(model)[0]?.id ??
                          selectedVoice);
                      setTutorForm((current) => ({
                        ...current,
                        realtimeModel: model,
                        voice: nextVoice,
                      }));
                      setSelectedModel(model);
                      setSelectedVoice(nextVoice);
                    },
                    onNameChange: (assistantName) =>
                      setTutorForm((current) => ({
                        ...current,
                        assistantName,
                      })),
                    onSave: saveTutorSettings,
                    onVoiceChange: (voice) => {
                      setTutorForm((current) => ({
                        ...current,
                        voice,
                      }));
                      setSelectedVoice(voice);
                    },
                    onVoiceInstructionsChange: (voiceInstructions) =>
                      setTutorForm((current) => ({
                        ...current,
                        voiceInstructions,
                      })),
                    realtimeStatus,
                    tutor: tutorForm,
                  }}
                />
              </PanelWindow>
            ))}
          </div>
        </aside>

        <div
          aria-label="Resize tools"
          className="vertical-resizer drawer-resizer"
          onPointerDown={dragLeftDivider}
          role="separator"
        />

        <section className="panel-stage">
          <div
            aria-label="Resize workspace width"
            className="vertical-resizer workspace-width-resizer"
            onPointerDown={dragWorkspaceDivider}
            role="separator"
          />

          <section
            className="right-region"
            ref={rightRef}
            style={{ "--lower-height": `${lowerHeight}px` } as CSSProperties}
          >
            <PanelWindow ariaLabel="Panel five" density="main">
              <MainPanelContent
                context={session?.runtimeContext ?? {}}
                emitInteractiveActions={emitRuntimeInteractiveActions}
                error={slideError}
                interactive={runtimeInteractive}
                interactiveState={runtimeInteractiveState}
                onInteractiveComplete={completeRuntimeInteractive}
                onInteractiveEvent={runRuntimeInteractiveEvent}
                onInteractiveSaveContext={saveRuntimeInteractiveContext}
                onInteractiveStateChange={changeRuntimeInteractiveState}
                slide={resolvedSlide}
                status={slideStatus}
              />
            </PanelWindow>
            <div
              aria-label="Resize rows"
              className="horizontal-resizer"
              onPointerDown={dragLowerDivider}
              role="separator"
            />
            <PanelWindow ariaLabel="Panel six" density="lower">
              <ChatPanelContent
                assistantName={tutorForm.assistantName}
                avatarPath={runtimeAvatarPath || tutorForm.avatarPath}
                avatarVisible={runtimeAvatarVisible}
                choiceIconBackground={tutorForm.choiceIconBackground}
                error={chatError}
                isChatEnabled={runtimeChatEnabled}
                isSending={isSendingMessage}
                isTurnLocked={
                  isSendingMessage ||
                  isScriptAudioPlaying ||
                  realtimeStatus === "streaming"
                }
                messages={messages}
                onChooseRuntimeButton={runRuntimeButton}
                onSendMessage={sendChatMessage}
                realtimeStatus={realtimeStatus}
                runtimeButtons={runtimeButtons}
                runtimeOverlays={Object.values(runtimeOverlays)}
                session={session}
                status={chatStatus}
                turnAnchorMessageId={turnAnchorMessageId}
                user={user}
              />
            </PanelWindow>
          </section>
        </section>

        <button
          aria-label={
            isInspectorOpen ? "Hide runtime inspector" : "Show runtime inspector"
          }
          aria-pressed={isInspectorOpen}
          className="runtime-inspector-toggle"
          onClick={() => setIsInspectorOpen((current) => !current)}
          title={isInspectorOpen ? "Hide runtime inspector" : "Show runtime inspector"}
          type="button"
        >
          <InspectorIcon />
        </button>

        <aside
          aria-hidden={!isInspectorOpen}
          aria-label="Runtime inspector"
          className="runtime-inspector-drawer"
        >
          <RuntimeInspectorPanel
            actionLog={runtimeActionLog}
            avatarPath={runtimeAvatarPath}
            avatarVisible={runtimeAvatarVisible}
            buttons={runtimeButtons}
            chatEnabled={runtimeChatEnabled}
            currentEvent={currentRuntimeEvent}
            currentEventSlug={currentRuntimeEventSlug}
            experience={selectedExperience}
            highlights={runtimeHighlights}
            interactive={runtimeInteractive}
            interactiveState={runtimeInteractiveState}
            isSendingMessage={isSendingMessage}
            isScriptAudioPlaying={isScriptAudioPlaying}
            messages={messages}
            notes={runtimeNotes}
            overlays={Object.values(runtimeOverlays)}
            realtimeStatus={realtimeStatus}
            runtimeDebug={recordFromUnknown(session?.runtimeState?.runtimeDebug)}
            runtimeContext={session?.runtimeContext ?? {}}
            runtimeSoundCount={runtimeSoundCount}
            session={session}
            selectedModel={selectedModel}
            selectedVoice={selectedVoice}
            slide={resolvedSlide}
            slideError={slideError}
            triggers={runtimeTriggers}
          />
        </aside>
      </section>
    </main>
  );
}
