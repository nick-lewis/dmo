import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { MinusIcon, PlusIcon } from "../components/Icons";
import {
  eventOutgoingLinks,
  eventTargetForRoute,
  isDynamicRouteTarget,
} from "../eventGraph";
import type { EventOutgoingLink, ExperienceEvent } from "../types";

type ViewportDragState = {
  clientX: number;
  clientY: number;
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
};

type PaneResizeDragState = {
  latestFraction: number;
  pointerId: number;
  sectionLeft: number;
  sectionWidth: number;
};

type DetailResizeDragState = {
  latestFraction: number;
  pointerId: number;
  sectionRight: number;
  sectionWidth: number;
};

type FlowRoute = {
  links: EventOutgoingLink[];
  target: ExperienceEvent;
};

type EventContextMenuState = {
  eventId: string;
  x: number;
  y: number;
};

type FlowViewportPosition = {
  scrollLeft: number;
  scrollTop: number;
};

type FlowCanvasSize = {
  height: number;
  width: number;
};

const flowSplitStorageKey = "dlu.next-editor-flow-split.v1";
const flowCollapsedStorageKey = "dlu.next-editor-flow-collapsed.v1";
const detailSplitStorageKey = "dlu.next-editor-detail-split.v1";
const flowViewportStoragePrefix = "dlu.next-editor-flow-viewport.v1";
const flowZoomStoragePrefix = "dlu.next-editor-flow-zoom.v1";
const defaultFlowSplitFraction = 0.25;
const defaultDetailSplitFraction = 0.28;
const defaultFlowZoom = 1;
const minFlowZoom = 0.55;
const maxFlowZoom = 1.9;
const minFlowPaneWidthPx = 220;
const minInspectorWidthPx = 360;
const minInspectorWithDetailWidthPx = 300;
const minDetailPaneWidthPx = 260;
const minFlowSplitFraction = 0.16;
const maxFlowSplitFraction = 0.68;
const minDetailSplitFraction = 0.18;
const maxDetailSplitFraction = 0.46;

function flowViewportStorageKey(experienceId: string) {
  return `${flowViewportStoragePrefix}:${experienceId}`;
}

function flowZoomStorageKey(experienceId: string) {
  return `${flowZoomStoragePrefix}:${experienceId}`;
}

function clampFlowZoom(value: number) {
  if (!Number.isFinite(value)) return defaultFlowZoom;
  return Math.min(maxFlowZoom, Math.max(minFlowZoom, value));
}

function readStoredFlowZoom(experienceId: string) {
  if (typeof window === "undefined") return defaultFlowZoom;

  try {
    return clampFlowZoom(
      Number.parseFloat(window.localStorage.getItem(flowZoomStorageKey(experienceId)) ?? ""),
    );
  } catch {
    return defaultFlowZoom;
  }
}

function writeStoredFlowZoom(experienceId: string, value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      flowZoomStorageKey(experienceId),
      clampFlowZoom(value).toFixed(3),
    );
  } catch {
    // Ignore storage failures; wheel zoom still works for the current view.
  }
}

function readStoredFlowViewportPosition(
  experienceId: string,
): FlowViewportPosition {
  if (typeof window === "undefined") {
    return { scrollLeft: 0, scrollTop: 0 };
  }

  try {
    const stored = window.localStorage.getItem(
      flowViewportStorageKey(experienceId),
    );
    if (!stored) return { scrollLeft: 0, scrollTop: 0 };

    const parsed = JSON.parse(stored) as FlowViewportPosition;
    if (!parsed || typeof parsed !== "object") {
      return { scrollLeft: 0, scrollTop: 0 };
    }

    return {
      scrollLeft:
        typeof parsed.scrollLeft === "number" &&
        Number.isFinite(parsed.scrollLeft) &&
        parsed.scrollLeft > 0
          ? parsed.scrollLeft
          : 0,
      scrollTop:
        typeof parsed.scrollTop === "number" &&
        Number.isFinite(parsed.scrollTop) &&
        parsed.scrollTop > 0
          ? parsed.scrollTop
          : 0,
    };
  } catch {
    return { scrollLeft: 0, scrollTop: 0 };
  }
}

