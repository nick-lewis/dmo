import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";

import { publicAsset } from "../assets";
import { MicIcon, SettingsIcon } from "../components/Icons";
import {
  type RealtimeModelId,
  type RealtimeVoiceId,
  classificationModelOptions,
  isRealtimeVoiceSupported,
  realtimeModelOptions,
  realtimeVoiceOptionsForModel,
} from "../realtime";
import { resizeTextareaToContent } from "../uiHelpers";
import type {
  ClassificationModelId,
  ExperienceForm,
  TutorSettings,
  VoiceSampleStatus,
} from "../types";
import {
  ImageLibraryPicker,
  type ImageLibraryOption,
} from "./ImageLibraryPicker";

const tutorVoiceTextareaMinHeightPx = 36;
const tutorVoiceTextareaMaxHeightPx = 160;

type NextEditorOverviewHeaderProps = {
  deletingScriptImagePath: string;
  experienceForm: ExperienceForm;
  isLoadingScriptImages: boolean;
  isTutorAvatarPickerOpen: boolean;
  isTutorSettingsOpen: boolean;
  isUploadingTutorAvatar: boolean;
  onDeleteUploadedImage: (path: string, label: string) => void;
  onFlushTutorAutosave: () => void | Promise<unknown>;
  onLoadScriptImages: () => void;
  onPlayVoiceSample: () => void | Promise<unknown>;
  onScriptTextRevealSpeedBlur: () => void;
  onScriptTextRevealSpeedChange: (value: string) => void;
  onSelectTutorAvatar: (path: string) => void;
  onTutorAvatarUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onTutorDraftChange: <Key extends keyof TutorSettings>(
    field: Key,
    value: TutorSettings[Key],
  ) => void;
  onTutorModelDraftChange: (model: RealtimeModelId) => void;
  onUpdateOverviewDraft: (field: keyof ExperienceForm, value: string) => void;
  scriptImageOptions: ImageLibraryOption[];
  scriptTextRevealSpeedDraft: string;
  setIsTutorAvatarPickerOpen: Dispatch<SetStateAction<boolean>>;
  setIsTutorSettingsOpen: Dispatch<SetStateAction<boolean>>;
  tutorAvatarPickerOptions: ImageLibraryOption[];
  tutorForm: TutorSettings;
  voiceSampleStatus: VoiceSampleStatus;
};

