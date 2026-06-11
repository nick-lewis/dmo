import type { CSSProperties, ReactNode } from "react";

type PanelWindowProps = {
  density: "compact" | "tall" | "tutor" | "notebook" | "terminal" | "main" | "lower";
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function PanelWindow({
  ariaLabel,
  children,
  className = "",
  density,
  style,
}: PanelWindowProps) {
  return (
    <article
      aria-label={ariaLabel}
      className={["panel-window", `panel-${density}`, className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <div className="panel-body">{children}</div>
    </article>
  );
}
