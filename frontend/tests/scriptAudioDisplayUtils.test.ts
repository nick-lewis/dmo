import assert from "node:assert/strict";
import test from "node:test";

import { remapDisplayCaretOffset } from "../src/features/scriptAudioDisplayUtils";

test("caret offset survives a placeholder space appearing before it", () => {
  // Live DOM had "Ah, x|there." (caret after the typed x); the re-render
  // inserts an extra space for the emptied slot: "Ah,  xthere.".
  assert.equal(remapDisplayCaretOffset("Ah, xthere.", 5, "Ah,  xthere."), 6);
});

test("caret offset survives whitespace collapsing", () => {
  assert.equal(remapDisplayCaretOffset("one   two", 9, "one two"), 7);
});

test("caret at the start stays at the start", () => {
  assert.equal(remapDisplayCaretOffset("hello there", 0, " hello there"), 0);
});

test("caret past the new text clamps to its end", () => {
  assert.equal(remapDisplayCaretOffset("one two three", 13, "one two"), 7);
});

test("newline-only prefixes map to the start", () => {
  assert.equal(remapDisplayCaretOffset("\n\nword", 2, "word"), 0);
});
