import { Fragment } from "react";

import type { ScriptAudioItem } from "../types";
import {
  displayBreakCount,
  displaySlotWidthStyle,
  displaySlotsAreEqual,
} from "./scriptAudioDisplayUtils";

type ScriptAudioDisplayEditorProps = {
  displayBaseSlots: string[];
  displayBreakDraft: number[];
  displayHasChanges: boolean;
  displaySlotDraft: string[];
  displayWordCountMatches: boolean;
  expectedDisplayWordCount: number;
  isSavingDisplay: boolean;
  item: ScriptAudioItem;
  onRemoveBreak: (slotIndex: number) => void;
  onReset: () => void;
  onSlotChange: (slotIndex: number, value: string) => void;
  onToggleBreak: (slotIndex: number) => void;
  visibleDisplayWordCount: number;
};

export function ScriptAudioDisplayEditor({
  displayBaseSlots,
  displayBreakDraft,
  displayHasChanges,
  displaySlotDraft,
  displayWordCountMatches,
  expectedDisplayWordCount,
  isSavingDisplay,
  item,
  onRemoveBreak,
  onReset,
  onSlotChange,
  onToggleBreak,
  visibleDisplayWordCount,
}: ScriptAudioDisplayEditorProps) {
  return (
    <div className="script-audio-display-editor">
      <div className="script-audio-display-head">
        <strong>Displayed text</strong>
        <span
          className={
            displayWordCountMatches ? "" : "script-audio-word-count-error"
          }
        >
          {displaySlotDraft.length}/{expectedDisplayWordCount || "?"} slots
          {visibleDisplayWordCount !== displaySlotDraft.length
            ? `, ${visibleDisplayWordCount} shown`
            : ""}
        </span>
      </div>
      <div
        aria-label={`Displayed transcript slots for ${item.source}`}
        className="script-audio-display-slots"
        role="group"
      >
        {displaySlotDraft.map((slot, index) => {
          const breakCount = displayBreakCount(displayBreakDraft, index);
          return (
            <Fragment key={`${item.id}-${index}`}>
              <label
                className={[
                  "script-audio-display-slot",
                  slot.trim() ? "" : "is-blank",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span>{index + 1}</span>
                <input
                  aria-label={`Displayed word slot ${index + 1}`}
                  onChange={(event) => onSlotChange(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (index < displaySlotDraft.length - 1) {
                      onToggleBreak(index);
                    }
                  }}
                  placeholder="[blank]"
                  style={displaySlotWidthStyle(slot)}
                  value={slot}
                />
              </label>
              {index < displaySlotDraft.length - 1 ? (
                <span className="script-audio-line-break-control">
                  <button
                    aria-label={`Add line break after displayed word ${index + 1}`}
                    className={[
                      "script-audio-line-break-toggle",
                      breakCount ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onToggleBreak(index)}
                    title={
                      breakCount
                        ? `${breakCount} line break${breakCount === 1 ? "" : "s"} after this word. Click to add another.`
                        : "Add a line break after this word."
                    }
                    type="button"
                  >
                    <span aria-hidden="true">↵</span>
                    {breakCount ? (
                      <span className="script-audio-line-break-count">
                        {breakCount}
                      </span>
                    ) : null}
                  </button>
                  {breakCount ? (
                    <button
                      aria-label={`Remove one line break after displayed word ${index + 1}`}
                      className="script-audio-line-break-remove"
                      onClick={() => onRemoveBreak(index)}
                      title="Remove one line break after this word."
                      type="button"
                    >
                      −
                    </button>
                  ) : null}
                </span>
              ) : null}
              {Array.from({ length: breakCount }, (_, breakIndex) => (
                <span
                  aria-hidden="true"
                  className="script-audio-display-line-break"
                  key={`${item.id}-${index}-break-${breakIndex}`}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
      <div className="script-audio-display-actions">
        <button
          className="header-action secondary"
          disabled={
            isSavingDisplay ||
            (!displayHasChanges &&
              !item.hasDisplayTranscript &&
              displaySlotsAreEqual(displaySlotDraft, displayBaseSlots))
          }
          onClick={onReset}
          title="Clear custom display wording and restore the generated timed transcript."
          type="button"
        >
          Reset display text
        </button>
      </div>
    </div>
  );
}
