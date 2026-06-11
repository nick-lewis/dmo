import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSlideHistory,
  runtimeSlideHistoryFromValue,
  slideHistoryKey,
} from "../src/runtimeUtils";

function slide(pageId: string) {
  return {
    cached: true,
    imageUrl: `https://example.com/${pageId}.png`,
    pageId,
    presentationId: "deck",
    slideRef: pageId,
  };
}

test("appendSlideHistory accumulates revealed slides without duplicates", () => {
  let history = appendSlideHistory([], slide("p1"));
  history = appendSlideHistory(history, slide("p2"));
  // Re-showing a slide keeps its original history position.
  history = appendSlideHistory(history, slide("p1"));

  assert.deepEqual(
    history.map((entry) => entry.pageId),
    ["p1", "p2"],
  );
});

test("slideHistoryKey identifies slides across history and live state", () => {
  assert.equal(slideHistoryKey(slide("p1")), slideHistoryKey(slide("p1")));
  assert.notEqual(slideHistoryKey(slide("p1")), slideHistoryKey(slide("p2")));
});

test("runtimeSlideHistoryFromValue keeps only well-formed slide entries", () => {
  const parsed = runtimeSlideHistoryFromValue([
    slide("p1"),
    { imageUrl: "" },
    "junk",
    null,
    slide("p2"),
  ]);

  assert.deepEqual(
    parsed.map((entry) => entry.pageId),
    ["p1", "p2"],
  );
  assert.deepEqual(runtimeSlideHistoryFromValue("not-a-list"), []);
});
