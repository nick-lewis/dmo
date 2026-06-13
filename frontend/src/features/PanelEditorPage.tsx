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
import {
  sidePanelUsagesFromExperience,
  type SidePanelUsage,
} from "../sidePanelUsage";
import type {
  Experience,
  ExperiencesPayload,
  SidePanelSettingEntry,
} from "../types";
import { HeaderNavActions } from "./HeaderNavActions";
import { ImageLibraryPicker } from "./ImageLibraryPicker";
import { RoadmapBoard } from "./RoadmapBoard";
import { useScriptImageLibrary } from "./useScriptImageLibrary";

// The panel page has two modes. Opened from an experience
// (/experiences/:id/panels) it lists panels that are referenced by authored
// panel actions and edits experience-specific settings. Opened globally
// (/panels) it acts as Panel lab: defaults plus a playground for every
// registered panel.

type NodeMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

type PanelEditorRow = {
  panelId: string;
  usage?: SidePanelUsage;
};

function panelUsageLabel(usage: SidePanelUsage | undefined) {
  if (!usage) return "";

  const count = usage.actionCount + usage.scriptMarkerCount;
  if (count > 0) {
    return `${count} action${count === 1 ? "" : "s"}`;
  }
  return usage.configured ? "Settings only" : "";
}

function hasPanelOverrideContent(override: SidePanelOverride) {
  return Boolean(
    (override.iconPath ?? "").trim() ||
      (override.title ?? "").trim() ||
      Object.keys(override.nodeEvents ?? {}).length,
  );
}

