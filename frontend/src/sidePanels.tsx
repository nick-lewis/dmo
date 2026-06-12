import type { ReactNode } from "react";

import { RoadmapBoard } from "./features/RoadmapBoard";
import {
  getSidePanelMetadata,
  sidePanelMetadataDefinitions,
  type SidePanelMetadata,
} from "./sidePanelMetadata";
import type { RuntimeRoadmapState } from "./types";

// Component implementations for registered side panels. Panels receive the
// running experience/session context plus panel-relevant runtime state and
// callbacks from the player.

export type SidePanelHost = {
  experienceId: string;
  // Select an available roadmap challenge (may trigger its linked event).
  onRoadmapSelect?: (nodeId: string) => void;
  // Replay an already-completed roadmap challenge (confirmation handled by
  // the board).
  onRoadmapReplay?: (nodeId: string) => void;
  roadmap?: RuntimeRoadmapState;
  runtimeContext: Record<string, unknown>;
  sessionId: string;
};

export type SidePanelProps = {
  host: SidePanelHost;
};

export type SidePanelDefinition = SidePanelMetadata & {
  Component: (props: SidePanelProps) => ReactNode;
};

function RoadmapSidePanel({ host }: SidePanelProps) {
  return (
    <RoadmapBoard
      activeId={host.roadmap?.activeId ?? ""}
      completedIds={new Set(host.roadmap?.completedIds ?? [])}
      onReplayNode={host.onRoadmapReplay}
      onSelectNode={host.onRoadmapSelect}
    />
  );
}

type SidePanelComponent = (props: SidePanelProps) => ReactNode;

const sidePanelComponents: Record<string, SidePanelComponent | undefined> = {
  roadmap: RoadmapSidePanel,
};

export const sidePanelDefinitions: SidePanelDefinition[] =
  sidePanelMetadataDefinitions.flatMap((metadata) => {
    const Component = sidePanelComponents[metadata.id];
    return Component ? [{ ...metadata, Component }] : [];
  });

export function getSidePanelDefinition(
  panelId: string,
): SidePanelDefinition | null {
  const metadata = getSidePanelMetadata(panelId);
  const Component = sidePanelComponents[panelId];
  return metadata && Component ? { ...metadata, Component } : null;
}
