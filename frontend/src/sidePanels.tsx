import type { ReactNode } from "react";

import {
  getSidePanelMetadata,
  sidePanelMetadataDefinitions,
  type SidePanelMetadata,
} from "./sidePanelMetadata";

// Component implementations for registered side panels. Panels receive the
// running experience/session context so future panels can read database-backed
// data; the roadmap starts blank on purpose.

export type SidePanelHost = {
  experienceId: string;
  runtimeContext: Record<string, unknown>;
  sessionId: string;
};

export type SidePanelProps = {
  host: SidePanelHost;
};

export type SidePanelDefinition = SidePanelMetadata & {
  Component: (props: SidePanelProps) => ReactNode;
};

function RoadmapSidePanel(_props: SidePanelProps) {
  return <div className="side-panel-roadmap" aria-label="Roadmap" />;
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
