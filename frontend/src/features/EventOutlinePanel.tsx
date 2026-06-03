import type { DragEvent } from "react";

import { eventTransitionStats } from "../eventGraph";
import type {
  ExperienceEvent,
  ExperienceValidation,
} from "../types";
import { PlusIcon } from "../components/Icons";
import { EventGraphView } from "./EventGraphView";

type EventOutlinePanelProps = {
  draggingEventId: string;
  editorEvents: ExperienceEvent[];
  eventSearch: string;
  experienceId: string;
  isEventGraphOpen: boolean;
  normalizedEventSearch: string;
  onCreateEvent: () => void;
  onDragEnd: () => void;
  onDragOverEvent: (event: DragEvent<HTMLElement>) => void;
  onDragStartEvent: (event: DragEvent<HTMLElement>, eventId: string) => void;
  onDropEvent: (event: DragEvent<HTMLElement>, eventId: string) => void;
  onOpenRouteSource: (eventId: string, itemId?: string) => void;
  onRefreshValidation: (experienceId: string, showLoading?: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelectEvent: (eventId: string) => void;
  onToggleGraph: () => void;
  selectedEvent: ExperienceEvent | null;
  validation: ExperienceValidation | null;
  validationError: string;
  validationStatus: "idle" | "loading" | "error";
  visibleEditorEvents: ExperienceEvent[];
};

export function EventOutlinePanel({
  draggingEventId,
  editorEvents,
  eventSearch,
  experienceId,
  isEventGraphOpen,
  normalizedEventSearch,
  onCreateEvent,
  onDragEnd,
  onDragOverEvent,
  onDragStartEvent,
  onDropEvent,
  onOpenRouteSource,
  onRefreshValidation,
  onSearchChange,
  onSelectEvent,
  onToggleGraph,
  selectedEvent,
  validation,
  validationError,
  validationStatus,
  visibleEditorEvents,
}: EventOutlinePanelProps) {
  return (
    <aside className="event-outline" aria-label="Events">
      <div className="event-outline-tools">
        <input
          aria-label="Find event"
          className="event-search-input"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Find event"
          type="search"
          value={eventSearch}
        />
        <button
          aria-pressed={isEventGraphOpen}
          className="event-create-button secondary"
          onClick={onToggleGraph}
          type="button"
        >
          Graph
        </button>
        <button
          className="event-create-button"
          onClick={onCreateEvent}
          type="button"
        >
          <PlusIcon />
          Event
        </button>
      </div>

      <div className="event-outline-list">
        {visibleEditorEvents.map((event) => {
          const stats = eventTransitionStats(editorEvents, event);
          const description = event.description.trim() || event.slug || "---";

          return (
            <button
              className={[
                "event-outline-row",
                event.id === selectedEvent?.id ? "is-selected" : "",
                draggingEventId === event.id ? "is-dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={!normalizedEventSearch}
              key={event.id}
              onClick={() => onSelectEvent(event.id)}
              onDragEnd={() => onDragEnd()}
              onDragOver={(dragEvent) => onDragOverEvent(dragEvent)}
              onDragStart={(dragEvent) => onDragStartEvent(dragEvent, event.id)}
              onDrop={(dropEvent) => onDropEvent(dropEvent, event.id)}
              title={
                normalizedEventSearch
                  ? "Clear search to reorder events"
                  : "Drag to reorder events"
              }
              type="button"
            >
              <span className="event-outline-copy">
                <span className="event-outline-title">
                  {event.title || "Untitled event"}
                </span>
                <span className="event-outline-description">{description}</span>
              </span>
              <span className="event-outline-meta">
                {event.isStart ? (
                  <span className="event-outline-badge">Start</span>
                ) : null}
                {stats.outgoingCount ? (
                  <span className="event-outline-count">
                    {stats.outgoingCount} out
                  </span>
                ) : null}
                {stats.incomingCount ? (
                  <span className="event-outline-count">
                    {stats.incomingCount} in
                  </span>
                ) : null}
                {stats.isUnlinked ? (
                  <span className="event-outline-warning">Unlinked</span>
                ) : null}
                {stats.unresolvedCount ? (
                  <span className="event-outline-warning">Missing</span>
                ) : null}
              </span>
            </button>
          );
        })}
        {!visibleEditorEvents.length ? (
          <div className="event-outline-empty">No events</div>
        ) : null}
      </div>

      {isEventGraphOpen ? (
        <EventGraphView
          events={editorEvents}
          onOpenRouteSource={onOpenRouteSource}
          onRefreshValidation={() => onRefreshValidation(experienceId, true)}
          onSelectEvent={onSelectEvent}
          selectedEventId={selectedEvent?.id ?? ""}
          validation={validation}
          validationError={validationError}
          validationStatus={validationStatus}
        />
      ) : null}
    </aside>
  );
}
