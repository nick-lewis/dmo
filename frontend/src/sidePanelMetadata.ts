import sidePanelRegistryData from "./sidePanelRegistry.json";

// Global registry of side-panel ("option") types. What a panel does is
// hardcoded in sidePanels.tsx; experiences may override its icon and title
// via Experience.sidePanels without touching code.

export type SidePanelMetadata = {
  description?: string;
  // Flush panels own their full window body (no padding, hidden scrollbar).
  flush?: boolean;
  glyph: string;
  id: string;
  label: string;
  // "hug" panels take their content's height instead of filling the column.
  sizing?: "fill" | "hug";
};

export type SidePanelOverride = {
  iconPath: string;
  nodeEvents?: Record<string, string>;
  panelId: string;
  title: string;
};

export type ResolvedSidePanel = {
  flush: boolean;
  glyph: string;
  iconPath: string;
  id: string;
  nodeEvents: Record<string, string>;
  sizing: "fill" | "hug";
  title: string;
};

export const sidePanelMetadataDefinitions =
  sidePanelRegistryData as SidePanelMetadata[];

export function getSidePanelMetadata(panelId: string) {
  return (
    sidePanelMetadataDefinitions.find((panel) => panel.id === panelId) ?? null
  );
}

export function resolveSidePanels(
  overrides: SidePanelOverride[] | undefined,
): ResolvedSidePanel[] {
  const overrideByPanelId = new Map(
    (overrides ?? [])
      .filter((override) => override && typeof override.panelId === "string")
      .map((override) => [override.panelId, override]),
  );

  return sidePanelMetadataDefinitions.map((panel) => {
    const override = overrideByPanelId.get(panel.id);
    return {
      flush: panel.flush === true,
      glyph: panel.glyph,
      iconPath: (override?.iconPath ?? "").trim(),
      id: panel.id,
      nodeEvents: override?.nodeEvents ?? {},
      sizing: panel.sizing === "hug" ? ("hug" as const) : ("fill" as const),
      title: (override?.title ?? "").trim() || panel.label,
    };
  });
}