function writeStoredFlowViewportPosition(
  experienceId: string,
  position: FlowViewportPosition,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      flowViewportStorageKey(experienceId),
      JSON.stringify({
        scrollLeft: Math.max(0, position.scrollLeft),
        scrollTop: Math.max(0, position.scrollTop),
      }),
    );
  } catch {
    // Ignore storage failures; dragging the map still works for this view.
  }
}

function clampFlowSplitFraction(value: number, sectionWidth = 0) {
  if (!Number.isFinite(value)) return defaultFlowSplitFraction;

  const pixelMin = sectionWidth > 0 ? minFlowPaneWidthPx / sectionWidth : 0;
  const pixelMax =
    sectionWidth > 0 ? (sectionWidth - minInspectorWidthPx) / sectionWidth : 1;
  const min = Math.max(minFlowSplitFraction, Math.min(0.48, pixelMin));
  const max = Math.max(min, Math.min(maxFlowSplitFraction, pixelMax));

  return Math.min(max, Math.max(min, value));
}

function readStoredFlowSplitFraction() {
  if (typeof window === "undefined") return defaultFlowSplitFraction;

  try {
    const stored = window.localStorage.getItem(flowSplitStorageKey);
    return clampFlowSplitFraction(stored ? Number.parseFloat(stored) : NaN);
  } catch {
    return defaultFlowSplitFraction;
  }
}

function writeStoredFlowSplitFraction(value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      flowSplitStorageKey,
      clampFlowSplitFraction(value).toFixed(4),
    );
  } catch {
    // Ignore storage failures; the split still works for the current view.
  }
}

function readStoredFlowCollapsed() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(flowCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writeStoredFlowCollapsed(value: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(flowCollapsedStorageKey, value ? "true" : "false");
  } catch {
    // Ignore storage failures; the collapse state still works for this view.
  }
}

function clampDetailSplitFraction(value: number, sectionWidth = 0) {
  if (!Number.isFinite(value)) return defaultDetailSplitFraction;

  const pixelMin = sectionWidth > 0 ? minDetailPaneWidthPx / sectionWidth : 0;
  const pixelMax =
    sectionWidth > 0
      ? (sectionWidth - minFlowPaneWidthPx - minInspectorWithDetailWidthPx) /
        sectionWidth
      : 1;
  const min = Math.max(minDetailSplitFraction, Math.min(0.38, pixelMin));
  const max = Math.max(min, Math.min(maxDetailSplitFraction, pixelMax));

  return Math.min(max, Math.max(min, value));
}

function readStoredDetailSplitFraction() {
  if (typeof window === "undefined") return defaultDetailSplitFraction;

  try {
    const stored = window.localStorage.getItem(detailSplitStorageKey);
    return clampDetailSplitFraction(stored ? Number.parseFloat(stored) : NaN);
  } catch {
    return defaultDetailSplitFraction;
  }
}

function writeStoredDetailSplitFraction(value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      detailSplitStorageKey,
      clampDetailSplitFraction(value).toFixed(4),
    );
  } catch {
    // Ignore storage failures; the split still works for the current view.
  }
}

function sortedEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function eventDescription(event: ExperienceEvent) {
  return event.description.trim();
}

function cleanRouteSource(source: string) {
  return source
    .replace(/^On entry:\s*/i, "")
    .replace(/^Action:\s*/i, "")
    .replace(/^FC route\s+([^:]+):\s*/i, "$1: ")
    .replace(/^Check\s+([^:]+):\s*/i, "$1: ")
    .replace(/^Classifiers\s+([^:]+):\s*/i, "$1: ")
    .trim();
}

function meaningfulCondition(condition = "") {
  const normalized = condition.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "shown after entry" ||
    normalized === "function called" ||
    normalized === "check matched" ||
    normalized === "classifier matched"
  ) {
    return "";
  }

  return condition.trim();
}

