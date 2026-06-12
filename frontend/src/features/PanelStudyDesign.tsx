import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";

import { apiFetch } from "../api";
import { publicAsset } from "../assets";
import { defaultChoiceIconBackground } from "../uiHelpers";
import { ArrowLeftIcon } from "../components/Icons";
import { getSidePanelDefinition, type SidePanelHost } from "../sidePanels";
import {
  getSidePanelMetadata,
  sidePanelMetadataDefinitions,
} from "../sidePanelMetadata";
import { ChatPanelContent } from "./ChatPanelContent";
import { HeaderNavActions } from "./HeaderNavActions";
import { ImageLibraryPicker } from "./ImageLibraryPicker";
import { MainPanelContent } from "./MainPanelContent";
import { PanelWindow } from "./PanelWindow";
import { RoadmapBoard } from "./RoadmapBoard";
import { SidePanelDock, type SidePanelDockPanel } from "./SidePanelDock";
import { SlidePager } from "./SlidePager";
import { useRuntimeLayout } from "./useRuntimeLayout";
import { useScriptImageLibrary } from "./useScriptImageLibrary";
import type {
  ApiUser,
  ChatMessage,
  ExperiencesPayload,
  ResolvedSlide,
  RuntimeButton,
  RuntimeOverlay,
  RuntimeSideImage,
  TutoringSession,
} from "../types";
import "../design-lab.css";

// Design lab for the student-facing player ("/run-design").
//
// This page renders the REAL player components (ChatPanelContent,
// MainPanelContent, PanelWindow) inside the real layout shell, fed with
// canned fixture data instead of a live session. Use it to try visual
// ideas without touching live runtime code:
//
//   - Experiment freely in this file and in src/design-lab.css.
//   - When an idea is worth keeping, promote it into the real
//     components / styles.css as a small deliberate change.
//   - Abandoned ideas just get deleted here; the real player never
//     saw them.

type SceneId =
  | "conversation"
  | "choices"
  | "tutor-speaking"
  | "side-images"
  | "empty";

// --- Left dock -------------------------------------------------------------
// The lab renders the REAL SidePanelDock and the REAL panel components from
// the global registry. Right-click the dock to choose which registered
// panels sit in it for design work (separate from clicking icons to open and
// close them); right-click a rail icon to pick or upload an icon image.
// These design choices live in localStorage only — they never touch the
// player runtime or the database.

type DesignDockState = {
  iconPaths: Record<string, string>;
  openIds: string[];
  placedIds: string[];
};

const designDockStorageKey = "design-lab-dock";

const defaultDockState: DesignDockState = {
  iconPaths: {},
  openIds: ["roadmap"],
  placedIds: ["roadmap"],
};

function isRegisteredPanelId(panelId: unknown): panelId is string {
  return typeof panelId === "string" && Boolean(getSidePanelMetadata(panelId));
}

function readStoredDockState(): DesignDockState {
  try {
    const raw = window.localStorage.getItem(designDockStorageKey);
    if (!raw) return defaultDockState;
    const parsed = JSON.parse(raw) as Partial<DesignDockState>;
    const placedIds = Array.isArray(parsed.placedIds)
      ? parsed.placedIds.filter(isRegisteredPanelId)
      : defaultDockState.placedIds;
    const openIds = Array.isArray(parsed.openIds)
      ? parsed.openIds.filter((panelId) => placedIds.includes(panelId))
      : [];
    const iconPaths: Record<string, string> = {};
    if (parsed.iconPaths && typeof parsed.iconPaths === "object") {
      for (const [panelId, iconPath] of Object.entries(parsed.iconPaths)) {
        if (isRegisteredPanelId(panelId) && typeof iconPath === "string") {
          iconPaths[panelId] = iconPath;
        }
      }
    }
    return { iconPaths, openIds, placedIds };
  } catch {
    return defaultDockState;
  }
}

const designPanelHost: SidePanelHost = {
  experienceId: "design-experience",
  runtimeContext: {},
  sessionId: "design-session",
};

function designDockPanelContent(panelId: string) {
  const definition = getSidePanelDefinition(panelId);
  if (!definition) return null;
  const PanelContent = definition.Component;
  return <PanelContent host={designPanelHost} />;
}

type DockMenuState = {
  panelId: string;
  x: number;
  y: number;
};

type Scene = {
  id: SceneId;
  label: string;
  description: string;
};

