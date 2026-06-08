import assert from "node:assert/strict";
import test from "node:test";

import type {
  EventActionStep,
  ExperienceEvent,
} from "../src/types";
import {
  activeScriptActionFromStored,
  readLocationNextEditorUiState,
  scriptDetailTabFromStored,
  selectedEventIdFromStored,
  sortedEventSteps,
  sortedScriptSteps,
  writeLocationNextEditorUiState,
} from "../src/features/nextEditorUiState";

function step(partial: Partial<EventActionStep>): EventActionStep {
  return {
    actionType: "script",
    condition: {},
    config: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    enabled: true,
    eventId: "event-1",
    id: "step-1",
    label: "Script",
    sortOrder: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function event(partial: Partial<ExperienceEvent>): ExperienceEvent {
  return {
    chatInstructions: "",
    chatTools: [],
    classifierGroups: [],
    conversationChecks: [],
    conversationChoices: [],
    conversationDslSource: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    description: "",
    experienceId: "experience-1",
    id: "event-1",
    isStart: false,
    onEntryDslSource: "",
    slug: "event-1",
    sortOrder: 0,
    steps: [],
    title: "Event",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("event step helpers sort deterministically and filter script actions", () => {
  const steps = [
    step({ actionType: "set_context", createdAt: "2026-01-01T00:00:02.000Z", id: "b", sortOrder: 1 }),
    step({ createdAt: "2026-01-01T00:00:01.000Z", id: "a", sortOrder: 1 }),
    step({ id: "first", sortOrder: 0 }),
  ];

  assert.deepEqual(sortedEventSteps(steps).map((item) => item.id), [
    "first",
    "a",
    "b",
  ]);
  assert.deepEqual(
    sortedScriptSteps(event({ steps })).map((item) => item.id),
    ["first", "a"],
  );
});

test("stored event and script selection restores only valid targets", () => {
  const events = [
    event({
      id: "event-a",
      steps: [step({ eventId: "event-a", id: "script-a", sortOrder: 0 })],
    }),
  ];

  assert.equal(
    selectedEventIdFromStored({ selectedEventId: "event-a" }, events),
    "event-a",
  );
  assert.equal(
    selectedEventIdFromStored({ selectedEventId: "missing" }, events),
    "",
  );

  assert.deepEqual(
    activeScriptActionFromStored(
      {
        activeScriptAction: {
          actionIndex: 0,
          eventId: "event-a",
          lineNumber: 4,
          source: "script()",
        },
      },
      events,
    ),
    {
      actionIndex: 0,
      eventId: "event-a",
      from: 0,
      lineNumber: 4,
      source: "script()",
      to: 0,
    },
  );
  assert.equal(
    activeScriptActionFromStored(
      { activeScriptAction: { actionIndex: 2, eventId: "event-a" } },
      events,
    ),
    null,
  );
});

test("script detail tab restores known tabs only", () => {
  assert.equal(scriptDetailTabFromStored({ scriptDetailTab: "fine-tuning" }), "fine-tuning");
  assert.equal(scriptDetailTabFromStored({ scriptDetailTab: "display" }), "display");
  assert.equal(scriptDetailTabFromStored({ scriptDetailTab: "audio" }), "audio");
  assert.equal(scriptDetailTabFromStored({ scriptDetailTab: "unknown" as never }), "audio");
});

test("location UI state reads and writes stable editor hashes", () => {
  const originalWindow = globalThis.window;
  let replacedUrl = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      history: {
        replaceState(_state: unknown, _title: string, url: string) {
          replacedUrl = url;
        },
        state: {},
      },
      location: {
        hash: "#event=event-a&script=1&tab=script",
        pathname: "/experiences/1/next",
        search: "?debug=1",
      },
    },
  });

  try {
    assert.deepEqual(readLocationNextEditorUiState(), {
      activeScriptAction: {
        actionIndex: 1,
        eventId: "event-a",
        source: "script()",
      },
      scriptDetailTab: "script",
      selectedEventId: "event-a",
    });

    writeLocationNextEditorUiState({
      activeScriptAction: { actionIndex: 2, eventId: "event-b" },
      scriptDetailTab: "fine-tuning",
      selectedEventId: "event-b",
    });
    assert.equal(
      replacedUrl,
      "/experiences/1/next?debug=1#event=event-b&script=2&tab=fine-tuning",
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