function routeCauseLabel(link: EventOutgoingLink) {
  const source = cleanRouteSource(link.source);
  const condition = meaningfulCondition(link.condition);
  let label = "";

  if (link.kind === "Choice") {
    label = source && source !== "Conversation choice" ? `Choice: ${source}` : "Choice";
  } else if (link.kind === "FC route") {
    label = source ? `Function: ${source}` : "Function call";
  } else if (link.kind === "Check") {
    label = source ? `Check: ${source}` : "Check matched";
  } else if (link.kind === "Classifiers") {
    label = source ? `Classifier: ${source}` : "Classifier matched";
  } else if (link.kind === "App submit" || link.kind === "App update submit") {
    label = source ? `Submit: ${source}` : "App submit";
  } else if (condition || source) {
    label = source || link.kind;
  }

  if (!label && !condition) return "";
  return condition ? `${label || "Route"} · if ${condition}` : label;
}

function routeLabel(links: EventOutgoingLink[]) {
  const labels = links.map(routeCauseLabel).filter(Boolean);
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  return `${labels[0]} + ${labels.length - 1}`;
}

function resolvedRoutesForEvent(
  events: ExperienceEvent[],
  event: ExperienceEvent,
) {
  const routesByTargetId = new Map<string, FlowRoute>();

  for (const link of eventOutgoingLinks(event)) {
    if (isDynamicRouteTarget(link.slug)) continue;

    const target = eventTargetForRoute(events, link.slug);
    if (!target) continue;

    const existing = routesByTargetId.get(target.id);
    if (existing) {
      existing.links.push(link);
    } else {
      routesByTargetId.set(target.id, {
        links: [link],
        target,
      });
    }
  }

  return [...routesByTargetId.values()].sort(
    (left, right) =>
      left.target.sortOrder - right.target.sortOrder ||
      left.target.createdAt.localeCompare(right.target.createdAt),
  );
}

function reachableEventIds(events: ExperienceEvent[]) {
  const start = events.find((event) => event.isStart) ?? events[0] ?? null;
  const reachable = new Set<string>();
  const stack = start ? [start] : [];

  while (stack.length) {
    const event = stack.pop();
    if (!event || reachable.has(event.id)) continue;

    reachable.add(event.id);
    resolvedRoutesForEvent(events, event).forEach((route) => {
      if (!reachable.has(route.target.id)) stack.push(route.target);
    });
  }

  return reachable;
}

function chunkItems<T>(items: T[], rowSize: number) {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += rowSize) {
    rows.push(items.slice(index, index + rowSize));
  }

  return rows;
}

function flowNodeClassName({
  event,
  events,
  isDisconnected = false,
  isReference = false,
  isSelected = false,
}: {
  event: ExperienceEvent;
  events: ExperienceEvent[];
  isDisconnected?: boolean;
  isReference?: boolean;
  isSelected?: boolean;
}) {
  const routes = resolvedRoutesForEvent(events, event);
  const classes = ["next-flow-card"];

  if (event.isStart) classes.push("is-start");
  else if (isDisconnected) classes.push("is-disconnected");
  else if (!routes.length) classes.push("is-dead-end");

  if (isReference) classes.push("is-reference");
  if (isSelected) classes.push("is-selected");
  return classes.join(" ");
}

function EventFlowCard({
  event,
  events,
  isDisconnected = false,
  isReference = false,
  onOpenContextMenu,
  onSelectEvent,
  selectedEventId,
}: {
  event: ExperienceEvent;
  events: ExperienceEvent[];
  isDisconnected?: boolean;
  isReference?: boolean;
  onOpenContextMenu: (eventId: string, event: MouseEvent) => void;
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string;
}) {
  const isSelected = event.id === selectedEventId;
  const description = eventDescription(event);

  return (
    <button
      aria-pressed={isSelected}
      className={flowNodeClassName({
        event,
        events,
        isDisconnected,
        isReference,
        isSelected,
      })}
      onClick={() => onSelectEvent(event.id)}
      onContextMenu={(contextMenuEvent) =>
        onOpenContextMenu(event.id, contextMenuEvent)
      }
      type="button"
    >
      <h3>{event.title || event.slug || "Untitled event"}</h3>
      {description ? <p>{description}</p> : null}
    </button>
  );
}

