import {
  type Dispatch,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import {
  type RealtimeModelId,
  isRealtimeVoiceSupported,
  realtimeVoiceOptionsForModel,
} from "../realtime";
import { apiFetch } from "../api";
import { choiceIconBackgroundValue } from "../uiHelpers";
import type {
  Experience,
  ExperienceForm,
  TutorSettings,
} from "../types";

type OverviewAutosaveOptions = {
  delayMs: number;
  experience: Experience | null;
  experienceForm: ExperienceForm;
  setError: Dispatch<SetStateAction<string>>;
  setExperience: Dispatch<SetStateAction<Experience | null>>;
  setExperienceForm: Dispatch<SetStateAction<ExperienceForm>>;
};

export function useOverviewAutosave({
  delayMs,
  experience,
  experienceForm,
  setError,
  setExperience,
  setExperienceForm,
}: OverviewAutosaveOptions) {
  const overviewAutosaveTimer = useRef<number | null>(null);
  const overviewAutosaveVersion = useRef(0);

  function hasOverviewChanges(draft: ExperienceForm) {
    if (!experience) return false;
    return (
      draft.title !== experience.title ||
      draft.description !== experience.description
    );
  }

  function clearOverviewAutosaveTimer() {
    if (!overviewAutosaveTimer.current) return;
    window.clearTimeout(overviewAutosaveTimer.current);
    overviewAutosaveTimer.current = null;
  }

  function nextOverviewAutosaveVersion() {
    overviewAutosaveVersion.current += 1;
    return overviewAutosaveVersion.current;
  }

  async function persistOverviewDraft(draft: ExperienceForm, version: number) {
    if (!experience || !draft.title.trim()) return true;
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );

      if (overviewAutosaveVersion.current !== version) return true;

      setExperience(payload.experience);
      setExperienceForm((current) => {
        if (
          current.title !== draft.title ||
          current.description !== draft.description
        ) {
          return current;
        }

        return {
          description: payload.experience.description,
          title: payload.experience.title,
        };
      });
      return true;
    } catch (saveError) {
      if (overviewAutosaveVersion.current === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save experience.",
        );
      }
      return false;
    }
  }

  function queueOverviewAutosave(draft: ExperienceForm) {
    clearOverviewAutosaveTimer();

    if (!draft.title.trim() || !hasOverviewChanges(draft)) return;

    const version = nextOverviewAutosaveVersion();
    overviewAutosaveTimer.current = window.setTimeout(() => {
      overviewAutosaveTimer.current = null;
      void persistOverviewDraft(draft, version);
    }, delayMs);
  }

  async function flushOverviewAutosave() {
    clearOverviewAutosaveTimer();

    if (!hasOverviewChanges(experienceForm)) return true;

    const version = nextOverviewAutosaveVersion();
    return persistOverviewDraft(experienceForm, version);
  }

  function updateOverviewDraft(field: keyof ExperienceForm, value: string) {
    const nextDraft = {
      ...experienceForm,
      [field]: value,
    };

    setExperienceForm(nextDraft);
    queueOverviewAutosave(nextDraft);
  }

  return {
    clearOverviewAutosaveTimer,
    flushOverviewAutosave,
    updateOverviewDraft,
  };
}

type TutorAutosaveOptions = {
  delayMs: number;
  experience: Experience | null;
  loadScriptAudioItems: (experienceId: string, showLoading: boolean) => void;
  setError: Dispatch<SetStateAction<string>>;
  setExperience: Dispatch<SetStateAction<Experience | null>>;
  setTutorForm: Dispatch<SetStateAction<TutorSettings>>;
  tutorForm: TutorSettings;
};

