// LU's roadmap: the level-unlock graph behind the roadmap side panel.
// The graph itself is global (hardcoded for now); which experience event each
// node triggers is configured PER EXPERIENCE in Experience.sidePanels
// (override.nodeEvents, edited in the panel editor). Progress lives in the
// session's runtime state (uiRuntime.roadmap): the student selects a
// challenge, but only authored roadmap_complete() actions finish one.

export type RoadmapNode = {
  id: string;
  requires: string[];
  title: string;
};

export const roadmapMainNodes: RoadmapNode[] = [
  { id: "predict", requires: [], title: "Predict one value" },
  { id: "knobs", requires: ["predict"], title: "Predict yes or no" },
  { id: "loss", requires: ["knobs"], title: "Learn from mistakes" },
  {
    id: "nudge",
    requires: ["loss"],
    title: "Recognize handwritten digits",
  },
  { id: "patterns", requires: ["loss"], title: "Spot patterns in images" },
  {
    id: "loop",
    requires: ["nudge", "patterns"],
    title: "Predict the next word",
  },
  { id: "smarter", requires: ["loop"], title: "Teach LU something new" },
];

// The dark world is deliberately NOT wired into the main board's edges; its
// gate is finishing the main board, checked separately.
export const roadmapDarkGateId = "smarter";

export const roadmapDarkNodes: RoadmapNode[] = [
  { id: "dataset", requires: [], title: "The first dataset" },
  { id: "forgot", requires: ["dataset"], title: "What LU forgot" },
  { id: "deleted", requires: ["dataset"], title: "The deleted weights" },
  { id: "why", requires: ["forgot", "deleted"], title: "Why LU teaches" },
];

export const roadmapMainTiers: string[][] = [
  ["predict"],
  ["knobs"],
  ["loss"],
  ["nudge", "patterns"],
  ["loop"],
  ["smarter"],
];

export const roadmapDarkTiers: string[][] = [
  ["dataset"],
  ["forgot", "deleted"],
  ["why"],
];

// Four states: locked → available (reachable) → active (the challenge the
// learner selected and is working on) → done.
export type RoadmapNodeStatus = "active" | "available" | "done" | "locked";

export function roadmapNodeStatus(
  node: RoadmapNode,
  completedIds: ReadonlySet<string>,
  gateOpen: boolean,
  activeId: string,
): RoadmapNodeStatus {
  if (completedIds.has(node.id)) return "done";
  if (!gateOpen) return "locked";
  if (!node.requires.every((id) => completedIds.has(id))) return "locked";
  return node.id === activeId ? "active" : "available";
}

export function roadmapStateFromValue(value: unknown): {
  activeId: string;
  completedIds: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { activeId: "", completedIds: [] };
  }
  const record = value as Record<string, unknown>;
  const completedIds = Array.isArray(record.completedIds)
    ? record.completedIds.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
  return {
    activeId: typeof record.activeId === "string" ? record.activeId : "",
    completedIds,
  };
}
