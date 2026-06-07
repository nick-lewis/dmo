import type { RealtimeModelId, RealtimeVoiceId } from "./realtime";
import type { PythonNotebookState } from "./PythonNotebookPanel";

export type ClassificationModelId = string;
export type HandlerActionOwnerKind =
  | "chatTool"
  | "conversationCheck"
  | "classifierGroup";

export type DraggingHandlerAction = {
  actionId: string;
  ownerId: string;
  ownerKind: HandlerActionOwnerKind;
};

export type DropPosition = "before" | "after";

export type EventStepDropTarget = {
  position: DropPosition;
  stepId: string;
};

export type ConversationItemKind = HandlerActionOwnerKind | "conversationChoice";

export type DraggingConversationItem = {
  itemId: string;
  itemKind: ConversationItemKind;
};

export type ConversationItemDropTarget = DraggingConversationItem & {
  position: DropPosition;
};

export type HandlerActionDropTarget = DraggingHandlerAction & {
  position: DropPosition;
};

export type CheckpointRecordingMode = "off" | "structural" | "full";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ApiUser = {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

export type TutoringSession = {
  id: string;
  experienceId: string;
  title: string;
  runtimeContext?: Record<string, unknown>;
  runtimeState?: Record<string, unknown>;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type SessionPayload = {
  session: TutoringSession;
  messages: ChatMessage[];
};

export type TutorSettings = {
  assistantName: string;
  avatarPath: string;
  choiceIconBackground: string;
  classificationModel: ClassificationModelId;
  realtimeModel: RealtimeModelId;
  systemPrompt: string;
  voice: RealtimeVoiceId;
  voiceInstructions: string;
};

export type EventActionStep = {
  id: string;
  eventId: string;
  actionType:
    | "script"
    | "set_context"
    | "append_context_list"
    | "get_ui_state"
    | "highlight_on"
    | "highlight_off"
    | "interactive"
    | "interactive_update"
    | "interactive_clear"
    | "python_notebook"
    | "chat_availability"
    | "set_ui_trigger"
    | "goto_event"
    | "button_choice";
  label: string;
  config: Record<string, unknown>;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ActionSequenceStep = {
  actionType: EventActionStep["actionType"];
  condition: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
  id: string;
  label: string;
  sortOrder: number;
};

export type EventChatTool = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  handlerActions: ActionSequenceStep[];
  parameters: Record<string, unknown>;
  triggersEvent: string;
  saveArgument: string;
  saveContextKey: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type EventConversationCheck = {
  id: string;
  eventId: string;
  title: string;
  instructions: string;
  resultContextKey: string;
  handlerActions: ActionSequenceStep[];
  triggersEvent: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type EventClassifier = {
  id: string;
  groupId: string;
  name: string;
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type EventClassifierGroup = {
  id: string;
  eventId: string;
  title: string;
  instructions: string;
  resultContextKey: string;
  handlerActions: ActionSequenceStep[];
  triggersEvent: string;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  classifiers: EventClassifier[];
  createdAt: string;
  updatedAt: string;
};

export type EventConversationChoice = {
  id: string;
  iconPath: string;
  label: string;
  triggersEvent: string;
  enabled: boolean;
  sortOrder: number;
};

export type ExperienceEvent = {
  id: string;
  experienceId: string;
  title: string;
  slug: string;
  description: string;
  onEntryDslSource: string;
  conversationDslSource: string;
  chatInstructions: string;
  conversationChoices: EventConversationChoice[];
  isStart: boolean;
  sortOrder: number;
  steps: EventActionStep[];
  chatTools: EventChatTool[];
  conversationChecks: EventConversationCheck[];
  classifierGroups: EventClassifierGroup[];
  createdAt: string;
  updatedAt: string;
};

export type EventStructuralHistoryItem =
  | { event: ExperienceEvent; type: "delete" }
  | { event: ExperienceEvent; type: "restore" }
  | {
      eventIdOrder: string[];
      selectedEventId: string;
      type: "reorder_events";
    };

export type Experience = {
  id: string;
  title: string;
  slug: string;
  description: string;
  tutor: TutorSettings;
  events: ExperienceEvent[];
  createdAt: string;
  updatedAt: string;
};

export type ExperienceSnapshot = {
  id: string;
  experienceId: string;
  title: string;
  note: string;
  createdAt: string;
  eventCount: number;
  format: string;
  version: number | null;
};

export type EventCheckpoint = {
  context: Array<{ key: string; value: unknown }>;
  createdAt: string;
  eventId: string;
  eventTitle: string;
  fingerprintMode: "structural" | "full";
  id: string;
  label: string;
  lastUsedAt: string;
  messageCount: number;
  runCount: number;
  slideRef: string;
};

export type ExperienceSnapshotsPayload = {
  snapshots: ExperienceSnapshot[];
};

export type EventCheckpointsPayload = {
  checkpoints: EventCheckpoint[];
};

export type ExperiencesPayload = {
  currentExperienceId: string;
  experiences: Experience[];
};

export type ExperienceForm = {
  title: string;
  description: string;
};

export type StepConditionDraft = {
  type: "always" | "context_equals" | "custom";
  key: string;
  raw?: Record<string, unknown>;
  value: string;
};

export type EventStepDraft = {
  id: string;
  actionType: EventActionStep["actionType"];
  label: string;
  config: Record<string, unknown>;
  condition: StepConditionDraft;
  enabled: boolean;
  sortOrder: number;
};

export type EventChatCaptureDraft = {
  description: string;
  id: string;
  saveAs: string;
};

export type EventChatToolDraft = {
  captures: EventChatCaptureDraft[];
  description: string;
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  name: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

export type EventConversationCheckDraft = {
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  instructions: string;
  resultContextKey: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

export type EventClassifierDraft = {
  condition: StepConditionDraft;
  enabled: boolean;
  id: string;
  model: string;
  name: string;
  prompt: string;
  schema: Record<string, unknown>;
  sortOrder: number;
};

export type EventClassifierGroupDraft = {
  classifiers: EventClassifierDraft[];
  condition: StepConditionDraft;
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  instructions: string;
  resultContextKey: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

export type EventConversationChoiceDraft = {
  enabled: boolean;
  iconPath: string;
  id: string;
  label: string;
  sortOrder: number;
  triggersEvent: string;
};

export type EventDraft = {
  chatInstructions: string;
  conversationChoices: EventConversationChoiceDraft[];
  title: string;
  description: string;
  steps: EventStepDraft[];
  chatTools: EventChatToolDraft[];
  conversationChecks: EventConversationCheckDraft[];
  classifierGroups: EventClassifierGroupDraft[];
};

export type StartEventPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  event: ExperienceEvent;
  ran: boolean;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

export type ConversationCheckPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  checks: Array<Record<string, unknown>>;
  classifierGroups: Array<Record<string, unknown>>;
  handled: boolean;
  ran: boolean;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

export type InteractiveRuntimePayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

export type PythonNotebookPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  notebook: PythonNotebookState;
};

export type RuntimeUiState = {
  avatarPath?: string;
  avatarVisible?: boolean;
  images?: Record<string, RuntimeSideImage>;
  interactive?: Record<string, unknown>;
  leftPanels?: Record<string, unknown>;
  notes?: RuntimeNote[];
  notesVisible: boolean;
  overlays?: Record<string, RuntimeOverlay>;
};

export type RuntimeHighlight = {
  color: string;
  selector: string;
};

export type RuntimeOverlay = {
  id: string;
  imagePath: string;
};

export type RuntimeSideImage = {
  imagePath: string;
  slot: string;
  visible: boolean;
};

export type RuntimeNote = {
  id: string;
  source?: string;
  text: string;
};

export type RuntimeUiTrigger = {
  eventId: string;
  selector: string;
  stepId: string;
  triggersEvent: string;
};

export type RuntimeButton = {
  eventId: string;
  iconBackground?: string;
  iconPath?: string;
  label: string;
  source?: string;
  stepId: string;
  triggersEvent: string;
};

export type RuntimeActionLogEntry = {
  detail: string;
  id: string;
  time: string;
  type: string;
};

export type RuntimeDebugTraceEntry = {
  at: string;
  details: Record<string, unknown>;
  summary: string;
  type: string;
};

export type EventOutgoingLink = {
  condition?: string;
  kind: string;
  slug: string;
  source: string;
  sourceItemId?: string;
};

export type EventGraphRouteRow = EventOutgoingLink & {
  sourceEvent: string;
  sourceEventId: string;
};

export type ExperienceValidationRoute = {
  dynamic: boolean;
  kind: string;
  source: string;
  sourceEventId: string;
  sourceEventSlug: string;
  sourceEventTitle: string;
  sourceItemId: string;
  target: string;
};

export type ExperienceValidationEvent = {
  id: string;
  isStart: boolean;
  slug: string;
  title: string;
};

export type ExperienceValidationAppIssue = {
  detail: string;
  interactiveId: string;
  source: string;
  sourceEventId: string;
  sourceEventSlug: string;
  sourceEventTitle: string;
  sourceItemId: string;
};

export type ExperienceValidationScriptIssue = {
  detail: string;
  issueType: string;
  markerType: string;
  source: string;
  sourceEventId: string;
  sourceEventSlug: string;
  sourceEventTitle: string;
  sourceItemId: string;
  value: string;
};

export type ExperienceValidation = {
  appIssues: ExperienceValidationAppIssue[];
  dynamicRouteCount: number;
  eventCount: number;
  orphanedEvents: ExperienceValidationEvent[];
  routeCount: number;
  routes: ExperienceValidationRoute[];
  scriptIssues: ExperienceValidationScriptIssue[];
  unresolvedRoutes: ExperienceValidationRoute[];
};

export type ExperienceValidationPayload = {
  validation: ExperienceValidation;
};

export type VoiceSampleStatus = "idle" | "loading" | "playing";

export type VoiceSamplePayload = {
  audioUrl: string;
  audioEngine?: string;
  audioModel?: string;
  cached: boolean;
  realtimeModel: RealtimeModelId;
  script: string;
  scriptModel: string;
  ttsModel?: string;
  voice: RealtimeVoiceId;
};

export type VoicePersonalityLabSample = {
  audioEngine?: string;
  audioModel?: string;
  audioUrl: string;
  cacheKey: string;
  cached: boolean;
  durationSeconds: number | null;
  error: string;
  realtimeModel: RealtimeModelId;
  script: string;
  voice: RealtimeVoiceId;
};

export type VoicePersonalityLabGroup = {
  cachedCount: number;
  createdAt: string;
  id: string;
  realtimeModel: RealtimeModelId;
  sampleCount: number;
  samples: VoicePersonalityLabSample[];
  updatedAt: string;
  voiceInstructions: string;
};

export type VoicePersonalityLabPayload = {
  activeGroupId?: string;
  defaultRealtimeModel: RealtimeModelId;
  errors?: string[];
  generated?: number;
  groups: VoicePersonalityLabGroup[];
  script: string;
  totalGroups: number;
};

export type MessageAudioPayload = {
  audioUrl: string;
  audioEngine?: string;
  audioModel?: string;
  cached: boolean;
  displayBreaks?: number[];
  displayCueOffsets?: number[];
  displaySlots?: string[];
  displayText?: string;
  durationSeconds?: number | null;
  messageId: string;
  realtimeModel: RealtimeModelId;
  scriptCues?: ScriptCue[];
  scriptWords?: ScriptWord[];
  timingModel?: string;
  timingWarning?: string;
  ttsModel?: string;
  voice: RealtimeVoiceId;
  voiceInstructions?: string;
};

export type ScriptAudioItem = {
  audioUrl: string;
  audioEngine?: string;
  audioModel?: string;
  cached: boolean;
  cacheKey: string;
  canGenerate: boolean;
  characterCount?: number;
  displayBaseSlots?: string[];
  displayBaseText?: string;
  defaultVoiceInstructions?: string;
  displayBreaks?: number[];
  displayCueOffsets?: number[];
  durationSeconds: number | null;
  displayExpectedWordCount?: number;
  displaySlotCount?: number;
  displaySlots?: string[];
  displayText?: string;
  displayWordCount?: number;
  generationReason?: string;
  hasDisplayTranscript?: boolean;
  hasVoiceInstructionsOverride?: boolean;
  id: string;
  markerCount?: number;
  preview: string;
  realtimeModel?: RealtimeModelId;
  script?: string;
  source: string;
  sourceCount?: number;
  sources?: string[];
  timedMarkerCount?: number;
  timingPreview?: ScriptWord[];
  timingWords?: ScriptWord[];
  timingWordCount?: number;
  timingModel?: string;
  ttsModel?: string;
  voice?: RealtimeVoiceId;
  voiceInstructions?: string;
  voiceInstructionsOverride?: string;
  wordCount?: number;
  wordsCached: boolean;
};

export type ScriptAudioPayload = {
  errors?: string[];
  generated?: number;
  scripts: ScriptAudioItem[];
  totalScripts: number;
};

export type ScriptAudioDisplayPayload = {
  defaultVoiceInstructions: string;
  displayBaseSlots: string[];
  displayBaseText: string;
  displayBreaks: number[];
  displayCueOffsets: number[];
  displayExpectedWordCount: number;
  displaySlotCount: number;
  displaySlots: string[];
  displayText: string;
  displayWordCount: number;
  hasDisplayTranscript: boolean;
  hasVoiceInstructionsOverride: boolean;
  id: string;
  script: string;
  voiceInstructions: string;
  voiceInstructionsOverride: string;
};

export type ScriptCue = {
  action: Record<string, unknown>;
  progress: number;
  time?: number;
  wordIndex?: number;
};

export type ScriptWord = {
  end: number;
  start: number;
  word: string;
};

export type ResolvedSlide = {
  cached: boolean;
  imageUrl: string;
  pageId: string;
  presentationId: string;
  slideRef: string;
};

export type SlideStatus = "empty" | "loading" | "ready" | "error";
