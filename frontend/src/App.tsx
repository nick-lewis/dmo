import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";

// Client-side routing: moving between pages keeps the app alive (no full
// reloads), which is what lets session context, audio, and an ever-present
// tutor survive navigation as the app grows into a multi-place world.
// Django-served pages (e.g. /accounts/login/) are still reached with
// window.location.assign — they are real page loads on purpose.

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
const PanelStudyDesign = lazy(() =>
  import("./features/PanelStudyDesign").then((module) => ({
    default: module.PanelStudyDesign,
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

// Full page loads always started a page at the top; client-side navigation
// keeps the old scroll position, so reset it ourselves per page change.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function ExperienceRunRoute() {
  const { experienceId = "" } = useParams();
  return <PanelStudy initialExperienceId={experienceId} key={experienceId} />;
}

function ExperienceNextRoute() {
  const { experienceId = "" } = useParams();
  return <ExperienceEditorNext experienceId={experienceId} key={experienceId} />;
}

function ExperienceMockupsRoute() {
  const { experienceId = "" } = useParams();
  return (
    <ExperienceEditorMockups experienceId={experienceId} key={experienceId} />
  );
}

function ExperienceEditRoute() {
  const { experienceId = "" } = useParams();
  return <ExperienceEditor experienceId={experienceId} key={experienceId} />;
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense
        fallback={
          <div
            aria-label="Loading app"
            className="app-route-loading"
            role="status"
          />
        }
      >
        <Routes>
          <Route element={<ExperienceHome />} path="/" />
          <Route element={<ExperienceHome />} path="/experiences" />
          <Route element={<ScriptTextSpeedLab />} path="/script-text-speed-lab" />
          <Route
            element={<VoicePersonalityLab />}
            path="/voice-personality-lab"
          />
          <Route element={<PanelStudyDesign />} path="/run-design" />
          <Route
            element={<ExperienceRunRoute />}
            path="/experiences/:experienceId/run"
          />
          <Route
            element={<ExperienceNextRoute />}
            path="/experiences/:experienceId/next"
          />
          <Route
            element={<ExperienceMockupsRoute />}
            path="/experiences/:experienceId/mockups"
          />
          <Route
            element={<ExperienceEditRoute />}
            path="/experiences/:experienceId/edit"
          />
          <Route
            element={<ExperienceEditRoute />}
            path="/experiences/:experienceId"
          />
          <Route element={<PanelStudy />} path="/surfaces/tutoring/panels" />
          <Route element={<ExperienceHome />} path="*" />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
