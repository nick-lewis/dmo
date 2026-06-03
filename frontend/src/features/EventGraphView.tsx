import { useState } from "react";

import {
  eventOutgoingLinks,
  eventTargetForRoute,
  eventTransitionStats,
  isDynamicRouteTarget,
  routeKindCounts,
} from "../eventGraph";
import type {
  EventGraphRouteRow,
  EventOutgoingLink,
  ExperienceEvent,
  ExperienceValidation,
} from "../types";

function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}
export function EventGraphView({
  events,
  onOpenRouteSource,
  onRefreshValidation,
  onSelectEvent,
  selectedEventId,
  validation,
  validationError,
  validationStatus,
}: {
  events: ExperienceEvent[];
  onOpenRouteSource: (eventId: string, itemId?: string) => void;
  onRefreshValidation: () => void;
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string;
  validation: ExperienceValidation | null;
  validationError: string;
  validationStatus: "idle" | "loading" | "error";
}) {
  const [selectedRouteKind, setSelectedRouteKind] = useState("");
  const sortedEvents = sortedExperienceEvents(events);
  const indexBySlug = new Map<string, number>();
  sortedEvents.forEach((event, index) => {
    indexBySlug.set(event.slug, index);
    indexBySlug.set(event.id, index);
  });
  const statsByEventId = new Map(
    sortedEvents.map((event) => [event.id, eventTransitionStats(events, event)]),
  );
  const orphanEvents = sortedEvents.filter(
    (event) => statsByEventId.get(event.id)?.isUnlinked,
  );
  const unresolvedRoutes = sortedEvents.flatMap((event) =>
    eventOutgoingLinks(event)
      .filter(
        (link) =>
          !isDynamicRouteTarget(link.slug) &&
          !eventTargetForRoute(sortedEvents, link.slug),
      )
      .map((link) => ({
        ...link,
        sourceEventId: event.id,
        sourceEvent: event.title || event.slug,
      })),
  );
  const orphanCount = orphanEvents.length;
  const unresolvedRouteCount = sortedEvents.reduce(
    (total, event) => total + (statsByEventId.get(event.id)?.unresolvedCount ?? 0),
    0,
  );
  const routeCount = sortedEvents.reduce(
    (total, event) => total + (statsByEventId.get(event.id)?.outgoingCount ?? 0),
    0,
  );
  const allOutgoingLinks = sortedEvents.flatMap((event) =>
    eventOutgoingLinks(event),
  );
  const routeRows: EventGraphRouteRow[] = sortedEvents.flatMap((event) =>
    eventOutgoingLinks(event).map((link) => ({
      ...link,
      sourceEvent: event.title || event.slug,
      sourceEventId: event.id,
    })),
  );
  const visibleRouteRows = selectedRouteKind
    ? routeRows.filter((link) => link.kind === selectedRouteKind)
    : routeRows;
  const routeKindSummary = routeKindCounts(allOutgoingLinks);
  const conditionalRouteCount = sortedEvents.reduce(
    (total, event) =>
      total + eventOutgoingLinks(event).filter((link) => link.condition).length,
    0,
  );
  const selectedEvent =
    sortedEvents.find((event) => event.id === selectedEventId) ?? sortedEvents[0];
  const rowHeight = 44;
  const height = Math.max(74, sortedEvents.length * rowHeight + 28);
  const links = sortedEvents.flatMap((event, sourceIndex) =>
    eventOutgoingLinks(event)
      .filter((link) => !selectedRouteKind || link.kind === selectedRouteKind)
      .map((link) => ({
        slug: link.slug,
        sourceIndex,
        targetIndex: indexBySlug.get(link.slug) ?? -1,
      }))
      .filter((link) => link.targetIndex >= 0),
  );
  const selectedOutgoingLinks = selectedEvent
    ? eventOutgoingLinks(selectedEvent)
    : [];
  const visibleSelectedOutgoingLinks = selectedRouteKind
    ? selectedOutgoingLinks.filter((link) => link.kind === selectedRouteKind)
    : selectedOutgoingLinks;
  const selectedRouteKindSummary = routeKindCounts(selectedOutgoingLinks);
  const incomingLinks = selectedEvent
    ? sortedEvents.flatMap((event) =>
        eventOutgoingLinks(event)
          .filter(
            (link) =>
              link.slug === selectedEvent.slug || link.slug === selectedEvent.id,
          )
          .map((link) => ({
            ...link,
            sourceEventId: event.id,
            sourceEvent: event.title || event.slug,
          })),
      )
    : [];
  const visibleIncomingLinks = selectedRouteKind
    ? incomingLinks.filter((link) => link.kind === selectedRouteKind)
    : incomingLinks;
  const unresolvedLinks = selectedOutgoingLinks.filter(
    (link) =>
      !isDynamicRouteTarget(link.slug) &&
      !eventTargetForRoute(sortedEvents, link.slug),
  );
  const visibleUnresolvedLinks = selectedRouteKind
    ? unresolvedLinks.filter((link) => link.kind === selectedRouteKind)
    : unresolvedLinks;

  return (
    <div className="event-graph-view" aria-label="Event graph">
      <svg
        aria-hidden="true"
        className="event-graph-lines"
        viewBox={`0 0 260 ${height}`}
      >
        {links.map((link, index) => {
          const startY = 24 + link.sourceIndex * rowHeight;
          const endY = 24 + link.targetIndex * rowHeight;
          const midX = link.sourceIndex < link.targetIndex ? 206 : 224;
          return (
            <path
              d={`M 102 ${startY} C ${midX} ${startY}, ${midX} ${endY}, 138 ${endY}`}
              key={`${link.sourceIndex}-${link.targetIndex}-${link.slug}-${index}`}
            />
          );
        })}
      </svg>
      <div className="event-graph-summary">
        <span>{sortedEvents.length} events</span>
        <span>{routeCount} routes</span>
        <span>{conditionalRouteCount} conditional</span>
        {orphanCount ? <strong>{orphanCount} orphaned</strong> : <span>0 orphaned</span>}
        {unresolvedRouteCount ? (
          <strong>{unresolvedRouteCount} unresolved</strong>
        ) : (
          <span>0 unresolved</span>
        )}
      </div>
      {routeKindSummary.length ? (
        <div className="event-graph-route-kinds" aria-label="Route source counts">
          {routeKindSummary.map(([kind, count]) => (
            <button
              aria-pressed={selectedRouteKind === kind}
              className={selectedRouteKind === kind ? "is-selected" : ""}
              key={kind}
              onClick={() =>
                setSelectedRouteKind((current) => (current === kind ? "" : kind))
              }
              title={
                selectedRouteKind === kind
                  ? `Show all route types`
                  : `Only show ${kind} routes`
              }
              type="button"
            >
              <strong>{kind}</strong>
              {count}
            </button>
          ))}
          {selectedRouteKind ? (
            <button
              className="event-graph-clear-filter"
              onClick={() => setSelectedRouteKind("")}
              type="button"
            >
              All
            </button>
          ) : null}
        </div>
      ) : null}
      <EventGraphValidationPanel
        onOpenRouteSource={onOpenRouteSource}
        onRefresh={onRefreshValidation}
        onSelectEvent={onSelectEvent}
        status={validationStatus}
        validation={validation}
        validationError={validationError}
      />
      {orphanEvents.length || unresolvedRoutes.length ? (
        <div className="event-graph-issues" aria-label="Graph issues">
          {orphanEvents.map((event) => (
            <button
              className="event-graph-issue"
              key={`orphan-${event.id}`}
              onClick={() => onSelectEvent(event.id)}
              type="button"
            >
              <strong>Orphaned</strong>
              <span>{event.title || event.slug}</span>
            </button>
          ))}
          {unresolvedRoutes.map((link, index) => (
            <button
              className="event-graph-issue is-unresolved"
              key={`missing-${link.sourceEventId}-${link.slug}-${index}`}
              onClick={() => onSelectEvent(link.sourceEventId)}
              type="button"
            >
              <strong>Missing target</strong>
              <span>
                {link.sourceEvent} {"->"} {link.slug}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="event-graph-nodes">
        {sortedEvents.map((event) => {
          const stats =
            statsByEventId.get(event.id) ?? eventTransitionStats(events, event);
          return (
            <button
              className={[
                "event-graph-node",
                event.id === selectedEventId ? "is-selected" : "",
                stats.isUnlinked ? "is-unlinked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={event.id}
              onClick={() => onSelectEvent(event.id)}
              type="button"
            >
              <span>{event.title || event.slug}</span>
              <small>
                {event.isStart ? "start" : `${stats.incomingCount} in`} /{" "}
                {stats.outgoingCount} out
                {stats.unresolvedCount ? ` / ${stats.unresolvedCount} unresolved` : ""}
              </small>
            </button>
          );
        })}
      </div>
      {selectedEvent ? (
        <div className="event-graph-details">
          <div className="event-graph-details-header">
            <strong>{selectedEvent.title || selectedEvent.slug}</strong>
            <span>
              {incomingLinks.length} in / {selectedOutgoingLinks.length} out
            </span>
          </div>
          {selectedRouteKindSummary.length ? (
            <div
              className="event-graph-route-kinds is-selected-event"
              aria-label="Selected event route sources"
            >
              {selectedRouteKindSummary.map(([kind, count]) => (
                <span key={kind}>
                  <strong>{kind}</strong>
                  {count}
                </span>
              ))}
            </div>
          ) : null}
          <EventGraphLinkList
            empty="No outgoing routes"
            events={sortedEvents}
            links={visibleSelectedOutgoingLinks}
            onSelectEvent={onSelectEvent}
            title={selectedRouteKind ? `Outgoing ${selectedRouteKind}` : "Outgoing"}
          />
          <EventGraphIncomingList
            empty={selectedEvent.isStart ? "Start event" : "No incoming routes"}
            links={visibleIncomingLinks}
            onSelectEvent={onSelectEvent}
            title={selectedRouteKind ? `Incoming ${selectedRouteKind}` : "Incoming"}
          />
          {visibleUnresolvedLinks.length ? (
            <EventGraphLinkList
              empty=""
              events={sortedEvents}
              links={visibleUnresolvedLinks}
              onSelectEvent={onSelectEvent}
              title="Unresolved"
              unresolved
            />
          ) : null}
        </div>
      ) : null}
      <EventGraphRouteCatalog
        events={sortedEvents}
        links={visibleRouteRows}
        onOpenRouteSource={onOpenRouteSource}
        onSelectEvent={onSelectEvent}
        title={selectedRouteKind ? `All ${selectedRouteKind} routes` : "All routes"}
      />
    </div>
  );
}

function EventGraphValidationPanel({
  onOpenRouteSource,
  onRefresh,
  onSelectEvent,
  status,
  validation,
  validationError,
}: {
  onOpenRouteSource: (eventId: string, itemId?: string) => void;
  onRefresh: () => void;
  onSelectEvent: (eventId: string) => void;
  status: "idle" | "loading" | "error";
  validation: ExperienceValidation | null;
  validationError: string;
}) {
  const appIssueCount = validation?.appIssues.length ?? 0;
  const scriptIssueCount = validation?.scriptIssues.length ?? 0;
  const unresolvedCount = validation?.unresolvedRoutes.length ?? 0;
  const orphanCount = validation?.orphanedEvents.length ?? 0;
  const issueCount =
    appIssueCount + scriptIssueCount + unresolvedCount + orphanCount;
  const statusLabel =
    status === "loading"
      ? "Checking"
      : status === "error"
        ? "Error"
        : validation
          ? `${issueCount} issues`
          : "Not checked";

  return (
    <div className="event-graph-validation" aria-label="Experience validation">
      <div className="event-graph-validation-header">
        <span>Validation</span>
        <strong>{statusLabel}</strong>
        <button onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>
      {validation ? (
        <div className="event-graph-validation-summary">
          <span>{validation.eventCount} events</span>
          <span>{validation.routeCount} routes</span>
          <span>{validation.dynamicRouteCount} dynamic</span>
          <span>{appIssueCount} app issues</span>
          <span>{scriptIssueCount} script issues</span>
        </div>
      ) : null}
      {validationError ? (
        <p className="event-graph-validation-empty">{validationError}</p>
      ) : null}
      {validation && issueCount ? (
        <div className="event-graph-validation-issues">
          {validation.appIssues.map((issue, index) => (
            <button
              className="event-graph-validation-row is-app"
              key={`${issue.sourceEventId}-${issue.interactiveId}-${index}`}
              onClick={() =>
                onOpenRouteSource(issue.sourceEventId, issue.sourceItemId)
              }
              title={issue.detail}
              type="button"
            >
              <strong>{issue.interactiveId}</strong>
              <span>
                {issue.sourceEventTitle || issue.sourceEventSlug} / {issue.source}
              </span>
            </button>
          ))}
          {validation.scriptIssues.map((issue, index) => (
            <button
              className="event-graph-validation-row is-script"
              key={`${issue.sourceEventId}-${issue.issueType}-${issue.value}-${index}`}
              onClick={() =>
                onOpenRouteSource(issue.sourceEventId, issue.sourceItemId)
              }
              title={issue.detail}
              type="button"
            >
              <strong>{issue.value || issue.markerType || "script"}</strong>
              <span>
                {issue.sourceEventTitle || issue.sourceEventSlug} / {issue.source}
              </span>
            </button>
          ))}
          {validation.unresolvedRoutes.map((route, index) => (
            <button
              className="event-graph-validation-row is-route"
              key={`${route.sourceEventId}-${route.target}-${index}`}
              onClick={() =>
                onOpenRouteSource(route.sourceEventId, route.sourceItemId)
              }
              type="button"
            >
              <strong>{route.target || "missing event"}</strong>
              <span>
                {route.sourceEventTitle || route.sourceEventSlug} / {route.kind}
              </span>
            </button>
          ))}
          {validation.orphanedEvents.map((event) => (
            <button
              className="event-graph-validation-row is-orphan"
              key={event.id}
              onClick={() => onSelectEvent(event.id)}
              type="button"
            >
              <strong>{event.title || event.slug}</strong>
              <span>Orphaned event</span>
            </button>
          ))}
        </div>
      ) : null}
      {validation && !issueCount ? (
        <p className="event-graph-validation-empty">
          No unresolved routes, orphaned events, app registration issues, or script issues.
        </p>
      ) : null}
    </div>
  );
}

function EventGraphRouteCatalog({
  events,
  links,
  onOpenRouteSource,
  onSelectEvent,
  title,
}: {
  events: ExperienceEvent[];
  links: EventGraphRouteRow[];
  onOpenRouteSource: (eventId: string, itemId?: string) => void;
  onSelectEvent: (eventId: string) => void;
  title: string;
}) {
  return (
    <div className="event-graph-route-catalog">
      <div className="event-graph-route-catalog-header">
        <span>{title}</span>
        <strong>{links.length}</strong>
      </div>
      {links.length ? (
        <div className="event-graph-route-table">
          {links.map((link, index) => {
            const target = eventTargetForRoute(events, link.slug);
            const isDynamic = isDynamicRouteTarget(link.slug);

            return (
              <div
                className={[
                  "event-graph-route-row",
                  target || isDynamic ? "" : "is-unresolved",
                  isDynamic ? "is-dynamic" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${link.sourceEventId}-${link.slug}-${link.source}-${index}`}
              >
                <button
                  className="event-graph-route-event"
                  onClick={() =>
                    onOpenRouteSource(link.sourceEventId, link.sourceItemId)
                  }
                  title={
                    link.sourceItemId
                      ? "Open the source action in the editor"
                      : "Open the source event"
                  }
                  type="button"
                >
                  {link.sourceEvent}
                </button>
                <span className="event-graph-route-kind">{link.kind}</span>
                {target ? (
                  <button
                    className="event-graph-route-event"
                    onClick={() => onSelectEvent(target.id)}
                    type="button"
                  >
                    {target.title || target.slug}
                  </button>
                ) : isDynamic ? (
                  <code>{link.slug || "dynamic event"}</code>
                ) : (
                  <code>{link.slug || "missing event"}</code>
                )}
                <small>
                  {link.source}
                  {link.condition ? ` / if ${link.condition}` : ""}
                </small>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="event-graph-route-empty">No routes</p>
      )}
    </div>
  );
}

function EventGraphLinkList({
  empty,
  events,
  links,
  onSelectEvent,
  title,
  unresolved = false,
}: {
  empty: string;
  events: ExperienceEvent[];
  links: EventOutgoingLink[];
  onSelectEvent: (eventId: string) => void;
  title: string;
  unresolved?: boolean;
}) {
  return (
    <div className="event-graph-link-group">
      <span>{title}</span>
      {links.length ? (
        links.map((link, index) => {
          const target = eventTargetForRoute(events, link.slug);
          const isDynamic = isDynamicRouteTarget(link.slug);
          const className = [
            "event-graph-link-row",
            unresolved || (!target && !isDynamic) ? "is-unresolved" : "",
            isDynamic ? "is-dynamic" : "",
            target ? "is-clickable" : "",
          ]
            .filter(Boolean)
            .join(" ");

          if (!target) {
            return (
              <div className={className} key={`${link.slug}-${link.source}-${index}`}>
                <strong>{link.slug || (isDynamic ? "Dynamic event" : "Missing event")}</strong>
                <small>
                  {link.kind} / {link.source}
                  {link.condition ? ` / if ${link.condition}` : ""}
                </small>
              </div>
            );
          }

          return (
            <button
              className={className}
              key={`${link.slug}-${link.source}-${index}`}
              onClick={() => onSelectEvent(target.id)}
              type="button"
            >
              <strong>{target.title || target.slug}</strong>
              <small>
                {link.kind} / {link.source}
                {link.condition ? ` / if ${link.condition}` : ""}
              </small>
            </button>
          );
        })
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function EventGraphIncomingList({
  empty,
  links,
  onSelectEvent,
  title,
}: {
  empty: string;
  links: Array<EventOutgoingLink & { sourceEvent: string; sourceEventId: string }>;
  onSelectEvent: (eventId: string) => void;
  title: string;
}) {
  return (
    <div className="event-graph-link-group">
      <span>{title}</span>
      {links.length ? (
        links.map((link, index) => (
          <button
            className="event-graph-link-row is-clickable"
            key={`${link.sourceEvent}-${link.slug}-${link.source}-${index}`}
            onClick={() => onSelectEvent(link.sourceEventId)}
            type="button"
          >
            <strong>{link.sourceEvent}</strong>
            <small>
              {link.kind} / {link.source}
              {link.condition ? ` / if ${link.condition}` : ""}
            </small>
          </button>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}
