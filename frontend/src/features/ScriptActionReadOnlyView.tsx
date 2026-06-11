import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { RefreshIcon } from "../components/Icons";
import type { ScriptMarkerInstance, ScriptSlidePreview } from "../scriptMarkers";
import {
  clamp,
  dropIndexForTextTarget,
  isSlideMarker,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import {
  sourceMarkerForView,
  viewMarkerEditKey,
  type ScriptActionRow,
  type ScriptActionViewMarker,
} from "./scriptActionProjection";
import { normalizeDisplayBreaks } from "./scriptAudioDisplayUtils";

type ScriptInsertionPreview = {
  height: number;
  insertionIndex: number;
  x: number;
  y: number;
};

type ScriptActionReadOnlyViewProps = {
  actionRows: ScriptActionRow[];
  canRefreshSlides: boolean;
  deckUrl: string;
  displayBreaks: number[];
  isRefreshingSlides: boolean;
  markers: ScriptActionViewMarker[];
  onDeckUrlChange: (value: string) => void;
  onOpenInsert: (
    insertionIndex: number,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onOpenMarker: (
    marker: ScriptMarkerInstance,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onMoveMarker: (
    marker: ScriptActionViewMarker,
    targetSourceIndex: number,
  ) => string | null;
  onRefreshSlides: () => void;
  onRemoveMarker: (marker: ScriptMarkerInstance) => void;
  previews: Record<string, ScriptSlidePreview>;
  sourceIndexByTextIndex: number[];
  text: string;
};

function markerStyleType(marker: ScriptMarkerInstance) {
  return isSlideMarker(marker) ? "slide" : "action";
}

function deckUrlForNewTab(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function ScriptActionReadOnlyView({
  actionRows,
  canRefreshSlides,
  deckUrl,
  displayBreaks,
  isRefreshingSlides,
  markers,
  onDeckUrlChange,
  onOpenInsert,
  onOpenMarker,
  onMoveMarker,
  onRefreshSlides,
  onRemoveMarker,
  previews,
  sourceIndexByTextIndex,
  text,
}: ScriptActionReadOnlyViewProps) {
  const [insertionPreview, setInsertionPreview] =
    useState<ScriptInsertionPreview | null>(null);
  const [pendingFocusMarkerKey, setPendingFocusMarkerKey] = useState("");
  const [selectedMarkerKey, setSelectedMarkerKey] = useState("");
  const pendingFocusMarkerRef = useRef<HTMLButtonElement | null>(null);
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(displayBreaks).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  let wordIndex = 0;

  useEffect(() => {
    setInsertionPreview(null);
  }, [text]);

  useEffect(() => {
    setSelectedMarkerKey((current) =>
      current && markers.some((marker) => viewMarkerEditKey(marker) === current)
        ? current
        : "",
    );
  }, [markers]);

  useLayoutEffect(() => {
    if (!pendingFocusMarkerKey || selectedMarkerKey !== pendingFocusMarkerKey) {
      return;
    }

    pendingFocusMarkerRef.current?.focus({ preventScroll: true });
    setPendingFocusMarkerKey("");
  }, [markers, pendingFocusMarkerKey, selectedMarkerKey]);

  function elementFromEventTarget(target: EventTarget | null) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Text) return target.parentElement;
    return null;
  }

  function closestClientRectToPointer(
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ) {
    const rects = Array.from(element.getClientRects()).filter(
      (rect) => rect.width > 0 || rect.height > 0,
    );
    if (!rects.length) return element.getBoundingClientRect();

    return rects.reduce((closestRect, rect) => {
      const closestX = clamp(clientX, rect.left, rect.right);
      const closestY = clamp(clientY, rect.top, rect.bottom);
      const currentDistance =
        (clientX - closestX) ** 2 + (clientY - closestY) ** 2;
      const bestX = clamp(clientX, closestRect.left, closestRect.right);
      const bestY = clamp(clientY, closestRect.top, closestRect.bottom);
      const bestDistance = (clientX - bestX) ** 2 + (clientY - bestY) ** 2;
      return currentDistance < bestDistance ? rect : closestRect;
    }, rects[0]);
  }

  function previewForScriptPointer(event: ReactMouseEvent<HTMLElement>) {
    const target = elementFromEventTarget(event.target);
    if (!target || target.closest(".next-script-action-token")) return null;

    const insertRegion = target.closest<HTMLElement>("[data-default-insert]");
    const defaultInsertionIndex = Number(insertRegion?.dataset.defaultInsert);
    const defaultStartInsertionIndex = Number(
      insertRegion?.dataset.defaultInsertStart,
    );
    const insertTarget = target.closest<HTMLElement>("[data-insert-before]");

    if (!insertTarget) {
      const region = insertRegion ?? event.currentTarget;
      const rect = region.getBoundingClientRect();
      const styles = window.getComputedStyle(event.currentTarget);
      const lineHeight =
        Number.parseFloat(styles.lineHeight) ||
        Number.parseFloat(styles.fontSize) * 1.75 ||
        22;
      const firstInsertTarget =
        region.querySelector<HTMLElement>("[data-insert-before]");
      const firstInsertRect = firstInsertTarget
        ? closestClientRectToPointer(
            firstInsertTarget,
            event.clientX,
            event.clientY,
          )
        : null;
      const firstTargetInsertionIndex = Number(
        firstInsertTarget?.dataset.insertBefore,
      );
      const isAtOrAboveFirstLine =
        firstInsertRect !== null &&
        event.clientY <= firstInsertRect.bottom + lineHeight * 0.35;
      const insertionIndex =
        isAtOrAboveFirstLine &&
        Number.isFinite(defaultStartInsertionIndex)
          ? defaultStartInsertionIndex
          : isAtOrAboveFirstLine && Number.isFinite(firstTargetInsertionIndex)
            ? firstTargetInsertionIndex
            : Number.isFinite(defaultInsertionIndex)
              ? defaultInsertionIndex
              : text.length;

      return {
        height: Math.max(16, lineHeight - 3),
        insertionIndex,
        x: Math.round(clamp(event.clientX, rect.left + 12, rect.right - 12)),
        y: Math.round(
          clamp(
            event.clientY - lineHeight / 2,
            rect.top + 8,
            Math.max(rect.top + 8, rect.bottom - lineHeight - 8),
          ),
        ),
      };
    }

    const beforeIndex = Number(insertTarget.dataset.insertBefore);
    const afterIndex = Number(insertTarget.dataset.insertAfter);
    const safeBeforeIndex = Number.isFinite(beforeIndex) ? beforeIndex : 0;
    const safeAfterIndex = Number.isFinite(afterIndex) ? afterIndex : text.length;
    const insertionIndex = dropIndexForTextTarget(
      insertTarget,
      safeBeforeIndex,
      safeAfterIndex,
      event.clientX,
    );
    const rect = closestClientRectToPointer(
      insertTarget,
      event.clientX,
      event.clientY,
    );
    const ratio = insertionIndex <= safeBeforeIndex ? 0 : 1;

    return {
      height: Math.max(16, rect.height - 3),
      insertionIndex,
      x: Math.round(rect.left + ratio * rect.width),
      y: Math.round(rect.top + 1),
    };
  }

  function sourceIndexForTextIndex(index: number) {
    return (
      sourceIndexByTextIndex[index] ??
      sourceIndexByTextIndex[sourceIndexByTextIndex.length - 1] ??
      0
    );
  }

  function textTokenRangesOutsideMarkers() {
    const ranges: Array<{ end: number; start: number }> = [];
    const wordPattern = /\S+/g;
    let cursor = 0;

    [...markers]
      .sort((left, right) => left.start - right.start)
      .forEach((marker) => {
        if (marker.start > cursor) {
          const segment = text.slice(cursor, marker.start);
          wordPattern.lastIndex = 0;
          for (const match of segment.matchAll(wordPattern)) {
            const start = cursor + (match.index ?? 0);
            ranges.push({
              end: start + match[0].length,
              start,
            });
          }
        }
        cursor = Math.max(cursor, marker.end);
      });

    if (cursor < text.length) {
      const segment = text.slice(cursor);
      wordPattern.lastIndex = 0;
      for (const match of segment.matchAll(wordPattern)) {
        const start = cursor + (match.index ?? 0);
        ranges.push({
          end: start + match[0].length,
          start,
        });
      }
    }

    return ranges;
  }

  function sourceIndexForMarkerNudge(
    marker: ScriptActionViewMarker,
    direction: -1 | 1,
  ) {
    const tokenRanges = textTokenRangesOutsideMarkers();
    const targetTextIndex =
      direction < 0
        ? tokenRanges
            .filter((range) => range.end <= marker.start)
            .at(-1)?.start
        : tokenRanges.find((range) => range.start >= marker.end)?.end;

    if (targetTextIndex === undefined) return null;
    return sourceIndexForTextIndex(targetTextIndex);
  }

  function renderActionToken(marker: ScriptActionViewMarker) {
    const sourceMarker = sourceMarkerForView(marker);
    const markerKey = viewMarkerEditKey(marker);
    return (
      <button
        className={[
          "next-script-action-token",
          markerStyleType(marker) === "slide" ? "is-slide" : "is-action",
          selectedMarkerKey === markerKey ? "is-selected" : "",
        ].join(" ")}
        key={markerKey}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelectedMarkerKey(markerKey);
          onOpenMarker(sourceMarker, event);
        }}
        onContextMenu={(event) => {
          setSelectedMarkerKey(markerKey);
          onOpenMarker(sourceMarker, event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onRemoveMarker(sourceMarker);
            return;
          }

          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

          const targetSourceIndex = sourceIndexForMarkerNudge(
            marker,
            event.key === "ArrowLeft" ? -1 : 1,
          );
          if (targetSourceIndex === null) return;

          event.preventDefault();
          event.stopPropagation();
          const nextMarkerKey = onMoveMarker(marker, targetSourceIndex);
          if (nextMarkerKey) {
            setSelectedMarkerKey(nextMarkerKey);
            setPendingFocusMarkerKey(nextMarkerKey);
          }
        }}
        ref={
          pendingFocusMarkerKey === markerKey ? pendingFocusMarkerRef : undefined
        }
        title={sourceMarker.marker}
        type="button"
      >
        {isSlideMarker(marker)
          ? `Slide ${marker.argList[0]?.trim() || "1"}`
          : marker.label}
      </button>
    );
  }

  function appendTextSegment(
    nodes: Array<JSX.Element | string>,
    segment: string,
    offset: number,
    keyPrefix: string,
  ) {
    const pieces = segment.match(/\s+|\S+/g) ?? [];
    let pieceOffset = 0;
    pieces.forEach((piece, index) => {
      const pieceStart = offset + pieceOffset;
      pieceOffset += piece.length;

      if (/^\s+$/.test(piece)) {
        if (piece.includes("\n")) {
          let whitespaceOffset = 0;
          piece.split(/(\n+)/).forEach((part, partIndex) => {
            if (!part) return;
            const partStart = pieceStart + whitespaceOffset;
            whitespaceOffset += part.length;

            if (!part.includes("\n")) {
              nodes.push(
                <span
                  className="next-script-view-space"
                  data-insert-after={sourceIndexForTextIndex(
                    partStart + part.length,
                  )}
                  data-insert-before={sourceIndexForTextIndex(partStart)}
                  key={`${keyPrefix}-space-${index}-${partIndex}-${partStart}`}
                >
                  {part}
                </span>,
              );
              return;
            }

            const insertIndex = sourceIndexForTextIndex(partStart + part.length);
            nodes.push(
              <span
                aria-label={part.length > 1 ? "Page break" : "Line break"}
                className={
                  part.length > 1
                    ? "next-script-view-page-break"
                    : "next-script-view-line-break"
                }
                data-insert-after={insertIndex}
                data-insert-before={insertIndex}
                key={`${keyPrefix}-breakspace-${index}-${partIndex}-${partStart}`}
              />,
            );
          });
          return;
        }

        nodes.push(
          <span
            className="next-script-view-space"
            data-insert-after={sourceIndexForTextIndex(
              pieceStart + piece.length,
            )}
            data-insert-before={sourceIndexForTextIndex(pieceStart)}
            key={`${keyPrefix}-space-${index}-${pieceStart}`}
          >
            {piece}
          </span>,
        );
        return;
      }

      const beforeIndex = pieceStart;
      const afterIndex = pieceStart + piece.length;
      nodes.push(
        <span
          className="next-script-view-word"
          data-insert-after={sourceIndexForTextIndex(afterIndex)}
          data-insert-before={sourceIndexForTextIndex(beforeIndex)}
          key={`${keyPrefix}-word-${index}-${beforeIndex}`}
        >
          {piece}
        </span>,
      );

      const lineBreakCount = breakCounts.get(wordIndex) ?? 0;
      for (let breakIndex = 0; breakIndex < lineBreakCount; breakIndex += 1) {
        nodes.push(
          <br key={`${keyPrefix}-break-${index}-${breakIndex}-${beforeIndex}`} />,
        );
      }
      wordIndex += 1;
    });
  }

  function renderSegmentNodes(
    textStart: number,
    textEnd: number,
    keyPrefix: string,
  ) {
    const nodes: Array<JSX.Element | string> = [];
    let cursor = textStart;
    markers
      .filter(
        (marker) =>
          !isSlideMarker(marker) &&
          marker.start >= textStart &&
          marker.end <= textEnd,
      )
      .forEach((marker, index) => {
        if (marker.start > cursor) {
          appendTextSegment(
            nodes,
            text.slice(cursor, marker.start),
            cursor,
            `${keyPrefix}-text-${index}`,
          );
        }
        nodes.push(renderActionToken(marker));
        cursor = marker.end;
      });

    if (cursor < textEnd) {
      appendTextSegment(
        nodes,
        text.slice(cursor, textEnd),
        cursor,
        `${keyPrefix}-tail`,
      );
    }

    return nodes;
  }

  function handleScriptContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const preview = previewForScriptPointer(event);
    if (!preview) return;
    event.preventDefault();
    onOpenInsert(preview.insertionIndex, event);
    setInsertionPreview(preview);
  }

  function handleScriptMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const preview = previewForScriptPointer(event);
    setInsertionPreview((current) => {
      if (
        current &&
        preview &&
        current.insertionIndex === preview.insertionIndex &&
        current.x === preview.x &&
        current.y === preview.y &&
        current.height === preview.height
      ) {
        return current;
      }
      return preview;
    });
  }

  return (
    <div className="next-script-view">
      <div className="next-script-slides-link-row">
        <input
          aria-label="Slides link"
          onChange={(event) => onDeckUrlChange(event.target.value)}
          onMouseDown={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;

            const url = deckUrlForNewTab(deckUrl);
            if (!url) return;

            event.preventDefault();
            event.stopPropagation();
            const link = document.createElement("a");
            link.href = url;
            link.rel = "noopener noreferrer";
            link.target = "_blank";
            document.body.append(link);
            link.click();
            link.remove();
          }}
          placeholder="Slides link"
          spellCheck={false}
          title="Ctrl-click to open slides"
          type="url"
          value={deckUrl}
        />
        <button
          aria-label="Refresh slide previews"
          disabled={!canRefreshSlides || isRefreshingSlides}
          onClick={onRefreshSlides}
          title={
            canRefreshSlides
              ? "Refresh slide previews from the deck"
              : "Add a slides link and slide action first"
          }
          type="button"
        >
          <RefreshIcon />
        </button>
      </div>
      <div
        aria-label="Slides and actions"
        className="next-script-slide-flow"
        role="table"
      >
        {actionRows.length ? (
          actionRows.map((row, rowIndex) => {
            const rowNodes = renderSegmentNodes(
              row.textStart,
              row.textEnd,
              row.key,
            );
            const previewKey = row.slideRef
              ? slidePreviewKeyForDeck(deckUrl, row.slideRef)
              : "";
            const preview = previewKey ? previews[previewKey] : null;

            return (
              <div
                className={[
                  "next-script-slide-row",
                  row.marker ? "has-slide" : "has-no-slide",
                ].join(" ")}
                key={row.key}
                role="row"
              >
                <div
                  className="next-script-slide-script"
                  data-default-insert={sourceIndexForTextIndex(row.textEnd)}
                  data-default-insert-start={sourceIndexForTextIndex(
                    rowIndex === 0 ? 0 : row.textStart,
                  )}
                  onContextMenu={handleScriptContextMenu}
                  onMouseLeave={() => setInsertionPreview(null)}
                  onMouseMove={handleScriptMouseMove}
                  role="cell"
                >
                  {row.marker ? (
                    <div className="next-script-slide-anchor">
                      {renderActionToken(row.marker)}
                    </div>
                  ) : row.label !== "No slide" ? (
                    <div className="next-script-slide-anchor is-muted">
                      <span>{row.label}</span>
                    </div>
                  ) : null}
                  <div className="next-script-segment-document">
                    {rowNodes.length ? (
                      rowNodes
                    ) : (
                      <div
                        className="next-script-view-empty"
                        data-default-insert={sourceIndexForTextIndex(
                          row.textStart,
                        )}
                      />
                    )}
                  </div>
                </div>
                <div className="next-script-slide-preview" role="cell">
                  {row.slideRef &&
                  preview?.status === "ready" &&
                  preview.imageUrl ? (
                    row.marker ? (
                      <button
                        aria-label={`Edit ${row.label}`}
                        className="next-script-slide-preview-button"
                        onClick={(event) => {
                          const sourceMarker = sourceMarkerForView(row.marker!);
                          setSelectedMarkerKey(viewMarkerEditKey(row.marker!));
                          onOpenMarker(sourceMarker, event);
                        }}
                        title="Choose which slide this shows."
                        type="button"
                      >
                        <img alt={row.label} src={preview.imageUrl} />
                      </button>
                    ) : (
                      <img alt={row.label} src={preview.imageUrl} />
                    )
                  ) : (
                    <span>
                      {!row.slideRef
                        ? "No slide"
                        : !deckUrl.trim()
                          ? "Deck URL needed"
                          : preview?.status === "loading"
                            ? "Loading"
                            : preview?.detail || "Slide unavailable"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="next-script-slide-row has-no-slide is-empty" role="row">
            <div
              className="next-script-slide-script"
              data-default-insert={sourceIndexForTextIndex(0)}
              data-default-insert-start={sourceIndexForTextIndex(0)}
              onContextMenu={handleScriptContextMenu}
              onMouseLeave={() => setInsertionPreview(null)}
              onMouseMove={handleScriptMouseMove}
              role="cell"
            >
              <div className="next-script-view-empty" />
            </div>
            <div className="next-script-slide-preview" role="cell">
              <span>No slide</span>
            </div>
          </div>
        )}
      </div>
      {insertionPreview ? (
        <span
          aria-hidden="true"
          className="next-script-insertion-caret"
          style={{
            height: insertionPreview.height,
            left: insertionPreview.x,
            top: insertionPreview.y,
          }}
        />
      ) : null}
    </div>
  );
}
