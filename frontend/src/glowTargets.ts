import { sidePanelMetadataDefinitions } from "./sidePanelMetadata";

// Named glow targets for the highlight ("glow") action. Authoring UIs only
// ever offer these names; the mapped class selectors are what gets stored in
// highlight_on/highlight_off configs and script markers. Class selectors are
// required: marker arguments cannot contain "]" so attribute selectors are
// off-limits, and the classes below are stable hooks placed on player
// elements specifically for glowing.

export type GlowTarget = {
  id: string;
  label: string;
  selector: string;
};

export const defaultGlowColor = "rgba(59, 130, 246, 0.6)";

const baseGlowTargets: GlowTarget[] = [
  { id: "chat-input", label: "Chat input", selector: ".glow-chat-input" },
  { id: "chat-panel", label: "Chat panel", selector: ".glow-chat-panel" },
  { id: "main-panel", label: "Main panel", selector: ".glow-main-panel" },
  { id: "avatar", label: "Tutor avatar", selector: ".glow-avatar" },
];

export function glowTargets(): GlowTarget[] {
  return [
    ...baseGlowTargets,
    ...sidePanelMetadataDefinitions.map((panel) => ({
      id: `panel-${panel.id}`,
      label: `Panel: ${panel.label}`,
      selector: `.glow-panel-${panel.id}`,
    })),
  ];
}

export function glowTargetById(targetId: string): GlowTarget | null {
  return glowTargets().find((target) => target.id === targetId) ?? null;
}

export function glowTargetBySelector(selector: string): GlowTarget | null {
  const trimmed = selector.trim();
  return glowTargets().find((target) => target.selector === trimmed) ?? null;
}
