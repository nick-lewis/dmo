import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import {
  apiFetch,
  experienceEditPath,
  experienceNextEditPath,
  experienceRunPath,
} from "../api";
import { InspectorIcon, PlayIcon, PlusIcon } from "../components/Icons";
import { writeSelectedExperienceId } from "../persistence";
import type {
  ApiUser,
  Experience,
  ExperienceEvent,
  ExperiencesPayload,
  SessionPayload,
} from "../types";

type ShowcaseVariant = "script" | "stage" | "flow";

type MockupEvent = {
  checkCount: number;
  choiceCount: number;
  description: string;
  id: string;
  isStart: boolean;
  routeCount: number;
  slug: string;
  stepCount: number;
  title: string;
  toolCount: number;
};

type CueTrack = "voice" | "stage" | "learner" | "check" | "route";

type TimelineCue = {
  detail: string;
  id: string;
  kind: CueTrack;
  label: string;
  start: number;
  span: number;
  track: CueTrack;
};

const showcaseVariants: Array<{ id: ShowcaseVariant; label: string }> = [
  { id: "script", label: "Script" },
  { id: "stage", label: "Stage" },
  { id: "flow", label: "Flow" },
];

const fallbackEventTitles = [
  "Start conversation",
  "Show scenario",
  "Check understanding",
  "Practice response",
  "Wrap up",
];

const trackLabels: Array<{ id: CueTrack; label: string }> = [
  { id: "voice", label: "Tutor voice" },
  { id: "stage", label: "Screen" },
  { id: "learner", label: "Learner" },
  { id: "check", label: "Check" },
  { id: "route", label: "Route" },
];

function countRoutes(event: ExperienceEvent) {
  return (
    event.conversationChoices.filter((choice) => choice.triggersEvent).length +
    event.chatTools.filter((tool) => tool.triggersEvent).length +
    event.conversationChecks.filter((check) => check.triggersEvent).length +
    event.classifierGroups.filter((group) => group.triggersEvent).length
  );
}

function summarizeEvent(event: ExperienceEvent): MockupEvent {
  return {
    checkCount: event.conversationChecks.length + event.classifierGroups.length,
    choiceCount: event.conversationChoices.length,
    description: event.description,
    id: event.id,
    isStart: event.isStart,
    routeCount: countRoutes(event),
    slug: event.slug,
    stepCount: event.steps.length,
    title: event.title,
    toolCount: event.chatTools.length,
  };
}

function fallbackEvents(): MockupEvent[] {
  return fallbackEventTitles.map((title, index) => ({
    checkCount: index === 2 ? 1 : 0,
    choiceCount: index === 1 ? 3 : index === 3 ? 2 : 0,
    description:
      index === 0
        ? "Learner enters the experience and hears the opening frame."
        : "Preview event for testing script, timing, and branching structure.",
    id: `mockup-event-${index}`,
    isStart: index === 0,
    routeCount: index < fallbackEventTitles.length - 1 ? 1 : 0,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    stepCount: index + 2,
    title,
    toolCount: index === 2 ? 1 : 0,
  }));
}

function buildMockupEvents(experience: Experience | null) {
  if (!experience?.events.length) return fallbackEvents();

  const summarizedEvents = [...experience.events]
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .slice(0, 8)
    .map(summarizeEvent);

  if (summarizedEvents.length >= 5) return summarizedEvents;

  const previewEvents = fallbackEvents().map((event, index) => ({
    ...event,
    id: `preview-${event.id}`,
    isStart: false,
    title:
      index === 0 && summarizedEvents.some((candidate) => candidate.isStart)
        ? "Orientation check"
        : event.title,
  }));

  return [
    ...summarizedEvents,
    ...previewEvents.slice(0, 5 - summarizedEvents.length),
  ];
}

function cueStyle(cue: TimelineCue) {
  return {
    "--cue-start": `${cue.start}%`,
    "--cue-span": `${cue.span}%`,
  } as CSSProperties;
}

