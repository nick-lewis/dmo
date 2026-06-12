import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";

import { publicAsset } from "../assets";
import {
  type RoadmapNode,
  type RoadmapNodeStatus,
  roadmapDarkGateId,
  roadmapDarkNodes,
  roadmapDarkTiers,
  roadmapMainNodes,
  roadmapMainTiers,
  roadmapNodeStatus,
} from "../roadmapDefinition";

// LU's roadmap board: a horizontal matcha circuit board where abilities are
// chips. The student can SELECT an available chip (which may trigger an
// experience event); completion only ever comes from authored
// roadmap_complete() actions. Completed chips can be replayed after a
// confirmation modal. Beside the main board sits the gray world ("LU's
// traumatic past"), gated on mastering the main board.
//
// Pure presentational: progress and click handling come from the caller
// (the real player wires the session; the design lab wires fixtures).

const roadmapBoardLayout = {
  cross: 290,
  crossMargin: 80,
  margin: 66,
  tierGap: 112,
};

function roadmapBoardGeometry(tiers: string[][]) {
  const layout = roadmapBoardLayout;
  const along = layout.margin * 2 + (tiers.length - 1) * layout.tierGap;
  const positions: Record<string, { x: number; y: number }> = {};

  tiers.forEach((tier, tierIndex) => {
    const x = layout.margin + tierIndex * layout.tierGap;
    tier.forEach((nodeId, nodeIndex) => {
      const span = layout.cross - layout.crossMargin * 2;
      const y =
        tier.length === 1
          ? layout.cross / 2
          : layout.crossMargin + (span * nodeIndex) / (tier.length - 1);
      positions[nodeId] = { x, y };
    });
  });

  return { height: layout.cross, positions, width: along };
}

