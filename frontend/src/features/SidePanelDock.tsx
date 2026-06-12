import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react";

import { publicAsset } from "../assets";

// Icon-rail dock for side panels ("options"). A glyph rail hugs the main
// panel's left edge; toggling a panel slides its window out of the main
// panel. Open windows stack as one connected, resizable column. Open state
// is owned by the caller (the runtime), so authored actions and student
// clicks flow through the same source of truth.

export type SidePanelDockPanel = {
  // Flush panels own their full window body (no padding, hidden scrollbar).
  flush?: boolean;
  glyph: string;
  iconPath: string;
  id: string;
  // "hug" panels take their content's height instead of filling the column.
  sizing?: "fill" | "hug";
  title: string;
};

type SidePanelDockProps = {
  onTogglePanel: (panelId: string, open: boolean) => void;
  openPanelIds: string[];
  panels: SidePanelDockPanel[];
  renderPanelContent: (panelId: string) => ReactNode;
  shellRef: RefObject<HTMLElement | null>;
  workspaceWidth: number;
};

const dockMinPanelWeight = 0.3;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function SidePanelDock({
  onTogglePanel,
  openPanelIds,
  panels,
  renderPanelContent,
  shellRef,
  workspaceWidth,
}: SidePanelDockProps) {
  // Default to the widest the dock can go; the clamp against dockSpace
  // brings it down to whatever the screen actually allows.
  const [dockWidth, setDockWidth] = useState(9999);
  const [dockSpace, setDockSpace] = useState(360);
  const [isResizingDock, setIsResizingDock] = useState(false);
  const [dockWeights, setDockWeights] = useState<Record<string, number>>({});
  const dockColumnRef = useRef<HTMLDivElement | null>(null);

  // Available room between the screen edge and the main panel; the dock
  // column is clamped to it so windows never run off-screen.
  useEffect(() => {
    function measureDockSpace() {
      const shell = shellRef.current;
      const stage = shell?.querySelector(".panel-stage");
      if (!shell || !stage) return;
      setDockSpace(Math.max(0, stage.getBoundingClientRect().left - 10));
    }

    measureDockSpace();
    window.addEventListener("resize", measureDockSpace);
    return () => window.removeEventListener("resize", measureDockSpace);
  }, [shellRef, workspaceWidth]);

  function startDockWidthDrag(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = clampNumber(dockWidth, 230, dockSpace - 56);
    const maxWidth = Math.max(230, dockSpace - 56);
    setIsResizingDock(true);

    function onMove(moveEvent: PointerEvent) {
      setDockWidth(
        clampNumber(startWidth + (startX - moveEvent.clientX), 230, maxWidth),
      );
    }
    function onUp() {
      setIsResizingDock(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startDockSplitDrag(
    upperPanelId: string,
    lowerPanelId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    const column = dockColumnRef.current;
    if (!column) return;
    event.preventDefault();

    const startY = event.clientY;
    const totalHeight = column.getBoundingClientRect().height || 1;
    const startUpper = dockWeights[upperPanelId] ?? 1;
    const startLower = dockWeights[lowerPanelId] ?? 1;
    const weightSum = openPanelIds.reduce(
      (sum, id) => sum + (dockWeights[id] ?? 1),
      0,
    );
    setIsResizingDock(true);

    function onMove(moveEvent: PointerEvent) {
      const rawDelta = ((moveEvent.clientY - startY) / totalHeight) * weightSum;
      const delta = clampNumber(
        rawDelta,
        dockMinPanelWeight - startUpper,
        startLower - dockMinPanelWeight,
      );
      setDockWeights((current) => ({
        ...current,
        [upperPanelId]: startUpper + delta,
        [lowerPanelId]: startLower - delta,
      }));
    }
    function onUp() {
      setIsResizingDock(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!panels.length) return null;

  const openIds = panels
    .map((panel) => panel.id)
    .filter((panelId) => openPanelIds.includes(panelId));
  const hasOpenWindows = openIds.length > 0;
  const allOpenPanelsHug =
    hasOpenWindows &&
    openIds.every(
      (panelId) =>
        panels.find((panel) => panel.id === panelId)?.sizing === "hug",
    );
  const effectiveDockWidth = clampNumber(
    dockWidth,
    170,
    Math.max(170, dockSpace - 56),
  );

  function renderDockWindow(panel: SidePanelDockPanel, isOpen: boolean) {
    const hugsContent = panel.sizing === "hug";
    return (
      <section
        aria-hidden={!isOpen}
        className={[
          "side-dock-window",
          `glow-panel-${panel.id}`,
          isOpen ? "is-open" : "",
          hugsContent ? "is-hug" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          flexGrow: isOpen && !hugsContent ? dockWeights[panel.id] ?? 1 : 0,
        }}
      >
        <header>
          <span className="side-dock-glyph" aria-hidden="true">
            {panel.iconPath ? (
              <img alt="" src={publicAsset(panel.iconPath)} />
            ) : (
              panel.glyph
            )}
          </span>
          <strong>{panel.title}</strong>
          <button
            aria-label={`Close ${panel.title}`}
            onClick={() => onTogglePanel(panel.id, false)}
            tabIndex={isOpen ? 0 : -1}
            type="button"
          >
            ×
          </button>
        </header>
        <div
          className={[
            "side-dock-window-body",
            panel.flush ? "is-flush" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {renderPanelContent(panel.id)}
        </div>
      </section>
    );
  }

  return (
    <aside
      aria-label="Side panels"
      className={[
        "side-dock",
        hasOpenWindows ? "is-open" : "",
        isResizingDock ? "is-resizing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--dock-width": `${effectiveDockWidth}px` } as CSSProperties}
    >
      <div
        aria-label="Toggle side panels"
        className="side-dock-rail"
        role="toolbar"
      >
        {panels.map((panel) => {
          const isOpen = openIds.includes(panel.id);
          return (
            <button
              aria-pressed={isOpen}
              className={`glow-panel-${panel.id}`}
              key={panel.id}
              onClick={() => onTogglePanel(panel.id, !isOpen)}
              title={panel.title}
              type="button"
            >
              <span aria-hidden="true">
                {panel.iconPath ? (
                  <img alt="" src={publicAsset(panel.iconPath)} />
                ) : (
                  panel.glyph
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-hidden={!hasOpenWindows} className="side-dock-slide">
        <div className="side-dock-slide-inner">
          <div
            aria-label="Resize side panels"
            className="side-dock-width-handle"
            onPointerDown={startDockWidthDrag}
            role="separator"
          />
          <div
            className={["side-dock-column", allOpenPanelsHug ? "is-hug" : ""]
              .filter(Boolean)
              .join(" ")}
            ref={dockColumnRef}
          >
            {panels.map((panel, panelIndex) => {
              const isOpen = openIds.includes(panel.id);
              const previousOpenId = panels
                .slice(0, panelIndex)
                .map((candidate) => candidate.id)
                .filter((id) => openIds.includes(id))
                .pop();
              return (
                <Fragment key={panel.id}>
                  {isOpen && previousOpenId ? (
                    <div
                      aria-label="Resize panels"
                      className="side-dock-split"
                      onPointerDown={(event) =>
                        startDockSplitDrag(previousOpenId, panel.id, event)
                      }
                      role="separator"
                    />
                  ) : null}
                  {renderDockWindow(panel, isOpen)}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
