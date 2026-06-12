import { useNavigate } from "react-router-dom";

// The shared top-right navigation: every authoring/lab page shows the same
// four links (the student-facing player keeps its own minimal header). The
// current page's link is disabled. Panels opens the current experience's
// panel editor when the page is tied to one, and the global panels page
// (panel-wide defaults) otherwise.

export type HeaderNavPage =
  | "design-lab"
  | "experiences"
  | "panels"
  | "voice-lab"
  | "";

export function HeaderNavActions({
  beforeNavigate,
  currentPage = "",
  experienceId = "",
}: {
  // Pages with autosave pass their flush here; navigation is cancelled when
  // it fails.
  beforeNavigate?: () => Promise<boolean>;
  currentPage?: HeaderNavPage;
  experienceId?: string;
}) {
  const navigate = useNavigate();

  async function go(path: string) {
    if (beforeNavigate) {
      const canLeave = await beforeNavigate();
      if (!canLeave) return;
    }
    navigate(path);
  }

  const links: Array<{
    disabled?: boolean;
    id: HeaderNavPage;
    label: string;
    path: string;
    title?: string;
  }> = [
    { id: "experiences", label: "Experiences", path: "/experiences" },
    { id: "voice-lab", label: "Voice lab", path: "/voice-personality-lab" },
    { id: "design-lab", label: "Design lab", path: "/run-design" },
    {
      id: "panels",
      label: "Panels",
      path: experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/panels`
        : "/panels",
      title: experienceId
        ? undefined
        : "Global panel settings (open from an experience to edit its panels)",
    },
  ];

  return (
    <>
      {links.map((link) => (
        <button
          className="header-action secondary"
          disabled={link.disabled || link.id === currentPage}
          key={link.id}
          onClick={() => void go(link.path)}
          title={link.title}
          type="button"
        >
          {link.label}
        </button>
      ))}
    </>
  );
}
