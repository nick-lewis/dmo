import { useEffect, useRef, useState } from "react";

import { apiFetch, experienceEditPath, experienceRunPath } from "../api";
import { PlusIcon, TrashIcon } from "../components/Icons";
import { readSelectedExperienceId, writeSelectedExperienceId } from "../persistence";
import type { ApiUser, Experience, ExperienceForm, ExperiencesPayload, SessionPayload } from "../types";

const experienceAutosaveDelayMs = 700;

export function ExperienceHome() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ExperienceForm>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const autosaveTimers = useRef<Record<string, number>>({});
  const autosaveVersions = useRef<Record<string, number>>({});

  function draftFromExperience(experience: Experience): ExperienceForm {
    return {
      description: experience.description,
      title: experience.title,
    };
  }

  function draftsFromExperiences(nextExperiences: Experience[]) {
    return Object.fromEntries(
      nextExperiences.map((experience) => [
        experience.id,
        draftFromExperience(experience),
      ]),
    );
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadExperiences() {
      setStatus("loading");
      setError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const savedExperienceId = readSelectedExperienceId();
        const chosenExperience =
          payload.experiences.find(
            (experience) => experience.id === savedExperienceId,
          ) ??
          payload.experiences.find(
            (experience) => experience.id === payload.currentExperienceId,
          ) ??
          payload.experiences[0];

        if (!chosenExperience) {
          throw new Error("Could not load an experience.");
        }

        if (isCancelled) return;

        setUser(me.user);
        setExperiences(payload.experiences);
        setDrafts(draftsFromExperiences(payload.experiences));
        writeSelectedExperienceId(chosenExperience.id);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load experiences.",
        );
      }
    }

    loadExperiences();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

  function hasDraftChanges(experience: Experience, draft: ExperienceForm) {
    return (
      draft.title !== experience.title ||
      draft.description !== experience.description
    );
  }

  function clearAutosaveTimer(experienceId: string) {
    const timer = autosaveTimers.current[experienceId];
    if (timer) {
      window.clearTimeout(timer);
      delete autosaveTimers.current[experienceId];
    }
  }

  function nextAutosaveVersion(experienceId: string) {
    const version = (autosaveVersions.current[experienceId] ?? 0) + 1;
    autosaveVersions.current[experienceId] = version;
    return version;
  }

  async function persistExperienceDraft(
    experienceId: string,
    draft: ExperienceForm,
    version: number,
  ) {
    if (!draft.title.trim()) return true;
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experienceId}/`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );

      if (autosaveVersions.current[experienceId] !== version) return true;

      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      setDrafts((current) => {
        const currentDraft = current[payload.experience.id];
        if (
          currentDraft &&
          (currentDraft.title !== draft.title ||
            currentDraft.description !== draft.description)
        ) {
          return current;
        }

        return {
          ...current,
          [payload.experience.id]: draftFromExperience(payload.experience),
        };
      });
      return true;
    } catch (saveError) {
      if (autosaveVersions.current[experienceId] === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save experience.",
        );
      }
      return false;
    }
  }

  function queueExperienceAutosave(experience: Experience, draft: ExperienceForm) {
    clearAutosaveTimer(experience.id);

    if (!draft.title.trim() || !hasDraftChanges(experience, draft)) return;

    const version = nextAutosaveVersion(experience.id);
    autosaveTimers.current[experience.id] = window.setTimeout(() => {
      delete autosaveTimers.current[experience.id];
      void persistExperienceDraft(experience.id, draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushExperienceAutosave(experience: Experience) {
    const draft = drafts[experience.id] ?? draftFromExperience(experience);
    clearAutosaveTimer(experience.id);

    if (!hasDraftChanges(experience, draft)) return true;

    const version = nextAutosaveVersion(experience.id);
    return persistExperienceDraft(experience.id, draft, version);
  }

  async function runExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
    if (!didSave) return;

    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({ experienceId: experience.id }),
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Could not start a fresh run.",
      );
      return;
    }

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceRunPath(experience.id));
  }

  async function editExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
    if (!didSave) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceEditPath(experience.id));
  }

  async function deleteExperience(experience: Experience) {
    const didConfirm = window.confirm(`Delete "${experience.title}"?`);
    if (!didConfirm) return;

    clearAutosaveTimer(experience.id);
    setError("");

    try {
      const payload = await apiFetch<ExperiencesPayload>(
        `/api/experiences/${experience.id}/`,
        {
          method: "DELETE",
        },
      );
      setExperiences(payload.experiences);
      setDrafts(draftsFromExperiences(payload.experiences));
      writeSelectedExperienceId(payload.currentExperienceId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete experience.",
      );
    }
  }

  function updateDraft(
    experience: Experience,
    draft: ExperienceForm,
    field: keyof ExperienceForm,
    value: string,
  ) {
    const nextDraft = {
      ...draft,
      [field]: value,
    };

    setDrafts((current) => ({
      ...current,
      [experience.id]: nextDraft,
    }));
    queueExperienceAutosave(experience, nextDraft);
  }

  async function createExperience() {
    setIsCreating(true);
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>("/api/experiences/", {
        method: "POST",
        body: JSON.stringify({
          description: "",
          title: "Untitled experience",
        }),
      });
      setExperiences((current) => [payload.experience, ...current]);
      setDrafts((current) => ({
        ...current,
        [payload.experience.id]: draftFromExperience(payload.experience),
      }));
      writeSelectedExperienceId(payload.experience.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create experience.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function signOut() {
    setIsSigningOut(true);

    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout/", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } finally {
      window.location.assign("/accounts/login/");
    }
  }

  return (
    <main
      className="panel-study experience-home-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">dLU</p>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={signOut}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="experience-home">
        <div className="experience-home-title">
          <h1>Experiences</h1>
          <button
            aria-label={isCreating ? "Creating experience" : "New experience"}
            className="experience-create-button"
            disabled={isCreating}
            onClick={createExperience}
            title={isCreating ? "Creating experience" : "New experience"}
            type="button"
          >
            <PlusIcon />
          </button>
        </div>

        {status === "loading" ? (
          <div className="experience-state">Loading experiences...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        <div className="experience-list">
          {experiences.map((experience) => {
            const draft = drafts[experience.id] ?? draftFromExperience(experience);

            return (
              <div
                className="experience-row"
                key={experience.id}
              >
                <button
                  aria-label={`Delete ${draft.title || "experience"}`}
                  className="experience-delete-button"
                  onClick={() => void deleteExperience(experience)}
                  title="Delete experience"
                  type="button"
                >
                  <TrashIcon />
                </button>
                <div className="experience-row-main">
                  <input
                    aria-label="Experience title"
                    className="experience-title-input"
                    onChange={(event) =>
                      updateDraft(
                        experience,
                        draft,
                        "title",
                        event.target.value,
                      )
                    }
                    type="text"
                    value={draft.title}
                  />
                  <input
                    aria-label="Experience description"
                    className="experience-description-input"
                    onChange={(event) =>
                      updateDraft(
                        experience,
                        draft,
                        "description",
                        event.target.value,
                      )
                    }
                    placeholder="---"
                    type="text"
                    value={draft.description}
                  />
                </div>
                <div className="experience-row-actions">
                  <button
                    className="header-action secondary"
                    onClick={() => void editExperience(experience)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="header-action"
                    onClick={() => void runExperience(experience)}
                    type="button"
                  >
                    Run
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