export function useTutorAutosave({
  delayMs,
  experience,
  loadScriptAudioItems,
  setError,
  setExperience,
  setTutorForm,
  tutorForm,
}: TutorAutosaveOptions) {
  const tutorAutosaveTimer = useRef<number | null>(null);
  const tutorAutosaveVersion = useRef(0);
  const [isSavingTutor, setIsSavingTutor] = useState(false);

  function hasTutorChanges(draft: TutorSettings) {
    if (!experience) return false;

    return (
      draft.assistantName !== experience.tutor.assistantName ||
      draft.avatarPath !== experience.tutor.avatarPath ||
      choiceIconBackgroundValue(draft.choiceIconBackground) !==
        choiceIconBackgroundValue(experience.tutor.choiceIconBackground) ||
      draft.classificationModel !== experience.tutor.classificationModel ||
      draft.realtimeModel !== experience.tutor.realtimeModel ||
      draft.systemPrompt !== experience.tutor.systemPrompt ||
      draft.voice !== experience.tutor.voice ||
      draft.voiceInstructions !== experience.tutor.voiceInstructions
    );
  }

  function clearTutorAutosaveTimer() {
    if (!tutorAutosaveTimer.current) return;
    window.clearTimeout(tutorAutosaveTimer.current);
    tutorAutosaveTimer.current = null;
  }

  function nextTutorAutosaveVersion() {
    tutorAutosaveVersion.current += 1;
    return tutorAutosaveVersion.current;
  }

  async function persistTutorDraft(draft: TutorSettings, version: number) {
    if (!experience || !draft.assistantName.trim()) return true;
    setIsSavingTutor(true);
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ tutor: draft }),
        },
      );

      if (tutorAutosaveVersion.current !== version) return true;

      setExperience(payload.experience);
      setTutorForm((current) => {
        if (
          current.assistantName !== draft.assistantName ||
          current.avatarPath !== draft.avatarPath ||
          choiceIconBackgroundValue(current.choiceIconBackground) !==
            choiceIconBackgroundValue(draft.choiceIconBackground) ||
          current.classificationModel !== draft.classificationModel ||
          current.realtimeModel !== draft.realtimeModel ||
          current.systemPrompt !== draft.systemPrompt ||
          current.voice !== draft.voice ||
          current.voiceInstructions !== draft.voiceInstructions
        ) {
          return current;
        }

        return payload.experience.tutor;
      });
      void loadScriptAudioItems(payload.experience.id, false);
      return true;
    } catch (saveError) {
      if (tutorAutosaveVersion.current === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save tutor settings.",
        );
      }
      return false;
    } finally {
      setIsSavingTutor(false);
    }
  }

  function queueTutorAutosave(draft: TutorSettings) {
    clearTutorAutosaveTimer();

    if (!draft.assistantName.trim() || !hasTutorChanges(draft)) return;

    const version = nextTutorAutosaveVersion();
    tutorAutosaveTimer.current = window.setTimeout(() => {
      tutorAutosaveTimer.current = null;
      void persistTutorDraft(draft, version);
    }, delayMs);
  }

  async function flushTutorAutosave() {
    clearTutorAutosaveTimer();

    if (!hasTutorChanges(tutorForm)) return true;

    const version = nextTutorAutosaveVersion();
    return persistTutorDraft(tutorForm, version);
  }

  function updateTutorDraft<K extends keyof TutorSettings>(
    field: K,
    value: TutorSettings[K],
  ) {
    setTutorForm((current) => {
      const nextDraft = {
        ...current,
        [field]: value,
      };

      queueTutorAutosave(nextDraft);
      return nextDraft;
    });
  }

  function updateTutorModelDraft(realtimeModel: RealtimeModelId) {
    setTutorForm((current) => {
      const supportedVoice = isRealtimeVoiceSupported(realtimeModel, current.voice)
        ? current.voice
        : (realtimeVoiceOptionsForModel(realtimeModel)[0]?.id ?? current.voice);
      const nextDraft = {
        ...current,
        realtimeModel,
        voice: supportedVoice,
      };

      queueTutorAutosave(nextDraft);
      return nextDraft;
    });
  }

  return {
    clearTutorAutosaveTimer,
    flushTutorAutosave,
    isSavingTutor,
    updateTutorDraft,
    updateTutorModelDraft,
  };
}
