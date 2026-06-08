import assert from "node:assert/strict";
import test from "node:test";

import { parseScriptMarkerInstances } from "../src/scriptMarkers";
import {
  insertScriptMarkerAt,
  linkedMarkerIndexes,
  replaceScriptMarkerText,
  replaceScriptMarkersInText,
  sourceInsertionIndexBeforeSpokenWord,
} from "../src/features/fineTuningMarkerText";

test("fine tuning marker insertion preserves readable spacing", () => {
  assert.equal(
    insertScriptMarkerAt("First second", 5, "[gslide: 2]"),
    "First [gslide: 2] second",
  );
  assert.equal(
    insertScriptMarkerAt("First second", 0, "[gslide: 1]"),
    "[gslide: 1] First second",
  );
  assert.equal(
    insertScriptMarkerAt("First second", "First second".length, "[gslide: 3]"),
    "First second [gslide: 3]",
  );
});

test("fine tuning marker replacement updates exact marker ranges", () => {
  const sourceText = "Intro [gslide: 1] body";
  const [marker] = parseScriptMarkerInstances(sourceText);

  assert.equal(
    replaceScriptMarkerText(sourceText, marker, "[gslide: 2]"),
    "Intro [gslide: 2] body",
  );
});

test("fine tuning marker replacement applies from the end of the source text", () => {
  const sourceText =
    "Intro [gslide: 1, @500ms] body [play_sound: sounds/thud.mp3, 0.5, @900ms] done";
  const markers = parseScriptMarkerInstances(sourceText);

  assert.equal(
    replaceScriptMarkersInText(sourceText, [
      { marker: markers[0], nextMarker: "[gslide: 2, @600ms]" },
      { marker: markers[1], nextMarker: null },
    ]),
    "Intro [gslide: 2, @600ms] body  done",
  );
});

test("fine tuning insertion indexes skip existing markers", () => {
  const sourceText = "First [gslide: 1] second third";
  const markers = parseScriptMarkerInstances(sourceText);

  assert.equal(
    sourceInsertionIndexBeforeSpokenWord({
      markers,
      text: sourceText,
      wordIndex: 1,
    }),
    sourceText.indexOf("second"),
  );
  assert.equal(
    sourceInsertionIndexBeforeSpokenWord({
      markers,
      text: sourceText,
      wordIndex: 2,
    }),
    sourceText.indexOf("third"),
  );
});

test("fine tuning linked marker lookup returns a full link group", () => {
  const sourceText =
    "One [gslide: 1, @100ms, @link:pair] two [play_sound: sounds/thud.mp3, 0.5, @100ms, @link:pair] three";
  const markers = parseScriptMarkerInstances(sourceText);

  assert.deepEqual(linkedMarkerIndexes(markers, 0), [0, 1]);
  assert.deepEqual(linkedMarkerIndexes(markers, 1), [0, 1]);
});
