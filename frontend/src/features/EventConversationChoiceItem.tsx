import { publicAsset } from "../assets";
import { GripIcon, TrashIcon } from "../components/Icons";
import { defaultChoiceIconPath } from "../tutorAssets";
import type {
  DraggingConversationItem,
  EventConversationChoiceDraft,
} from "../types";
import { choiceIconBackgroundStyle } from "../uiHelpers";
import type { ConversationItemInteractionProps } from "./eventConversationItemTypes";
import { EventDestinationSelect } from "./EventDestinationSelect";
import { inlineFieldWidthStyle } from "./eventEditorUtils";

type EventConversationChoiceItemProps = ConversationItemInteractionProps & {
  choice: EventConversationChoiceDraft;
  choiceIconBackground: string;
  deleteEventConversationChoice: (choiceId: string) => void;
  isExpanded: boolean;
  updateEventConversationChoiceDraft: (
    choiceId: string,
    updater: (choice: EventConversationChoiceDraft) => EventConversationChoiceDraft,
  ) => void;
  updateEventConversationChoiceDraftField: <
    K extends keyof EventConversationChoiceDraft,
  >(
    choiceId: string,
    field: K,
    value: EventConversationChoiceDraft[K],
  ) => void;
};

export function EventConversationChoiceItem({
  choice,
  choiceIconBackground,
  clearActionDragState,
  conversationItemDropTarget,
  deleteEventConversationChoice,
  dragConversationItem,
  dragLeaveConversationItem,
  dragOverConversationItem,
  dropConversationItem,
  editorEvents,
  isDraggingConversationItem,
  isExpanded,
  toggleExpandedItem,
  updateEventConversationChoiceDraft,
  updateEventConversationChoiceDraftField,
}: EventConversationChoiceItemProps) {
  const targetEventSlug = choice.triggersEvent;
  const dragPayload: DraggingConversationItem = {
    itemId: choice.id,
    itemKind: "conversationChoice",
  };

  return (
    <article
      className={[
        "event-step",
        "chat-exit-step",
        "conversation-choice-step",
        "tone-flow",
        isDraggingConversationItem(dragPayload) ? "is-dragging" : "",
        conversationItemDropTarget?.itemId === choice.id &&
        conversationItemDropTarget.itemKind === "conversationChoice"
          ? `is-drop-${conversationItemDropTarget.position}`
          : "",
        isExpanded ? "is-expanded" : "",
        !choice.enabled ? "is-disabled" : "",
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
          aria-label="Drag choice"
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
            onClick={() => toggleExpandedItem(choice.id)}
            onDragStart={(event) => dragConversationItem(event, dragPayload)}
            type="button"
          >
            Choice
          </button>
          <input
            aria-label="Conversation choice label"
            className="chat-exit-title-input"
            onChange={(event) =>
              updateEventConversationChoiceDraftField(
                choice.id,
                "label",
                event.target.value,
              )
            }
            placeholder="Continue"
            style={inlineFieldWidthStyle(choice.label, "Continue", 8, 30)}
            type="text"
            value={choice.label}
          />
        </div>

        <div className="event-step-tools">
          <button
            aria-label={choice.enabled ? "Disable choice" : "Enable choice"}
            className={`event-enable-button${choice.enabled ? "" : " is-off"}`}
            onClick={() =>
              updateEventConversationChoiceDraft(choice.id, (currentChoice) => ({
                ...currentChoice,
                enabled: !currentChoice.enabled,
              }))
            }
            title={choice.enabled ? "Enabled" : "Disabled"}
            type="button"
          >
            <span />
          </button>
          <button
            aria-label="Delete choice"
            className="event-icon-button danger"
            onClick={() => deleteEventConversationChoice(choice.id)}
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
              ariaLabel="Conversation choice destination event"
              editorEvents={editorEvents}
              onChange={(value) =>
                updateEventConversationChoiceDraftField(
                  choice.id,
                  "triggersEvent",
                  value,
                )
              }
              value={targetEventSlug}
            />
          </div>
          <div className="event-context-line conversation-choice-icon-line">
            <span className="event-detail-label">ICON</span>
            <button
              aria-label={
                choice.iconPath ? "Remove choice icon" : "Include choice icon"
              }
              className={`event-enable-button${choice.iconPath ? "" : " is-off"}`}
              onClick={() =>
                updateEventConversationChoiceDraftField(
                  choice.id,
                  "iconPath",
                  choice.iconPath ? "" : defaultChoiceIconPath,
                )
              }
              title={
                choice.iconPath
                  ? "Icon shown with this choice"
                  : "Show button icon with this choice"
              }
              type="button"
            >
              <span />
            </button>
            <span
              aria-hidden="true"
              className={`conversation-choice-icon-preview${
                choice.iconPath ? "" : " is-empty"
              }`}
              style={choiceIconBackgroundStyle(choiceIconBackground)}
            >
              {choice.iconPath ? (
                <img alt="" src={publicAsset(choice.iconPath)} />
              ) : null}
            </span>
            <span className="conversation-choice-icon-copy">
              {choice.iconPath ? "Button icon" : "---"}
            </span>
          </div>
        </div>
      ) : null}
    </article>
  );
}
