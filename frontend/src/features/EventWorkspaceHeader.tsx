import { RedoIcon, TrashIcon, UndoIcon } from "../components/Icons";
import { inlineFieldWidthStyle } from "./eventEditorUtils";
import type {
  CheckpointRecordingMode,
  EventCheckpoint,
  EventDraft,
  ExperienceEvent,
} from "../types";
import { EventRunControls } from "./EventRunControls";

type SelectedEventRouteChip = {
  id: string;
  label: string;
  target: string;
};

type EventWorkspaceHeaderProps = {
  canRedoEditorHistory: boolean;
  canUndoEditorHistory: boolean;
  checkpointMode: CheckpointRecordingMode;
  checkpoints: EventCheckpoint[];
  deletingEventId: string;
  editorEvents: ExperienceEvent[];
  eventDraft: EventDraft;
  eventCheckpointError: string;
  eventCheckpointStatus: "idle" | "loading" | "error";
  isRunning: boolean;
  onChangeCheckpointMode: (mode: CheckpointRecordingMode) => void;
  onDeleteEvent: () => void;
  onOpenRoute: (routeId: string) => void;
  onRedoEditorHistory: () => void;
  onRefreshCheckpoints: () => void;
  onRunSelectedEvent: (checkpointId: string) => void;
  onUndoEditorHistory: () => void;
  onUpdateEventDraft: (
    field: "chatInstructions" | "description" | "title",
    value: string,
  ) => void;
  redoEditorTitle: string;
  selectedEvent: ExperienceEvent | null;
  selectedEventRoutes: SelectedEventRouteChip[];
  undoEditorTitle: string;
};

export function EventWorkspaceHeader({
  canRedoEditorHistory,
  canUndoEditorHistory,
  checkpointMode,
  checkpoints,
  deletingEventId,
  editorEvents,
  eventDraft,
  eventCheckpointError,
  eventCheckpointStatus,
  isRunning,
  onChangeCheckpointMode,
  onDeleteEvent,
  onOpenRoute,
  onRedoEditorHistory,
  onRefreshCheckpoints,
  onRunSelectedEvent,
  onUndoEditorHistory,
  onUpdateEventDraft,
  redoEditorTitle,
  selectedEvent,
  selectedEventRoutes,
  undoEditorTitle,
}: EventWorkspaceHeaderProps) {
  return (
    <>
      <div className="event-document-header">
        <div className="event-title-stack">
          <div className="event-title-line">
            <input
              aria-label="Event title"
              className="event-title-text"
              onChange={(event) => onUpdateEventDraft("title", event.target.value)}
              style={inlineFieldWidthStyle(eventDraft.title, "Start", 6, 32)}
              type="text"
              value={eventDraft.title}
            />
            <input
              aria-label="Event description"
              className="event-description-text"
              onChange={(event) =>
                onUpdateEventDraft("description", event.target.value)
              }
              placeholder="---"
              style={inlineFieldWidthStyle(
                eventDraft.description,
                "---",
                4,
                54,
              )}
              type="text"
              value={eventDraft.description}
            />
          </div>
        </div>
        <div className="event-history-tools">
          <EventRunControls
            checkpointMode={checkpointMode}
            checkpoints={checkpoints}
            error={eventCheckpointError}
            hasSelectedEvent={Boolean(selectedEvent)}
            isRunning={isRunning}
            onChangeCheckpointMode={onChangeCheckpointMode}
            onRefreshCheckpoints={onRefreshCheckpoints}
            onRun={onRunSelectedEvent}
            selectedEventId={selectedEvent?.id ?? ""}
            selectedEventTitle={selectedEvent?.title || "this event"}
            status={eventCheckpointStatus}
          />
          <button
            aria-label="Undo event edit or reordered action"
            className="event-icon-button"
            disabled={!canUndoEditorHistory}
            onClick={onUndoEditorHistory}
            title={undoEditorTitle}
            type="button"
          >
            <UndoIcon />
          </button>
          <button
            aria-label="Redo event edit or reordered action"
            className="event-icon-button"
            disabled={!canRedoEditorHistory}
            onClick={onRedoEditorHistory}
            title={redoEditorTitle}
            type="button"
          >
            <RedoIcon />
          </button>
          <button
            aria-label="Delete selected event"
            className="event-icon-button danger"
            disabled={
              !selectedEvent ||
              editorEvents.length <= 1 ||
              deletingEventId === selectedEvent.id
            }
            onClick={onDeleteEvent}
            title={
              editorEvents.length <= 1
                ? "An experience needs at least one event"
                : "Delete selected event"
            }
            type="button"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {selectedEventRoutes.length ? (
        <div className="event-route-strip" aria-label="Event routes">
          <span>Routes</span>
          {selectedEventRoutes.map((route) => (
            <button
              className="event-route-chip"
              key={route.id}
              onClick={() => onOpenRoute(route.id)}
              type="button"
            >
              <strong>{route.label}</strong>
              <span>{route.target}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
