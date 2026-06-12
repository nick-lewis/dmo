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
  // Whether the panel is part of this experience at all; chosen in the
  // panel editor. Only enabled panels can appear in the player's dock.
  enabled?: boolean;
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

export type SidePanelGlobalSetting = {
  iconPath: string;
  panelId: string;
  title: string;
};

export function resolveSidePanels(
  overrides: SidePanelOverride[] | undefined,
  globalSettings: SidePanelGlobalSetting[] = [],
): ResolvedSidePanel[] {
  const overrideByPanelId = new Map(
    (overrides ?? [])
      .filter((override) => override && typeof override.panelId === "string")
      .map((override) => [override.panelId, override]),
  );
  const settingByPanelId = new Map(
    globalSettings
      .filter((setting) => setting && typeof setting.panelId === "string")
      .map((setting) => [setting.panelId, setting]),
  );

  // Only panels added to the experience (in the panel editor) resolve;
  // runtime actions then control when they become available/open. Icon and
  // title fall back: experience override -> user global setting -> registry.
  return sidePanelMetadataDefinitions.flatMap((panel) => {
    const override = overrideByPanelId.get(panel.id);
    if (override?.enabled !== true) return [];
    const setting = settingByPanelId.get(panel.id);
    return [
      {
        flush: panel.flush === true,
        glyph: panel.glyph,
        iconPath:
          (override.iconPath ?? "").trim() ||
          (setting?.iconPath ?? "").trim(),
        id: panel.id,
        nodeEvents: override.nodeEvents ?? {},
        sizing: panel.sizing === "hug" ? ("hug" as const) : ("fill" as const),
        title:
          (override.title ?? "").trim() ||
          (setting?.title ?? "").trim() ||
          panel.label,
      },
    ];
  });
}
