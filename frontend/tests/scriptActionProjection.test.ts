import assert from "node:assert/strict";
import test from "node:test";

import { parseScriptMarkerInstances } from "../src/scriptMarkers";
import {
  projectScriptActionsToDisplayText,
  sourceMarkerForView,
} from "../src/features/scriptActionProjection";

test("projection keeps actions in display text and groups slide rows", () => {
  const sourceText =
    "Intro [gslide: 2] Slide text [play_sound: sounds/thud.mp3, 0.5]";
  const sourceMarkers = parseScriptMarkerInstances(sourceText);
  const projected = projectScriptActionsToDisplayText({
    displayBreaks: [0, 0],
    displaySlots: ["Intro", "Slide", "text"],
    markers: sourceMarkers,
    sourceText,
  });

  assert.equal(projected.markers.length, 2);
  assert.equal(sourceMarkerForView(projected.markers[0]), sourceMarkers[0]);
  assert.match(projected.text, /\[gslide: 2\]/);
  assert.match(projected.text, /\[play_sound: sounds\/thud\.mp3, 0\.5\]/);
  assert.deepEqual(projected.rows.map((row) => row.label), [
    "No slide",
    "Slide 2",
  ]);
});

test("timed markers project by audio timing when timing words are available", () => {
  const sourceText = "First second [gslide: 3, @1.2s] third";
  const sourceMarkers = parseScriptMarkerInstances(sourceText);
  const projected = projectScriptActionsToDisplayText({
    displayBreaks: [],
    displaySlots: ["First", "second", "third"],
    markers: sourceMarkers,
    sourceText,
    timingWords: [
      { end: 0.2, start: 0, word: "First" },
      { end: 0.8, start: 0.5, word: "second" },
      { end: 1.5, start: 1.2, word: "third" },
    ],
  });

  assert.equal(projected.markers.length, 1);
  assert.match(projected.text, /First second \[gslide: 3, @1.2s\] third/);
});
