import {
  type FocusEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { publicAsset } from "../assets";
import { PlayIcon } from "../components/Icons";
import {
  type RealtimeModelId,
  type RealtimeStatus,
  type RealtimeVoiceId,
  classificationModelOptions,
  realtimeModelOptions,
  realtimeVoiceOptionsForModel,
} from "../realtime";
import {
  defaultChoiceIconPath,
  tutorAvatarOptions,
} from "../tutorAssets";
import {
  choiceIconBackgroundInputValue,
  choiceIconBackgroundStyle,
  resizeTextareaToContent,
} from "../uiHelpers";
import type {
  ClassificationModelId,
  TutorSettings,
  VoiceSampleStatus,
} from "../types";


const tutorVoiceTextareaMinHeightPx = 30;
const tutorVoiceTextareaMaxHeightPx = 180;


export type TutorControlsProps = {
  avatarUrl: string;
  error: string;
  isSaving: boolean;
  onAvatarPathChange: (avatarPath: string) => void;
  onChoiceIconBackgroundChange: (color: string) => void;
  onClassificationModelChange: (model: ClassificationModelId) => void;
  onModelChange: (model: RealtimeModelId) => void;
  onNameChange: (assistantName: string) => void;
  onPlaySample?: () => Promise<void> | void;
  onSave: () => Promise<void>;
  onVoiceChange: (voice: RealtimeVoiceId) => void;
  onVoiceInstructionsChange: (voiceInstructions: string) => void;
  realtimeStatus: RealtimeStatus;
  sampleStatus?: VoiceSampleStatus;
  showSaveAction?: boolean;
  tutor: TutorSettings;
};


export function TutorControls({
  avatarUrl,
  error,
  isSaving,
  onAvatarPathChange,
  onChoiceIconBackgroundChange,
  onClassificationModelChange,
  onModelChange,
  onNameChange,
  onPlaySample,
  onSave,
  onVoiceChange,
  onVoiceInstructionsChange,
  sampleStatus = "idle",
  showSaveAction = true,
  tutor,
}: TutorControlsProps) {
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const avatarChoices = tutorAvatarOptions.some(
    (option) => option.path === tutor.avatarPath,
  )
    ? tutorAvatarOptions
    : [{ label: "Current image", path: tutor.avatarPath }, ...tutorAvatarOptions];
  const classificationChoices = classificationModelOptions.some(
    (option) => option.id === tutor.classificationModel,
  )
    ? classificationModelOptions
    : [
        {
          id: tutor.classificationModel,
          label: tutor.classificationModel,
        },
        ...classificationModelOptions,
      ];
  const voiceOptions = realtimeVoiceOptionsForModel(tutor.realtimeModel);
  const sampleActionLabel =
    sampleStatus === "playing"
      ? "Stop voice sample"
      : sampleStatus === "loading"
        ? "Loading voice sample"
        : "Play voice sample";
  const voiceInstructionsTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = voiceInstructionsTextareaRef.current;
    resizeTextareaToContent(textarea, {
      maxHeight: tutorVoiceTextareaMaxHeightPx,
      minHeight: tutorVoiceTextareaMinHeightPx,
    });

    if (!textarea || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      resizeTextareaToContent(textarea, {
        maxHeight: tutorVoiceTextareaMaxHeightPx,
        minHeight: tutorVoiceTextareaMinHeightPx,
      });
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [tutor.voiceInstructions]);

  const closeAvatarPickerOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setIsAvatarPickerOpen(false);
    }
  };

  return (
    <form
      className="tutor-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSaving) onSave();
      }}
    >
      <div className="tutor-compact-grid">
        <div
          className="tutor-avatar-row"
          onBlur={closeAvatarPickerOnBlur}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsAvatarPickerOpen(false);
            }
          }}
        >
          <button
            aria-expanded={isAvatarPickerOpen}
            aria-label="Change tutor image"
            className="tutor-avatar-button"
            onClick={() => setIsAvatarPickerOpen((isOpen) => !isOpen)}
            title="Change tutor image"
            type="button"
          >
            <img alt="" className="tutor-avatar-preview" src={avatarUrl} />
          </button>

          {isAvatarPickerOpen ? (
            <div aria-label="Tutor image choices" className="tutor-avatar-popover">
              {avatarChoices.map((option) => {
                const isSelected = option.path === tutor.avatarPath;

                return (
                  <button
                    aria-label={`Use ${option.label}`}
                    aria-pressed={isSelected}
                    className={`tutor-avatar-option${isSelected ? " selected" : ""}`}
                    key={option.path}
                    onClick={() => {
                      onAvatarPathChange(option.path);
                      setIsAvatarPickerOpen(false);
                    }}
                    title={option.label}
                    type="button"
                  >
                    <img alt="" src={publicAsset(option.path)} />
                  </button>
                );
              })}
            </div>
          ) : null}

          {onPlaySample ? (
            <button
              aria-label={sampleActionLabel}
              className="header-action secondary tutor-sample-button"
              disabled={sampleStatus === "loading"}
              onClick={() => void onPlaySample()}
              title={sampleActionLabel}
              type="button"
            >
              <PlayIcon />
            </button>
          ) : null}
        </div>

        <label className="control-field tutor-choice-icon-field">
          <span>Choice icon</span>
          <span className="tutor-choice-icon-control">
            <span
              aria-hidden="true"
              className="tutor-choice-icon-preview"
              style={choiceIconBackgroundStyle(tutor.choiceIconBackground)}
            >
              <img alt="" src={publicAsset(defaultChoiceIconPath)} />
            </span>
            <input
              aria-label="Choice icon background color"
              onChange={(event) =>
                onChoiceIconBackgroundChange(event.target.value)
              }
              title="Choice icon background color"
              type="color"
              value={choiceIconBackgroundInputValue(tutor.choiceIconBackground)}
            />
          </span>
        </label>

        <label className="control-field">
          <span>Name</span>
          <input
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="dee-lou"
            type="text"
            value={tutor.assistantName}
          />
        </label>

        <label className="control-field">
          <span>Chat model</span>
          <select
            onChange={(event) =>
              onModelChange(event.target.value as RealtimeModelId)
            }
            value={tutor.realtimeModel}
          >
            {realtimeModelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>Voice</span>
          <select
            onChange={(event) =>
              onVoiceChange(event.target.value as RealtimeVoiceId)
            }
            value={tutor.voice}
          >
            {voiceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="tutor-prompt-grid">
          <label className="control-field">
            <span>Personality and tone</span>
            <textarea
              className="prompt-textarea compact"
              onChange={(event) => {
                resizeTextareaToContent(event.currentTarget, {
                  maxHeight: tutorVoiceTextareaMaxHeightPx,
                  minHeight: tutorVoiceTextareaMinHeightPx,
                });
                onVoiceInstructionsChange(event.target.value);
              }}
              placeholder="How the tutor should sound..."
              ref={voiceInstructionsTextareaRef}
              rows={1}
              value={tutor.voiceInstructions}
            />
          </label>
        </div>

        <label className="control-field">
          <span>Classification model</span>
          <select
            onChange={(event) =>
              onClassificationModelChange(
                event.target.value as ClassificationModelId,
              )
            }
            value={tutor.classificationModel}
          >
            {classificationChoices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showSaveAction ? (
        <div className="control-actions single-action">
          <button className="header-action" disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : "Save tutor"}
          </button>
        </div>
      ) : null}

      {error ? <p className="control-error">{error}</p> : null}
    </form>
  );
}
