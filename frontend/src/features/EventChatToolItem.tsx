import type {
  Dispatch,
  Ref,
  SetStateAction,
} from "react";

import { GripIcon, PlusIcon, TrashIcon } from "../components/Icons";
import type {
  DraggingConversationItem,
  EventActionStep,
  EventChatCaptureDraft,
  EventChatToolDraft,
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

type EventChatToolItemProps = ConversationItemInteractionProps &
  HandlerActionInteractionProps & {
  addEventChatCapture: (toolId: string) => void;
  addEventChatToolAction: (
    toolId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  conversationAddBlockRef: Ref<HTMLDivElement>;
  conversationAddMenuToolId: string;
  deleteEventChatCapture: (toolId: string, captureId: string) => void;
  deleteEventChatTool: (toolId: string) => void;
  deleteEventChatToolAction: (toolId: string, actionId: string) => void;
  setConversationAddMenuToolId: Dispatch<SetStateAction<string>>;
  toggleExpandedParent: (parentId: string, childIds: string[]) => void;
  tool: EventChatToolDraft;
  updateEventChatCaptureDraft: (
    toolId: string,
    captureId: string,
    updater: (capture: EventChatCaptureDraft) => EventChatCaptureDraft,
  ) => void;
  updateEventChatToolActionCondition: (
    toolId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) => void;
  updateEventChatToolActionConfig: (
    toolId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) => void;
  updateEventChatToolActionConfigPatch: (
    toolId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) => void;
  updateEventChatToolActionDraft: (
    toolId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) => void;
  updateEventChatToolDraft: (
    toolId: string,
    updater: (tool: EventChatToolDraft) => EventChatToolDraft,
  ) => void;
  updateEventChatToolDraftField: <K extends keyof EventChatToolDraft>(
    toolId: string,
    field: K,
    value: EventChatToolDraft[K],
  ) => void;
};

export function EventChatToolItem({
  addEventChatCapture,
  addEventChatToolAction,
  clearActionDragState,
  closeExpandedItem,
  conversationAddBlockRef,
  conversationAddMenuToolId,
  conversationItemDropTarget,
  deleteEventChatCapture,
  deleteEventChatTool,
  deleteEventChatToolAction,
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
  setConversationAddMenuToolId,
  toggleExpandedItem,
  toggleExpandedParent,
  tool,
  updateEventChatCaptureDraft,
  updateEventChatToolActionCondition,
  updateEventChatToolActionConfig,
  updateEventChatToolActionConfigPatch,
  updateEventChatToolActionDraft,
  updateEventChatToolDraft,
  updateEventChatToolDraftField,
}: EventChatToolItemProps) {
  const isHandlerActionExpanded = tool.handlerActions.some((step) =>
    isExpandedItem(step.id),
  );
  const isExpanded = isExpandedItem(tool.id) || isHandlerActionExpanded;
  const targetEventSlug = tool.triggersEvent;
  const dragPayload: DraggingConversationItem = {
    itemId: tool.id,
    itemKind: "chatTool",
  };

  return (
    <article
      className={[
        "event-step",
        "chat-exit-step",
        "tone-flow",
        isDraggingConversationItem(dragPayload) ? "is-dragging" : "",
        conversationItemDropTarget?.itemId === tool.id &&
        conversationItemDropTarget.itemKind === "chatTool"
          ? `is-drop-${conversationItemDropTarget.position}`
          : "",
        isExpanded ? "is-expanded" : "",
        !tool.enabled ? "is-disabled" : "",
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
          aria-label="Drag FC route"
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
                tool.id,
                tool.handlerActions.map((step) => step.id),
              )
            }
            onDragStart={(event) => dragConversationItem(event, dragPayload)}
            type="button"
          >
            FC route
          </button>
          <input
            aria-label="FC route title"
            className="chat-exit-title-input"
            onChange={(event) =>
              updateEventChatToolDraftField(tool.id, "title", event.target.value)
            }
            placeholder="Title"
            style={inlineFieldWidthStyle(tool.title, "Title", 5, 34)}
            type="text"
            value={tool.title}
          />
        </div>

        <div className="event-step-tools">
          <button
            aria-label={tool.enabled ? "Disable FC route" : "Enable FC route"}
            className={`event-enable-button${tool.enabled ? "" : " is-off"}`}
            onClick={() =>
              updateEventChatToolDraft(tool.id, (currentTool) => ({
                ...currentTool,
                enabled: !currentTool.enabled,
              }))
            }
            title={tool.enabled ? "Enabled" : "Disabled"}
            type="button"
          >
            <span />
          </button>
          <button
            aria-label="Delete FC route"
            className="event-icon-button danger"
            onClick={() => void deleteEventChatTool(tool.id)}
            type="button"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="event-step-detail chat-exit-detail">
          <div className="event-context-line chat-exit-core-line">
            <span className="event-detail-label">DESTINATION</span>
            <EventDestinationSelect
              ariaLabel="FC route destination event"
              editorEvents={editorEvents}
              onChange={(value) =>
                updateEventChatToolDraftField(
                  tool.id,
                  "triggersEvent",
                  value,
                )
              }
              value={targetEventSlug}
            />
          </div>
          <div className="event-context-line single-value">
            <span className="event-detail-label">
              FUNCTION CALL DESCRIPTION
            </span>
            <input
              aria-label="Function call trigger conditions"
              onChange={(event) =>
                updateEventChatToolDraftField(
                  tool.id,
                  "description",
                  event.target.value,
                )
              }
              placeholder="Describe the conditions that should trigger this FC route."
              type="text"
              value={tool.description}
            />
          </div>
          <div className="chat-exit-capture-block">
            <div className="chat-exit-capture-header">
              <button
                className="event-add-button compact"
                onClick={() => addEventChatCapture(tool.id)}
                type="button"
              >
                <PlusIcon />
                Argument
              </button>
            </div>
            {tool.captures.map((capture) => (
              <div
                className="event-context-line chat-exit-capture-line"
                key={capture.id}
              >
                <span className="event-detail-label">SAVE AS</span>
                <input
                  aria-label="Save argument as context key"
                  onChange={(event) =>
                    updateEventChatCaptureDraft(
                      tool.id,
                      capture.id,
                      (currentCapture) => ({
                        ...currentCapture,
                        saveAs: event.target.value,
                      }),
                    )
                  }
                  placeholder="delivery_estimate"
                  type="text"
                  value={capture.saveAs}
                />
                <span className="event-detail-label">
                  ARGUMENT DESCRIPTION
                </span>
                <input
                  aria-label="Argument description"
                  onChange={(event) =>
                    updateEventChatCaptureDraft(
                      tool.id,
                      capture.id,
                      (currentCapture) => ({
                        ...currentCapture,
                        description: event.target.value,
                      }),
                    )
                  }
                  placeholder="The learner's delivery-time estimate."
                  type="text"
                  value={capture.description}
                />
                <button
                  aria-label="Delete argument"
                  className="event-icon-button danger"
                  onClick={() => deleteEventChatCapture(tool.id, capture.id)}
                  type="button"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            {!tool.captures.length ? (
              <div className="chat-exit-empty">---</div>
            ) : null}
          </div>

          <div className="chat-tool-actions-block">
            <EventHandlerActionAddMenu
              activeMenuId={conversationAddMenuToolId}
              addBlockRef={conversationAddBlockRef}
              menuId={tool.id}
              onAddAction={(actionType) =>
                addEventChatToolAction(tool.id, actionType)
              }
              setActiveMenuId={setConversationAddMenuToolId}
            />

            <EventHandlerActionList
              clearActionDragState={clearActionDragState}
              closeExpandedItem={closeExpandedItem}
              dragHandleLabel="Drag route action"
              dragHandlerAction={dragHandlerAction}
              dragLeaveHandlerAction={dragLeaveHandlerAction}
              dragOverHandlerAction={dragOverHandlerAction}
              dropHandlerAction={dropHandlerAction}
              editorEvents={editorEvents}
              handlerActionDropTarget={handlerActionDropTarget}
              isDraggingHandlerAction={isDraggingHandlerAction}
              isExpandedItem={isExpandedItem}
              onDeleteAction={(actionId) =>
                deleteEventChatToolAction(tool.id, actionId)
              }
              onUpdateActionCondition={(actionId, condition) =>
                updateEventChatToolActionCondition(tool.id, actionId, condition)
              }
              onUpdateActionConfig={(actionId, key, value) =>
                updateEventChatToolActionConfig(tool.id, actionId, key, value)
              }
              onUpdateActionConfigPatch={(actionId, patch) =>
                updateEventChatToolActionConfigPatch(tool.id, actionId, patch)
              }
              onUpdateActionDraft={(actionId, updater) =>
                updateEventChatToolActionDraft(tool.id, actionId, updater)
              }
              openExpandedItem={openExpandedItem}
              ownerId={tool.id}
              ownerKind="chatTool"
              scriptAudioItems={scriptAudioItems}
              steps={tool.handlerActions}
              toggleExpandedItem={toggleExpandedItem}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
