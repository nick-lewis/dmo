import sidePanelRegistryData from "./sidePanelRegistry.json";

// Global registry of side-panel ("option") types. What a panel does is
// hardcoded in sidePanels.tsx; experiences may override its icon and title
// via Experience.sidePanels without touching code.

export type SidePanelMetadata = {
  description?: string;
  glyph: string;
  id: string;
  label: string;
};

export type SidePanelOverride = {
  iconPath: string;
  panelId: string;
  title: string;
};

export type ResolvedSidePanel = {
  glyph: string;
  iconPath: string;
  id: string;
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
      glyph: panel.glyph,
      iconPath: (override?.iconPath ?? "").trim(),
      id: panel.id,
      title: (override?.title ?? "").trim() || panel.label,
    };
  });
}
