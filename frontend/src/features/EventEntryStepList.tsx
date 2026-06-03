import type {
  DragEvent,
  Ref,
} from "react";

import {
  eventActionDescription,
  eventActionLabel,
  eventActionOptions,
  eventActionToneClass,
} from "../actionRegistry";
import { GripIcon, PlusIcon, TrashIcon } from "../components/Icons";
import type {
  EventActionStep,
  EventDraft,
  EventStepDraft,
  EventStepDropTarget,
  ExperienceEvent,
  ScriptAudioItem,
  StepConditionDraft,
} from "../types";
import {
  eventConditionSummary,
  eventStepSummary,
} from "./eventEditorUtils";
import { ActionStepDetail } from "./ActionStepDetail";

type EventEntryStepListProps = {
  editorEvents: ExperienceEvent[];
  eventAddBlockRef: Ref<HTMLDivElement>;
  eventDraft: EventDraft;
  eventStepDropTarget: EventStepDropTarget | null;
  draggingStepId: string;
  isEventAddMenuOpen: boolean;
  isExpandedItem: (itemId: string) => boolean;
  onAddEventStep: (actionType: EventActionStep["actionType"]) => void;
  onClearActionDragState: () => void;
  onDeleteEventStep: (stepId: string) => void;
  onDragEventStep: (event: DragEvent<HTMLElement>, stepId: string) => void;
  onDragLeaveEventStep: (
    event: DragEvent<HTMLElement>,
    stepId: string,
  ) => void;
  onDragOverEventStep: (
    event: DragEvent<HTMLElement>,
    stepId: string,
  ) => void;
  onDropEventStep: (event: DragEvent<HTMLElement>, stepId: string) => void;
  onOpenExpandedItem: (itemId: string) => void;
  onToggleAddMenu: () => void;
  onToggleExpandedItem: (itemId: string) => void;
  onUpdateEventStepCondition: (
    stepId: string,
    condition: Partial<StepConditionDraft>,
  ) => void;
  onUpdateEventStepConfig: (
    stepId: string,
    key: string,
    value: unknown,
  ) => void;
  onUpdateEventStepConfigPatch: (
    stepId: string,
    patch: Record<string, unknown>,
  ) => void;
  onUpdateEventStepDraft: (
    stepId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) => void;
  scriptAudioItems: ScriptAudioItem[];
};

export function EventEntryStepList({
  editorEvents,
  eventAddBlockRef,
  eventDraft,
  eventStepDropTarget,
  draggingStepId,
  isEventAddMenuOpen,
  isExpandedItem,
  onAddEventStep,
  onClearActionDragState,
  onDeleteEventStep,
  onDragEventStep,
  onDragLeaveEventStep,
  onDragOverEventStep,
  onDropEventStep,
  onOpenExpandedItem,
  onToggleAddMenu,
  onToggleExpandedItem,
  onUpdateEventStepCondition,
  onUpdateEventStepConfig,
  onUpdateEventStepConfigPatch,
  onUpdateEventStepDraft,
  scriptAudioItems,
}: EventEntryStepListProps) {
  return (
    <>
      <div className="event-sequence-header">
        <span>On entry</span>
      </div>

      <div className="event-step-list">
        {eventDraft.steps.map((step, index) => {
          const conditionText = eventConditionSummary(step.condition);
          const isExpanded = isExpandedItem(step.id);
          const toneClass = eventActionToneClass(step.actionType);

          return (
            <article
              className={[
                "event-step",
                `tone-${toneClass}`,
                draggingStepId === step.id ? "is-dragging" : "",
                eventStepDropTarget?.stepId === step.id
                  ? `is-drop-${eventStepDropTarget.position}`
                  : "",
                isExpanded ? "is-expanded" : "",
                !step.enabled ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={!isExpanded}
              key={step.id}
              onDragEnd={onClearActionDragState}
              onDragLeave={(event) => onDragLeaveEventStep(event, step.id)}
              onDragOver={(event) => onDragOverEventStep(event, step.id)}
              onDragStart={(event) => {
                if (!isExpanded) onDragEventStep(event, step.id);
              }}
              onDrop={(event) => onDropEventStep(event, step.id)}
              title="Drag to reorder"
            >
              <div className="event-step-main">
                <span
                  aria-label={`Drag step ${index + 1}`}
                  className="event-drag-handle"
                  draggable={isExpanded}
                  onDragStart={(event) => onDragEventStep(event, step.id)}
                  title="Drag to reorder"
                >
                  <GripIcon />
                </span>

                <button
                  aria-expanded={isExpanded}
                  className="event-step-summary"
                  draggable={isExpanded}
                  onClick={() => onToggleExpandedItem(step.id)}
                  onDragStart={(event) => onDragEventStep(event, step.id)}
                  type="button"
                >
                  <span className="event-step-kind">
                    {eventActionLabel(step.actionType)}
                  </span>
                  <span className="event-step-copy">
                    {eventStepSummary(step, editorEvents)}
                  </span>
                </button>

                <div className="event-step-tools">
                  <button
                    className={`event-if-chip${conditionText ? "" : " is-empty"}`}
                    onClick={() => onOpenExpandedItem(step.id)}
                    title={
                      conditionText
                        ? `Condition: ${conditionText}`
                        : "Set condition"
                    }
                    type="button"
                  >
                    IF{conditionText ? ` ${conditionText}` : ""}
                  </button>
                  <button
                    aria-label={step.enabled ? "Disable step" : "Enable step"}
                    className={`event-enable-button${
                      step.enabled ? "" : " is-off"
                    }`}
                    onClick={() =>
                      onUpdateEventStepDraft(step.id, (currentStep) => ({
                        ...currentStep,
                        enabled: !currentStep.enabled,
                      }))
                    }
                    title={step.enabled ? "Enabled" : "Disabled"}
                    type="button"
                  >
                    <span />
                  </button>
                  <button
                    aria-label="Delete step"
                    className="event-icon-button danger"
                    disabled={eventDraft.steps.length <= 1}
                    onClick={() => onDeleteEventStep(step.id)}
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <ActionStepDetail
                  editorEvents={editorEvents}
                  scriptAudioItems={scriptAudioItems}
                  step={step}
                  updateConfig={(key, value) =>
                    onUpdateEventStepConfig(step.id, key, value)
                  }
                  updateConfigPatch={(patch) =>
                    onUpdateEventStepConfigPatch(step.id, patch)
                  }
                  updateCondition={(condition) =>
                    onUpdateEventStepCondition(step.id, condition)
                  }
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="event-add-block" ref={eventAddBlockRef}>
        <button
          aria-expanded={isEventAddMenuOpen}
          className="event-add-button"
          onClick={onToggleAddMenu}
          type="button"
        >
          <PlusIcon />
          Add action
        </button>
        {isEventAddMenuOpen ? (
          <div className="event-add-menu">
            {eventActionOptions.map((option) => (
              <button
                className={`event-add-option tone-${eventActionToneClass(
                  option.id,
                )}`}
                key={option.id}
                onClick={() => onAddEventStep(option.id)}
                type="button"
              >
                <span>{option.label}</span>
                <small>{eventActionDescription(option.id)}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
