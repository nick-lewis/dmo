import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, experienceNextEditPath } from "../api";
import { ArrowLeftIcon } from "../components/Icons";
import type { SidePanelOverride } from "../sidePanelMetadata";
import { getSidePanelMetadata } from "../sidePanelMetadata";
import type { Experience } from "../types";
import { RoadmapBoard } from "./RoadmapBoard";

// The panel editor: shows a panel alone, tied to one experience, for
// configuring how it behaves there. For the roadmap that means choosing
// which experience event each challenge triggers — right-click (or click) a
// challenge and pick from the experience's events. Links are stored in the
// per-experience side panel overrides (Experience.sidePanels), the same
// place as icon/title overrides.

type NodeMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

export function PanelEditorPage() {
  const { experienceId = "" } = useParams();
  const navigate = useNavigate();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadExperience() {
      setStatus("loading");
      try {
        const payload = await apiFetch<{ experience: Experience }>(
          `/api/experiences/${encodeURIComponent(experienceId)}/`,
        );
        if (isCancelled) return;
        setExperience(payload.experience);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;
        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the experience.",
        );
      }
    }

    void loadExperience();
    return () => {
      isCancelled = true;
    };
  }, [experienceId]);

  useEffect(() => {
    if (!nodeMenu) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && nodeMenuRef.current?.contains(target)) return;
      setNodeMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNodeMenu(null);
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [nodeMenu]);

  const roadmapMetadata = getSidePanelMetadata("roadmap");
  const roadmapOverride = experience?.sidePanels?.find(
    (override) => override.panelId === "roadmap",
  );
  const nodeEvents = roadmapOverride?.nodeEvents ?? {};
  const sortedEvents = [...(experience?.events ?? [])].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );

  const nodeBadges: Record<string, string> = {};
  for (const [nodeId, eventSlug] of Object.entries(nodeEvents)) {
    const linkedEvent = sortedEvents.find((event) => event.slug === eventSlug);
    nodeBadges[nodeId] = linkedEvent?.title || eventSlug;
  }

  async function saveNodeEvent(nodeId: string, eventSlug: string) {
    if (!experience) return;

    const nextEvents = { ...nodeEvents };
    if (eventSlug) nextEvents[nodeId] = eventSlug;
    else delete nextEvents[nodeId];

    const nextOverride: SidePanelOverride = {
      iconPath: roadmapOverride?.iconPath ?? "",
      nodeEvents: nextEvents,
      panelId: "roadmap",
      title: roadmapOverride?.title ?? "",
    };
    const sidePanels = [
      ...(experience.sidePanels ?? []).filter(
        (override) => override.panelId !== "roadmap",
      ),
      nextOverride,
    ];

    setExperience({ ...experience, sidePanels });
    setNodeMenu(null);
    try {
      await apiFetch(
        `/api/experiences/${encodeURIComponent(experience.id)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ sidePanels }),
        },
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the panel links.",
      );
    }
  }

  function openNodeMenu(nodeId: string, event: ReactMouseEvent<HTMLElement>) {
    setNodeMenu({
      nodeId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 296)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
    });
  }

  return (
    <main
      className="panel-study panel-editor-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <button
          aria-label="Back to editor"
          className="study-back-button"
          onClick={() =>
            navigate(experienceNextEditPath(experienceId))
          }
          title="Back to editor"
          type="button"
        >
          <ArrowLeftIcon />
        </button>
        <div className="study-actions">
          <button
            className="header-action secondary"
            onClick={() => navigate("/experiences")}
            type="button"
          >
            Experiences
          </button>
        </div>
      </header>

      <section className="panel-editor">
        <div className="panel-editor-title">
          <h1>Panel editor</h1>
          {experience ? <p>{experience.title}</p> : null}
        </div>

        {status === "loading" ? (
          <div className="experience-state">Loading panel...</div>
        ) : null}
        {error ? <div className="experience-state error">{error}</div> : null}

        {status === "ready" && experience ? (
          <>
            <p className="panel-editor-hint">
              Right-click a challenge to choose which event it triggers in
              this experience. Linked challenges show their event below the
              title.
            </p>
            <div className="panel-editor-window">
              <header>
                <span aria-hidden="true">{roadmapMetadata?.glyph ?? "🧭"}</span>
                <strong>
                  {roadmapOverride?.title || roadmapMetadata?.label || "Roadmap"}
                </strong>
              </header>
              <div className="panel-editor-window-body">
                <RoadmapBoard
                  activeId=""
                  completedIds={new Set()}
                  editor={{
                    nodeBadges,
                    onNodeContextMenu: openNodeMenu,
                  }}
                />
              </div>
            </div>
          </>
        ) : null}
      </section>

      {nodeMenu ? (
        <div
          className="panel-editor-menu"
          ref={nodeMenuRef}
          role="menu"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
        >
          <p className="panel-editor-menu-title">Triggers event</p>
          <button
            aria-checked={!nodeEvents[nodeMenu.nodeId]}
            className="panel-editor-menu-item"
            onClick={() => void saveNodeEvent(nodeMenu.nodeId, "")}
            role="menuitemradio"
            type="button"
          >
            <strong>No event</strong>
            <i aria-hidden="true">{!nodeEvents[nodeMenu.nodeId] ? "✓" : ""}</i>
          </button>
          {sortedEvents.map((event) => {
            const isLinked = nodeEvents[nodeMenu.nodeId] === event.slug;
            return (
              <button
                aria-checked={isLinked}
                className="panel-editor-menu-item"
                key={event.id}
                onClick={() => void saveNodeEvent(nodeMenu.nodeId, event.slug)}
                role="menuitemradio"
                type="button"
              >
                <strong>{event.title || event.slug}</strong>
                <small>{event.slug}</small>
                <i aria-hidden="true">{isLinked ? "✓" : ""}</i>
              </button>
            );
          })}
          {!sortedEvents.length ? (
            <p className="panel-editor-menu-empty">
              This experience has no events yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
