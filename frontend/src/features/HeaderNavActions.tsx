import { useNavigate } from "react-router-dom";

// The shared top-right navigation: every authoring/lab page shows the same
// four links (the student-facing player keeps its own minimal header). The
// current page's link is disabled. Panels opens the current experience's
// panel settings; Panel lab is the global playground/defaults page.

export type HeaderNavPage =
  | "design-lab"
  | "experiences"
  | "panel-lab"
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
    ...(experienceId
      ? [
          {
            id: "panels" as const,
            label: "Panels",
            path: `/experiences/${encodeURIComponent(experienceId)}/panels`,
          },
        ]
      : []),
    {
      id: "panel-lab",
      label: "Panel lab",
      path: "/panels",
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