export function PanelEditorPage() {
  const { experienceId = "" } = useParams();
  const isGlobal = !experienceId;
  const navigate = useNavigate();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [globalSettings, setGlobalSettings] = useState<
    SidePanelSettingEntry[]
  >([]);
  // The shared image library API routes through an experience for its
  // ownership check; global mode borrows the first experience.
  const [libraryExperienceId, setLibraryExperienceId] = useState("");
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
    experienceId: experienceId || libraryExperienceId,
    setError,
  });

  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      try {
        if (experienceId) {
          const payload = await apiFetch<{ experience: Experience }>(
            `/api/experiences/${encodeURIComponent(experienceId)}/`,
          );
          if (isCancelled) return;
          setExperience(payload.experience);
        } else {
          const [settingsPayload, experiencesPayload] = await Promise.all([
            apiFetch<{ settings: SidePanelSettingEntry[] }>(
              "/api/side-panel-settings/",
            ),
            apiFetch<ExperiencesPayload>("/api/experiences/"),
          ]);
          if (isCancelled) return;
          setGlobalSettings(settingsPayload.settings);
          setLibraryExperienceId(
            experiencesPayload.experiences[0]?.id ?? "",
          );
        }
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;
        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the panel editor.",
        );
      }
    }

    void loadEditor();
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

  const panelUsages = sidePanelUsagesFromExperience(experience);
  const panelRows: PanelEditorRow[] = isGlobal
    ? sidePanelMetadataDefinitions.map((panel) => ({ panelId: panel.id }))
    : panelUsages.map((usage) => ({ panelId: usage.panelId, usage }));
  const activePanelId = panelRows.some((row) => row.panelId === selectedPanelId)
    ? selectedPanelId
    : panelRows[0]?.panelId ?? selectedPanelId;
  const selectedUsage = panelRows.find(
    (row) => row.panelId === activePanelId,
  )?.usage;
  const selectedMetadata = getSidePanelMetadata(activePanelId);
  const selectedOverride = experience?.sidePanels?.find(
    (override) => override.panelId === activePanelId,
  );
  const selectedGlobalSetting = globalSettings.find(
    (setting) => setting.panelId === activePanelId,
  );
  const selectedIconPath = isGlobal
    ? selectedGlobalSetting?.iconPath ?? ""
    : selectedOverride?.iconPath ?? "";
  const selectedTitle = isGlobal
    ? selectedGlobalSetting?.title ?? ""
    : selectedOverride?.title ?? "";
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
      iconPath: existing?.iconPath ?? "",
      nodeEvents: existing?.nodeEvents ?? {},
      panelId,
      title: existing?.title ?? "",
      ...patch,
    };
    const sidePanels = (experience.sidePanels ?? []).filter(
      (override) => override.panelId !== panelId,
    );
    if (hasPanelOverrideContent(nextOverride)) {
      sidePanels.push(nextOverride);
    }

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

  async function saveGlobalSetting(
    panelId: string,
    patch: Partial<SidePanelSettingEntry>,
  ) {
    const existing = globalSettings.find(
      (setting) => setting.panelId === panelId,
    );
    try {
      const payload = await apiFetch<{ settings: SidePanelSettingEntry[] }>(
        "/api/side-panel-settings/",
        {
          method: "POST",
          body: JSON.stringify({
            iconPath: existing?.iconPath ?? "",
            panelId,
            title: existing?.title ?? "",
            ...patch,
          }),
        },
      );
      setGlobalSettings(payload.settings);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the panel defaults.",
      );
    }
  }

  async function savePanelIcon(iconPath: string) {
    if (isGlobal) {
      await saveGlobalSetting(activePanelId, { iconPath });
    } else {
      await savePanelOverride(activePanelId, { iconPath });
    }
  }

  async function savePanelTitle(title: string) {
    if (isGlobal) {
      await saveGlobalSetting(activePanelId, { title });
    } else {
      await savePanelOverride(activePanelId, { title });
    }
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
      await savePanelIcon(imagePath);
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
          aria-label={isGlobal ? "Back to experiences" : "Back to editor"}
          className="study-back-button"
          onClick={() =>
            navigate(
              isGlobal ? "/experiences" : experienceNextEditPath(experienceId),
            )
          }
          title={isGlobal ? "Back to experiences" : "Back to editor"}
          type="button"
        >
          <ArrowLeftIcon />
        </button>
        <div className="study-actions">
          <HeaderNavActions
            currentPage={isGlobal ? "panel-lab" : "panels"}
            experienceId={experienceId}
          />
        </div>
      </header>

      <section className="panel-editor">
        <div className="panel-editor-title">
          <h1>{isGlobal ? "Panel lab" : "Panels"}</h1>
          {isGlobal ? (
            <p>Global defaults and panel previews</p>
          ) : experience ? (
            <p>{experience.title}</p>
          ) : null}
        </div>

        {status === "loading" ? (
          <div className="experience-state">Loading panel...</div>
        ) : null}
        {error ? <div className="experience-state error">{error}</div> : null}

        {status === "ready" && (experience || isGlobal) ? (
          <div className="panel-editor-columns">
            <div className="panel-editor-list">
              {!panelRows.length ? (
                <div className="panel-editor-empty">
                  No panel actions in this experience.
                </div>
              ) : null}
              {panelRows.map((row) => {
                const panel = getSidePanelMetadata(row.panelId);
                if (!panel) return null;
                const override = experience?.sidePanels?.find(
                  (candidate) => candidate.panelId === panel.id,
                );
                const globalSetting = globalSettings.find(
                  (setting) => setting.panelId === panel.id,
                );
                const rowIconPath = isGlobal
                  ? globalSetting?.iconPath ?? ""
                  : override?.iconPath ?? "";
                const isSelected = panel.id === activePanelId;
                const usageLabel = panelUsageLabel(row.usage);
                return (
                  <div
                    className={[
                      "panel-editor-list-row",
                      !isGlobal && row.usage ? "is-on" : "",
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
                      {rowIconPath ? (
                        <img alt="" src={publicAsset(rowIconPath)} />
                      ) : (
                        panel.glyph
                      )}
                    </span>
                    <div className="panel-editor-list-name">
                      <strong>
                        {(isGlobal
                          ? globalSetting?.title
                          : override?.title) || panel.label}
                      </strong>
                      {isGlobal ? (
                        panel.description ? (
                          <small>{panel.description}</small>
                        ) : null
                      ) : usageLabel ? (
                        <small>{usageLabel}</small>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="panel-editor-detail">
              {selectedMetadata && (isGlobal || selectedUsage) ? (
                <>
                  <label className="panel-editor-title-row">
                    <span>Title</span>
                    <input
                      aria-label="Panel title"
                      defaultValue={selectedTitle}
                      key={`${activePanelId}:${selectedTitle}`}
                      onBlur={(event) =>
                        void savePanelTitle(event.target.value.trim())
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder={selectedMetadata.label}
                      type="text"
                    />
                  </label>
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
                      {selectedIconPath ? (
                        <img alt="" src={publicAsset(selectedIconPath)} />
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
                    {selectedIconPath ? (
                      <button
                        onClick={() => void savePanelIcon("")}
                        type="button"
                      >
                        Use default glyph
                      </button>
                    ) : null}
                  </div>
                  {isIconPickerOpen ? (
                    <ImageLibraryPicker
                      ariaLabel={`Icon options for ${activePanelId}`}
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
                        void savePanelIcon(path);
                        setIsIconPickerOpen(false);
                      }}
                      options={imageLibrary.scriptImageOptions}
                      selectedPath={selectedIconPath}
                    />
                  ) : null}
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(event) => void uploadPanelIcon(event)}
                    ref={iconFileInputRef}
                    type="file"
                  />

                  {isGlobal ? (
                    <p className="panel-editor-hint">
                      These defaults apply wherever an experience does not
                      override them.
                    </p>
                  ) : null}

                  {activePanelId === "roadmap" ? (
                    <>
                      {!isGlobal ? (
                        <p className="panel-editor-hint">
                          Right-click a challenge to choose which event it
                          triggers in this experience. Linked challenges show
                          their event below the title. Turn the panel on for
                          students with <code>panel(&quot;roadmap&quot;)</code>{" "}
                          or <code>[panel_on: roadmap]</code>.
                        </p>
                      ) : null}
                      <div className="panel-editor-window">
                        <header>
                          <span aria-hidden="true">
                            {selectedIconPath ? (
                              <img
                                alt=""
                                src={publicAsset(selectedIconPath)}
                              />
                            ) : (
                              selectedMetadata?.glyph ?? "🧭"
                            )}
                          </span>
                          <strong>
                            {selectedTitle ||
                              selectedMetadata?.label ||
                              "Roadmap"}
                          </strong>
                        </header>
                        <div className="panel-editor-window-body">
                          <RoadmapBoard
                            activeId=""
                            completedIds={new Set()}
                            editor={
                              isGlobal
                                ? undefined
                                : {
                                    nodeBadges,
                                    onNodeContextMenu: openNodeMenu,
                                  }
                            }
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
                  Panel settings appear after a panel action references a
                  registered panel.
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