function buildCues(event: MockupEvent | null): TimelineCue[] {
  const title = event?.title ?? "Selected event";
  const stepCount = event?.stepCount ?? 2;
  const choiceCount = Math.max(event?.choiceCount ?? 0, 2);
  const checkCount = Math.max(event?.checkCount ?? 0, 1);
  const routeCount = Math.max(event?.routeCount ?? 0, 1);

  return [
    {
      detail: "Narration, transcript, timing, and audio cache.",
      id: "voice-intro",
      kind: "voice",
      label: `${title} script`,
      span: Math.min(32 + stepCount * 3, 52),
      start: 3,
      track: "voice",
    },
    {
      detail: "Panel state, visual highlight, or interactive surface.",
      id: "stage-update",
      kind: "stage",
      label: "Show learner context",
      span: 24,
      start: 18,
      track: "stage",
    },
    {
      detail: `${choiceCount} possible learner choices.`,
      id: "learner-choice",
      kind: "learner",
      label: "Learner response window",
      span: 22,
      start: 46,
      track: "learner",
    },
    {
      detail: `${checkCount} rubric or classifier checkpoint.`,
      id: "conversation-check",
      kind: "check",
      label: "Evaluate response",
      span: 18,
      start: 64,
      track: "check",
    },
    {
      detail: `${routeCount} possible next events.`,
      id: "route-next",
      kind: "route",
      label: "Route next event",
      span: 15,
      start: 80,
      track: "route",
    },
  ];
}

function scriptLines(event: MockupEvent | null) {
  const title = event?.title ?? "Selected event";
  const description =
    event?.description.trim() ||
    "Frame the moment, then wait for the learner to act.";

  return [
    {
      id: "line-1",
      speaker: "Tutor",
      text: description,
      time: "0:00",
    },
    {
      id: "line-2",
      speaker: "Screen",
      text: `Show the learner the ${title.toLowerCase()} context and keep the next choice visible.`,
      time: "0:10",
    },
    {
      id: "line-3",
      speaker: "Learner",
      text: "Choose a response or continue after the prompt.",
      time: "0:24",
    },
    {
      id: "line-4",
      speaker: "System",
      text: "Check the response, update context, then route to the next event.",
      time: "0:38",
    },
  ];
}

function EventBeatStrip({
  events,
  onSelectEvent,
  selectedEvent,
}: {
  events: MockupEvent[];
  onSelectEvent: (eventId: string) => void;
  selectedEvent: MockupEvent | null;
}) {
  return (
    <div className="timeline-mockup-beat-strip" aria-label="Event beats">
      {events.map((event, index) => (
        <button
          aria-pressed={selectedEvent?.id === event.id}
          key={event.id}
          onClick={() => onSelectEvent(event.id)}
          type="button"
        >
          <span>{index + 1}</span>
          <strong>{event.title}</strong>
          <small>{event.stepCount} cues</small>
        </button>
      ))}
    </div>
  );
}

function CueStack({ cues }: { cues: TimelineCue[] }) {
  return (
    <div className="timeline-mockup-cue-stack">
      {cues.map((cue) => (
        <button className={`is-${cue.kind}`} key={cue.id} type="button">
          <span>{trackLabels.find((track) => track.id === cue.track)?.label}</span>
          <strong>{cue.label}</strong>
          <small>{cue.detail}</small>
        </button>
      ))}
    </div>
  );
}