export function NextEditorOverviewHeader({
  deletingScriptImagePath,
  experienceForm,
  isLoadingScriptImages,
  isTutorAvatarPickerOpen,
  isTutorSettingsOpen,
  isUploadingTutorAvatar,
  onDeleteUploadedImage,
  onFlushTutorAutosave,
  onLoadScriptImages,
  onPlayVoiceSample,
  onScriptTextRevealSpeedBlur,
  onScriptTextRevealSpeedChange,
  onSelectTutorAvatar,
  onTutorAvatarUpload,
  onTutorDraftChange,
  onTutorModelDraftChange,
  onUpdateOverviewDraft,
  scriptImageOptions,
  scriptTextRevealSpeedDraft,
  setIsTutorAvatarPickerOpen,
  setIsTutorSettingsOpen,
  tutorAvatarPickerOptions,
  tutorForm,
  voiceSampleStatus,
}: NextEditorOverviewHeaderProps) {
  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const tutorAvatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const tutorPresenceRef = useRef<HTMLDivElement | null>(null);
  const tutorVoiceInstructionsRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeTextareaToContent(overviewDescriptionRef.current);
  }, [experienceForm.description]);

  useEffect(() => {
    if (!isTutorSettingsOpen) return;

    resizeTextareaToContent(tutorVoiceInstructionsRef.current, {
      maxHeight: tutorVoiceTextareaMaxHeightPx,
      minHeight: tutorVoiceTextareaMinHeightPx,
    });
  }, [isTutorSettingsOpen, tutorForm.voiceInstructions]);

  useEffect(() => {
    if (!isTutorSettingsOpen) return;

    function closeIfOutsideTarget(target: EventTarget | null) {
      const node = target as Node | null;
      if (node && tutorPresenceRef.current?.contains(node)) return;

      setIsTutorSettingsOpen(false);
      void onFlushTutorAutosave();
    }

    function closeIfOutsidePointer(event: PointerEvent) {
      closeIfOutsideTarget(event.target);
    }

    function closeIfOutsideContextMenu(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && tutorPresenceRef.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      setIsTutorSettingsOpen(false);
      void onFlushTutorAutosave();
    }

    document.addEventListener("pointerdown", closeIfOutsidePointer, true);
    document.addEventListener("contextmenu", closeIfOutsideContextMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutsidePointer, true);
      document.removeEventListener(
        "contextmenu",
        closeIfOutsideContextMenu,
        true,
      );
    };
  }, [isTutorSettingsOpen, onFlushTutorAutosave, setIsTutorSettingsOpen]);

  useEffect(() => {
    if (isTutorSettingsOpen) return;
    setIsTutorAvatarPickerOpen(false);
  }, [isTutorSettingsOpen, setIsTutorAvatarPickerOpen]);

  const voiceOptions = realtimeVoiceOptionsForModel(tutorForm.realtimeModel);
  const activeVoice = isRealtimeVoiceSupported(
    tutorForm.realtimeModel,
    tutorForm.voice,
  )
    ? tutorForm.voice
    : (voiceOptions[0]?.id ?? tutorForm.voice);
  const classificationChoices = classificationModelOptions.some(
    (option) => option.id === tutorForm.classificationModel,
  )
    ? classificationModelOptions
    : [
        {
          id: tutorForm.classificationModel,
          label: tutorForm.classificationModel,
        },
        ...classificationModelOptions,
      ];
  const sampleActionLabel =
    voiceSampleStatus === "playing"
      ? "Stop voice sample"
      : voiceSampleStatus === "loading"
        ? "Loading voice sample"
        : "Play voice sample";
  const tutorAvatarUploadLabel = isUploadingTutorAvatar
    ? "Uploading tutor image"
    : "Upload tutor image";

  return (
    <section className="next-editor-overview-section">
      <div className="next-overview-editor">
        <div className="overview-editor">
          <input
            aria-label="Experience title"
            className="overview-title-text"
            onChange={(event) =>
              onUpdateOverviewDraft("title", event.target.value)
            }
            type="text"
            value={experienceForm.title}
          />
          <textarea
            aria-label="Experience description"
            className="overview-description-text"
            onChange={(event) =>
              onUpdateOverviewDraft("description", event.target.value)
            }
            onInput={(event) => resizeTextareaToContent(event.currentTarget)}
            placeholder="---"
            ref={overviewDescriptionRef}
            rows={1}
            value={experienceForm.description}
          />
        </div>
      </div>
      <div
        className="next-tutor-presence"
        ref={tutorPresenceRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsTutorSettingsOpen(false);
            void onFlushTutorAutosave();
          }
        }}
      >
        <div
          className="next-tutor-avatar-wrap"
          data-settings-open={isTutorSettingsOpen ? "true" : "false"}
          onContextMenu={(event) => {
            event.preventDefault();
            setIsTutorSettingsOpen(true);
          }}
        >
          <img
            alt=""
            className="next-tutor-avatar"
            src={publicAsset(tutorForm.avatarPath)}
          />
          <button
            aria-label={sampleActionLabel}
            className="next-tutor-play-button"
            disabled={voiceSampleStatus === "loading"}
            onClick={() => void onPlayVoiceSample()}
            title={sampleActionLabel}
            type="button"
          >
            <MicIcon />
          </button>
          <button
            aria-label="Tutor settings"
            aria-expanded={isTutorSettingsOpen}
            className="next-tutor-settings-button"
            onClick={() => setIsTutorSettingsOpen((isOpen) => !isOpen)}
            title="Tutor settings"
            type="button"
          >
            <SettingsIcon />
          </button>
        </div>
        {isTutorSettingsOpen ? (
          <div aria-label="Tutor settings" className="next-tutor-settings-menu">
            <div className="next-tutor-avatar-options">
              <span>Image</span>
              <div className="next-tutor-avatar-control">
                <button
                  aria-expanded={isTutorAvatarPickerOpen}
                  aria-label="Choose tutor image"
                  className="next-tutor-avatar-preview-button"
                  onClick={() => {
                    setIsTutorAvatarPickerOpen((isOpen) => !isOpen);
                    if (
                      !isTutorAvatarPickerOpen &&
                      !scriptImageOptions.length &&
                      !isLoadingScriptImages
                    ) {
                      onLoadScriptImages();
                    }
                  }}
                  title="Choose tutor image"
                  type="button"
                >
                  <img alt="" src={publicAsset(tutorForm.avatarPath)} />
                </button>
                <button
                  className="next-tutor-avatar-upload-button"
                  disabled={isUploadingTutorAvatar}
                  onClick={() => tutorAvatarFileInputRef.current?.click()}
                  title={tutorAvatarUploadLabel}
                  type="button"
                >
                  {isUploadingTutorAvatar ? "Uploading" : "Upload"}
                </button>
                {isTutorAvatarPickerOpen ? (
                  <ImageLibraryPicker
                    ariaLabel="Tutor image options"
                    classNames={{
                      deleteButton: "next-tutor-avatar-delete-button",
                      empty: "next-tutor-avatar-picker-empty",
                      option: "next-tutor-avatar-option",
                      optionMain: "next-tutor-avatar-option-main",
                      picker: "next-tutor-avatar-picker",
                    }}
                    deletingPath={deletingScriptImagePath}
                    emptyLabel="No images yet"
                    isLoading={isLoadingScriptImages}
                    onDelete={onDeleteUploadedImage}
                    onSelect={onSelectTutorAvatar}
                    options={tutorAvatarPickerOptions}
                    selectedPath={tutorForm.avatarPath}
                  />
                ) : null}
              </div>
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="next-tutor-avatar-file-input"
                onChange={onTutorAvatarUpload}
                ref={tutorAvatarFileInputRef}
                type="file"
              />
            </div>
            <label className="control-field">
              <span>Name</span>
              <input
                onChange={(event) =>
                  onTutorDraftChange("assistantName", event.target.value)
                }
                type="text"
                value={tutorForm.assistantName}
              />
            </label>
            <label className="control-field">
              <span>Voice</span>
              <select
                onChange={(event) =>
                  onTutorDraftChange(
                    "voice",
                    event.target.value as RealtimeVoiceId,
                  )
                }
                value={activeVoice}
              >
                {voiceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="control-field next-tutor-speed-field"
              title="Speed of pseudo generation of pre-generated scripts."
            >
              <span>Text reveal speed</span>
              <input
                aria-label="Text reveal speed"
                max="4"
                min="0.7"
                onChange={(event) =>
                  onScriptTextRevealSpeedChange(event.target.value)
                }
                onBlur={onScriptTextRevealSpeedBlur}
                step="0.05"
                type="number"
                value={scriptTextRevealSpeedDraft}
              />
            </label>
            <label className="control-field">
              <span>Chat model</span>
              <select
                onChange={(event) =>
                  onTutorModelDraftChange(event.target.value as RealtimeModelId)
                }
                value={tutorForm.realtimeModel}
              >
                {realtimeModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-field">
              <span>Classification model</span>
              <select
                onChange={(event) =>
                  onTutorDraftChange(
                    "classificationModel",
                    event.target.value as ClassificationModelId,
                  )
                }
                value={tutorForm.classificationModel}
              >
                {classificationChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-field">
              <span>Personality and tone</span>
              <textarea
                className="prompt-textarea compact"
                onChange={(event) => {
                  resizeTextareaToContent(event.currentTarget, {
                    maxHeight: tutorVoiceTextareaMaxHeightPx,
                    minHeight: tutorVoiceTextareaMinHeightPx,
                  });
                  onTutorDraftChange("voiceInstructions", event.target.value);
                }}
                ref={tutorVoiceInstructionsRef}
                rows={1}
                value={tutorForm.voiceInstructions}
              />
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
