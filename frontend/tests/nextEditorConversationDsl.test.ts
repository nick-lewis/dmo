import assert from "node:assert/strict";
import test from "node:test";

import { defaultChoiceIconPath } from "../src/tutorAssets";
import type { EventConversationChoice } from "../src/types";
import {
  conversationChoiceDslSourceFromChoices,
  conversationChoicesFromDslSource,
  parseDslBoolean,
  parseDslValue,
  splitDslArguments,
} from "../src/features/nextEditorConversationDsl";

function choice(
  partial: Partial<EventConversationChoice>,
): EventConversationChoice {
  return {
    enabled: true,
    iconPath: "",
    id: "choice-1",
    label: "Continue",
    sortOrder: 0,
    triggersEvent: "",
    ...partial,
  };
}

test("conversation choice DSL source is sorted and escaped", () => {
  const source = conversationChoiceDslSourceFromChoices([
    choice({
      id: "b",
      label: 'Say "yes"',
      sortOrder: 2,
      triggersEvent: "next",
    }),
    choice({
      iconPath: "icons/choice.png",
      id: "a",
      label: "Start",
      sortOrder: 1,
      triggersEvent: "start",
    }),
  ]);

  assert.equal(
    source,
    'button(text="Start", destination="start", icon=True)\nbutton(text="Say \\"yes\\"", destination="next", icon=False)',
  );
});

test("conversation choice parser handles named and positional arguments", () => {
  const parsed = conversationChoicesFromDslSource(
    [
      'button(text="Begin", destination="event-a", icon=True)',
      "choice('Keep going', 'event-b', icon=False)",
    ].join("\n"),
    [choice({ id: "existing", iconPath: "icons/existing.png" })],
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "existing");
  assert.equal(parsed[0].label, "Begin");
  assert.equal(parsed[0].triggersEvent, "event-a");
  assert.equal(parsed[0].iconPath, "icons/existing.png");
  assert.equal(parsed[1].label, "Keep going");
  assert.equal(parsed[1].triggersEvent, "event-b");
  assert.equal(parsed[1].iconPath, "");
});

test("conversation choice parser keeps an existing choice for partial invalid edits", () => {
  const existing = choice({
    id: "choice-old",
    label: "Old label",
    sortOrder: 0,
    triggersEvent: "old-destination",
  });
  const parsed = conversationChoicesFromDslSource("button(", [existing]);

  assert.deepEqual(parsed, [existing]);
});

test("conversation choice parser creates default icons when enabled without existing icon", () => {
  const parsed = conversationChoicesFromDslSource(
    'button(text="Icon please", destination="event-a", icon=True)',
    [],
  );

  assert.equal(parsed[0].iconPath, defaultChoiceIconPath);
});

test("DSL argument parsing preserves commas and quoted values", () => {
  assert.deepEqual(splitDslArguments('"Hello, friend", destination="next"'), [
    '"Hello, friend"',
    'destination="next"',
  ]);
  assert.equal(parseDslValue("'single quoted'"), "single quoted");
  assert.equal(parseDslBoolean("off", true), false);
  assert.equal(parseDslBoolean(undefined, true), true);
});
