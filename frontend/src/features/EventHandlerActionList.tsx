import type { DragEvent } from "react";

import {
  eventActionLabel,
  eventActionToneClass,
} from "../actionRegistry";
import { GripIcon, TrashIcon } from "../components/Icons";
import type {
  DraggingHandlerAction,
  EventStepDraft,
  ExperienceEvent,
  HandlerActionDropTarget,
  HandlerActionOwnerKind,
  ScriptAudioItem,
  StepConditionDraft,
} from "../types";
import {
  eventConditionSummary,
  eventStepSummary,
} from "./eventEditorUtils";
import { ActionStepDetail } from "./ActionStepDetail";

type EventHandlerActionListProps = {
  clearActionDragState: () => void;
  closeExpandedItem: (itemId: string) => void;
  dragHandleLabel: string;
  dragHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dragLeaveHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dragOverHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dropHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  editorEvents: ExperienceEvent[];
  handlerActionDropTarget: HandlerActionDropTarget | null;
  isDraggingHandlerAction: (payload: DraggingHandlerAction) => boolean;
  isExpandedItem: (itemId: string) => boolean;
  onDeleteAction: (actionId: string) => void;
  onUpdateActionCondition: (
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) => void;
  onUpdateActionConfig: (
    actionId: string,
    key: string,
    value: unknown,
  ) => void;
  onUpdateActionConfigPatch: (
    actionId: string,
    patch: Record<string, unknown>,
  ) => void;
  onUpdateActionDraft: (
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) => void;
  openExpandedItem: (itemId: string) => void;
  ownerId: string;
  ownerKind: HandlerActionOwnerKind;
  scriptAudioItems: ScriptAudioItem[];
  steps: EventStepDraft[];
  toggleExpandedItem: (itemId: string) => void;
};

export function EventHandlerActionList({
  clearActionDragState,
  closeExpandedItem,
  dragHandleLabel,
  dragHandlerAction,
  dragLeaveHandlerAction,
  dragOverHandlerAction,
  dropHandlerAction,
  editorEvents,
  handlerActionDropTarget,
  isDraggingHandlerAction,
  isExpandedItem,
  onDeleteAction,
  onUpdateActionCondition,
  onUpdateActionConfig,
  onUpdateActionConfigPatch,
  onUpdateActionDraft,
  openExpandedItem,
  ownerId,
  ownerKind,
  scriptAudioItems,
  steps,
  toggleExpandedItem,
}: EventHandlerActionListProps) {
  if (!steps.length) return null;

  return (
    <div className="event-step-list chat-tool-action-list">
      {steps.map((step) => {
        const conditionText = eventConditionSummary(step.condition);
        const isActionExpanded = isExpandedItem(step.id);
        const toneClass = eventActionToneClass(step.actionType);
        const dragPayload: DraggingHandlerAction = {
          actionId: step.id,
          ownerId,
          ownerKind,
        };

        return (
          <article
            className={[
              "event-step",
              "chat-tool-action-step",
              `tone-${toneClass}`,
              isDraggingHandlerAction(dragPayload) ? "is-dragging" : "",
              handlerActionDropTarget?.actionId === step.id &&
              handlerActionDropTarget.ownerId === ownerId &&
              handlerActionDropTarget.ownerKind === ownerKind
                ? `is-drop-${handlerActionDropTarget.position}`
                : "",
              isActionExpanded ? "is-expanded" : "",
              !step.enabled ? "is-disabled" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={!isActionExpanded}
            key={step.id}
            onDragEnd={clearActionDragState}
            onDragLeave={(event) => dragLeaveHandlerAction(event, dragPayload)}
            onDragOver={(event) => dragOverHandlerAction(event, dragPayload)}
            onDragStart={(event) => {
              if (!isActionExpanded) {
                dragHandlerAction(event, dragPayload);
              }
            }}
            onDrop={(event) => dropHandlerAction(event, dragPayload)}
            title="Drag to reorder"
          >
            <div className="event-step-main">
              <span
                aria-label={dragHandleLabel}
                className="event-drag-handle"
                draggable={isActionExpanded}
                onDragStart={(event) => dragHandlerAction(event, dragPayload)}
                title="Drag to reorder"
              >
                <GripIcon />
              </span>

              <button
                aria-expanded={isActionExpanded}
                className="event-step-summary"
                draggable={isActionExpanded}
                onClick={() => toggleExpandedItem(step.id)}
                onDragStart={(event) => dragHandlerAction(event, dragPayload)}
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
                  onClick={() => openExpandedItem(step.id)}
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
                  aria-label={step.enabled ? "Disable action" : "Enable action"}
                  className={`event-enable-button${
                    step.enabled ? "" : " is-off"
                  }`}
                  onClick={() =>
                    onUpdateActionDraft(step.id, (currentStep) => ({
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
                  aria-label="Delete action"
                  className="event-icon-button danger"
                  onClick={() => {
                    onDeleteAction(step.id);
                    if (isExpandedItem(step.id)) {
                      closeExpandedItem(step.id);
                      openExpandedItem(ownerId);
                    }
                  }}
                  type="button"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>

            {isActionExpanded ? (
              <ActionStepDetail
                className="event-step-detail chat-tool-action-detail"
                editorEvents={editorEvents}
                scriptAudioItems={scriptAudioItems}
                step={step}
                updateConfig={(key, value) =>
                  onUpdateActionConfig(step.id, key, value)
                }
                updateConfigPatch={(patch) =>
                  onUpdateActionConfigPatch(step.id, patch)
                }
                updateCondition={(condition) =>
                  onUpdateActionCondition(step.id, condition)
                }
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
