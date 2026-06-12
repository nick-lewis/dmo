import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, experienceNextEditPath } from "../api";
import { publicAsset } from "../assets";
import { ArrowLeftIcon } from "../components/Icons";
import type { SidePanelOverride } from "../sidePanelMetadata";
import {
  getSidePanelMetadata,
  sidePanelMetadataDefinitions,
} from "../sidePanelMetadata";
import type { Experience } from "../types";
import { ImageLibraryPicker } from "./ImageLibraryPicker";
import { RoadmapBoard } from "./RoadmapBoard";
import { useScriptImageLibrary } from "./useScriptImageLibrary";

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
  const [selectedPanelId, setSelectedPanelId] = useState("roadmap");
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const nodeMenuRef = useRef<HTMLDivElement | null>(null);
  const iconFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageLibrary = useScriptImageLibrary({
    experienceId,
    setError,
  });

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

  const selectedMetadata = getSidePanelMetadata(selectedPanelId);
  const selectedOverride = experience?.sidePanels?.find(
    (override) => override.panelId === selectedPanelId,
  );
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

  async function savePanelOverride(
    panelId: string,
    patch: Partial<SidePanelOverride>,
  ) {
    if (!experience) return;

    const existing = experience.sidePanels?.find(
      (override) => override.panelId === panelId,
    );
    const nextOverride: SidePanelOverride = {
      enabled: existing?.enabled ?? false,
      iconPath: existing?.iconPath ?? "",
      nodeEvents: existing?.nodeEvents ?? {},
      panelId,
      title: existing?.title ?? "",
      ...patch,
    };
    const sidePanels = [
      ...(experience.sidePanels ?? []).filter(
        (override) => override.panelId !== panelId,
      ),
      nextOverride,
    ];

    setExperience({ ...experience, sidePanels });
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
          : "Could not save the panel settings.",
      );
    }
  }

  async function saveNodeEvent(nodeId: string, eventSlug: string) {
    const nextEvents = { ...nodeEvents };
    if (eventSlug) nextEvents[nodeId] = eventSlug;
    else delete nextEvents[nodeId];

    setNodeMenu(null);
    await savePanelOverride("roadmap", { nodeEvents: nextEvents });
  }

  async function uploadPanelIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const imagePath = await imageLibrary.uploadScriptImageFile(
      file,
      "Could not upload the icon image.",
    );
    if (imagePath) {
      await savePanelOverride(selectedPanelId, { iconPath: imagePath });
      setIsIconPickerOpen(false);
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
          <div className="panel-editor-columns">
            <div className="panel-editor-list">
              {sidePanelMetadataDefinitions.map((panel) => {
                const override = experience.sidePanels?.find(
                  (candidate) => candidate.panelId === panel.id,
                );
                const isInExperience = override?.enabled === true;
                const isSelected = panel.id === selectedPanelId;
                return (
                  <div
                    className={[
                      "panel-editor-list-row",
                      isInExperience ? "is-on" : "",
                      isSelected ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={panel.id}
                    onClick={() => setSelectedPanelId(panel.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <span aria-hidden="true">
                      {override?.iconPath ? (
                        <img alt="" src={publicAsset(override.iconPath)} />
                      ) : (
                        panel.glyph
                      )}
                    </span>
                    <div className="panel-editor-list-name">
                      <strong>{override?.title || panel.label}</strong>
                      {panel.description ? (
                        <small>{panel.description}</small>
                      ) : null}
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void savePanelOverride(panel.id, {
                          enabled: !isInExperience,
                        });
                      }}
                      type="button"
                    >
                      {isInExperience ? "✓ In experience" : "Add to experience"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="panel-editor-detail">
              {selectedOverride?.enabled === true ? (
                <>
                  <div className="panel-editor-icon-row">
                    <span>Icon</span>
                    <button
                      aria-label="Choose panel icon"
                      className="panel-editor-icon-button"
                      onClick={() => {
                        const opening = !isIconPickerOpen;
                        setIsIconPickerOpen(opening);
                        if (opening) void imageLibrary.loadScriptImages();
                      }}
                      title="Choose from the image library"
                      type="button"
                    >
                      {selectedOverride.iconPath ? (
                        <img
                          alt=""
                          src={publicAsset(selectedOverride.iconPath)}
                        />
                      ) : (
                        <span aria-hidden="true">
                          {selectedMetadata?.glyph ?? "🧭"}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => iconFileInputRef.current?.click()}
                      type="button"
                    >
                      Upload image…
                    </button>
                    {selectedOverride.iconPath ? (
                      <button
                        onClick={() =>
                          void savePanelOverride(selectedPanelId, {
                            iconPath: "",
                          })
                        }
                        type="button"
                      >
                        Use default glyph
                      </button>
                    ) : null}
                  </div>
                  {isIconPickerOpen ? (
                    <ImageLibraryPicker
                      ariaLabel={`Icon options for ${selectedPanelId}`}
                      classNames={{
                        deleteButton: "next-script-image-delete-button",
                        empty: "next-script-image-picker-empty",
                        option: "next-script-image-option",
                        optionMain: "next-script-image-option-main",
                        picker: "next-script-image-picker",
                      }}
                      deletingPath={imageLibrary.deletingScriptImagePath}
                      emptyLabel="No images yet — upload one above."
                      isLoading={imageLibrary.isLoadingScriptImages}
                      onDelete={(path) =>
                        void imageLibrary.deleteScriptImageFile(path)
                      }
                      onSelect={(path) => {
                        void savePanelOverride(selectedPanelId, {
                          iconPath: path,
                        });
                        setIsIconPickerOpen(false);
                      }}
                      options={imageLibrary.scriptImageOptions}
                      selectedPath={selectedOverride.iconPath ?? ""}
                    />
                  ) : null}
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(event) => void uploadPanelIcon(event)}
                    ref={iconFileInputRef}
                    type="file"
                  />

                  {selectedPanelId === "roadmap" ? (
                    <>
                      <p className="panel-editor-hint">
                        Right-click a challenge to choose which event it
                        triggers in this experience. Linked challenges show
                        their event below the title. Turn the panel on for
                        students with <code>panel(&quot;roadmap&quot;)</code>{" "}
                        or <code>[panel_on: roadmap]</code>.
                      </p>
                      <div className="panel-editor-window">
                        <header>
                          <span aria-hidden="true">
                            {selectedOverride.iconPath ? (
                              <img
                                alt=""
                                src={publicAsset(selectedOverride.iconPath)}
                              />
                            ) : (
                              selectedMetadata?.glyph ?? "🧭"
                            )}
                          </span>
                          <strong>
                            {selectedOverride.title ||
                              selectedMetadata?.label ||
                              "Roadmap"}
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
                  ) : (
                    <p className="panel-editor-hint">
                      This panel has nothing else to configure yet.
                    </p>
                  )}
                </>
              ) : (
                <p className="panel-editor-hint">
                  Add this panel to the experience to configure it here.
                </p>
              )}
            </div>
          </div>
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
