import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFineTuningTimelineLayout,
  normalizedWaveformWindow,
  shiftedWaveformWindow,
  visibleWaveformPeaksForWindow,
  waveformPercentForTime,
  type FineTuningTimelineVisibility,
} from "../src/features/fineTuningTimelineLayout";
import type { ScriptMarkerInstance } from "../src/scriptMarkers";

function marker(type: string, id: string): ScriptMarkerInstance {
  return {
    argList: [],
    args: "",
    detail: id,
    end: 0,
    id,
    label: id,
    marker: `[${type}]`,
    start: 0,
    type,
    wordIndex: 0,
  };
}

const allVisible: FineTuningTimelineVisibility = {
  actions: true,
  chatCues: true,
  slides: true,
};

test("waveform windows clamp to a minimum span and valid bounds", () => {
  assert.deepEqual(normalizedWaveformWindow({ end: 1.02, start: 0.98 }, 0.1), {
    end: 1,
    start: 0.9,
  });
  assert.deepEqual(shiftedWaveformWindow({ end: 0.5, start: 0.2 }, 0.9), {
    end: 1,
    start: 0.7,
  });
});

test("waveform helper slices peaks for the visible window", () => {
  assert.deepEqual(visibleWaveformPeaksForWindow([1, 2, 3, 4, 5], {
    end: 0.6,
    start: 0.2,
  }), [2, 3]);
  assert.equal(
    waveformPercentForTime(5, 10, { end: 0.75, start: 0.25 }, 0.5),
    50,
  );
});

test("timeline layout stacks chips that would overlap and flags exact time matches", () => {
  const layout = buildFineTuningTimelineLayout({
    displayCues: [
      {
        chunk: {
          automaticStartTime: 2,
          boundaryIndex: 0,
          endSlot: 2,
          endTime: 3,
          fullText: "chunk",
          id: "chunk-1",
          index: 0,
          offsetSeconds: 0,
          startSlot: 2,
          startTime: 2,
        },
        index: 0,
        timeSeconds: 2,
        widthPx: 80,
      },
    ],
    durationForLayout: 10,
    markers: [
      { index: 0, marker: marker("gslide", "slide"), timeSeconds: 2, widthPx: 80 },
      { index: 1, marker: marker("play_sound", "sound"), timeSeconds: 2, widthPx: 80 },
    ],
    timelineVisibility: allVisible,
    visibleWaveformWindow: { end: 1, start: 0 },
    visibleWaveformWindowSpan: 1,
    waveformWidth: 320,
  });

  assert.equal(layout.timelineMarkers.length, 2);
  assert.equal(layout.displayCueLayouts.length, 1);
  assert.deepEqual(layout.timelineMarkers.map((item) => item.lane), [0, 1]);
  assert.equal(layout.displayCueLayouts[0].lane, 2);
  assert.equal(layout.laneCount, 3);
  assert.equal(layout.timelineMarkers[0].hasTimeMatch, true);
  assert.equal(layout.displayCueLayouts[0].hasTimeMatch, true);
});

test("timeline visibility filters slide, action, and chat cue layers", () => {
  const layout = buildFineTuningTimelineLayout({
    displayCues: [
      {
        chunk: {
          automaticStartTime: 2,
          boundaryIndex: 0,
          endSlot: 2,
          endTime: 3,
          fullText: "chunk",
          id: "chunk-1",
          index: 0,
          offsetSeconds: 0,
          startSlot: 2,
          startTime: 2,
        },
        index: 0,
        timeSeconds: 2,
        widthPx: 80,
      },
    ],
    durationForLayout: 10,
    markers: [
      { index: 0, marker: marker("gslide", "slide"), timeSeconds: 2, widthPx: 80 },
      { index: 1, marker: marker("play_sound", "sound"), timeSeconds: 2, widthPx: 80 },
    ],
    timelineVisibility: {
      actions: false,
      chatCues: false,
      slides: true,
    },
    visibleWaveformWindow: { end: 1, start: 0 },
    visibleWaveformWindowSpan: 1,
    waveformWidth: 320,
  });

  assert.deepEqual(layout.timelineMarkers.map((item) => item.marker.type), [
    "gslide",
  ]);
  assert.deepEqual(layout.displayCueLayouts, []);
});
