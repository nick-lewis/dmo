import type {
  Dispatch,
  Ref,
  SetStateAction,
} from "react";

import { GripIcon, PlusIcon, TrashIcon } from "../components/Icons";
import type {
  DraggingConversationItem,
  EventActionStep,
  EventClassifierDraft,
  EventClassifierGroupDraft,
  EventStepDraft,
  StepConditionDraft,
} from "../types";
import type {
  ConversationItemInteractionProps,
  HandlerActionInteractionProps,
} from "./eventConversationItemTypes";
import { EventDestinationSelect } from "./EventDestinationSelect";
import {
  eventConditionSummary,
  inlineFieldWidthStyle,
} from "./eventEditorUtils";
import { EventHandlerActionAddMenu } from "./EventHandlerActionAddMenu";
import { EventHandlerActionList } from "./EventHandlerActionList";

type EventClassifierGroupItemProps = ConversationItemInteractionProps &
  HandlerActionInteractionProps & {
  addEventClassifier: (groupId: string) => void;
  addEventClassifierGroupAction: (
    groupId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  conversationAddMenuCheckId: string;
  conversationCheckAddBlockRef: Ref<HTMLDivElement>;
  deleteEventClassifier: (groupId: string, classifierId: string) => void;
  deleteEventClassifierGroup: (groupId: string) => void;
  deleteEventClassifierGroupAction: (groupId: string, actionId: string) => void;
  group: EventClassifierGroupDraft;
  setConversationAddMenuCheckId: Dispatch<SetStateAction<string>>;
  toggleExpandedParent: (parentId: string, childIds: string[]) => void;
  updateEventClassifierDraft: (
    groupId: string,
    classifierId: string,
    updater: (classifier: EventClassifierDraft) => EventClassifierDraft,
  ) => void;
  updateEventClassifierDraftField: <K extends keyof EventClassifierDraft>(
    groupId: string,
    classifierId: string,
    field: K,
    value: EventClassifierDraft[K],
  ) => void;
  updateEventClassifierGroupActionCondition: (
    groupId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) => void;
  updateEventClassifierGroupActionConfig: (
    groupId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) => void;
  updateEventClassifierGroupActionConfigPatch: (
    groupId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) => void;
  updateEventClassifierGroupActionDraft: (
    groupId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) => void;
  updateEventClassifierGroupDraft: (
    groupId: string,
    updater: (group: EventClassifierGroupDraft) => EventClassifierGroupDraft,
  ) => void;
  updateEventClassifierGroupDraftField: <
    K extends keyof EventClassifierGroupDraft,
  >(
    groupId: string,
    field: K,
    value: EventClassifierGroupDraft[K],
  ) => void;
};

export function EventClassifierGroupItem({
  addEventClassifier,
  addEventClassifierGroupAction,
  clearActionDragState,
  closeExpandedItem,
  conversationAddMenuCheckId,
  conversationCheckAddBlockRef,
  conversationItemDropTarget,
  deleteEventClassifier,
  deleteEventClassifierGroup,
  deleteEventClassifierGroupAction,
  dragConversationItem,
  dragHandlerAction,
  dragLeaveConversationItem,
  dragLeaveHandlerAction,
  dragOverConversationItem,
  dragOverHandlerAction,
  dropConversationItem,
  dropHandlerAction,
  editorEvents,
  group,
  handlerActionDropTarget,
  isDraggingConversationItem,
  isDraggingHandlerAction,
  isExpandedItem,
  openExpandedItem,
  scriptAudioItems,
  setConversationAddMenuCheckId,
  toggleExpandedItem,
  toggleExpandedParent,
  updateEventClassifierDraft,
  updateEventClassifierDraftField,
  updateEventClassifierGroupActionCondition,
  updateEventClassifierGroupActionConfig,
  updateEventClassifierGroupActionConfigPatch,
  updateEventClassifierGroupActionDraft,
  updateEventClassifierGroupDraft,
  updateEventClassifierGroupDraftField,
}: EventClassifierGroupItemProps) {
  const isHandlerActionExpanded = group.handlerActions.some((step) =>
    isExpandedItem(step.id),
  );
  const isExpanded = isExpandedItem(group.id) || isHandlerActionExpanded;
  const targetEventSlug = group.triggersEvent;
  const groupMenuId = `classifier-group:${group.id}`;
  const dragPayload: DraggingConversationItem = {
    itemId: group.id,
    itemKind: "classifierGroup",
  };

  return (
    <article
      className={[
        "event-step",
        "chat-exit-step",
        "tone-state",
        isDraggingConversationItem(dragPayload) ? "is-dragging" : "",
        conversationItemDropTarget?.itemId === group.id &&
        conversationItemDropTarget.itemKind === "classifierGroup"
          ? `is-drop-${conversationItemDropTarget.position}`
          : "",
        isExpanded ? "is-expanded" : "",
        !group.enabled ? "is-disabled" : "",
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
          aria-label="Drag classifier group"
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
                group.id,
                group.handlerActions.map((step) => step.id),
              )
            }
            onDragStart={(event) => dragConversationItem(event, dragPayload)}
            type="button"
          >
            Classifiers
          </button>
          <input
            aria-label="Classifier group title"
            className="chat-exit-title-input"
            onChange={(event) =>
              updateEventClassifierGroupDraftField(
                group.id,
                "title",
                event.target.value,
              )
            }
            placeholder="Title"
            style={inlineFieldWidthStyle(group.title, "Title", 5, 34)}
            type="text"
            value={group.title}
          />
        </div>

        <div className="event-step-tools">
          <button
            aria-label={
              group.enabled
                ? "Disable classifier group"
                : "Enable classifier group"
            }
            className={`event-enable-button${group.enabled ? "" : " is-off"}`}
            onClick={() =>
              updateEventClassifierGroupDraft(group.id, (currentGroup) => ({
                ...currentGroup,
                enabled: !currentGroup.enabled,
              }))
            }
            title={group.enabled ? "Enabled" : "Disabled"}
            type="button"
          >
            <span />
          </button>
          <button
            aria-label="Delete classifier group"
            className="event-icon-button danger"
            onClick={() => void deleteEventClassifierGroup(group.id)}
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
              aria-label="Classifier group result context key"
              onChange={(event) =>
                updateEventClassifierGroupDraftField(
                  group.id,
                  "resultContextKey",
                  event.target.value,
                )
              }
              placeholder="_classifier_results"
              type="text"
              value={group.resultContextKey}
            />
            <span className="event-detail-label">DESTINATION</span>
            <EventDestinationSelect
              ariaLabel="Classifier group destination event"
              editorEvents={editorEvents}
              emptyLabel="None"
              onChange={(value) =>
                updateEventClassifierGroupDraftField(
                  group.id,
                  "triggersEvent",
                  value,
                )
              }
              value={targetEventSlug}
            />
          </div>
          <div className="event-context-line single-value">
            <span className="event-detail-label">GROUP INSTRUCTIONS</span>
            <input
              aria-label="Classifier group instructions"
              onChange={(event) =>
                updateEventClassifierGroupDraftField(
                  group.id,
                  "instructions",
                  event.target.value,
                )
              }
              placeholder="Shared instructions for this classifier pass."
              type="text"
              value={group.instructions}
            />
          </div>

          <div className="chat-exit-capture-block">
            <div className="chat-exit-capture-header">
              <span className="conversation-block-label">Classifiers</span>
              <button
                className="event-add-button compact"
                onClick={() => void addEventClassifier(group.id)}
                type="button"
              >
                <PlusIcon />
                Classifier
              </button>
            </div>
            {group.classifiers.map((classifier) => (
              <div
                className="event-context-line chat-exit-capture-line classifier-line"
                key={classifier.id}
              >
                <span className="event-detail-label">NAME</span>
                <input
                  aria-label="Classifier name"
                  onChange={(event) =>
                    updateEventClassifierDraftField(
                      group.id,
                      classifier.id,
                      "name",
                      event.target.value,
                    )
                  }
                  placeholder="banana"
                  type="text"
                  value={classifier.name}
                />
                <span className="event-detail-label">PROMPT</span>
                <input
                  aria-label="Classifier prompt"
                  onChange={(event) =>
                    updateEventClassifierDraftField(
                      group.id,
                      classifier.id,
                      "prompt",
                      event.target.value,
                    )
                  }
                  placeholder="Return mentioned=true when..."
                  type="text"
                  value={classifier.prompt}
                />
                <span
                  className={`event-if-chip classifier-if-chip${
                    eventConditionSummary(classifier.condition) ? "" : " is-empty"
                  }`}
                  title="Classifier run condition"
                >
                  RUN IF
                  {eventConditionSummary(classifier.condition)
                    ? ` ${eventConditionSummary(classifier.condition)}`
                    : " always"}
                </span>
                <button
                  aria-label={
                    classifier.enabled
                      ? "Disable classifier"
                      : "Enable classifier"
                  }
                  className={`event-enable-button${
                    classifier.enabled ? "" : " is-off"
                  }`}
                  onClick={() =>
                    updateEventClassifierDraft(
                      group.id,
                      classifier.id,
                      (currentClassifier) => ({
                        ...currentClassifier,
                        enabled: !currentClassifier.enabled,
                      }),
                    )
                  }
                  title={classifier.enabled ? "Enabled" : "Disabled"}
                  type="button"
                >
                  <span />
                </button>
                <button
                  aria-label="Delete classifier"
                  className="event-icon-button danger"
                  onClick={() =>
                    void deleteEventClassifier(group.id, classifier.id)
                  }
                  type="button"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            {!group.classifiers.length ? (
              <div className="chat-exit-empty">---</div>
            ) : null}
          </div>

          <div className="chat-tool-actions-block">
            <div className="conversation-block-label">Handler actions</div>
            <EventHandlerActionAddMenu
              activeMenuId={conversationAddMenuCheckId}
              addBlockRef={conversationCheckAddBlockRef}
              menuId={groupMenuId}
              onAddAction={(actionType) =>
                addEventClassifierGroupAction(group.id, actionType)
              }
              setActiveMenuId={setConversationAddMenuCheckId}
            />

            <EventHandlerActionList
              clearActionDragState={clearActionDragState}
              closeExpandedItem={closeExpandedItem}
              dragHandleLabel="Drag classifier action"
              dragHandlerAction={dragHandlerAction}
              dragLeaveHandlerAction={dragLeaveHandlerAction}
              dragOverHandlerAction={dragOverHandlerAction}
              dropHandlerAction={dropHandlerAction}
              editorEvents={editorEvents}
              handlerActionDropTarget={handlerActionDropTarget}
              isDraggingHandlerAction={isDraggingHandlerAction}
              isExpandedItem={isExpandedItem}
              onDeleteAction={(actionId) =>
                deleteEventClassifierGroupAction(group.id, actionId)
              }
              onUpdateActionCondition={(actionId, condition) =>
                updateEventClassifierGroupActionCondition(
                  group.id,
                  actionId,
                  condition,
                )
              }
              onUpdateActionConfig={(actionId, key, value) =>
                updateEventClassifierGroupActionConfig(
                  group.id,
                  actionId,
                  key,
                  value,
                )
              }
              onUpdateActionConfigPatch={(actionId, patch) =>
                updateEventClassifierGroupActionConfigPatch(
                  group.id,
                  actionId,
                  patch,
                )
              }
              onUpdateActionDraft={(actionId, updater) =>
                updateEventClassifierGroupActionDraft(
                  group.id,
                  actionId,
                  updater,
                )
              }
              openExpandedItem={openExpandedItem}
              ownerId={group.id}
              ownerKind="classifierGroup"
              scriptAudioItems={scriptAudioItems}
              steps={group.handlerActions}
              toggleExpandedItem={toggleExpandedItem}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
