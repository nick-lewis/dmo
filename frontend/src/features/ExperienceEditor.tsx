import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getMainPanelAppDefinition,
} from "../mainPanelApps";
import { publicAsset } from "../assets";
import {
  defaultChoiceIconBackground,
  resizeTextareaToContent,
} from "../uiHelpers";
import { ScriptAudioPanel } from "./ScriptAudioPanel";
import { TutorControls } from "./TutorControls";
import type {
  ApiUser,
  EventDraft,
  ExperienceEvent,
  Experience,
  ExperienceForm,
  TutorSettings,
} from "../types";
import { ExperienceSnapshotsPanel } from "./ExperienceSnapshotsPanel";
import { EventOutlinePanel } from "./EventOutlinePanel";
import { EventEntryStepList } from "./EventEntryStepList";
import { EventWorkspaceHeader } from "./EventWorkspaceHeader";
import { EventConversationEditor } from "./EventConversationEditor";
import { useEventAutosaveScheduler } from "./useEventAutosaveScheduler";
import { useEventAutosavePersistence } from "./useEventAutosavePersistence";
import { useEditorDragState } from "./useEditorDragState";
import { useEventDraftMutations } from "./useEventDraftMutations";
import { useEventServerMutations } from "./useEventServerMutations";
import { useEventDragHandlers } from "./useEventDragHandlers";
import { useEditorEventViewModel } from "./useEditorEventViewModel";
import { useEditorExpansion } from "./useEditorExpansion";
import { useEditorHistoryLabels } from "./useEditorHistoryLabels";
import { useEditorHistoryShortcuts } from "./useEditorHistoryShortcuts";
import { useEditorMenus } from "./useEditorMenus";
import { useEventDraftHistory } from "./useEventDraftHistory";
import { useEventPersistenceRefs } from "./useEventPersistenceRefs";
import {
  useOverviewAutosave,
  useTutorAutosave,
} from "./useExperienceAutosave";
import { useEventStructuralActions } from "./useEventStructuralActions";
import { useEventStructuralHistory } from "./useEventStructuralHistory";
import { useEditorScriptAudio } from "./useEditorScriptAudio";
import { useExperienceRunActions } from "./useExperienceRunActions";
import { useExperienceEditorLoader } from "./useExperienceEditorLoader";
import { useExperienceSnapshots } from "./useExperienceSnapshots";
import { useExperienceValidation } from "./useExperienceValidation";
import { useSelectedEventPersistence } from "./useSelectedEventPersistence";
import { useVoiceSample } from "./useVoiceSample";
import {
  eventDraftFromEvent,
  experienceAutosaveDelayMs,
  getSelectedExperienceEvent,
  editorUndoLimit,
} from "./eventEditorUtils";
export function ExperienceEditor({ experienceId }: { experienceId: string }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
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
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    chatInstructions: "",
    chatTools: [],
    classifierGroups: [],
    conversationChecks: [],
    conversationChoices: [],
    description: "",
    steps: [],
    title: "Start",
  });
  const [eventSearch, setEventSearch] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const {
    clearActionDragState,
    conversationItemDropTarget,
    draggingConversationItem,
    draggingEventId,
    draggingHandlerAction,
    draggingStepId,
    eventStepDropTarget,
    handlerActionDropTarget,
    setConversationItemDropTarget,
    setDraggingConversationItem,
    setDraggingEventId,
    setDraggingHandlerAction,
    setDraggingStepId,
    setEventStepDropTarget,
    setHandlerActionDropTarget,
  } = useEditorDragState();
  const {
    closeExpandedItem,
    isExpandedItem,
    openExpandedItem,
    resetExpandedItems,
    toggleExpandedItem,
    toggleExpandedParent,
  } = useEditorExpansion();
  const {
    eventCheckIdRemap,
    eventClassifierIdRemap,
    eventGroupIdRemap,
    eventStepIdRemap,
    eventToolIdRemap,
    forgetCheckId,
    forgetClassifierId,
    forgetGroupId,
    forgetStepId,
    forgetToolId,
    lastPersistedEvent,
    resolveCheckId,
    resolveClassifierId,
    resolveGroupId,
    resolveStepId,
    resolveToolId,
    setLastPersistedEvent,
  } = useEventPersistenceRefs();
  const {
    getComparableSelectedEvent,
    getSelectedEventParts,
    persistedDraftForUndo,
  } = useSelectedEventPersistence({
    experience,
    lastPersistedEvent,
    selectedEventId,
  });
  const {
    generateScriptAudio,
    loadScriptAudioItems,
    playScriptAudioPreview,
    playingScriptAudioId,
    saveScriptAudioDisplayTranscript,
    scriptAudioError,
    scriptAudioItems,
    scriptAudioPlaybackRate,
    scriptAudioStatus,
    setScriptAudioPlaybackRate,
    stopScriptAudioPreview,
  } = useEditorScriptAudio({
    experience,
    flushEditorAutosave,
  });
  const {
    hasEventChanges,
    persistEventDraft,
  } = useEventAutosavePersistence({
    eventCheckIdRemap,
    eventClassifierIdRemap,
    eventGroupIdRemap,
    eventStepIdRemap,
    eventToolIdRemap,
    experience,
    getComparableSelectedEvent,
    loadScriptAudioItems,
    setError,
    setEventDraft,
    setExperience,
    setLastPersistedEvent,
  });
  const {
    clearEventAutosaveTimer,
    flushEventAutosave,
    queueEventAutosave,
  } = useEventAutosaveScheduler({
    currentDraft: eventDraft,
    delayMs: experienceAutosaveDelayMs,
    hasChanges: hasEventChanges,
    persist: persistEventDraft,
  });


  const {
    clearEventStructuralHistory,
    clearEventStructuralRedo,
    completeStructuralHistoryMove,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    pushEventStructuralUndo,
  } = useEventStructuralHistory({ limit: editorUndoLimit });
  const {
    clearEventUndoHistory,
    eventRedoStack,
    eventUndoStack,
    redoEventEdit,
    rememberEventDraftForUndo,
    stageEventDraft,
    undoEventEdit,
  } = useEventDraftHistory({
    clearStructuralRedo: clearEventStructuralRedo,
    currentDraft: eventDraft,
    limit: editorUndoLimit,
    queueAutosave: queueEventAutosave,
    setDraft: setEventDraft,
  });
  const {
    conversationAddBlockRef,
    conversationAddMenuCheckId,
    conversationAddMenuToolId,
    conversationCheckAddBlockRef,
    conversationItemAddBlockRef,
    eventAddBlockRef,
    isConversationAddMenuOpen,
    isEventAddMenuOpen,
    setConversationAddMenuCheckId,
    setConversationAddMenuToolId,
    setIsConversationAddMenuOpen,
    setIsEventAddMenuOpen,
  } = useEditorMenus();
  const [isEventGraphOpen, setIsEventGraphOpen] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState("");
  const { playVoiceSample, voiceSampleStatus } = useVoiceSample({
    experience,
    setError,
    tutor: tutorForm,
  });
  const {
    checkpointRecordingMode,
    createExperienceSnapshot,
    deleteExperienceSnapshot,
    deletingSnapshotId,
    eventCheckpointError,
    eventCheckpointStatus,
    eventCheckpoints,
    experienceSnapshots,
    exportExperienceSnapshot,
    exportingSnapshotId,
    isCreatingSnapshot,
    isLoadingSnapshots,
    loadEventCheckpoints,
    loadExperienceSnapshots,
    resetSnapshotsAndCheckpoints,
    restoreExperienceSnapshot,
    restoringSnapshotId,
    setCheckpointRecordingMode,
    snapshotError,
  } = useExperienceSnapshots({
    experience,
    flushEditorAutosave,
    isReady: status === "ready",
    selectedEventId,
  });
  const {
    isSigningOut,
    returnToExperiences,
    runExperience,
    runningEventId,
    runSelectedEvent,
    signOut,
  } = useExperienceRunActions({
    checkpointRecordingMode,
    experience,
    flushEditorAutosave,
    selectedEventId,
    setError,
  });
  const {
    experienceValidation,
    experienceValidationError,
    experienceValidationStatus,
    loadExperienceValidation,
    resetExperienceValidation,
  } = useExperienceValidation({
    events: experience?.events,
    experienceId: experience?.id ?? "",
    isGraphOpen: isEventGraphOpen,
    isReady: status === "ready",
  });
  const {
    editorEvents,
    normalizedEventSearch,
    selectedEvent,
    selectedEventRoutes,
    visibleEditorEvents,
  } = useEditorEventViewModel({
    eventDraft,
    eventSearch,
    experience,
    selectedEventId,
  });
  const {
    canRedoEditorHistory,
    canUndoEditorHistory,
    redoEditorTitle,
    undoEditorTitle,
  } = useEditorHistoryLabels({
    eventRedoStack,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    eventUndoStack,
  });
  const {
    addEventChatCapture,
    addEventChatToolAction,
    addEventClassifierGroupAction,
    addEventConversationCheckAction,
    addEventConversationChoice,
    deleteEventChatCapture,
    deleteEventChatToolAction,
    deleteEventClassifierGroupAction,
    deleteEventConversationCheckAction,
    deleteEventConversationChoice,
    reorderDraftActionSequence,
    reorderEventChatTool,
    reorderEventChatToolAction,
    reorderEventClassifierGroup,
    reorderEventClassifierGroupAction,
    reorderEventConversationCheck,
    reorderEventConversationCheckAction,
    reorderEventConversationChoice,
    updateEventChatCaptureDraft,
    updateEventChatToolActionConfig,
    updateEventChatToolActionConfigPatch,
    updateEventChatToolActionCondition,
    updateEventChatToolActionDraft,
    updateEventChatToolDraft,
    updateEventChatToolDraftField,
    updateEventClassifierDraft,
    updateEventClassifierDraftField,
    updateEventClassifierGroupActionConfig,
    updateEventClassifierGroupActionConfigPatch,
    updateEventClassifierGroupActionCondition,
    updateEventClassifierGroupActionDraft,
    updateEventClassifierGroupDraft,
    updateEventClassifierGroupDraftField,
    updateEventConversationCheckActionConfig,
    updateEventConversationCheckActionConfigPatch,
    updateEventConversationCheckActionCondition,
    updateEventConversationCheckActionDraft,
    updateEventConversationCheckDraft,
    updateEventConversationCheckDraftField,
    updateEventConversationChoiceDraft,
    updateEventConversationChoiceDraftField,
    updateEventDraft,
    updateEventStepConfig,
    updateEventStepConfigPatch,
    updateEventStepCondition,
    updateEventStepDraft,
  } = useEventDraftMutations({
    closeExpandedItem,
    editorEvents,
    eventDraft,
    openExpandedItem,
    selectedEventId,
    setConversationAddMenuCheckId,
    setConversationAddMenuToolId,
    setIsConversationAddMenuOpen,
    stageEventDraft,
  });

  const {
    addEventChatTool,
    addEventClassifier,
    addEventClassifierGroup,
    addEventConversationCheck,
    addEventStep,
    createEditorEvent,
    deleteEditorEvent,
    deleteEventChatTool,
    deleteEventClassifier,
    deleteEventClassifierGroup,
    deleteEventConversationCheck,
    deleteEventStep,
    openEditorRouteSource,
    reorderEditorEvent,
    reorderEventStep,
    selectEditorEvent,
  } = useEventServerMutations({
    clearActionDragState,
    clearEventAutosaveTimer,
    clearEventUndoHistory,
    closeExpandedItem,
    editorEvents,
    eventDraft,
    experience,
    flushEventAutosave,
    forgetCheckId,
    forgetClassifierId,
    forgetGroupId,
    forgetStepId,
    forgetToolId,
    getSelectedEventParts,
    loadScriptAudioItems,
    normalizedEventSearch,
    openExpandedItem,
    persistedDraftForUndo,
    pushEventStructuralUndo,
    rememberEventDraftForUndo,
    reorderDraftActionSequence,
    resetExpandedItems,
    resetStructuralEditorState,
    resolveCheckId,
    resolveClassifierId,
    resolveGroupId,
    resolveStepId,
    resolveToolId,
    selectedEventId,
    setConversationAddMenuCheckId,
    setConversationAddMenuToolId,
    setDeletingEventId,
    setDraggingEventId,
    setError,
    setEventDraft,
    setExperience,
    setIsConversationAddMenuOpen,
    setIsEventAddMenuOpen,
    setLastPersistedEvent,
    setSelectedEventId,
  });

  const {
    dragConversationItem,
    dragEditorEvent,
    dragEventStep,
    dragHandlerAction,
    dragLeaveConversationItem,
    dragLeaveEventStep,
    dragLeaveHandlerAction,
    dragOverConversationItem,
    dragOverEditorEvent,
    dragOverEventStep,
    dragOverHandlerAction,
    dropConversationItem,
    dropEditorEvent,
    dropEventStep,
    dropHandlerAction,
    isDraggingConversationItem,
    isDraggingHandlerAction,
  } = useEventDragHandlers({
    conversationItemDropTarget,
    draggingConversationItem,
    draggingEventId,
    draggingHandlerAction,
    draggingStepId,
    eventStepDropTarget,
    handlerActionDropTarget,
    normalizedEventSearch,
    reorderEditorEvent,
    reorderEventChatTool,
    reorderEventChatToolAction,
    reorderEventClassifierGroup,
    reorderEventClassifierGroupAction,
    reorderEventConversationCheck,
    reorderEventConversationCheckAction,
    reorderEventConversationChoice,
    reorderEventStep,
    setConversationItemDropTarget,
    setDraggingConversationItem,
    setDraggingHandlerAction,
    setDraggingEventId,
    setDraggingStepId,
    setEventStepDropTarget,
    setHandlerActionDropTarget,
  });

  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
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
    clearTutorAutosaveTimer,
    flushTutorAutosave,
    isSavingTutor,
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

  function resetStructuralEditorState(nextEvent: ExperienceEvent | null) {
    setLastPersistedEvent(nextEvent);
    setSelectedEventId(nextEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(nextEvent));
    clearEventUndoHistory();
    resetExpandedItems();
    setDraggingEventId("");
    clearActionDragState();
    setIsEventAddMenuOpen(false);
    setIsConversationAddMenuOpen(false);
    setConversationAddMenuToolId("");
    setConversationAddMenuCheckId("");
  }

  const {
    redoEditorHistory,
    undoEditorHistory,
  } = useEventStructuralActions({
    completeStructuralHistoryMove,
    eventRedoStack,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    eventUndoStack,
    experience,
    loadScriptAudioItems,
    redoEventEdit,
    resetStructuralEditorState,
    selectedEventId,
    setError,
    setExperience,
    undoEventEdit,
  });

  useEditorHistoryShortcuts({
    eventDraft,
    eventRedoStack,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    eventUndoStack,
    redoEditorHistory,
    undoEditorHistory,
  });

  function applyExperience(nextExperience: Experience) {
    const selectedEvent = getSelectedExperienceEvent(
      nextExperience,
      selectedEventId,
    );
    setExperience(nextExperience);
    setExperienceForm({
      description: nextExperience.description,
      title: nextExperience.title,
    });
    setTutorForm(nextExperience.tutor);
    setSelectedEventId(selectedEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(selectedEvent));
    clearEventStructuralHistory();
    resetExperienceValidation();
    resetSnapshotsAndCheckpoints();
    clearEventUndoHistory();
  }

  useExperienceEditorLoader({
    applyExperience,
    experienceId,
    loadExperienceSnapshots,
    loadScriptAudioItems,
    setError,
    setStatus,
    setUser,
  });

  useEffect(() => {
    return () => {
      clearOverviewAutosaveTimer();
      clearTutorAutosaveTimer();
    };
  }, []);

  useEffect(() => {
    resizeTextareaToContent(overviewDescriptionRef.current);
  }, [experienceForm.description]);

  async function flushEditorAutosave() {
    const didSaveOverview = await flushOverviewAutosave();
    if (!didSaveOverview) return false;

    const didSaveTutor = await flushTutorAutosave();
    if (!didSaveTutor) return false;

    return flushEventAutosave();
  }

  async function saveTutorSettings() {
    await flushTutorAutosave();
  }

  return (
    <main
      className="panel-study experience-editor-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <div className="study-actions">
          <button
            className="header-action secondary"
            onClick={() => void returnToExperiences()}
            type="button"
          >
            Experiences
          </button>
          {experience ? <p className="study-kicker">{experienceForm.title}</p> : null}
        </div>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action"
            disabled={!experience}
            onClick={runExperience}
            type="button"
          >
            Run
          </button>
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={signOut}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="experience-editor">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        {experience ? (
          <>
            <section className="editor-section">
              <div className="overview-editor">
                <input
                  aria-label="Experience title"
                  className="overview-title-text"
                  onChange={(event) =>
                    updateOverviewDraft("title", event.target.value)
                  }
                  type="text"
                  value={experienceForm.title}
                />
                <textarea
                  aria-label="Experience description"
                  className="overview-description-text"
                  onChange={(event) =>
                    updateOverviewDraft("description", event.target.value)
                  }
                  onInput={(event) =>
                    resizeTextareaToContent(event.currentTarget)
                  }
                  placeholder="---"
                  ref={overviewDescriptionRef}
                  rows={1}
                  value={experienceForm.description}
                />
              </div>
            </section>

            <section className="editor-section tutor-editor-section">
              <TutorControls
                avatarUrl={publicAsset(tutorForm.avatarPath)}
                error={error}
                isSaving={isSavingTutor}
                onAvatarPathChange={(avatarPath) =>
                  updateTutorDraft("avatarPath", avatarPath)
                }
                onChoiceIconBackgroundChange={(choiceIconBackground) =>
                  updateTutorDraft("choiceIconBackground", choiceIconBackground)
                }
                onClassificationModelChange={(classificationModel) =>
                  updateTutorDraft("classificationModel", classificationModel)
                }
                onModelChange={updateTutorModelDraft}
                onNameChange={(assistantName) =>
                  updateTutorDraft("assistantName", assistantName)
                }
                onPlaySample={playVoiceSample}
                onSave={saveTutorSettings}
                onVoiceChange={(voice) => updateTutorDraft("voice", voice)}
                onVoiceInstructionsChange={(voiceInstructions) =>
                  updateTutorDraft("voiceInstructions", voiceInstructions)
                }
                realtimeStatus="idle"
                sampleStatus={voiceSampleStatus}
                showSaveAction={false}
                tutor={tutorForm}
              />
            </section>

            <section className="editor-section script-audio-section">
              <ScriptAudioPanel
                error={scriptAudioError}
                isBusy={scriptAudioStatus === "loading" || scriptAudioStatus === "generating"}
                items={scriptAudioItems}
                onGenerateAll={() => void generateScriptAudio()}
                onGenerateOne={(scriptId) => void generateScriptAudio(scriptId)}
                onPlay={playScriptAudioPreview}
                onRegenerateAll={() => void generateScriptAudio("", true)}
                onRegenerateOne={(scriptId) => void generateScriptAudio(scriptId, true)}
                onStop={stopScriptAudioPreview}
                playingId={playingScriptAudioId}
                playbackRate={scriptAudioPlaybackRate}
                onPlaybackRateChange={setScriptAudioPlaybackRate}
                onSaveDisplayTranscript={saveScriptAudioDisplayTranscript}
                status={scriptAudioStatus}
              />
            </section>

            <section className="editor-section snapshot-section">
              <ExperienceSnapshotsPanel
                deletingId={deletingSnapshotId}
                error={snapshotError}
                exportingId={exportingSnapshotId}
                isCreating={isCreatingSnapshot}
                isLoading={isLoadingSnapshots}
                onCreate={() => void createExperienceSnapshot()}
                onDelete={(snapshot) => void deleteExperienceSnapshot(snapshot)}
                onExport={(snapshot) => void exportExperienceSnapshot(snapshot)}
                onRefresh={() => void loadExperienceSnapshots(experience.id)}
                onRestore={(snapshot) => void restoreExperienceSnapshot(snapshot)}
                restoringId={restoringSnapshotId}
                snapshots={experienceSnapshots}
              />
            </section>

            <section className="editor-section event-editor-section">
              <div className="event-authoring-grid">
                <EventOutlinePanel
                  draggingEventId={draggingEventId}
                  editorEvents={editorEvents}
                  eventSearch={eventSearch}
                  experienceId={experience.id}
                  isEventGraphOpen={isEventGraphOpen}
                  normalizedEventSearch={normalizedEventSearch}
                  onCreateEvent={() => void createEditorEvent()}
                  onDragEnd={() => setDraggingEventId("")}
                  onDragOverEvent={dragOverEditorEvent}
                  onDragStartEvent={dragEditorEvent}
                  onDropEvent={(event, eventId) => void dropEditorEvent(event, eventId)}
                  onOpenRouteSource={(eventId, itemId) =>
                    void openEditorRouteSource(eventId, itemId)
                  }
                  onRefreshValidation={(targetExperienceId, showLoading) =>
                    void loadExperienceValidation(targetExperienceId, showLoading)
                  }
                  onSearchChange={setEventSearch}
                  onSelectEvent={(eventId) => void selectEditorEvent(eventId)}
                  onToggleGraph={() =>
                    setIsEventGraphOpen((current) => !current)
                  }
                  selectedEvent={selectedEvent}
                  validation={experienceValidation}
                  validationError={experienceValidationError}
                  validationStatus={experienceValidationStatus}
                  visibleEditorEvents={visibleEditorEvents}
                />

                <div className="event-workspace">
                  <EventWorkspaceHeader
                    canRedoEditorHistory={canRedoEditorHistory}
                    canUndoEditorHistory={canUndoEditorHistory}
                    checkpointMode={checkpointRecordingMode}
                    checkpoints={eventCheckpoints}
                    deletingEventId={deletingEventId}
                    editorEvents={editorEvents}
                    eventCheckpointError={eventCheckpointError}
                    eventCheckpointStatus={eventCheckpointStatus}
                    eventDraft={eventDraft}
                    isRunning={Boolean(runningEventId)}
                    onChangeCheckpointMode={setCheckpointRecordingMode}
                    onDeleteEvent={() => void deleteEditorEvent()}
                    onOpenRoute={openExpandedItem}
                    onRedoEditorHistory={redoEditorHistory}
                    onRefreshCheckpoints={() => {
                      if (selectedEvent) void loadEventCheckpoints(selectedEvent.id);
                    }}
                    onRunSelectedEvent={(checkpointId) =>
                      void runSelectedEvent(checkpointId)
                    }
                    onUndoEditorHistory={undoEditorHistory}
                    onUpdateEventDraft={updateEventDraft}
                    redoEditorTitle={redoEditorTitle}
                    selectedEvent={selectedEvent}
                    selectedEventRoutes={selectedEventRoutes}
                    undoEditorTitle={undoEditorTitle}
                  />
              <EventEntryStepList
                draggingStepId={draggingStepId}
                editorEvents={editorEvents}
                eventAddBlockRef={eventAddBlockRef}
                eventDraft={eventDraft}
                eventStepDropTarget={eventStepDropTarget}
                isEventAddMenuOpen={isEventAddMenuOpen}
                isExpandedItem={isExpandedItem}
                onAddEventStep={(actionType) => void addEventStep(actionType)}
                onClearActionDragState={clearActionDragState}
                onDeleteEventStep={(stepId) => void deleteEventStep(stepId)}
                onDragEventStep={dragEventStep}
                onDragLeaveEventStep={dragLeaveEventStep}
                onDragOverEventStep={dragOverEventStep}
                onDropEventStep={(event, stepId) => void dropEventStep(event, stepId)}
                onOpenExpandedItem={openExpandedItem}
                onToggleAddMenu={() =>
                  setIsEventAddMenuOpen((current) => !current)
                }
                onToggleExpandedItem={toggleExpandedItem}
                onUpdateEventStepCondition={updateEventStepCondition}
                onUpdateEventStepConfig={updateEventStepConfig}
                onUpdateEventStepConfigPatch={updateEventStepConfigPatch}
                onUpdateEventStepDraft={updateEventStepDraft}
                scriptAudioItems={scriptAudioItems}
              />
              <EventConversationEditor
                addEventChatCapture={addEventChatCapture}
                addEventChatTool={() => void addEventChatTool()}
                addEventChatToolAction={addEventChatToolAction}
                addEventClassifier={(groupId) => void addEventClassifier(groupId)}
                addEventClassifierGroup={() => void addEventClassifierGroup()}
                addEventClassifierGroupAction={addEventClassifierGroupAction}
                addEventConversationCheck={() => void addEventConversationCheck()}
                addEventConversationCheckAction={addEventConversationCheckAction}
                addEventConversationChoice={addEventConversationChoice}
                choiceIconBackground={tutorForm.choiceIconBackground}
                clearActionDragState={clearActionDragState}
                closeExpandedItem={closeExpandedItem}
                conversationAddBlockRef={conversationAddBlockRef}
                conversationAddMenuCheckId={conversationAddMenuCheckId}
                conversationAddMenuToolId={conversationAddMenuToolId}
                conversationCheckAddBlockRef={conversationCheckAddBlockRef}
                conversationItemAddBlockRef={conversationItemAddBlockRef}
                conversationItemDropTarget={conversationItemDropTarget}
                deleteEventChatCapture={deleteEventChatCapture}
                deleteEventChatTool={(toolId) => void deleteEventChatTool(toolId)}
                deleteEventChatToolAction={deleteEventChatToolAction}
                deleteEventClassifier={(groupId, classifierId) =>
                  void deleteEventClassifier(groupId, classifierId)
                }
                deleteEventClassifierGroup={(groupId) =>
                  void deleteEventClassifierGroup(groupId)
                }
                deleteEventClassifierGroupAction={deleteEventClassifierGroupAction}
                deleteEventConversationCheck={(checkId) =>
                  void deleteEventConversationCheck(checkId)
                }
                deleteEventConversationCheckAction={deleteEventConversationCheckAction}
                deleteEventConversationChoice={deleteEventConversationChoice}
                dragConversationItem={dragConversationItem}
                dragHandlerAction={dragHandlerAction}
                dragLeaveConversationItem={dragLeaveConversationItem}
                dragLeaveHandlerAction={dragLeaveHandlerAction}
                dragOverConversationItem={dragOverConversationItem}
                dragOverHandlerAction={dragOverHandlerAction}
                dropConversationItem={dropConversationItem}
                dropHandlerAction={dropHandlerAction}
                editorEvents={editorEvents}
                eventDraft={eventDraft}
                handlerActionDropTarget={handlerActionDropTarget}
                isConversationAddMenuOpen={isConversationAddMenuOpen}
                isDraggingConversationItem={isDraggingConversationItem}
                isDraggingHandlerAction={isDraggingHandlerAction}
                isExpandedItem={isExpandedItem}
                openExpandedItem={openExpandedItem}
                scriptAudioItems={scriptAudioItems}
                setConversationAddMenuCheckId={setConversationAddMenuCheckId}
                setConversationAddMenuToolId={setConversationAddMenuToolId}
                setIsConversationAddMenuOpen={setIsConversationAddMenuOpen}
                toggleExpandedItem={toggleExpandedItem}
                toggleExpandedParent={toggleExpandedParent}
                updateEventChatCaptureDraft={updateEventChatCaptureDraft}
                updateEventChatToolActionCondition={updateEventChatToolActionCondition}
                updateEventChatToolActionConfig={updateEventChatToolActionConfig}
                updateEventChatToolActionConfigPatch={updateEventChatToolActionConfigPatch}
                updateEventChatToolActionDraft={updateEventChatToolActionDraft}
                updateEventChatToolDraft={updateEventChatToolDraft}
                updateEventChatToolDraftField={updateEventChatToolDraftField}
                updateEventClassifierDraft={updateEventClassifierDraft}
                updateEventClassifierDraftField={updateEventClassifierDraftField}
                updateEventClassifierGroupActionCondition={
                  updateEventClassifierGroupActionCondition
                }
                updateEventClassifierGroupActionConfig={
                  updateEventClassifierGroupActionConfig
                }
                updateEventClassifierGroupActionConfigPatch={
                  updateEventClassifierGroupActionConfigPatch
                }
                updateEventClassifierGroupActionDraft={
                  updateEventClassifierGroupActionDraft
                }
                updateEventClassifierGroupDraft={updateEventClassifierGroupDraft}
                updateEventClassifierGroupDraftField={
                  updateEventClassifierGroupDraftField
                }
                updateEventConversationCheckActionCondition={
                  updateEventConversationCheckActionCondition
                }
                updateEventConversationCheckActionConfig={
                  updateEventConversationCheckActionConfig
                }
                updateEventConversationCheckActionConfigPatch={
                  updateEventConversationCheckActionConfigPatch
                }
                updateEventConversationCheckActionDraft={
                  updateEventConversationCheckActionDraft
                }
                updateEventConversationCheckDraft={updateEventConversationCheckDraft}
                updateEventConversationCheckDraftField={
                  updateEventConversationCheckDraftField
                }
                updateEventConversationChoiceDraft={updateEventConversationChoiceDraft}
                updateEventConversationChoiceDraftField={
                  updateEventConversationChoiceDraftField
                }
                updateEventDraft={updateEventDraft}
              />
                </div>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
