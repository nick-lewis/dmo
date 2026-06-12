import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultGlowColor,
  glowTargetById,
  glowTargetBySelector,
  glowTargets,
} from "../src/glowTargets";
import {
  parsePythonDslStepActions,
  pythonDslSourceFromEventSteps,
} from "../src/features/pythonDslActions";
import {
  roadmapMainNodes,
  roadmapNodeStatus,
  roadmapStateFromValue,
} from "../src/roadmapDefinition";
import { runtimeSidePanelsFromRecord } from "../src/runtimeUtils";
import { resolveSidePanels } from "../src/sidePanelMetadata";
import type { EventActionStep } from "../src/types";

function stepFixture(
  actionType: EventActionStep["actionType"],
  config: Record<string, unknown>,
  sortOrder: number,
  enabled = true,
): EventActionStep {
  return {
    actionType,
    condition: {},
    config,
    createdAt: "2026-01-01T00:00:00Z",
    enabled,
    eventId: "event-1",
    id: `step-${sortOrder}`,
    label: "",
    sortOrder,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

test("resolveSidePanels resolves only panels enabled for the experience", () => {
  const resolved = resolveSidePanels([
    {
      enabled: true,
      iconPath: "icons/map.png",
      panelId: "roadmap",
      title: "Lou's Map",
    },
  ]);
  const roadmap = resolved.find((panel) => panel.id === "roadmap");
  assert.ok(roadmap);
  assert.equal(roadmap.title, "Lou's Map");
  assert.equal(roadmap.iconPath, "icons/map.png");

  // Defaults apply when the enabled override leaves title/icon empty.
  const bare = resolveSidePanels([
    { enabled: true, iconPath: "", panelId: "roadmap", title: "" },
  ]).find((panel) => panel.id === "roadmap");
  assert.ok(bare);
  assert.equal(bare.title, "LU's Roadmap");

  // Panels not added to the experience do not resolve at all.
  assert.deepEqual(resolveSidePanels(undefined), []);
  assert.deepEqual(
    resolveSidePanels([
      { iconPath: "", panelId: "roadmap", title: "Custom" },
    ]),
    [],
  );
});

test("runtimeSidePanelsFromRecord keeps only available panels", () => {
  assert.deepEqual(
    runtimeSidePanelsFromRecord({
      code: { available: false, open: true },
      roadmap: { available: true, open: true },
      sketch: { available: true },
    }),
    {
      roadmap: { available: true, open: true },
      sketch: { available: true, open: false },
    },
  );
  assert.deepEqual(runtimeSidePanelsFromRecord(null), {});
});

test("glow targets resolve by id and reverse-map by selector", () => {
  const chatInput = glowTargetById("chat-input");
  assert.ok(chatInput);
  assert.equal(chatInput.selector, ".glow-chat-input");
  assert.equal(glowTargetBySelector(".glow-chat-input")?.id, "chat-input");
  assert.equal(glowTargetById("panel-roadmap")?.selector, ".glow-panel-roadmap");
  assert.ok(glowTargets().length >= 5);
});

test("panel() DSL lines parse with modes and default to open", () => {
  assert.deepEqual(parsePythonDslStepActions('panel("roadmap")'), [
    { actionType: "side_panel", mode: "open", panelId: "roadmap" },
  ]);
  assert.deepEqual(
    parsePythonDslStepActions('panel("roadmap", mode="available")'),
    [{ actionType: "side_panel", mode: "available", panelId: "roadmap" }],
  );
  assert.deepEqual(parsePythonDslStepActions('panel("roadmap", "off")'), [
    { actionType: "side_panel", mode: "off", panelId: "roadmap" },
  ]);
});

test("glow() DSL lines resolve named targets and drop unknown ones", () => {
  assert.deepEqual(parsePythonDslStepActions('glow("chat-input")'), [
    {
      actionType: "highlight_on",
      color: defaultGlowColor,
      selector: ".glow-chat-input",
    },
  ]);
  assert.deepEqual(
    parsePythonDslStepActions('glow("avatar", color="rgba(255,0,0,0.5)")'),
    [
      {
        actionType: "highlight_on",
        color: "rgba(255,0,0,0.5)",
        selector: ".glow-avatar",
      },
    ],
  );
  assert.deepEqual(parsePythonDslStepActions('glow_off("chat-input")'), [
    { actionType: "highlight_off", selector: ".glow-chat-input" },
  ]);
  assert.deepEqual(parsePythonDslStepActions('glow("not-a-target")'), []);
});

test("panel and glow steps project back into DSL source", () => {
  const source = pythonDslSourceFromEventSteps([
    stepFixture(
      "side_panel",
      { mode: "open", panelId: "roadmap", source: "next-on-entry-dsl" },
      0,
    ),
    stepFixture(
      "highlight_on",
      {
        color: defaultGlowColor,
        selector: ".glow-chat-input",
        source: "next-on-entry-dsl",
      },
      1,
    ),
    stepFixture(
      "highlight_off",
      { selector: ".glow-avatar", source: "next-on-entry-dsl" },
      2,
    ),
  ]);
  assert.equal(
    source,
    'panel("roadmap")\nglow("chat-input")\nglow_off("avatar")',
  );
});

test("projection skips conversation-sourced and legacy highlight steps", () => {
  const source = pythonDslSourceFromEventSteps([
    stepFixture(
      "side_panel",
      { mode: "open", panelId: "roadmap", source: "next-conversation-dsl" },
      0,
    ),
    // Legacy old-editor highlight: no source tag, raw selector.
    stepFixture(
      "highlight_on",
      { color: "red", selector: ".runtime-notes-toggle" },
      1,
    ),
  ]);
  assert.equal(source, "");
});

test("round trip: parsed DSL re-projects to the same source", () => {
  const original = 'panel("roadmap", mode="available")\nglow("main-panel")';
  const actions = parsePythonDslStepActions(original);
  const steps = actions.map((action, index) => {
    if (action.actionType === "side_panel") {
      return stepFixture(
        "side_panel",
        {
          mode: action.mode,
          panelId: action.panelId,
          source: "next-on-entry-dsl",
        },
        index,
      );
    }
    if (action.actionType === "highlight_on") {
      return stepFixture(
        "highlight_on",
        {
          color: action.color,
          selector: action.selector,
          source: "next-on-entry-dsl",
        },
        index,
      );
    }
    throw new Error("unexpected action");
  });
  assert.equal(pythonDslSourceFromEventSteps(steps), original);
});

test("roadmap_complete DSL lines parse and project back to source", () => {
  assert.deepEqual(parsePythonDslStepActions('roadmap_complete("predict")'), [
    { actionType: "roadmap_complete", nodeId: "predict" },
  ]);
  assert.deepEqual(parsePythonDslStepActions("roadmap_complete()"), []);

  const step = stepFixture(
    "roadmap_complete",
    { nodeId: "predict", source: "next-on-entry-dsl" },
    0,
  );
  assert.equal(
    pythonDslSourceFromEventSteps([step]),
    'roadmap_complete("predict")',
  );
});

test("roadmap node status derives locked/available/active/done", () => {
  const completed = new Set(["predict"]);
  const byId = new Map(roadmapMainNodes.map((node) => [node.id, node]));
  const knobs = byId.get("knobs");
  const loss = byId.get("loss");
  const predict = byId.get("predict");
  assert.ok(knobs && loss && predict);

  assert.equal(roadmapNodeStatus(predict, completed, true, ""), "done");
  assert.equal(roadmapNodeStatus(knobs, completed, true, ""), "available");
  assert.equal(roadmapNodeStatus(knobs, completed, true, "knobs"), "active");
  assert.equal(roadmapNodeStatus(loss, completed, true, ""), "locked");
  // A closed gate locks everything that is not already done.
  assert.equal(roadmapNodeStatus(knobs, completed, false, ""), "locked");
});

test("roadmapStateFromValue tolerates malformed session state", () => {
  assert.deepEqual(roadmapStateFromValue(undefined), {
    activeId: "",
    completedIds: [],
  });
  assert.deepEqual(
    roadmapStateFromValue({
      activeId: "knobs",
      completedIds: ["predict", 7, ""],
    }),
    { activeId: "knobs", completedIds: ["predict"] },
  );
});
