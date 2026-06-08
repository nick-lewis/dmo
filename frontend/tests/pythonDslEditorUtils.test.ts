import assert from "node:assert/strict";
import test from "node:test";

import {
  canSwapDslActionLine,
  formatPythonDsl,
  lineStartOffset,
  parseButtonActionArgumentRanges,
  parseDestinationArgumentRange,
} from "../src/features/pythonDslEditorUtils";

test("formatPythonDsl normalizes indentation and dedents else blocks", () => {
  assert.equal(
    formatPythonDsl("if ready:\nchat(enabled=True)\nelse:\npass\n\n\n"),
    "if ready:\n    chat(enabled=True)\nelse:\n    pass",
  );
});

test("destination parser finds named and positional destination strings", () => {
  assert.deepEqual(
    parseDestinationArgumentRange('goto_event(destination="event-2")', 12),
    {
      from: 23,
      to: 44,
      value: "event-2",
      valueFrom: 36,
      valueTo: 43,
    },
  );

  assert.deepEqual(parseDestinationArgumentRange('goto("slug")', 5), {
    from: 9,
    to: 16,
    value: "slug",
    valueFrom: 11,
    valueTo: 15,
  });
});

test("button parser exposes editable destination and icon ranges", () => {
  const parsed = parseButtonActionArgumentRanges(
    'button(text="Continue", destination="next", icon=False)',
    20,
  );

  assert.equal(parsed.destination?.value, "next");
  assert.equal(parsed.icon?.value, false);
  assert.equal(parsed.icon?.valueFrom, 69);
});

test("line movement helpers preserve hierarchy boundaries", () => {
  assert.equal(
    canSwapDslActionLine(
      ["chat(enabled=True)", "if ready:", "    chat(enabled=False)"],
      0,
      1,
      1,
    ),
    false,
  );
  assert.equal(
    canSwapDslActionLine(["chat(enabled=True)", ""], 0, 1, 1),
    true,
  );
  assert.equal(lineStartOffset(["one", "two", "three"], 2), 8);
});
