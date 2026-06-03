import type {
  Dispatch,
  Ref,
  SetStateAction,
} from "react";

import { GripIcon, TrashIcon } from "../components/Icons";
import type {
  DraggingConversationItem,
  EventActionStep,
  EventConversationCheckDraft,
  EventStepDraft,
  StepConditionDraft,
} from "../types";
import type {
  ConversationItemInteractionProps,
  HandlerActionInteractionProps,
} from "./eventConversationItemTypes";
import { inlineFieldWidthStyle } from "./eventEditorUtils";
import { EventDestinationSelect } from "./EventDestinationSelect";
import { EventHandlerActionAddMenu } from "./EventHandlerActionAddMenu";
import { EventHandlerActionList } from "./EventHandlerActionList";

type EventConversationCheckItemProps = ConversationItemInteractionProps &
  HandlerActionInteractionProps & {
  addEventConversationCheckAction: (
    checkId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  check: EventConversationCheckDraft;
  conversationAddMenuCheckId: string;
  conversationCheckAddBlockRef: Ref<HTMLDivElement>;
  deleteEventConversationCheck: (checkId: string) => void;
  deleteEventConversationCheckAction: (checkId: string, actionId: string) => void;
  setConversationAddMenuCheckId: Dispatch<SetStateAction<string>>;
  toggleExpandedParent: (parentId: string, childIds: string[]) => void;
  updateEventConversationCheckActionCondition: (
    checkId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) => void;
  updateEventConversationCheckActionConfig: (
    checkId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) => void;
  updateEventConversationCheckActionConfigPatch: (
    checkId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) => void;
  updateEventConversationCheckActionDraft: (
    checkId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) => void;
  updateEventConversationCheckDraft: (
    checkId: string,
    updater: (check: EventConversationCheckDraft) => EventConversationCheckDraft,
  ) => void;
  updateEventConversationCheckDraftField: <
    K extends keyof EventConversationCheckDraft,
  >(
    checkId: string,
    field: K,
    value: EventConversationCheckDraft[K],
  ) => void;
};

export function EventConversationCheckItem({
  addEventConversationCheckAction,
  check,
  clearActionDragState,
  closeExpandedItem,
  conversationAddMenuCheckId,
  conversationCheckAddBlockRef,
  conversationItemDropTarget,
  deleteEventConversationCheck,
  deleteEventConversationCheckAction,
  dragConversationItem,
  dragHandlerAction,
  dragLeaveConversationItem,
  dragLeaveHandlerAction,
  dragOverConversationItem,
  dragOverHandlerAction,
  dropConversationItem,
  dropHandlerAction,
  editorEvents,
  handlerActionDropTarget,
  isDraggingConversationItem,
  isDraggingHandlerAction,
  isExpandedItem,
  openExpandedItem,
  scriptAudioItems,
  setConversationAddMenuCheckId,
  toggleExpandedItem,
  toggleExpandedParent,
  updateEventConversationCheckActionCondition,
  updateEventConversationCheckActionConfig,
  updateEventConversationCheckActionConfigPatch,
  updateEventConversationCheckActionDraft,
  updateEventConversationCheckDraft,
  updateEventConversationCheckDraftField,
}: EventConversationCheckItemProps) {
  const isHandlerActionExpanded = check.handlerActions.some((step) =>
    isExpandedItem(step.id),
  );
  const isExpanded = isExpandedItem(check.id) || isHandlerActionExpanded;
  const targetEventSlug = check.triggersEvent;
  const dragPayload: DraggingConversationItem = {
    itemId: check.id,
    itemKind: "conversationCheck",
  };

  return (
    <article
      className={[
        "event-step",
        "chat-exit-step",
        "conversation-check-step",
        "tone-state",
        isDraggingConversationItem(dragPayload) ? "is-dragging" : "",
        conversationItemDropTarget?.itemId === check.id &&
        conversationItemDropTarget.itemKind === "conversationCheck"
          ? `is-drop-${conversationItemDropTarget.position}`
          : "",
        isExpanded ? "is-expanded" : "",
        !check.enabled ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={!isExpanded}
      onDragEnd={clearActionDragState}
      onDragLeave={(event) => dragLeaveConversationItem(event, dragPayload)}
      onDragOver={(event) => dragOverConversationItem(event, dragPayload)}
      onDragStart={(event) => {
        if (!isExpanded) dragConversationItem(event, dragPayload);
      }}
      onDrop={(event) => dropConversationItem(event, dragPayload)}
      title="Drag to reorder"
    >
      <div className="event-step-main">
        <span
          aria-label="Drag conversation check"
          className="event-drag-handle"
          draggable={isExpanded}
          onDragStart={(event) => dragConversationItem(event, dragPayload)}
          title="Drag to reorder"
        >
          <GripIcon />
        </span>

        <div className="event-step-summary chat-exit-summary">
          <button
            aria-expanded={isExpanded}
            className="event-step-kind chat-exit-expand-button"
            draggable={isExpanded}
            onClick={() =>
              toggleExpandedParent(
                check.id,
                check.handlerActions.map((step) => step.id),
              )
            }
            onDragStart={(event) => dragConversationItem(event, dragPayload)}
            type="button"
          >
            Check
          </button>
          <input
            aria-label="Conversation check title"
            className="chat-exit-title-input"
            onChange={(event) =>
              updateEventConversationCheckDraftField(
                check.id,
                "title",
                event.target.value,
              )
            }
            placeholder="Title"
            style={inlineFieldWidthStyle(check.title, "Title", 5, 34)}
            type="text"
            value={check.title}
          />
        </div>

        <div className="event-step-tools">
          <button
            aria-label={
              check.enabled
                ? "Disable conversation check"
                : "Enable conversation check"
            }
            className={`event-enable-button${check.enabled ? "" : " is-off"}`}
            onClick={() =>
              updateEventConversationCheckDraft(check.id, (currentCheck) => ({
                ...currentCheck,
                enabled: !currentCheck.enabled,
              }))
            }
            title={check.enabled ? "Enabled" : "Disabled"}
            type="button"
          >
            <span />
          </button>
          <button
            aria-label="Delete conversation check"
            className="event-icon-button danger"
            onClick={() => void deleteEventConversationCheck(check.id)}
            type="button"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="event-step-detail chat-exit-detail">
          <div className="event-context-line conversation-check-core-line">
            <span className="event-detail-label">SAVE AS</span>
            <input
              aria-label="Conversation check result context key"
              onChange={(event) =>
                updateEventConversationCheckDraftField(
                  check.id,
                  "resultContextKey",
                  event.target.value,
                )
              }
              placeholder="student_confused"
              type="text"
              value={check.resultContextKey}
            />
            <span className="event-detail-label">DESTINATION</span>
            <EventDestinationSelect
              ariaLabel="Conversation check destination event"
              editorEvents={editorEvents}
              onChange={(value) =>
                updateEventConversationCheckDraftField(
                  check.id,
                  "triggersEvent",
                  value,
                )
              }
              value={targetEventSlug}
            />
          </div>
          <div className="event-context-line single-value">
            <span className="event-detail-label">CHECK INSTRUCTIONS</span>
            <input
              aria-label="Conversation check instructions"
              onChange={(event) =>
                updateEventConversationCheckDraftField(
                  check.id,
                  "instructions",
                  event.target.value,
                )
              }
              placeholder="Describe exactly when this check should return true."
              type="text"
              value={check.instructions}
            />
          </div>

          <div className="chat-tool-actions-block">
            <EventHandlerActionAddMenu
              activeMenuId={conversationAddMenuCheckId}
              addBlockRef={conversationCheckAddBlockRef}
              menuId={check.id}
              onAddAction={(actionType) =>
                addEventConversationCheckAction(check.id, actionType)
              }
              setActiveMenuId={setConversationAddMenuCheckId}
            />

            <EventHandlerActionList
              clearActionDragState={clearActionDragState}
              closeExpandedItem={closeExpandedItem}
              dragHandleLabel="Drag check action"
              dragHandlerAction={dragHandlerAction}
              dragLeaveHandlerAction={dragLeaveHandlerAction}
              dragOverHandlerAction={dragOverHandlerAction}
              dropHandlerAction={dropHandlerAction}
              editorEvents={editorEvents}
              handlerActionDropTarget={handlerActionDropTarget}
              isDraggingHandlerAction={isDraggingHandlerAction}
              isExpandedItem={isExpandedItem}
              onDeleteAction={(actionId) =>
                deleteEventConversationCheckAction(check.id, actionId)
              }
              onUpdateActionCondition={(actionId, condition) =>
                updateEventConversationCheckActionCondition(
                  check.id,
                  actionId,
                  condition,
                )
              }
              onUpdateActionConfig={(actionId, key, value) =>
                updateEventConversationCheckActionConfig(
                  check.id,
                  actionId,
                  key,
                  value,
                )
              }
              onUpdateActionConfigPatch={(actionId, patch) =>
                updateEventConversationCheckActionConfigPatch(
                  check.id,
                  actionId,
                  patch,
                )
              }
              onUpdateActionDraft={(actionId, updater) =>
                updateEventConversationCheckActionDraft(
                  check.id,
                  actionId,
                  updater,
                )
              }
              openExpandedItem={openExpandedItem}
              ownerId={check.id}
              ownerKind="conversationCheck"
              scriptAudioItems={scriptAudioItems}
              steps={check.handlerActions}
              toggleExpandedItem={toggleExpandedItem}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