const scenes: Scene[] = [
  {
    id: "conversation",
    label: "Conversation",
    description: "A few student/tutor turns with chat enabled.",
  },
  {
    id: "choices",
    label: "Choice prompt",
    description: "Tutor question with runtime choice buttons.",
  },
  {
    id: "tutor-speaking",
    label: "Tutor speaking",
    description: "Streaming tutor message with the composer locked.",
  },
  {
    id: "side-images",
    label: "Side images",
    description: "Avatar plus a right-side image at different scales.",
  },
  {
    id: "empty",
    label: "Fresh session",
    description: "Empty thread, ready composer, empty main panel.",
  },
];

const fixtureUser: ApiUser = {
  id: 1,
  username: "design-student",
  email: "student@example.com",
  firstName: "Sam",
  lastName: "Student",
  displayName: "Sam",
};

const fixtureSession: TutoringSession = {
  id: "design-session",
  experienceId: "design-experience",
  title: "Design lab session",
  runtimeContext: {},
  runtimeState: {},
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// The design reference deck; slides are resolved through the real slides API
// so the lab shows actual slides. The bundled robot image is only the
// fallback while loading or when the deck cannot be fetched. Several slides
// of the same deck feed the pagination experiment in the main panel.
const designDeckUrl =
  "https://docs.google.com/presentation/d/1Fj34qG2v8vFLuF295IdOHVfvkPBwtbvVKtTjGZMnvGw/edit";

const designSlideRefs = ["1", "2", "3", "4", "5"];

const fixtureSlide: ResolvedSlide = {
  cached: true,
  imageUrl: publicAsset("test-images/test-dmo.png"),
  pageId: "design-page",
  presentationId: "design-deck",
  slideRef: "1",
};

let fixtureSequence = 0;

function fixtureMessage(
  role: ChatMessage["role"],
  content: string,
  metadata?: Record<string, unknown>,
): ChatMessage {
  fixtureSequence += 1;
  return {
    id: `design-message-${fixtureSequence}`,
    role,
    content,
    sequence: fixtureSequence,
    createdAt: "2026-01-01T00:00:00Z",
    metadata,
  };
}

const conversationMessages: ChatMessage[] = [
  fixtureMessage(
    "assistant",
    "Welcome back! Last time we looked at how a neural network adjusts its weights. Ready to keep going?",
  ),
  fixtureMessage("user", "Yes, but I'm still fuzzy on what a loss function actually does."),
  fixtureMessage(
    "assistant",
    "Great question. Think of the loss function as a score for how wrong the network's guess was. A big loss means a bad guess; a loss near zero means the guess was close. Training is just the process of nudging the weights to make that score smaller.",
  ),
  fixtureMessage("user", "So the network never sees the 'right answer' directly, just the score?"),
  fixtureMessage(
    "assistant",
    "Exactly right. The gradient of that score tells each weight which direction to move. Let's make that concrete with the diagram on the slide.",
  ),
];

const choiceMessages: ChatMessage[] = [
  fixtureMessage(
    "assistant",
    "Quick check before we move on: which of these best describes what gradient descent is doing?",
  ),
];

const choiceButtons: RuntimeButton[] = [
  {
    eventId: "design-event",
    iconPath: "test-images/wrench.png",
    label: "Following the slope of the loss downhill",
    stepId: "design-choice-1",
    triggersEvent: "design-next",
  },
  {
    eventId: "design-event",
    iconPath: "test-images/wrench.png",
    label: "Trying random weights until one works",
    stepId: "design-choice-2",
    triggersEvent: "design-next",
  },
  {
    eventId: "design-event",
    label: "I'm not sure yet",
    stepId: "design-choice-3",
    triggersEvent: "design-next",
  },
];

const tutorSpeakingMessages: ChatMessage[] = [
  fixtureMessage("user", "Can you walk me through backpropagation one more time?"),
  fixtureMessage(
    "assistant",
    "Of course. Picture the network's error flowing backwards through each layer, and at every stop it asks: how much did you contribute to this mistake...",
    { streaming: true },
  ),
];

const sideImageMessages: ChatMessage[] = [
  fixtureMessage(
    "assistant",
    "Here's the model we just trained on the left, and the dataset it learned from on the right.",
  ),
];

const sideImages: RuntimeSideImage[] = [
  {
    imagePath: "test-images/dLU-right.png",
    scale: 1,
    slot: "left",
    visible: true,
  },
  {
    imagePath: "test-images/test-dmo2.png",
    scale: 0.9,
    slot: "right",
    visible: true,
  },
];

const noOverlays: RuntimeOverlay[] = [];

type SceneFixture = {
  avatarVisible: boolean;
  isChatEnabled: boolean;
  isTurnLocked: boolean;
  messages: ChatMessage[];
  runtimeButtons: RuntimeButton[];
  runtimeSideImages: RuntimeSideImage[];
  slide: ResolvedSlide | null;
  streaming: boolean;
};

function sceneFixture(sceneId: SceneId): SceneFixture {
  switch (sceneId) {
    case "choices":
      return {
        avatarVisible: true,
        isChatEnabled: false,
        isTurnLocked: false,
        messages: choiceMessages,
        runtimeButtons: choiceButtons,
        runtimeSideImages: [],
        slide: fixtureSlide,
        streaming: false,
      };
    case "tutor-speaking":
      return {
        avatarVisible: true,
        isChatEnabled: true,
        isTurnLocked: true,
        messages: tutorSpeakingMessages,
        runtimeButtons: [],
        runtimeSideImages: [],
        slide: fixtureSlide,
        streaming: true,
      };
    case "side-images":
      return {
        avatarVisible: true,
        isChatEnabled: true,
        isTurnLocked: false,
        messages: sideImageMessages,
        runtimeButtons: [],
        runtimeSideImages: sideImages,
        slide: fixtureSlide,
        streaming: false,
      };
    case "empty":
      return {
        avatarVisible: true,
        isChatEnabled: true,
        isTurnLocked: false,
        messages: [],
        runtimeButtons: [],
        runtimeSideImages: [],
        slide: null,
        streaming: false,
      };
    case "conversation":
    default:
      return {
        avatarVisible: true,
        isChatEnabled: true,
        isTurnLocked: false,
        messages: conversationMessages,
        runtimeButtons: [],
        runtimeSideImages: [],
        slide: fixtureSlide,
        streaming: false,
      };
  }
}

export function PanelStudyDesign() {
  const {
    dragLowerDivider,
    dragWorkspaceDivider,
    lowerHeight,
    rightRef,
    shellRef,
    shellStyle,
    workspaceWidth,
  } = useRuntimeLayout({ initiallyOpen: false });
  const navigate = useNavigate();
  const [sceneId, setSceneId] = useState<SceneId>("conversation");
  const [roadmapDoneIds, setRoadmapDoneIds] = useState<string[]>([]);
  const [roadmapActiveId, setRoadmapActiveId] = useState<string | null>(null);
  const roadmapDoneSet = useMemo(
    () => new Set(roadmapDoneIds),
    [roadmapDoneIds],
  );

  // Lab stand-ins for real runtime behavior: selecting a challenge is the
  // student's click; completing happens via the toolbar button (in the real
  // player only a roadmap_complete() action can do that).
  function completeSelectedRoadmapChip() {
    if (!roadmapActiveId) return;
    const nodeId = roadmapActiveId;
    setRoadmapDoneIds((current) =>
      current.includes(nodeId) ? current : [...current, nodeId],
    );
    setRoadmapActiveId(null);
  }
  const [dockState, setDockState] = useState<DesignDockState>(readStoredDockState);
  const [dockMenu, setDockMenu] = useState<DockMenuState | null>(null);
  const dockMenuRef = useRef<HTMLDivElement | null>(null);
  const iconFileInputRef = useRef<HTMLInputElement | null>(null);
  const [libraryExperienceId, setLibraryExperienceId] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const imageLibrary = useScriptImageLibrary({
    experienceId: libraryExperienceId,
    setError: setLibraryError,
  });
  const [isToolbarOpen, setIsToolbarOpen] = useState(true);

  useEffect(() => {
    window.localStorage.setItem(designDockStorageKey, JSON.stringify(dockState));
  }, [dockState]);

  useEffect(() => {
    if (!dockMenu) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && dockMenuRef.current?.contains(target)) return;
      setDockMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDockMenu(null);
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dockMenu]);
  const [designSlides, setDesignSlides] = useState<ResolvedSlide[]>([]);
  const [designSlideIndex, setDesignSlideIndex] = useState(0);

  // Plain fetch (not apiFetch) so a logged-out lab visit degrades to the
  // fallback image instead of redirecting to the sign-in page.
  useEffect(() => {
    let cancelled = false;

    async function resolveDesignSlides() {
      const csrfToken =
        document.cookie
          .split("; ")
          .find((part) => part.startsWith("csrftoken="))
          ?.split("=")[1] ?? "";
      const resolved = await Promise.all(
        designSlideRefs.map(async (slideRef) => {
          try {
            const response = await fetch("/api/slides/resolve/", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken,
              },
              body: JSON.stringify({
                deckUrl: designDeckUrl,
                forceRefresh: false,
                slideRef,
              }),
            });
            if (!response.ok) return null;
            const payload = (await response.json()) as ResolvedSlide;
            return payload?.imageUrl ? payload : null;
          } catch {
            // Failed refs just drop out; the bundled image stays the fallback.
            return null;
          }
        }),
      );
      if (!cancelled) {
        setDesignSlides(
          resolved.filter((slide): slide is ResolvedSlide => Boolean(slide)),
        );
      }
    }

    void resolveDesignSlides();
    return () => {
      cancelled = true;
    };
  }, []);

  const slidePageIndex = Math.min(
    designSlideIndex,
    Math.max(0, designSlides.length - 1),
  );
  const currentDesignSlide = designSlides[slidePageIndex] ?? null;
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const fixture = useMemo(() => sceneFixture(sceneId), [sceneId]);
  const scene = scenes.find((candidate) => candidate.id === sceneId) ?? scenes[0];
  const messages = [...fixture.messages, ...localMessages];

  function selectScene(nextSceneId: SceneId) {
    setSceneId(nextSceneId);
    setLocalMessages([]);
  }

  const dockPanels: SidePanelDockPanel[] = dockState.placedIds.flatMap(
    (panelId) => {
      const metadata = getSidePanelMetadata(panelId);
      return metadata
        ? [
            {
              flush: metadata.flush,
              glyph: metadata.glyph,
              iconPath: dockState.iconPaths[panelId] ?? "",
              id: panelId,
              sizing: metadata.sizing,
              title: metadata.label,
            },
          ]
        : [];
    },
  );

  function toggleDockPanel(panelId: string, open: boolean) {
    setDockState((current) => ({
      ...current,
      openIds: open
        ? [...current.openIds.filter((id) => id !== panelId), panelId]
        : current.openIds.filter((id) => id !== panelId),
    }));
  }

  // Placing a panel is the design-time act of putting it in the dock at all;
  // a freshly placed panel also opens so it can be styled right away.
  function togglePlacedPanel(panelId: string) {
    setDockState((current) => {
      const isPlaced = current.placedIds.includes(panelId);
      return {
        ...current,
        openIds: isPlaced
          ? current.openIds.filter((id) => id !== panelId)
          : [...current.openIds, panelId],
        placedIds: isPlaced
          ? current.placedIds.filter((id) => id !== panelId)
          : [...current.placedIds, panelId],
      };
    });
  }

  function setPanelIconPath(panelId: string, iconPath: string) {
    setDockState((current) => {
      const iconPaths = { ...current.iconPaths };
      if (iconPath) iconPaths[panelId] = iconPath;
      else delete iconPaths[panelId];
      return { ...current, iconPaths };
    });
  }

  // The icon image library is global storage on the backend, but its API
  // routes through an experience for the ownership check — borrow the first
  // experience. Loaded lazily so a logged-out lab visit never redirects.
  async function ensureIconLibrary() {
    let targetId = libraryExperienceId;
    if (!targetId) {
      try {
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        targetId = payload.experiences[0]?.id ?? "";
      } catch (libraryLoadError) {
        setLibraryError(
          libraryLoadError instanceof Error
            ? libraryLoadError.message
            : "Could not load the image library.",
        );
        return;
      }
      if (!targetId) {
        setLibraryError(
          "Create an experience first; the lab borrows its image library.",
        );
        return;
      }
      setLibraryExperienceId(targetId);
    }
    await imageLibrary.loadScriptImages(targetId);
  }

  function openDockContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target : null;
    const railButton = target?.closest(".side-dock-rail button");
    const panelId = railButton
      ? dockPanels.find((panel) =>
          railButton.classList.contains(`glow-panel-${panel.id}`),
        )?.id ?? ""
      : "";
    setLibraryError("");
    setDockMenu({
      panelId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 296)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 380)),
    });
    if (panelId) void ensureIconLibrary();
  }

  async function uploadPanelIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !dockMenu?.panelId) return;

    const imagePath = await imageLibrary.uploadScriptImageFile(
      file,
      "Could not upload the icon image.",
    );
    if (imagePath) setPanelIconPath(dockMenu.panelId, imagePath);
  }

  // Typed messages and chosen buttons append locally so the thread feels
  // alive while styling; nothing is sent to the backend.
  async function appendLocalMessage(content: string) {
    setLocalMessages((current) => [...current, fixtureMessage("user", content)]);
  }

  function chooseButton(button: RuntimeButton) {
    setLocalMessages((current) => [...current, fixtureMessage("user", button.label)]);
  }

  return (
    <main
      className="panel-study design-lab"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <button
          aria-label="Back to editor"
          className="study-back-button"
          onClick={() => navigate("/")}
          title="Back to editor"
          type="button"
        >
          <ArrowLeftIcon />
        </button>
        <div className="study-actions">
          <HeaderNavActions currentPage="design-lab" />
        </div>
      </header>

      <section
        className="workspace-shell drawer-closed side-dock-active"
        ref={shellRef}
        style={shellStyle}
      >
        <section className="panel-stage">
          <div
            aria-label="Resize workspace width"
            className="vertical-resizer workspace-width-resizer"
            onPointerDown={dragWorkspaceDivider}
            role="separator"
          />
          <div
            className="design-lab-dock-zone"
            onContextMenu={openDockContextMenu}
          >
            {dockPanels.length ? (
              <SidePanelDock
                onTogglePanel={toggleDockPanel}
                openPanelIds={dockState.openIds}
                panels={dockPanels}
                renderPanelContent={(panelId) =>
                  panelId === "roadmap" ? (
                    <RoadmapBoard
                      activeId={roadmapActiveId ?? ""}
                      completedIds={roadmapDoneSet}
                      onReplayNode={() => {}}
                      onSelectNode={(nodeId) => setRoadmapActiveId(nodeId)}
                    />
                  ) : (
                    designDockPanelContent(panelId)
                  )
                }
                shellRef={shellRef}
                workspaceWidth={workspaceWidth}
              />
            ) : (
              <aside
                aria-label="Side panels (none placed)"
                className="side-dock design-lab-empty-dock"
              >
                <div className="side-dock-rail">
                  <span aria-hidden="true" title="Right-click to add panels">
                    +
                  </span>
                </div>
              </aside>
            )}
          </div>
          <section
            className="right-region"
            ref={rightRef}
            style={{ "--lower-height": `${lowerHeight}px` } as CSSProperties}
          >
            <PanelWindow
              ariaLabel="Panel five"
              className="slide-pager-host"
              density="main"
            >
              <MainPanelContent
                context={{}}
                emitInteractiveActions={() => {}}
                error=""
                interactive={null}
                interactiveState={{}}
                onInteractiveComplete={() => {}}
                onInteractiveEvent={() => {}}
                onInteractiveSaveContext={async () => {}}
                onInteractiveStateChange={() => {}}
                slide={fixture.slide ? currentDesignSlide ?? fixture.slide : null}
                status={fixture.slide ? "ready" : "empty"}
              />
              {fixture.slide ? (
                <SlidePager
                  activeIndex={slidePageIndex}
                  count={designSlides.length}
                  onSelect={setDesignSlideIndex}
                />
              ) : null}
            </PanelWindow>
            <div
              aria-label="Resize rows"
              className="horizontal-resizer"
              onPointerDown={dragLowerDivider}
              role="separator"
            />
            <PanelWindow ariaLabel="Panel six" density="lower">
              <ChatPanelContent
                assistantName="dee-lou"
                avatarPath="test-images/dLU-right.png"
                avatarVisible={fixture.avatarVisible}
                choiceIconBackground={defaultChoiceIconBackground}
                error=""
                isChatEnabled={fixture.isChatEnabled}
                isSending={false}
                isTurnLocked={fixture.isTurnLocked}
                messages={messages}
                onChooseRuntimeButton={chooseButton}
                onSendMessage={appendLocalMessage}
                realtimeStatus={fixture.streaming ? "streaming" : "idle"}
                runtimeButtons={fixture.runtimeButtons}
                runtimeOverlays={noOverlays}
                runtimeSideImages={fixture.runtimeSideImages}
                session={fixtureSession}
                status="ready"
                turnAnchorMessageId={null}
                user={fixtureUser}
              />
            </PanelWindow>
          </section>
        </section>
      </section>

      {dockMenu ? (
        <div
          className="design-lab-context-menu"
          ref={dockMenuRef}
          role="menu"
          style={{ left: dockMenu.x, top: dockMenu.y }}
        >
          {dockMenu.panelId ? (
            <>
              <p className="design-lab-menu-title">
                Icon for{" "}
                {getSidePanelMetadata(dockMenu.panelId)?.label ??
                  dockMenu.panelId}
              </p>
              {libraryError ? (
                <p className="design-lab-menu-error">{libraryError}</p>
              ) : null}
              <div className="design-lab-menu-actions">
                <button
                  onClick={() => iconFileInputRef.current?.click()}
                  type="button"
                >
                  Upload image…
                </button>
                {dockState.iconPaths[dockMenu.panelId] ? (
                  <button
                    onClick={() => setPanelIconPath(dockMenu.panelId, "")}
                    type="button"
                  >
                    Use default glyph
                  </button>
                ) : null}
              </div>
              <ImageLibraryPicker
                ariaLabel={`Icon options for ${dockMenu.panelId}`}
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
                onSelect={(path) => setPanelIconPath(dockMenu.panelId, path)}
                options={imageLibrary.scriptImageOptions}
                selectedPath={dockState.iconPaths[dockMenu.panelId] ?? ""}
              />
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(event) => void uploadPanelIcon(event)}
                ref={iconFileInputRef}
                type="file"
              />
            </>
          ) : (
            <>
              <p className="design-lab-menu-title">Panels in the design dock</p>
              {sidePanelMetadataDefinitions.map((panel) => {
                const isPlaced = dockState.placedIds.includes(panel.id);
                return (
                  <button
                    aria-checked={isPlaced}
                    className="design-lab-menu-item"
                    key={panel.id}
                    onClick={() => togglePlacedPanel(panel.id)}
                    role="menuitemcheckbox"
                    type="button"
                  >
                    <span aria-hidden="true">{panel.glyph}</span>
                    <strong>{panel.label}</strong>
                    <i aria-hidden="true">{isPlaced ? "✓" : ""}</i>
                  </button>
                );
              })}
            </>
          )}
        </div>
      ) : null}

      <aside className={`design-lab-toolbar${isToolbarOpen ? "" : " is-collapsed"}`}>
        <button
          aria-expanded={isToolbarOpen}
          className="design-lab-toolbar-toggle"
          onClick={() => setIsToolbarOpen((current) => !current)}
          type="button"
        >
          {isToolbarOpen ? "Hide design scenes" : "Design scenes"}
        </button>
        {isToolbarOpen ? (
          <div className="design-lab-toolbar-body">
            <div className="design-lab-scene-list" role="radiogroup" aria-label="Design scenes">
              {scenes.map((candidate) => (
                <button
                  aria-checked={candidate.id === sceneId}
                  className={`design-lab-scene${candidate.id === sceneId ? " is-active" : ""}`}
                  key={candidate.id}
                  onClick={() => selectScene(candidate.id)}
                  role="radio"
                  type="button"
                >
                  {candidate.label}
                </button>
              ))}
            </div>
            <p className="design-lab-scene-description">{scene.description}</p>
            <p className="design-lab-group-label">LU&apos;s circuit board</p>
            <div className="design-lab-scene-list">
              <button
                className="design-lab-scene"
                disabled={!roadmapActiveId}
                onClick={completeSelectedRoadmapChip}
                type="button"
              >
                Complete selected
              </button>
              <button
                className="design-lab-scene"
                disabled={!roadmapDoneIds.length && !roadmapActiveId}
                onClick={() => {
                  setRoadmapDoneIds([]);
                  setRoadmapActiveId(null);
                }}
                type="button"
              >
                Reset progress
              </button>
            </div>
            <p className="design-lab-scene-description">
              This is the REAL roadmap panel. Click a lit chip to select it
              (in the player that triggers its linked event); &quot;Complete
              selected&quot; stands in for the roadmap_complete() action.
              Drag anywhere to pan.
            </p>
            <p
              className="design-lab-layout-readout"
              title="Your saved panel sizes — same ones the real player uses."
            >
              workspace {Math.round(workspaceWidth)}px · chat height{" "}
              {Math.round(lowerHeight)}px
            </p>
          </div>
        ) : null}
      </aside>
    </main>
  );
}
