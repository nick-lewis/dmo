import { routeExperience } from "./api";
import { ExperienceEditor } from "./features/ExperienceEditor";
import { ExperienceHome } from "./features/ExperienceHome";
import { PanelStudy } from "./features/PanelStudy";
import { VoicePersonalityLab } from "./features/VoicePersonalityLab";

function App() {
  const pathname = window.location.pathname;
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const experienceRoute = routeExperience(pathname);

  if (normalizedPath === "/" || normalizedPath === "/experiences") {
    return <ExperienceHome />;
  }

  if (normalizedPath === "/voice-personality-lab") {
    return <VoicePersonalityLab />;
  }

  if (experienceRoute.experienceId && experienceRoute.mode === "run") {
    return <PanelStudy initialExperienceId={experienceRoute.experienceId} />;
  }

  if (experienceRoute.experienceId) {
    return <ExperienceEditor experienceId={experienceRoute.experienceId} />;
  }

  if (normalizedPath === "/surfaces/tutoring/panels") {
    return <PanelStudy />;
  }

  return <ExperienceHome />;
}

export default App;