// Right-angle PCB trace between two chips.
function roadmapEdgePath(
  positions: Record<string, { x: number; y: number }>,
  fromId: string,
  toId: string,
) {
  const from = positions[fromId];
  const to = positions[toId];
  if (!from || !to) return "";
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

// Drag anywhere on the board to pan its scroll container (the scrollbar is
// hidden); clicks on chips still land as long as the pointer does not move.
function startRoadmapPan(event: ReactPointerEvent<HTMLDivElement>) {
  const scrollerElement = event.currentTarget.closest(".roadmap-scroll");
  if (!(scrollerElement instanceof HTMLElement)) return;
  const scroller: HTMLElement = scrollerElement;

  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = scroller.scrollLeft;
  const startTop = scroller.scrollTop;

  function onMove(moveEvent: PointerEvent) {
    scroller.scrollLeft = startLeft - (moveEvent.clientX - startX);
    scroller.scrollTop = startTop - (moveEvent.clientY - startY);
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

export type RoadmapBoardProps = {
  activeId: string;
  completedIds: ReadonlySet<string>;
  // Editor mode renders every node selectable-looking and routes all clicks
  // (and right-clicks) to the caller without state rules.
  editor?: {
    nodeBadges: Record<string, string>;
    onNodeContextMenu: (
      nodeId: string,
      event: ReactMouseEvent<HTMLElement>,
    ) => void;
  };
  onReplayNode?: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
};

function RoadmapWorld({
  activeId,
  completedIds,
  editor,
  isDark,
  nodes,
  onConfirmReplay,
  onSelectNode,
  tiers,
  title,
}: {
  activeId: string;
  completedIds: ReadonlySet<string>;
  editor?: RoadmapBoardProps["editor"];
  isDark: boolean;
  nodes: RoadmapNode[];
  onConfirmReplay: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  tiers: string[][];
  title: string;
}) {
  const gateOpen =
    Boolean(editor) || !isDark || completedIds.has(roadmapDarkGateId);
  const geometry = roadmapBoardGeometry(tiers);
  const edges = nodes.flatMap((node) =>
    node.requires.map((fromId) => ({ fromId, toId: node.id })),
  );

  return (
    <section
      className={["roadmap-world", isDark ? "is-dark" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {isDark ? (
        <span aria-hidden="true" className="roadmap-dark-caption">
          {gateOpen ? title : `??? · ${title}`}
        </span>
      ) : null}
      <div
        className="roadmap-canvas"
        style={{ height: geometry.height, width: geometry.width }}
      >
        <svg
          aria-hidden="true"
          className="roadmap-edges"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        >
          {edges.map((edge) => (
            <path
              className={[
                "roadmap-edge",
                gateOpen && completedIds.has(edge.fromId) ? "is-lit" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              d={roadmapEdgePath(geometry.positions, edge.fromId, edge.toId)}
              key={`${edge.fromId}-${edge.toId}`}
            />
          ))}
        </svg>
        {nodes.map((node, nodeIndex) => {
          const position = geometry.positions[node.id];
          if (!position) return null;
          const status: RoadmapNodeStatus = editor
            ? "available"
            : roadmapNodeStatus(node, completedIds, gateOpen, activeId);
          const masked = !editor && isDark && !gateOpen;
          const glyph =
            status === "done"
              ? "✓"
              : status === "available" || status === "active"
                ? isDark
                  ? "✦"
                  : String(nodeIndex + 1)
                : masked
                  ? "⛓"
                  : null;
          // Titles only show once a chip is unlocked; masked dark chips
          // whisper "? ? ?" instead.
          const titleText =
            status === "locked" ? (masked ? "? ? ?" : "") : node.title;
          const isClickable =
            Boolean(editor) ||
            (status === "available" && Boolean(onSelectNode)) ||
            status === "done";
          return (
            <button
              aria-label={`${masked || status === "locked" ? "Locked challenge" : node.title} (${status})`}
              className="roadmap-node"
              data-state={status}
              disabled={!isClickable}
              key={node.id}
              onClick={(event) => {
                if (editor) {
                  editor.onNodeContextMenu(node.id, event);
                  return;
                }
                if (status === "available") onSelectNode?.(node.id);
                if (status === "done") onConfirmReplay(node.id);
              }}
              onContextMenu={(event) => {
                if (!editor) return;
                event.preventDefault();
                event.stopPropagation();
                editor.onNodeContextMenu(node.id, event);
              }}
              style={{ left: position.x, top: position.y }}
              type="button"
            >
              <span aria-hidden="true" className="roadmap-node-face">
                {glyph ?? (
                  <img
                    alt=""
                    className="roadmap-node-lock"
                    src={publicAsset("test-images/green-lock.png")}
                  />
                )}
              </span>
              <span className="roadmap-node-title">{titleText}</span>
              {editor?.nodeBadges[node.id] ? (
                <span className="roadmap-node-badge">
                  {editor.nodeBadges[node.id]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function RoadmapBoard({
  activeId,
  completedIds,
  editor,
  onReplayNode,
  onSelectNode,
}: RoadmapBoardProps) {
  const [replayNodeId, setReplayNodeId] = useState("");
  const replayNode =
    [...roadmapMainNodes, ...roadmapDarkNodes].find(
      (node) => node.id === replayNodeId,
    ) ?? null;

  function confirmReplay(nodeId: string) {
    if (!onReplayNode) return;
    setReplayNodeId(nodeId);
  }

  return (
    <div className="roadmap-scroll">
      <div
        className={["roadmap-board", editor ? "is-editor" : ""]
          .filter(Boolean)
          .join(" ")}
        onPointerDown={startRoadmapPan}
      >
        <RoadmapWorld
          activeId={activeId}
          completedIds={completedIds}
          editor={editor}
          isDark={false}
          nodes={roadmapMainNodes}
          onConfirmReplay={confirmReplay}
          onSelectNode={onSelectNode}
          tiers={roadmapMainTiers}
          title="LU's upgrades"
        />
        <RoadmapWorld
          activeId={activeId}
          completedIds={completedIds}
          editor={editor}
          isDark
          nodes={roadmapDarkNodes}
          onConfirmReplay={confirmReplay}
          onSelectNode={onSelectNode}
          tiers={roadmapDarkTiers}
          title="LU's traumatic past"
        />
      </div>
      {replayNode ? (
        <div
          className="roadmap-replay-backdrop"
          onClick={() => setReplayNodeId("")}
          role="presentation"
        >
          <div
            aria-label="Replay completed challenge"
            className="roadmap-replay-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <p>
              Do you want to do the completed challenge{" "}
              <strong>{replayNode.title}</strong> again?
            </p>
            <div className="roadmap-replay-actions">
              <button
                onClick={() => {
                  const nodeId = replayNode.id;
                  setReplayNodeId("");
                  onReplayNode?.(nodeId);
                }}
                type="button"
              >
                Yes, play it again
              </button>
              <button onClick={() => setReplayNodeId("")} type="button">
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
