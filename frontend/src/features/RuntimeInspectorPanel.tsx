import type {
  RealtimeModelId,
  RealtimeStatus,
  RealtimeVoiceId,
} from "../realtime";
import type { RuntimeInteractive } from "../mainPanelApps";
import {
  cachedScriptAudioFromMessage,
  scriptAudioSources,
  scriptCuesFromMessage,
} from "../scriptAudio";
import {
  eventOutgoingLinks,
  eventTitleForTrigger,
  eventTransitionStats,
} from "../eventGraph";
import {
  compactRuntimeValue,
  fullRuntimeValue,
  recordFromUnknown,
  runtimeActionText,
  runtimeDebugEntries,
  runtimeTraceDetailsText,
  runtimeTraceTime,
  runtimeValueTypeLabel,
} from "../runtimeUtils";
import type {
  ChatMessage,
  Experience,
  ExperienceEvent,
  ResolvedSlide,
  RuntimeActionLogEntry,
  RuntimeButton,
  RuntimeHighlight,
  RuntimeNote,
  RuntimeOverlay,
  RuntimeUiTrigger,
  TutoringSession,
} from "../types";


const realtimeStatusLabels: Record<RealtimeStatus, string> = {
  "audio-blocked": "Audio blocked",
  connected: "Voice ready",
  connecting: "Connecting",
  error: "Voice error",
  idle: "Voice idle",
  streaming: "Speaking",
};


