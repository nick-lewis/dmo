import assert from "node:assert/strict";
import test from "node:test";

import type { ScriptMarkerInstance } from "../src/scriptMarkers";
import type { ScriptAudioItem } from "../src/types";
import {
  appendScriptActionHistoryEntry,
  displayBreakDraftForItem,
  insertScriptMarkerAt,
  mergeMarkersIntoSpokenText,
  removeScriptMarker,
  replaceScriptMarker,
  scriptAudioItemForScriptText,
  wordInsertionIndex,
} from "../src/features/nextEditorScriptUtils";

function marker(
  markerText: string,
  start: number,
  end: number,
  wordIndex = 0,
): ScriptMarkerInstance {
  return {
    argList: [],
    args: "",
    detail: "",
    end,
    id: `${start}-${markerText}`,
    label: "Marker",
    marker: markerText,
    start,
    type: "gslide",
    wordIndex,
  };
}

function audioItem(partial: Partial<ScriptAudioItem>): ScriptAudioItem {
  return {
    audioUrl: "",
    cached: false,
    cacheKey: "",
    canGenerate: true,
    displayBaseSlots: [],
    displayBreaks: [],
    displaySlots: [],
    durationSeconds: 0,
    id: "script-1",
    preview: "",
    script: "",
    source: "script",
    wordsCached: false,
    ...partial,
  };
}

test("script marker insertion preserves readable spacing", () => {
  assert.equal(insertScriptMarkerAt("First second", 5, "[gslide: 1]"), "First [gslide: 1] second");
  assert.equal(insertScriptMarkerAt("First second", 0, "[gslide: 1]"), "[gslide: 1] First second");
});

test("script marker replacement and removal keep text clean", () => {
  const source = "First [gslide: 1] second.";
  const existing = marker("[gslide: 1]", 6, 17);

  assert.equal(replaceScriptMarker(source, existing, "[gslide: 2]"), "First [gslide: 2] second.");
  assert.equal(removeScriptMarker(source, existing), "First second.");
});

test("markers merge into spoken text by word index", () => {
  assert.equal(wordInsertionIndex("First second third", 2), 12);
  assert.equal(
    mergeMarkersIntoSpokenText("First second third", [
      marker("[gslide: 2]", 0, 0, 2),
      marker("[play_sound: sounds/thud.mp3]", 0, 0, 0),
    ]),
    "[play_sound: sounds/thud.mp3] First second [gslide: 2] third",
  );
});

test("script action history deduplicates adjacent entries", () => {
  const first = appendScriptActionHistoryEntry([], "one");
  assert.deepEqual(first, ["one"]);
  assert.strictEqual(appendScriptActionHistoryEntry(first, "one"), first);
  assert.deepEqual(appendScriptActionHistoryEntry(first, "two"), ["one", "two"]);
});

test("script audio lookup and display break draft normalization use persisted data", () => {
  const items = [
    audioItem({ id: "a", script: "First second" }),
    audioItem({ id: "b", preview: "Another line" }),
  ];

  assert.equal(scriptAudioItemForScriptText(items, "First\nsecond")?.id, "a");
  assert.equal(scriptAudioItemForScriptText(items, "")?.id, undefined);
  assert.deepEqual(
    displayBreakDraftForItem(
      audioItem({
        displayBaseSlots: ["First", "second", "third"],
        displayBreaks: [0, 99, 1],
        id: "drafted",
      }),
      { drafted: [1, 99, 0] },
    ),
    [0, 1],
  );
});
