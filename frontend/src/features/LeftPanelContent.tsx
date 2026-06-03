import type {
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import {
  PythonNotebookPanel,
  PythonTerminalPanel,
  type PythonNotebookState,
  type PythonNotebookStatus,
} from "../PythonNotebookPanel";
import type {
  ApiUser,
  Experience,
  ExperienceForm,
  ResolvedSlide,
  RuntimeNote,
  SlideStatus,
} from "../types";
import type { TutorControlsProps } from "./TutorControls";


export const leftPanels = [
  { density: "tall", kind: "experience", label: "Experience" },
  { density: "tutor", kind: "tutor", label: "Tutor settings" },
  { density: "notebook", kind: "notebook", label: "Python notebook" },
  { density: "terminal", kind: "terminal", label: "Python terminal" },
] as const;

export type LeftPanelKind = (typeof leftPanels)[number]["kind"];


type ExperienceControlsProps = {
  chatStatus: "loading" | "ready" | "error";
  error: string;
  experienceForm: ExperienceForm;
  experiences: Experience[];
  isCreatingExperience: boolean;
  isCreatingSession: boolean;
  isSavingExperience: boolean;
  isSigningOut: boolean;
  onCreateExperience: () => Promise<void>;
  onCreateNewSession: () => Promise<void>;
  onExperienceFormChange: Dispatch<SetStateAction<ExperienceForm>>;
  onSaveExperience: () => Promise<void>;
  onSelectExperience: (experienceId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  selectedExperienceId: string;
  user: ApiUser | null;
};

type SlideControlsProps = {
  deckUrl: string;
  error: string;
  onClear: () => void;
  onDeckUrlChange: (url: string) => void;
  onRefreshSlide: () => void;
  onResolveSlide: () => void;
  onSampleDeck: () => void;
  onSlideRefChange: (slideRef: string) => void;
  resolvedSlide: ResolvedSlide | null;
  slideRef: string;
  status: SlideStatus;
};

type PythonNotebookControlsProps = {
  error: string;
  notebook: PythonNotebookState;
  onChange: (notebook: PythonNotebookState) => void;
  onClearOutputs: () => void;
  onFormatCell: (cellId: string) => void;
  onRunAll: () => void;
  onRunCell: (cellId: string) => void;
  status: PythonNotebookStatus;
};


export function LeftPanelContent({
  experience,
  kind,
  notebook,
  runtime,
  slides,
  tutor,
}: {
  experience: ExperienceControlsProps;
  kind: LeftPanelKind;
  notebook: PythonNotebookControlsProps;
  runtime: {
    notes: RuntimeNote[];
    notesVisible: boolean;
    onToggleNotes: () => void;
  };
  slides: SlideControlsProps;
  tutor: TutorControlsProps;
}) {
  void slides;

  if (kind === "experience") {
    return (
      <RuntimePlaceholderPanel
        kicker={experience.chatStatus === "ready" ? "Running" : "Workspace"}
        title="Experience context"
        tags={["Session", "Learner", "State"]}
      >
        <p>
          This panel will hold run-specific context: current event, learner
          state, and lightweight controls that belong to the live experience.
        </p>
        <p className="muted-copy">
          Authoring settings now live in the experience editor.
        </p>
        <button
          aria-pressed={runtime.notesVisible}
          className="runtime-inline-button runtime-notes-toggle"
          onClick={runtime.onToggleNotes}
          type="button"
        >
          {runtime.notesVisible ? "Notes open" : "Open notes"}
        </button>
        {runtime.notes.length ? (
          <div className="runtime-note-list" aria-label="Runtime notes">
            {runtime.notes.slice(-4).reverse().map((note) => (
              <div className="runtime-note-item" key={note.id}>
                {note.text}
              </div>
            ))}
          </div>
        ) : null}
      </RuntimePlaceholderPanel>
    );
  }

  if (kind === "tutor") {
    return (
      <RuntimePlaceholderPanel
        kicker={tutor.tutor.assistantName || "dee-lou"}
        title="Tutor runtime"
        tags={[tutor.tutor.realtimeModel, tutor.tutor.voice, tutor.realtimeStatus]}
      >
        <p>
          Runtime-only tutor signals can live here later: speaking state,
          current instructions, tool calls, or transcript diagnostics.
        </p>
      </RuntimePlaceholderPanel>
    );
  }

  if (kind === "notebook") {
    return (
      <PythonNotebookPanel
        error={notebook.error}
        notebook={notebook.notebook}
        onChange={notebook.onChange}
        onClearOutputs={notebook.onClearOutputs}
        onFormatCell={notebook.onFormatCell}
        onRunAll={notebook.onRunAll}
        onRunCell={notebook.onRunCell}
        status={notebook.status}
      />
    );
  }

  if (kind === "terminal") {
    return (
      <PythonTerminalPanel
        error={notebook.error}
        notebook={notebook.notebook}
        onRunAll={notebook.onRunAll}
        status={notebook.status}
      />
    );
  }

  return (
    <div className="text-stack">
      <div className="tag-row">
        <span>Objective</span>
        <span>Constraint</span>
      </div>
      <p>
        The student has a partly correct first move. The interface should make
        supporting context easy to scan without competing with the main work area.
      </p>
      <p className="muted-copy">
        Preferred response shape: short question, one target, no full solution yet.
      </p>
    </div>
  );
}


function RuntimePlaceholderPanel({
  children,
  kicker,
  tags,
  title,
}: {
  children: ReactNode;
  kicker: string;
  tags: string[];
  title: string;
}) {
  return (
    <div className="text-stack runtime-placeholder">
      <div className="runtime-placeholder-header">
        <span>{kicker}</span>
        <strong>{title}</strong>
      </div>
      <div className="tag-row">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {children}
    </div>
  );
}
