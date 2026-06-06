import { lazy, Suspense, type ReactNode } from "react";

import { routeExperience } from "./api";

const ExperienceEditor = lazy(() =>
  import("./features/ExperienceEditor").then((module) => ({
    default: module.ExperienceEditor,
  })),
);
const ExperienceEditorMockups = lazy(() =>
  import("./features/ExperienceEditorMockups").then((module) => ({
    default: module.ExperienceEditorMockups,
  })),
);
const ExperienceEditorNext = lazy(() =>
  import("./features/ExperienceEditorNext").then((module) => ({
    default: module.ExperienceEditorNext,
  })),
);
const ExperienceHome = lazy(() =>
  import("./features/ExperienceHome").then((module) => ({
    default: module.ExperienceHome,
  })),
);
const PanelStudy = lazy(() =>
  import("./features/PanelStudy").then((module) => ({
    default: module.PanelStudy,
  })),
);
const ScriptTextSpeedLab = lazy(() =>
  import("./features/ScriptTextSpeedLab").then((module) => ({
    default: module.ScriptTextSpeedLab,
  })),
);
const VoicePersonalityLab = lazy(() =>
  import("./features/VoicePersonalityLab").then((module) => ({
    default: module.VoicePersonalityLab,
  })),
);

function App() {
  const pathname = window.location.pathname;
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const experienceRoute = routeExperience(pathname);
  let screen: ReactNode;

  if (normalizedPath === "/" || normalizedPath === "/experiences") {
    screen = <ExperienceHome />;
  } else if (normalizedPath === "/script-text-speed-lab") {
    screen = <ScriptTextSpeedLab />;
  } else if (normalizedPath === "/voice-personality-lab") {
    screen = <VoicePersonalityLab />;
  } else if (experienceRoute.experienceId && experienceRoute.mode === "run") {
    screen = <PanelStudy initialExperienceId={experienceRoute.experienceId} />;
  } else if (experienceRoute.experienceId && experienceRoute.mode === "next") {
    screen = <ExperienceEditorNext experienceId={experienceRoute.experienceId} />;
  } else if (experienceRoute.experienceId && experienceRoute.mode === "mockups") {
    screen = <ExperienceEditorMockups experienceId={experienceRoute.experienceId} />;
  } else if (experienceRoute.experienceId) {
    screen = <ExperienceEditor experienceId={experienceRoute.experienceId} />;
  } else if (normalizedPath === "/surfaces/tutoring/panels") {
    screen = <PanelStudy />;
  } else {
    screen = <ExperienceHome />;
  }

  return (
    <Suspense
      fallback={
        <div
          aria-label="Loading app"
          className="app-route-loading"
          role="status"
        />
      }
    >
      {screen}
    </Suspense>
  );
}

export default App;