function EventFlowBranch({
  events,
  onOpenContextMenu,
  onSelectEvent,
  route,
  selectedEventId,
  visitedEventIds,
}: {
  events: ExperienceEvent[];
  onOpenContextMenu: (eventId: string, event: MouseEvent) => void;
  onSelectEvent: (eventId: string) => void;
  route: FlowRoute;
  selectedEventId: string;
  visitedEventIds: Set<string>;
}) {
  const isReference = visitedEventIds.has(route.target.id);
  const label = routeLabel(route.links);

  return (
    <div className="next-flow-branch">
      {label ? <span className="next-flow-branch-cause">{label}</span> : null}
      {isReference ? (
        <EventFlowCard
          event={route.target}
          events={events}
          isReference
          onOpenContextMenu={onOpenContextMenu}
          onSelectEvent={onSelectEvent}
          selectedEventId={selectedEventId}
        />
      ) : (
        <EventFlowPath
          events={events}
          event={route.target}
          onOpenContextMenu={onOpenContextMenu}
          onSelectEvent={onSelectEvent}
          selectedEventId={selectedEventId}
          visitedEventIds={visitedEventIds}
        />
      )}
    </div>
  );
}

function EventFlowPath({
  events,
  event,
  onOpenContextMenu,
  onSelectEvent,
  selectedEventId,
  visitedEventIds,
}: {
  events: ExperienceEvent[];
  event: ExperienceEvent;
  onOpenContextMenu: (eventId: string, event: MouseEvent) => void;
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string;
  visitedEventIds: Set<string>;
}) {
  const localVisited = new Set(visitedEventIds);
  const linearEvents: ExperienceEvent[] = [];
  let currentEvent: ExperienceEvent | null = event;
  let nextRoutes: FlowRoute[] = [];

  while (currentEvent && !localVisited.has(currentEvent.id)) {
    linearEvents.push(currentEvent);
    localVisited.add(currentEvent.id);
    nextRoutes = resolvedRoutesForEvent(events, currentEvent);

    if (nextRoutes.length !== 1) break;
    currentEvent = nextRoutes[0].target;
  }

  const branchRoutes = nextRoutes.length > 1 ? nextRoutes : [];
  const repeatedRoute = nextRoutes.length === 1 ? nextRoutes[0] : null;

  return (
    <div className="next-flow-path">
      <div className="next-flow-linear">
        {linearEvents.map((flowEvent) => (
          <EventFlowCard
            event={flowEvent}
            events={events}
            key={flowEvent.id}
            onOpenContextMenu={onOpenContextMenu}
            onSelectEvent={onSelectEvent}
            selectedEventId={selectedEventId}
          />
        ))}
        {repeatedRoute && localVisited.has(repeatedRoute.target.id) ? (
          <EventFlowCard
            event={repeatedRoute.target}
            events={events}
            isReference
            onOpenContextMenu={onOpenContextMenu}
            onSelectEvent={onSelectEvent}
            selectedEventId={selectedEventId}
          />
        ) : null}
      </div>
      {branchRoutes.length ? (
        <div
          className="next-flow-branches"
          style={{ ["--flow-branch-count" as string]: branchRoutes.length }}
        >
          {branchRoutes.map((route) => (
            <EventFlowBranch
              events={events}
              key={`${linearEvents.at(-1)?.id}-${route.target.id}-${route.links
                .map((link) => link.sourceItemId || link.source || link.kind)
                .join("-")}`}
              onOpenContextMenu={onOpenContextMenu}
              onSelectEvent={onSelectEvent}
              route={route}
              selectedEventId={selectedEventId}
              visitedEventIds={localVisited}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExperienceEventFlow({
  detailPanel,
  events,
  experienceId,
  inspector,
  isCreatingEvent,
  onCreateEvent,
  onDeleteEvent,
  onSelectEvent,
  selectedEventId,
}: {
  detailPanel?: ReactNode;
  events: ExperienceEvent[];
  experienceId: string;
  inspector?: ReactNode;
  isCreatingEvent: boolean;
  onCreateEvent: () => void;
  onDeleteEvent: (eventId: string) => void;
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string;
}) {
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const flowViewportRef = useRef<HTMLDivElement | null>(null);
  const flowSectionRef = useRef<HTMLElement | null>(null);
  const detailResizeDragRef = useRef<DetailResizeDragState | null>(null);
  const paneResizeDragRef = useRef<PaneResizeDragState | null>(null);
  const viewportDragRef = useRef<ViewportDragState | null>(null);
  const viewportWriteFrameRef = useRef<number | null>(null);
  const [detailSplitFraction, setDetailSplitFraction] = useState(
    readStoredDetailSplitFraction,
  );
  const [flowSplitFraction, setFlowSplitFraction] = useState(
    readStoredFlowSplitFraction,
  );
  const [flowZoom, setFlowZoom] = useState(() => readStoredFlowZoom(experienceId));
  const [flowCanvasSize, setFlowCanvasSize] = useState<FlowCanvasSize>({
    height: 0,
    width: 0,
  });
  const [isFlowCollapsed, setIsFlowCollapsed] = useState(
    readStoredFlowCollapsed,
  );
  const [eventContextMenu, setEventContextMenu] =
    useState<EventContextMenuState | null>(null);
  const [isDetailResizing, setIsDetailResizing] = useState(false);
  const [isPaneResizing, setIsPaneResizing] = useState(false);
  const isResizing = isPaneResizing || isDetailResizing;
  const orderedEvents = sortedEvents(events);
  const startEvent =
    orderedEvents.find((event) => event.isStart) ?? orderedEvents[0] ?? null;
  const reachable = reachableEventIds(orderedEvents);
  const disconnectedEvents = orderedEvents.filter(
    (event) => !reachable.has(event.id),
  );
  const disconnectedEventRows = chunkItems(disconnectedEvents, 3);
  const hasInspector = Boolean(inspector);
  const isEffectiveFlowCollapsed = hasInspector && isFlowCollapsed;

  useEffect(() => {
    const viewport = flowViewportRef.current;
    if (!viewport) return;

    const position = readStoredFlowViewportPosition(experienceId);
    viewport.scrollLeft = position.scrollLeft;
    viewport.scrollTop = position.scrollTop;
    setFlowZoom(readStoredFlowZoom(experienceId));
  }, [experienceId]);

  useEffect(() => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return undefined;

    function updateCanvasSize() {
      const rect = canvas.getBoundingClientRect();
      setFlowCanvasSize({
        height: canvas.offsetHeight || rect.height,
        width: canvas.offsetWidth || rect.width,
      });
    }

    updateCanvasSize();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [orderedEvents.length, disconnectedEvents.length, selectedEventId]);

  useEffect(
    () => () => {
      if (viewportWriteFrameRef.current === null) return;

      window.cancelAnimationFrame(viewportWriteFrameRef.current);
      viewportWriteFrameRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!hasInspector && isFlowCollapsed) {
      setIsFlowCollapsed(false);
      writeStoredFlowCollapsed(false);
    }
  }, [hasInspector, isFlowCollapsed]);

  useEffect(() => {
    if (!eventContextMenu) return;

    function closeEventContextMenu(event: Event) {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") {
        return;
      }

      setEventContextMenu(null);
    }

    document.addEventListener("pointerdown", closeEventContextMenu);
    document.addEventListener("keydown", closeEventContextMenu);
    return () => {
      document.removeEventListener("pointerdown", closeEventContextMenu);
      document.removeEventListener("keydown", closeEventContextMenu);
    };
  }, [eventContextMenu]);

  function writeCurrentViewportPosition() {
    const viewport = flowViewportRef.current;
    if (!viewport) return;

    writeStoredFlowViewportPosition(experienceId, {
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
  }

  function scheduleViewportPositionSave() {
    if (viewportWriteFrameRef.current !== null) return;

    viewportWriteFrameRef.current = window.requestAnimationFrame(() => {
      viewportWriteFrameRef.current = null;
      writeCurrentViewportPosition();
    });
  }

  function startViewportDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea")) return;

    const viewport = flowViewportRef.current;
    if (!viewport) return;

    viewportDragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.dataset.dragging = "true";
    viewport.setPointerCapture(event.pointerId);
  }

  function dragViewport(event: PointerEvent<HTMLDivElement>) {
    const drag = viewportDragRef.current;
    const viewport = flowViewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.clientY);
  }

  function stopViewportDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = viewportDragRef.current;
    const viewport = flowViewportRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    if (viewport) delete viewport.dataset.dragging;
    writeCurrentViewportPosition();
    viewportDragRef.current = null;
  }

  function zoomFlowViewport(event: WheelEvent<HTMLDivElement>) {
    const viewport = flowViewportRef.current;
    if (!viewport) return;

    event.preventDefault();

    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const nextZoom = clampFlowZoom(flowZoom * Math.exp(-event.deltaY * 0.0014));

    if (nextZoom === flowZoom) return;

    const contentX = (viewport.scrollLeft + pointerX) / flowZoom;
    const contentY = (viewport.scrollTop + pointerY) / flowZoom;

    setFlowZoom(nextZoom);
    writeStoredFlowZoom(experienceId, nextZoom);

    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, contentX * nextZoom - pointerX);
      viewport.scrollTop = Math.max(0, contentY * nextZoom - pointerY);
      scheduleViewportPositionSave();
    });
  }

  function updateFlowSplitFraction(nextFraction: number, sectionWidth = 0) {
    const next = clampFlowSplitFraction(nextFraction, sectionWidth);
    setFlowSplitFraction(next);
    return next;
  }

  function startPaneResize(event: PointerEvent<HTMLDivElement>) {
    if (isEffectiveFlowCollapsed) return;
    if (event.button !== 0) return;

    const section = flowSectionRef.current;
    if (!section) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = section.getBoundingClientRect();
    const nextFraction = clampFlowSplitFraction(
      (event.clientX - rect.left) / rect.width,
      rect.width,
    );

    paneResizeDragRef.current = {
      latestFraction: nextFraction,
      pointerId: event.pointerId,
      sectionLeft: rect.left,
      sectionWidth: rect.width,
    };
    setIsPaneResizing(true);
    updateFlowSplitFraction(nextFraction, rect.width);
    writeStoredFlowSplitFraction(nextFraction);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragPaneResize(event: PointerEvent<HTMLDivElement>) {
    const drag = paneResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const nextFraction = updateFlowSplitFraction(
      (event.clientX - drag.sectionLeft) / drag.sectionWidth,
      drag.sectionWidth,
    );
    drag.latestFraction = nextFraction;
    writeStoredFlowSplitFraction(nextFraction);
  }

  function stopPaneResize(event: PointerEvent<HTMLDivElement>) {
    const drag = paneResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    writeStoredFlowSplitFraction(drag.latestFraction);
    paneResizeDragRef.current = null;
    setIsPaneResizing(false);
  }

  function nudgePaneSize(delta: number) {
    const sectionWidth = flowSectionRef.current?.getBoundingClientRect().width ?? 0;
    setFlowSplitFraction((current) => {
      const next = clampFlowSplitFraction(current + delta, sectionWidth);
      writeStoredFlowSplitFraction(next);
      return next;
    });
  }

  function updateDetailSplitFraction(nextFraction: number, sectionWidth = 0) {
    const next = clampDetailSplitFraction(nextFraction, sectionWidth);
    setDetailSplitFraction(next);
    return next;
  }

  function startDetailResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const section = flowSectionRef.current;
    if (!section) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = section.getBoundingClientRect();
    const nextFraction = clampDetailSplitFraction(
      (rect.right - event.clientX) / rect.width,
      rect.width,
    );

    detailResizeDragRef.current = {
      latestFraction: nextFraction,
      pointerId: event.pointerId,
      sectionRight: rect.right,
      sectionWidth: rect.width,
    };
    setIsDetailResizing(true);
    updateDetailSplitFraction(nextFraction, rect.width);
    writeStoredDetailSplitFraction(nextFraction);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragDetailResize(event: PointerEvent<HTMLDivElement>) {
    const drag = detailResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const nextFraction = updateDetailSplitFraction(
      (drag.sectionRight - event.clientX) / drag.sectionWidth,
      drag.sectionWidth,
    );
    drag.latestFraction = nextFraction;
    writeStoredDetailSplitFraction(nextFraction);
  }

  function stopDetailResize(event: PointerEvent<HTMLDivElement>) {
    const drag = detailResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    writeStoredDetailSplitFraction(drag.latestFraction);
    detailResizeDragRef.current = null;
    setIsDetailResizing(false);
  }

  function nudgeDetailSize(delta: number) {
    const sectionWidth = flowSectionRef.current?.getBoundingClientRect().width ?? 0;
    setDetailSplitFraction((current) => {
      const next = clampDetailSplitFraction(current + delta, sectionWidth);
      writeStoredDetailSplitFraction(next);
      return next;
    });
  }

  function handlePaneResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEffectiveFlowCollapsed) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgePaneSize(event.shiftKey ? -0.06 : -0.025);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgePaneSize(event.shiftKey ? 0.06 : 0.025);
    } else if (event.key === "Home") {
      event.preventDefault();
      const sectionWidth =
        flowSectionRef.current?.getBoundingClientRect().width ?? 0;
      const next = clampFlowSplitFraction(minFlowSplitFraction, sectionWidth);
      setFlowSplitFraction(next);
      writeStoredFlowSplitFraction(next);
    } else if (event.key === "End") {
      event.preventDefault();
      const sectionWidth =
        flowSectionRef.current?.getBoundingClientRect().width ?? 0;
      const next = clampFlowSplitFraction(maxFlowSplitFraction, sectionWidth);
      setFlowSplitFraction(next);
      writeStoredFlowSplitFraction(next);
    }
  }

  function toggleFlowCollapsed() {
    setIsFlowCollapsed((current) => {
      const next = !current;
      writeStoredFlowCollapsed(next);
      return next;
    });
  }

  function openEventContextMenu(eventId: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setEventContextMenu({
      eventId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function deleteContextEvent() {
    if (!eventContextMenu) return;

    onDeleteEvent(eventContextMenu.eventId);
    setEventContextMenu(null);
  }

  function handleDetailResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeDetailSize(event.shiftKey ? 0.06 : 0.025);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeDetailSize(event.shiftKey ? -0.06 : -0.025);
    } else if (event.key === "Home") {
      event.preventDefault();
      const sectionWidth =
        flowSectionRef.current?.getBoundingClientRect().width ?? 0;
      const next = clampDetailSplitFraction(maxDetailSplitFraction, sectionWidth);
      setDetailSplitFraction(next);
      writeStoredDetailSplitFraction(next);
    } else if (event.key === "End") {
      event.preventDefault();
      const sectionWidth =
        flowSectionRef.current?.getBoundingClientRect().width ?? 0;
      const next = clampDetailSplitFraction(minDetailSplitFraction, sectionWidth);
      setDetailSplitFraction(next);
      writeStoredDetailSplitFraction(next);
    }
  }

  const sectionStyle = inspector
    ? ({
        "--next-flow-left-width": `${flowSplitFraction * 100}%`,
        "--next-flow-detail-width": `${detailSplitFraction * 100}%`,
      } as CSSProperties)
    : undefined;
  const canvasSpaceStyle = {
    "--next-flow-zoom": flowZoom,
    height: flowCanvasSize.height
      ? `${Math.ceil(flowCanvasSize.height * flowZoom)}px`
      : undefined,
    width: flowCanvasSize.width
      ? `${Math.ceil(flowCanvasSize.width * flowZoom)}px`
      : undefined,
  } as CSSProperties;

  return (
    <section
      aria-label="Event flow"
      className="next-flow-section"
      data-flow-collapsed={isEffectiveFlowCollapsed ? "true" : "false"}
      data-has-detail-panel={detailPanel ? "true" : "false"}
      data-has-inspector={hasInspector ? "true" : "false"}
      data-resizing={isResizing ? "true" : "false"}
      ref={flowSectionRef}
      style={sectionStyle}
    >
      <div className="next-flow-pane">
        <div className="next-flow-toolbar">
          <button
            aria-label={isCreatingEvent ? "Creating event" : "Create event"}
            className="next-flow-create-button"
            disabled={isCreatingEvent}
            onClick={onCreateEvent}
            title={isCreatingEvent ? "Creating event" : "Create event"}
            type="button"
          >
            <PlusIcon />
          </button>
          <h2>Events</h2>
        </div>

        <div
          className="next-flow-viewport"
          onLostPointerCapture={(event) => stopViewportDrag(event)}
          onPointerCancel={(event) => stopViewportDrag(event)}
          onPointerDown={startViewportDrag}
          onPointerMove={dragViewport}
          onPointerUp={(event) => stopViewportDrag(event)}
          onScroll={scheduleViewportPositionSave}
          onWheel={zoomFlowViewport}
          ref={flowViewportRef}
        >
          <div className="next-flow-canvas-space" style={canvasSpaceStyle}>
            <div className="next-flow-canvas" ref={flowCanvasRef}>
              {startEvent ? (
                <EventFlowPath
                  event={startEvent}
                  events={orderedEvents}
                  onOpenContextMenu={openEventContextMenu}
                  onSelectEvent={onSelectEvent}
                  selectedEventId={selectedEventId}
                  visitedEventIds={new Set()}
                />
              ) : (
                <div className="next-flow-empty">No events yet.</div>
              )}

              {disconnectedEvents.length ? (
                <div className="next-flow-disconnected" aria-label="Not connected">
                  <span>Not connected</span>
                  <div>
                    {disconnectedEventRows.map((row, rowIndex) => (
                      <div className="next-flow-disconnected-row" key={rowIndex}>
                        {row.map((event) => (
                          <EventFlowCard
                            event={event}
                            events={orderedEvents}
                            isDisconnected
                            key={event.id}
                            onOpenContextMenu={openEventContextMenu}
                            onSelectEvent={onSelectEvent}
                            selectedEventId={selectedEventId}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {inspector ? (
        <>
          <div
            aria-label="Resize event panel"
            aria-orientation="vertical"
            aria-valuemax={Math.round(maxFlowSplitFraction * 100)}
            aria-valuemin={Math.round(minFlowSplitFraction * 100)}
            aria-valuenow={Math.round(flowSplitFraction * 100)}
            className="next-flow-resizer"
            onKeyDown={handlePaneResizeKeyDown}
            onLostPointerCapture={(event) => stopPaneResize(event)}
            onPointerCancel={(event) => stopPaneResize(event)}
            onPointerDown={startPaneResize}
            onPointerMove={dragPaneResize}
            onPointerUp={(event) => stopPaneResize(event)}
            role="separator"
            tabIndex={0}
          >
            <button
              aria-expanded={!isEffectiveFlowCollapsed}
              aria-label={
                isEffectiveFlowCollapsed ? "Expand event map" : "Collapse event map"
              }
              className="next-flow-collapse-button"
              onClick={toggleFlowCollapsed}
              onPointerDown={(event) => event.stopPropagation()}
              title={
                isEffectiveFlowCollapsed ? "Expand event map" : "Collapse event map"
              }
              type="button"
            >
              {isEffectiveFlowCollapsed ? <PlusIcon /> : <MinusIcon />}
            </button>
          </div>
          <aside className="next-event-inspector-slot">{inspector}</aside>
          {detailPanel ? (
            <>
              <div
                aria-label="Resize action detail panel"
                aria-orientation="vertical"
                aria-valuemax={Math.round(maxDetailSplitFraction * 100)}
                aria-valuemin={Math.round(minDetailSplitFraction * 100)}
                aria-valuenow={Math.round(detailSplitFraction * 100)}
                className="next-flow-resizer next-flow-detail-resizer"
                onKeyDown={handleDetailResizeKeyDown}
                onLostPointerCapture={(event) => stopDetailResize(event)}
                onPointerCancel={(event) => stopDetailResize(event)}
                onPointerDown={startDetailResize}
                onPointerMove={dragDetailResize}
                onPointerUp={(event) => stopDetailResize(event)}
                role="separator"
                tabIndex={0}
              />
              <aside className="next-event-detail-slot">{detailPanel}</aside>
            </>
          ) : null}
        </>
      ) : null}
      {eventContextMenu ? (
        <div
          aria-label="Event menu"
          className="next-flow-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: eventContextMenu.x, top: eventContextMenu.y }}
        >
          <button onClick={deleteContextEvent} type="button">
            Delete event
          </button>
        </div>
      ) : null}
    </section>
  );
}
