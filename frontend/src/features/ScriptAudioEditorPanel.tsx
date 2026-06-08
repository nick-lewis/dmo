import { type Ref } from "react";

import { SettingsIcon } from "../components/Icons";

type ScriptAudioEditorPanelProps = {
  audioText: string;
  audioTextareaRef: Ref<HTMLTextAreaElement>;
  hasCustomVoiceInstructions: boolean;
  isAudioTextDisabled: boolean;
  isVoiceSettingsDisabled: boolean;
  isVoiceSettingsOpen: boolean;
  onAudioTextBlur: () => void;
  onAudioTextChange: (
    value: string,
    selectionStart: number | null,
    selectionEnd: number | null,
    selectionDirection: "backward" | "forward" | "none" | null,
  ) => void;
  onAudioTextFocus: (value: string) => void;
  onSaveVoiceInstructions: () => void | Promise<unknown>;
  onToggleVoiceSettings: () => void;
  onVoiceInstructionsChange: (value: string) => void;
  voiceInstructionsDraft: string;
  voiceInstructionsRef: Ref<HTMLInputElement>;
};

export function ScriptAudioEditorPanel({
  audioText,
  audioTextareaRef,
  hasCustomVoiceInstructions,
  isAudioTextDisabled,
  isVoiceSettingsDisabled,
  isVoiceSettingsOpen,
  onAudioTextBlur,
  onAudioTextChange,
  onAudioTextFocus,
  onSaveVoiceInstructions,
  onToggleVoiceSettings,
  onVoiceInstructionsChange,
  voiceInstructionsDraft,
  voiceInstructionsRef,
}: ScriptAudioEditorPanelProps) {
  return (
    <div
      className={[
        "next-audio-script-panel",
        isVoiceSettingsOpen ? "has-voice-settings" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="next-audio-script-toolbar">
        {hasCustomVoiceInstructions ? (
          <span>custom personality and tone</span>
        ) : null}
        <button
          aria-label="Audio script personality and tone"
          aria-expanded={isVoiceSettingsOpen}
          aria-pressed={isVoiceSettingsOpen}
          className={[
            "next-script-voice-settings-button",
            hasCustomVoiceInstructions ? "has-custom" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={isVoiceSettingsDisabled}
          onClick={onToggleVoiceSettings}
          title={
            hasCustomVoiceInstructions
              ? "Custom personality and tone for this audio script"
              : "Personality and tone for this audio script"
          }
          type="button"
        >
          <SettingsIcon />
        </button>
      </div>
      <div
        aria-hidden={!isVoiceSettingsOpen}
        className={[
          "next-script-voice-panel",
          isVoiceSettingsOpen ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <input
          aria-label="Audio script personality and tone"
          className="next-script-voice-input"
          disabled={isVoiceSettingsDisabled || !isVoiceSettingsOpen}
          onBlur={() => void onSaveVoiceInstructions()}
          onChange={(event) =>
            onVoiceInstructionsChange(event.currentTarget.value)
          }
          onContextMenu={(event) => event.stopPropagation()}
          ref={voiceInstructionsRef}
          spellCheck
          tabIndex={isVoiceSettingsOpen ? 0 : -1}
          type="text"
          value={voiceInstructionsDraft}
        />
      </div>
      <div className="next-script-textarea-shell">
        <textarea
          aria-label="Audio script text"
          className="next-script-textarea"
          disabled={isAudioTextDisabled}
          onBlur={onAudioTextBlur}
          onChange={(event) =>
            onAudioTextChange(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              event.currentTarget.selectionDirection,
            )
          }
          onContextMenu={(event) => event.stopPropagation()}
          onFocus={(event) => onAudioTextFocus(event.currentTarget.value)}
          placeholder="No script text yet."
          ref={audioTextareaRef}
          spellCheck
          value={audioText}
        />
      </div>
    </div>
  );
}
