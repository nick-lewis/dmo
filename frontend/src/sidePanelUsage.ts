import { parseScriptMarkerInstances } from "./scriptMarkers";
import {
  getSidePanelMetadata,
  sidePanelMetadataDefinitions,
  type SidePanelOverride,
} from "./sidePanelMetadata";
import type {
  ActionSequenceStep,
  EventActionStep,
  Experience,
  ExperienceEvent,
} from "./types";

export type SidePanelUsage = {
  actionCount: number;
  configured: boolean;
  panelId: string;
  scriptMarkerCount: number;
};

function emptyUsage(panelId: string): SidePanelUsage {
  return {
    actionCount: 0,
    configured: false,
    panelId,
    scriptMarkerCount: 0,
  };
}

function registeredPanelOrder(panelId: string) {
  const index = sidePanelMetadataDefinitions.findIndex(
    (panel) => panel.id === panelId,
  );
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function addUsage(
  usageByPanelId: Map<string, SidePanelUsage>,
  panelId: string,
) {
  const trimmedPanelId = panelId.trim();
  if (!trimmedPanelId || !getSidePanelMetadata(trimmedPanelId)) return null;

  const usage = usageByPanelId.get(trimmedPanelId) ?? emptyUsage(trimmedPanelId);
  usageByPanelId.set(trimmedPanelId, usage);
  return usage;
}

function scanScriptMarkers(
  usageByPanelId: Map<string, SidePanelUsage>,
  text: unknown,
) {
  if (typeof text !== "string" || !text.trim()) return;

  for (const marker of parseScriptMarkerInstances(text)) {
    if (marker.type !== "panel_on" && marker.type !== "panel_off") continue;

    const usage = addUsage(usageByPanelId, marker.argList[0] ?? "");
    if (usage) usage.scriptMarkerCount += 1;
  }
}

function scanActions(
  usageByPanelId: Map<string, SidePanelUsage>,
  actions: Array<ActionSequenceStep | EventActionStep> = [],
) {
  for (const action of actions) {
    if (action.actionType === "side_panel") {
      const panelId =
        typeof action.config?.panelId === "string" ? action.config.panelId : "";
      const usage = addUsage(usageByPanelId, panelId);
      if (usage) usage.actionCount += 1;
    }

    if (action.actionType === "script") {
      scanScriptMarkers(usageByPanelId, action.config?.text);
    }
  }
}

function scanEvent(
  usageByPanelId: Map<string, SidePanelUsage>,
  event: ExperienceEvent,
) {
  scanActions(usageByPanelId, event.steps);

  for (const tool of event.chatTools ?? []) {
    scanActions(usageByPanelId, tool.handlerActions ?? []);
  }
  for (const check of event.conversationChecks ?? []) {
    scanActions(usageByPanelId, check.handlerActions ?? []);
  }
  for (const group of event.classifierGroups ?? []) {
    scanActions(usageByPanelId, group.handlerActions ?? []);
  }
}

function overrideHasSettings(override: SidePanelOverride) {
  return Boolean(
    (override.title ?? "").trim() ||
      (override.iconPath ?? "").trim() ||
      Object.keys(override.nodeEvents ?? {}).length ||
      override.enabled === true,
  );
}

export function sidePanelUsagesFromExperience(
  experience: Experience | null | undefined,
): SidePanelUsage[] {
  if (!experience) return [];

  const usageByPanelId = new Map<string, SidePanelUsage>();

  for (const event of experience.events ?? []) {
    scanEvent(usageByPanelId, event);
  }

  for (const override of experience.sidePanels ?? []) {
    if (!overrideHasSettings(override)) continue;

    const usage = addUsage(usageByPanelId, override.panelId);
    if (usage) usage.configured = true;
  }

  return [...usageByPanelId.values()].sort(
    (left, right) =>
      registeredPanelOrder(left.panelId) - registeredPanelOrder(right.panelId) ||
      left.panelId.localeCompare(right.panelId),
  );
}