export function RuntimeInspectorPanel({
  actionLog,
  avatarPath,
  avatarVisible,
  buttons,
  chatEnabled,
  currentEvent,
  currentEventSlug,
  experience,
  highlights,
  interactive,
  interactiveState,
  isSendingMessage,
  isScriptAudioPlaying,
  messages,
  notes,
  overlays,
  realtimeStatus,
  runtimeDebug,
  runtimeContext,
  runtimeSoundCount,
  session,
  selectedModel,
  selectedVoice,
  slide,
  slideError,
  triggers,
}: {
  actionLog: RuntimeActionLogEntry[];
  avatarPath: string;
  avatarVisible: boolean;
  buttons: RuntimeButton[];
  chatEnabled: boolean;
  currentEvent: ExperienceEvent | null;
  currentEventSlug: string;
  experience: Experience | null;
  highlights: Record<string, RuntimeHighlight>;
  interactive: RuntimeInteractive | null;
  interactiveState: Record<string, unknown>;
  isSendingMessage: boolean;
  isScriptAudioPlaying: boolean;
  messages: ChatMessage[];
  notes: RuntimeNote[];
  overlays: RuntimeOverlay[];
  realtimeStatus: RealtimeStatus;
  runtimeDebug: Record<string, unknown>;
  runtimeContext: Record<string, unknown>;
  runtimeSoundCount: number;
  session: TutoringSession | null;
  selectedModel: RealtimeModelId;
  selectedVoice: RealtimeVoiceId;
  slide: ResolvedSlide | null;
  slideError: string;
  triggers: RuntimeUiTrigger[];
}) {
  const contextEntries = Object.entries(runtimeContext).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const interactiveStateEntries = Object.entries(interactiveState);
  const highlightEntries = Object.values(highlights);
  const noteEntries = notes.slice(-12).reverse();
  const serverActionEntries = runtimeDebugEntries(runtimeDebug.recentActions).slice(
    0,
    18,
  );
  const conversationLogicEntries = runtimeDebugEntries(runtimeDebug.recentActions)
    .filter((entry) =>
      [
        "classifier_group_result",
        "classifier_group_skipped",
        "classifier_result",
        "classifier_skipped",
        "conversation_check_result",
      ].includes(entry.type),
    )
    .slice(0, 10);
  const transitionEntries = runtimeDebugEntries(runtimeDebug.transitions).slice(
    0,
    12,
  );
  const scriptedMessages = messages.filter((message) => {
    const source =
      typeof message.metadata?.source === "string"
        ? message.metadata.source
        : "";
    return (
      message.role === "assistant" &&
      message.content.trim().length > 0 &&
      scriptAudioSources.has(source)
    );
  });
  const cachedAudioMessages = scriptedMessages
    .map(cachedScriptAudioFromMessage)
    .filter(Boolean);
  const timedAudioMessages = cachedAudioMessages.filter(
    (audio) => (audio?.scriptWords?.length ?? 0) > 0,
  );
  const scriptCueRows = scriptedMessages
    .flatMap((message) => {
      const cachedAudio = cachedScriptAudioFromMessage(message);
      const cues = cachedAudio?.scriptCues?.length
        ? cachedAudio.scriptCues
        : scriptCuesFromMessage(message);
      const messageText = compactRuntimeValue(message.content, "script");

      return cues.map((cue, index) => {
        const actionType =
          typeof cue.action.type === "string" ? cue.action.type : "action";
        const cuePosition =
          typeof cue.time === "number"
            ? `${cue.time.toFixed(2)}s`
            : typeof cue.wordIndex === "number"
              ? `word ${cue.wordIndex}`
              : `${Math.round(cue.progress * 100)}%`;

        return {
          detail: runtimeActionText(cue.action),
          id: `${message.id}-${index}`,
          message: messageText,
          position: cuePosition,
          type: actionType,
        };
      });
    })
    .slice(0, 24);
  const tutor = experience?.tutor ?? null;
  const realtimePromptDebug = recordFromUnknown(runtimeDebug.realtimePrompt);
  const realtimePromptInstructions =
    typeof realtimePromptDebug.instructions === "string"
      ? realtimePromptDebug.instructions
      : "";
  const realtimePromptTools = Array.isArray(realtimePromptDebug.tools)
    ? realtimePromptDebug.tools
        .map((tool) => (typeof tool === "string" ? tool.trim() : ""))
        .filter(Boolean)
    : [];
  const promptContextRows = [
    {
      label: "Rendered realtime",
      value: realtimePromptInstructions,
    },
    {
      label: "Realtime tools",
      value: realtimePromptTools.join(", "),
    },
    {
      label: "Tutor system",
      value: tutor?.systemPrompt ?? "",
    },
    {
      label: "Event chat",
      value: currentEvent?.chatInstructions ?? "",
    },
    {
      label: "Personality and tone",
      value: tutor?.voiceInstructions ?? "",
    },
    {
      label: "Classification model",
      value: tutor?.classificationModel ?? "",
    },
  ].filter((row) => row.value.trim());
  const currentEventLabel =
    currentEvent?.title || currentEventSlug || (session ? "Start" : "---");
  const events = experience?.events ?? [];
  const eventStats =
    currentEvent && events.length ? eventTransitionStats(events, currentEvent) : null;
  const outgoingLinks = currentEvent
    ? eventOutgoingLinks(currentEvent).slice(0, 8)
    : [];
  const enabledStepCount =
    currentEvent?.steps.filter((step) => step.enabled).length ?? 0;
  const enabledToolCount =
    currentEvent?.chatTools.filter((tool) => tool.enabled).length ?? 0;
  const enabledCheckCount =
    currentEvent?.conversationChecks.filter((check) => check.enabled).length ?? 0;
  const enabledClassifierGroupCount =
    currentEvent?.classifierGroups.filter((group) => group.enabled).length ?? 0;
  const enabledClassifierCount =
    currentEvent?.classifierGroups.reduce(
      (total, group) =>
        total +
        group.classifiers.filter(
          (classifier) => group.enabled && classifier.enabled,
        ).length,
      0,
    ) ?? 0;
  const runtimeDebugUpdatedAt =
    typeof runtimeDebug.updatedAt === "string" ? runtimeDebug.updatedAt : "";

  return (
    <div className="runtime-inspector-scroll">
      <div className="runtime-inspector-panel">
        <header className="runtime-inspector-header">
          <span>Runtime</span>
          <strong>{currentEventLabel}</strong>
        </header>

        <div className="runtime-inspector-section">
          <div className="runtime-inspector-kv">
            <span>Session</span>
            <strong>{session?.id.slice(0, 8) || "---"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Event slug</span>
            <strong>{currentEvent?.slug || currentEventSlug || "---"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Chat</span>
            <strong>{chatEnabled ? "on" : "off"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Trace</span>
            <strong>{runtimeTraceTime(runtimeDebugUpdatedAt)}</strong>
          </div>
        </div>

        <section className="runtime-inspector-section">
          <h2>Client state</h2>
          <div className="runtime-inspector-list">
            <div className="runtime-inspector-row">
              <span>Chat lock</span>
              <code>
                {isSendingMessage || isScriptAudioPlaying || realtimeStatus === "streaming"
                  ? "locked"
                  : "ready"}
              </code>
            </div>
            <div className="runtime-inspector-row">
              <span>Voice</span>
              <code>{selectedVoice}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Chat model</span>
              <code>{selectedModel}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Realtime</span>
              <code>{realtimeStatusLabels[realtimeStatus]}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Script audio</span>
              <code>{isScriptAudioPlaying ? "playing" : "idle"}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Sound effects</span>
              <code>{runtimeSoundCount}</code>
            </div>
          </div>
        </section>

        <section className="runtime-inspector-section">
          <h2>Current event</h2>
          {currentEvent ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>On entry</span>
                <code>
                  {enabledStepCount}/{currentEvent.steps.length}
                </code>
              </div>
              <div className="runtime-inspector-row">
                <span>Conversation</span>
                <code>
                  {enabledToolCount} FC / {enabledCheckCount} checks /{" "}
                  {enabledClassifierCount} classifiers
                </code>
              </div>
              <div className="runtime-inspector-row">
                <span>Classifier groups</span>
                <code>
                  {enabledClassifierGroupCount}/{currentEvent.classifierGroups.length}
                </code>
              </div>
              {eventStats ? (
                <div className="runtime-inspector-row">
                  <span>Routing</span>
                  <code>
                    {eventStats.incomingCount} in / {eventStats.outgoingCount} out
                    {eventStats.unresolvedCount
                      ? ` / ${eventStats.unresolvedCount} missing`
                      : ""}
                  </code>
                </div>
              ) : null}
              {outgoingLinks.map((link, index) => (
                <div
                  className="runtime-inspector-row runtime-inspector-link-row"
                  key={`${link.kind}-${link.slug}-${index}`}
                >
                  <span>{link.kind}</span>
                  <code
                    title={[
                      eventTitleForTrigger(events, link.slug) || link.slug,
                      link.source ? `from ${link.source}` : "",
                      link.condition ? `if ${link.condition}` : "",
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  >
                    {eventTitleForTrigger(events, link.slug) || link.slug}
                    {link.condition ? ` if ${link.condition}` : ""}
                  </code>
                  <small className="runtime-inspector-route-source">
                    {link.source}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Conversation logic</h2>
          {conversationLogicEntries.length ? (
            <div className="runtime-action-log">
              {conversationLogicEntries.map((entry, index) => {
                const detailsText = runtimeTraceDetailsText(entry.details);
                return (
                  <div
                    className="runtime-action-row"
                    key={`${entry.at}-${entry.type}-${index}`}
                  >
                    <span>{runtimeTraceTime(entry.at)}</span>
                    <strong>{entry.type}</strong>
                    <p>{entry.summary}</p>
                    {detailsText ? (
                      <code className="runtime-action-detail">{detailsText}</code>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Prompt context</h2>
          {promptContextRows.length ? (
            <div className="runtime-inspector-list">
              {promptContextRows.map((row) => (
                <div className="runtime-inspector-row" key={row.label}>
                  <span>{row.label}</span>
                  <code
                    className="runtime-inspector-value"
                    title={fullRuntimeValue(row.value)}
                  >
                    <span>{compactRuntimeValue(row.value)}</span>
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Context</h2>
          {contextEntries.length ? (
            <div className="runtime-inspector-list">
              {contextEntries.map(([key, value]) => (
                <div className="runtime-inspector-row" key={key}>
                  <span>{key}</span>
                  <code
                    className="runtime-inspector-value"
                    title={fullRuntimeValue(value)}
                  >
                    <span>{compactRuntimeValue(value)}</span>
                    <small>{runtimeValueTypeLabel(value)}</small>
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Main panel</h2>
          {interactive ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>App</span>
                <code>{interactive.interactiveId}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>View</span>
                <code>{interactive.mode || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Target</span>
                <code>{interactive.triggersEvent || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Title</span>
                <code>{interactive.title || "---"}</code>
              </div>
              {interactiveStateEntries.map(([key, value]) => (
                <div className="runtime-inspector-row" key={key}>
                  <span>{key}</span>
                  <code>{compactRuntimeValue(value)}</code>
                </div>
              ))}
            </div>
          ) : slide ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>Slide</span>
                <code>{slide.slideRef || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Page</span>
                <code>{slide.pageId || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Cache</span>
                <code>{slide.cached ? "hit" : "miss"}</code>
              </div>
            </div>
          ) : slideError ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>Slide error</span>
                <code>{slideError}</code>
              </div>
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Visuals</h2>
          <div className="runtime-inspector-list">
            <div className="runtime-inspector-row">
              <span>Agent image</span>
              <code>{avatarPath || "---"}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Image visible</span>
              <code>{avatarVisible ? "yes" : "no"}</code>
            </div>
            {overlays.map((overlay) => (
              <div className="runtime-inspector-row" key={overlay.id}>
                <span>Overlay {overlay.id}</span>
                <code>{overlay.imagePath}</code>
              </div>
            ))}
          </div>
        </section>

        <section className="runtime-inspector-section">
          <h2>Notes</h2>
          {noteEntries.length ? (
            <div className="runtime-inspector-list">
              {noteEntries.map((note) => (
                <div className="runtime-inspector-row" key={note.id}>
                  <span>{note.source || note.id}</span>
                  <code>{note.text}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Pending triggers</h2>
          <div className="runtime-inspector-list">
            {triggers.map((trigger) => (
              <div
                className="runtime-inspector-row"
                key={`${trigger.selector}-${trigger.triggersEvent}`}
              >
                <span>{trigger.selector}</span>
                <code>{trigger.triggersEvent}</code>
              </div>
            ))}
            {buttons.map((button) => (
              <div
                className="runtime-inspector-row"
                key={`${button.stepId}-${button.triggersEvent}`}
              >
                <span>button: {button.label}</span>
                <code>{button.triggersEvent}</code>
              </div>
            ))}
          </div>
          {!triggers.length && !buttons.length ? (
            <p className="runtime-inspector-empty">---</p>
          ) : null}
        </section>

        <section className="runtime-inspector-section">
          <h2>Highlights</h2>
          <div className="runtime-inspector-list">
            {highlightEntries.map((highlight) => (
              <div
                className="runtime-inspector-row"
                key={highlight.selector}
              >
                <span>{highlight.selector}</span>
                <code>highlight</code>
              </div>
            ))}
          </div>
          {!highlightEntries.length ? (
            <p className="runtime-inspector-empty">---</p>
          ) : null}
        </section>

        <section className="runtime-inspector-section">
          <h2>Audio cache</h2>
          <div className="runtime-inspector-list">
            <div className="runtime-inspector-row">
              <span>Scripted lines</span>
              <code>{scriptedMessages.length}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Cached audio</span>
              <code>{cachedAudioMessages.length}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Word timing</span>
              <code>{timedAudioMessages.length}</code>
            </div>
          </div>
        </section>

        <section className="runtime-inspector-section">
          <h2>Script cues</h2>
          {scriptCueRows.length ? (
            <div className="runtime-action-log">
              {scriptCueRows.map((cue) => (
                <div className="runtime-action-row" key={cue.id}>
                  <span>{cue.position}</span>
                  <strong>{cue.type}</strong>
                  <p>{cue.detail}</p>
                  <code className="runtime-action-detail">{cue.message}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Transitions</h2>
          {transitionEntries.length ? (
            <div className="runtime-action-log">
              {transitionEntries.map((entry, index) => (
                (() => {
                  const detailsText = runtimeTraceDetailsText(entry.details);
                  return (
                    <div
                      className="runtime-action-row"
                      key={`${entry.at}-${entry.type}-${index}`}
                    >
                      <span>{runtimeTraceTime(entry.at)}</span>
                      <strong>{entry.type}</strong>
                      <p>{entry.summary}</p>
                      {detailsText ? (
                        <code className="runtime-action-detail">{detailsText}</code>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Server actions</h2>
          {serverActionEntries.length ? (
            <div className="runtime-action-log">
              {serverActionEntries.map((entry, index) => (
                (() => {
                  const detailsText = runtimeTraceDetailsText(entry.details);
                  return (
                    <div
                      className="runtime-action-row"
                      key={`${entry.at}-${entry.type}-${index}`}
                    >
                      <span>{runtimeTraceTime(entry.at)}</span>
                      <strong>{entry.type}</strong>
                      <p>{entry.summary}</p>
                      {detailsText ? (
                        <code className="runtime-action-detail">{detailsText}</code>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Client actions</h2>
          {actionLog.length ? (
            <div className="runtime-action-log">
              {actionLog.map((entry) => (
                <div className="runtime-action-row" key={entry.id}>
                  <span>{entry.time}</span>
                  <strong>{entry.type}</strong>
                  <p>{entry.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>
      </div>
    </div>
  );
}
