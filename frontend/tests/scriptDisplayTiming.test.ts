import assert from "node:assert/strict";
import test from "node:test";

import {
  alignScriptWordsToDisplaySlots,
  hasStagedDisplayBreak,
  scriptDisplayChunkSpecsFromValues,
  stagedDisplaySplitIndexes,
} from "../src/features/scriptDisplayTiming";

const words = [
  { end: 0.25, start: 0, word: "First" },
  { end: 0.75, start: 0.4, word: "line" },
  { end: 1.5, start: 1.2, word: "second" },
  { end: 2.2, start: 1.8, word: "line" },
];

test("double display breaks produce audio-timed virtual chat chunks", () => {
  const chunks = scriptDisplayChunkSpecsFromValues({
    displayBreaks: [1, 1],
    displaySlots: ["First", "line", "second", "line"],
    durationSeconds: 2.4,
    messageId: "message-1",
    scriptWords: words,
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].fullText, "First line");
  assert.equal(chunks[0].startTime, 0);
  assert.equal(chunks[0].endTime, 1.2);
  assert.equal(chunks[1].fullText, "second line");
  assert.equal(chunks[1].startTime, 1.2);
  assert.equal(chunks[1].id, "message-1:chunk:1");
});

test("single display breaks stay inside one message", () => {
  assert.deepEqual(stagedDisplaySplitIndexes([1]), []);
  assert.equal(hasStagedDisplayBreak([1]), false);
  assert.deepEqual(
    scriptDisplayChunkSpecsFromValues({
      displayBreaks: [1],
      displaySlots: ["First", "line", "second", "line"],
      durationSeconds: 2.4,
      scriptWords: words,
    }),
    [],
  );
});

test("missing word timings do not fake staged chunks", () => {
  assert.equal(hasStagedDisplayBreak([1, 1]), true);
  assert.deepEqual(
    scriptDisplayChunkSpecsFromValues({
      displayBreaks: [1, 1],
      displaySlots: ["First", "line", "second", "line"],
      durationSeconds: 2.4,
      scriptWords: [],
    }),
    [],
  );
});

test("display slots can align to multiple generated timing words", () => {
  const aligned = alignScriptWordsToDisplaySlots(
    ["don't", "stop"],
    [
      { end: 0.1, start: 0, word: "don" },
      { end: 0.2, start: 0.1, word: "t" },
      { end: 0.5, start: 0.3, word: "stop" },
    ],
  );

  assert.deepEqual(aligned, [
    { end: 0.2, start: 0, word: "don't" },
    { end: 0.5, start: 0.3, word: "stop" },
  ]);
});

test("cue offsets shift later chunk starts without changing automatic timing", () => {
  const chunks = scriptDisplayChunkSpecsFromValues({
    displayBreaks: [1, 1],
    displayCueOffsets: [0.25],
    displaySlots: ["First", "line", "second", "line"],
    durationSeconds: 2.4,
    scriptWords: words,
  });

  assert.equal(chunks[1].automaticStartTime, 1.2);
  assert.equal(chunks[1].offsetSeconds, 0.25);
  assert.equal(chunks[1].startTime, 1.45);
});