function TimelineTracks({
  cues,
  dense = false,
}: {
  cues: TimelineCue[];
  dense?: boolean;
}) {
  return (
    <div className={`timeline-mockup-tracks ${dense ? "is-dense" : ""}`}>
      <div className="timeline-mockup-ruler">
        <span>0:00</span>
        <span>0:15</span>
        <span>0:30</span>
        <span>0:45</span>
        <span>1:00</span>
      </div>
      <div className="timeline-mockup-track-body">
        <div className="timeline-mockup-playhead" />
        {trackLabels.map((track) => (
          <div className="timeline-mockup-track-row" key={track.id}>
            <div className="timeline-mockup-track-label">{track.label}</div>
            <div className="timeline-mockup-track-lane">
              {cues
                .filter((cue) => cue.track === track.id)
                .map((cue) => (
                  <button
                    className={`timeline-mockup-cue is-${cue.kind}`}
                    key={cue.id}
                    style={cueStyle(cue)}
                    title={cue.detail}
                    type="button"
                  >
                    {cue.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScriptMockup({
  events,
  onSelectEvent,
  selectedEvent,
}: {
  events: MockupEvent[];
  onSelectEvent: (eventId: string) => void;
  selectedEvent: MockupEvent | null;
}) {
  const cues = buildCues(selectedEvent);

  return (
    <div className="timeline-mockup-script">
      <section className="timeline-mockup-script-main">
        <EventBeatStrip
          events={events}
          onSelectEvent={onSelectEvent}
          selectedEvent={selectedEvent}
        />
        <div className="timeline-mockup-script-page">
          {scriptLines(selectedEvent).map((line, index) => (
            <button
              aria-pressed={index === 0}
              className="timeline-mockup-script-line"
              key={line.id}
              type="button"
            >
              <span>{line.time}</span>
              <strong>{line.speaker}</strong>
              <p>{line.text}</p>
            </button>
          ))}
        </div>
      </section>

      <aside className="timeline-mockup-side">
        <div className="timeline-mockup-pane-heading">
          <span>Selected event</span>
          <button type="button">Edit</button>
        </div>
        <div className="timeline-mockup-selected-title">
          <InspectorIcon />
          <h2>{selectedEvent?.title ?? "Select an event"}</h2>
        </div>
        <p>{selectedEvent?.description || "No description yet."}</p>
        <CueStack cues={cues} />
      </aside>

      <section className="timeline-mockup-bottom">
        <div className="timeline-mockup-pane-heading">
          <span>Timing</span>
          <button type="button">Add cue</button>
        </div>
        <TimelineTracks cues={cues} dense />
      </section>
    </div>
  );
}

function StageMockup({
  events,
  onSelectEvent,
  selectedEvent,
}: {
  events: MockupEvent[];
  onSelectEvent: (eventId: string) => void;
  selectedEvent: MockupEvent | null;
}) {
  const cues = buildCues(selectedEvent);
  const selectedCue = cues[1];

  return (
    <div className="timeline-mockup-stage">
      <aside className="timeline-mockup-event-rail">
        <div className="timeline-mockup-pane-heading">
          <span>Scenes</span>
          <button aria-label="Add event" type="button">
            <PlusIcon />
          </button>
        </div>
        {events.map((event) => (
          <button
            aria-pressed={selectedEvent?.id === event.id}
            key={event.id}
            onClick={() => onSelectEvent(event.id)}
            type="button"
          >
            <strong>{event.title}</strong>
            <small>
              {event.stepCount} cues / {event.routeCount} routes
            </small>
          </button>
        ))}
      </aside>

      <section className="timeline-mockup-stage-center">
        <div className="timeline-mockup-preview">
          <div className="timeline-mockup-preview-top">
            <span>Learner view</span>
            <button type="button">Preview</button>
          </div>
          <div className="timeline-mockup-preview-stage">
            <div>
              <span>Panel</span>
              <h2>{selectedEvent?.title ?? "Selected event"}</h2>
              <p>{selectedEvent?.description || "Learner sees the current frame."}</p>
            </div>
            <div className="timeline-mockup-choice-preview">
              <button type="button">Continue</button>
              <button type="button">Ask for a hint</button>
            </div>
          </div>
        </div>
        <TimelineTracks cues={cues} />
      </section>

      <aside className="timeline-mockup-side">
        <div className="timeline-mockup-pane-heading">
          <span>Clip inspector</span>
          <button type="button">Open</button>
        </div>
        <div className="timeline-mockup-clip-card">
          <span>{trackLabels.find((track) => track.id === selectedCue.track)?.label}</span>
          <h2>{selectedCue.label}</h2>
          <p>{selectedCue.detail}</p>
        </div>
        <dl className="timeline-mockup-props">
          <div>
            <dt>Starts</dt>
            <dd>0:10</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>0:14</dd>
          </div>
          <div>
            <dt>Condition</dt>
            <dd>Always</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>Event</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function FlowMockup({
  events,
  onSelectEvent,
  selectedEvent,
}: {
  events: MockupEvent[];
  onSelectEvent: (eventId: string) => void;
  selectedEvent: MockupEvent | null;
}) {
  const cues = buildCues(selectedEvent);

  return (
    <div className="timeline-mockup-flow">
      <section className="timeline-mockup-flow-map">
        <div className="timeline-mockup-pane-heading">
          <span>Branch map</span>
          <button type="button">Fit</button>
        </div>
        <div className="timeline-mockup-flow-nodes">
          {events.map((event, index) => (
            <button
              aria-pressed={selectedEvent?.id === event.id}
              className={`tone-${index % 4}`}
              key={event.id}
              onClick={() => onSelectEvent(event.id)}
              type="button"
            >
              <span>{event.isStart ? "Start" : "Event"}</span>
              <strong>{event.title}</strong>
              <small>
                {event.choiceCount} choices / {event.routeCount} routes
              </small>
              <i>
                <b style={cueStyle(cues[0])} />
                <b style={cueStyle(cues[1])} />
                <b style={cueStyle(cues[3])} />
              </i>
            </button>
          ))}
        </div>
      </section>

      <aside className="timeline-mockup-flow-side">
        <div className="timeline-mockup-pane-heading">
          <span>Selected branch</span>
          <button type="button">Edit path</button>
        </div>
        <h2>{selectedEvent?.title ?? "Select an event"}</h2>
        <p>{selectedEvent?.description || "Branching and timing for this event."}</p>
        <div className="timeline-mockup-route-table">
          <div>
            <span>When</span>
            <span>Do</span>
            <span>Next</span>
          </div>
          <button type="button">
            <span>After script</span>
            <strong>Show choices</strong>
            <span>Stay</span>
          </button>
          <button type="button">
            <span>On response</span>
            <strong>Run check</strong>
            <span>Route</span>
          </button>
          <button type="button">
            <span>On pass</span>
            <strong>Save context</strong>
            <span>Next event</span>
          </button>
        </div>
        <TimelineTracks cues={cues} dense />
      </aside>
    </div>
  );
}

export function ExperienceEditorMockups({
  experienceId,
}: {
  experienceId: string;
}) {
  const [activeVariant, setActiveVariant] = useState<ShowcaseVariant>("script");
  const [error, setError] = useState("");
  const [experience, setExperience] = useState<Experience | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadMockups() {
      setStatus("loading");
      setError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const nextExperience =
          payload.experiences.find((candidate) => candidate.id === experienceId) ??
          null;

        if (!nextExperience) {
          throw new Error("Experience not found.");
        }

        if (isCancelled) return;

        const startEvent =
          nextExperience.events.find((event) => event.isStart) ??
          nextExperience.events[0];

        setUser(me.user);
        setExperience(nextExperience);
        setSelectedEventId(startEvent?.id ?? "");
        writeSelectedExperienceId(nextExperience.id);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load editor mockups.",
        );
      }
    }

    loadMockups();

    return () => {
      isCancelled = true;
    };
  }, [experienceId]);

  const events = useMemo(() => buildMockupEvents(experience), [experience]);
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;

  function returnToExperiences() {
    window.location.assign("/experiences");
  }

  function openNewEditor() {
    if (!experience) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceNextEditPath(experience.id));
  }

  function openCurrentEditor() {
    if (!experience) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceEditPath(experience.id));
  }

  async function runExperience() {
    if (!experience) return;

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
      className="panel-study experience-editor-page editor-showcase-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <div className="study-actions">
          <button
            className="header-action secondary"
            onClick={returnToExperiences}
            type="button"
          >
            Experiences
          </button>
        </div>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action secondary"
            disabled={!experience}
            onClick={openNewEditor}
            type="button"
          >
            New editor
          </button>
          <button
            className="header-action secondary"
            disabled={!experience}
            onClick={openCurrentEditor}
            type="button"
          >
            Current editor
          </button>
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="editor-showcase">
        {status === "loading" ? (
          <div className="experience-state">Loading mockups...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        {experience ? (
          <>
            <div className="editor-showcase-toolbar">
              <div className="editor-showcase-titlebar">
                <button
                  aria-label="Run experience"
                  className="next-overview-run-button"
                  onClick={() => void runExperience()}
                  title="Run experience"
                  type="button"
                >
                  <PlayIcon />
                </button>
                <div>
                  <h1>{experience.title}</h1>
                  <p>{experience.description || "---"}</p>
                </div>
              </div>

              <div
                aria-label="Mockup direction"
                className="editor-showcase-tabs"
                role="tablist"
              >
                {showcaseVariants.map((variant) => (
                  <button
                    aria-selected={activeVariant === variant.id}
                    key={variant.id}
                    onClick={() => setActiveVariant(variant.id)}
                    role="tab"
                    type="button"
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>

            <section className="editor-showcase-frame">
              {activeVariant === "script" ? (
                <ScriptMockup
                  events={events}
                  onSelectEvent={setSelectedEventId}
                  selectedEvent={selectedEvent}
                />
              ) : null}
              {activeVariant === "stage" ? (
                <StageMockup
                  events={events}
                  onSelectEvent={setSelectedEventId}
                  selectedEvent={selectedEvent}
                />
              ) : null}
              {activeVariant === "flow" ? (
                <FlowMockup
                  events={events}
                  onSelectEvent={setSelectedEventId}
                  selectedEvent={selectedEvent}
                />
              ) : null}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
