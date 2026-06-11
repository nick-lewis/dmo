import assert from "node:assert/strict";
import test from "node:test";

import {
  canSwapDslActionLine,
  formatPythonDsl,
  lineStartOffset,
  parseButtonActionArgumentRanges,
  parseDestinationArgumentRange,
  removedScriptActionIndices,
  scriptActionRangesFromSource,
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

test("script action ranges skip commented lines", () => {
  const source = 'chat(enabled=False)\nscript()\n# script()\nscript("x")';
  assert.deepEqual(scriptActionRangesFromSource(source), [
    { from: 20, to: 28 },
    { from: 40, to: 51 },
  ]);
});

function mapThroughSingleDeletion(deleteFrom: number, deleteTo: number) {
  return (position: number) => {
    if (position <= deleteFrom) return position;
    if (position >= deleteTo) return position - (deleteTo - deleteFrom);
    return deleteFrom;
  };
}

test("deleting the first of two script lines reports index 0", () => {
  const oldSource = "script()\nscript()";
  const newSource = "script()";
  const mapPosition = mapThroughSingleDeletion(0, 9);
  assert.deepEqual(
    removedScriptActionIndices(
      scriptActionRangesFromSource(oldSource),
      scriptActionRangesFromSource(newSource),
      mapPosition,
    ),
    [0],
  );
});

test("deleting the last script line reports the last index", () => {
  const oldSource = "script()\nscript()";
  const newSource = "script()";
  const mapPosition = mapThroughSingleDeletion(8, 17);
  assert.deepEqual(
    removedScriptActionIndices(
      scriptActionRangesFromSource(oldSource),
      scriptActionRangesFromSource(newSource),
      mapPosition,
    ),
    [1],
  );
});

test("backspacing one character inside a script call reports it removed", () => {
  const oldSource = "script()\nscript()";
  const newSource = "script(\nscript()";
  const mapPosition = mapThroughSingleDeletion(7, 8);
  assert.deepEqual(
    removedScriptActionIndices(
      scriptActionRangesFromSource(oldSource),
      scriptActionRangesFromSource(newSource),
      mapPosition,
    ),
    [0],
  );
});

test("inserting a script line reports no removals", () => {
  const oldSource = "script()";
  const newSource = "script()\nscript()";
  const mapPosition = (position: number) => position;
  assert.deepEqual(
    removedScriptActionIndices(
      scriptActionRangesFromSource(oldSource),
      scriptActionRangesFromSource(newSource),
      mapPosition,
    ),
    [],
  );
});
