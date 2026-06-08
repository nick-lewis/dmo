import { clamp } from "./scriptActionEditorUtils";

export type FloatingMenuPosition = {
  x: number;
  y: number;
};

export function clampFloatingMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  padding = 12,
): FloatingMenuPosition {
  if (typeof window === "undefined") {
    return { x, y };
  }

  const maxX = Math.max(padding, window.innerWidth - width - padding);
  const maxY = Math.max(padding, window.innerHeight - height - padding);

  return {
    x: Math.round(clamp(x, padding, maxX)),
    y: Math.round(clamp(y, padding, maxY)),
  };
}
