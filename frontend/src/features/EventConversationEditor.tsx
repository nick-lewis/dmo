import type {
  Dispatch,
  Ref,
  SetStateAction,
} from "react";

import type {
  EventActionStep,
  EventChatCaptureDraft,
  EventChatToolDraft,
  EventClassifierDraft,
  EventClassifierGroupDraft,
  EventConversationCheckDraft,
  EventConversationChoiceDraft,
  EventDraft,
  EventStepDraft,
  StepConditionDraft,
} from "../types";
import { EventConversationAddMenu } from "./EventConversationAddMenu";
import { EventClassifierGroupItem } from "./EventClassifierGroupItem";
import { EventChatToolItem } from "./EventChatToolItem";
import { EventConversationCheckItem } from "./EventConversationCheckItem";
import { EventConversationChoiceItem } from "./EventConversationChoiceItem";
import type {
  ConversationItemInteractionProps,
  HandlerActionInteractionProps,
} from "./eventConversationItemTypes";

type EventConversationEditorProps = ConversationItemInteractionProps &
  HandlerActionInteractionProps & {
  addEventChatCapture: (toolId: string) => void;
  addEventChatTool: () => void;
  addEventChatToolAction: (
    toolId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  addEventClassifier: (groupId: string) => void;
  addEventClassifierGroup: () => void;
  addEventClassifierGroupAction: (
    groupId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  addEventConversationCheck: () => void;
  addEventConversationCheckAction: (
    checkId: string,
    actionType: EventActionStep["actionType"],
  ) => void;
  addEventConversationChoice: () => void;
  choiceIconBackground: string;
  conversationAddBlockRef: Ref<HTMLDivElement>;
  conversationAddMenuCheckId: string;
  conversationAddMenuToolId: string;
  conversationCheckAddBlockRef: Ref<HTMLDivElement>;
  conversationItemAddBlockRef: Ref<HTMLDivElement>;
  deleteEventChatCapture: (toolId: string, captureId: string) => void;
  deleteEventChatTool: (toolId: string) => void;
  deleteEventChatToolAction: (toolId: string, actionId: string) => void;
  deleteEventClassifier: (groupId: string, classifierId: string) => void;
  deleteEventClassifierGroup: (groupId: string) => void;
  deleteEventClassifierGroupAction: (groupId: string, actionId: string) => void;
  deleteEventConversationCheck: (checkId: string) => void;
  deleteEventConversationCheckAction: (checkId: string, actionId: string) => void;
  deleteEventConversationChoice: (choiceId: string) => void;
  eventDraft: EventDraft;
  isConversationAddMenuOpen: boolean;
  setConversationAddMenuCheckId: Dispatch<SetStateAction<string>>;
  setConversationAddMenuToolId: Dispatch<SetStateAction<string>>;
  setIsConversationAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  toggleExpandedParent: (parentId: string, childIds: string[]) => void;
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
  updateEventClassifierGroupDraftField: <K extends keyof EventClassifierGroupDraft>(
    groupId: string,
    field: K,
    value: EventClassifierGroupDraft[K],
  ) => void;
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
  updateEventConversationCheckDraftField: <K extends keyof EventConversationCheckDraft>(
    checkId: string,
    field: K,
    value: EventConversationCheckDraft[K],
  ) => void;
  updateEventConversationChoiceDraft: (
    choiceId: string,
    updater: (choice: EventConversationChoiceDraft) => EventConversationChoiceDraft,
  ) => void;
  updateEventConversationChoiceDraftField: <K extends keyof EventConversationChoiceDraft>(
    choiceId: string,
    field: K,
    value: EventConversationChoiceDraft[K],
  ) => void;
  updateEventDraft: (
    field: "chatInstructions" | "description" | "title",
    value: string,
  ) => void;
};

export function EventConversationEditor({
  addEventChatCapture,
  addEventChatTool,
  addEventChatToolAction,
  addEventClassifier,
  addEventClassifierGroup,
  addEventClassifierGroupAction,
  addEventConversationCheck,
  addEventConversationCheckAction,
  addEventConversationChoice,
  choiceIconBackground,
  clearActionDragState,
  closeExpandedItem,
  conversationAddBlockRef,
  conversationAddMenuCheckId,
  conversationAddMenuToolId,
  conversationCheckAddBlockRef,
  conversationItemAddBlockRef,
  conversationItemDropTarget,
  deleteEventChatCapture,
  deleteEventChatTool,
  deleteEventChatToolAction,
  deleteEventClassifier,
  deleteEventClassifierGroup,
  deleteEventClassifierGroupAction,
  deleteEventConversationCheck,
  deleteEventConversationCheckAction,
  deleteEventConversationChoice,
  dragConversationItem,
  dragHandlerAction,
  dragLeaveConversationItem,
  dragLeaveHandlerAction,
  dragOverConversationItem,
  dragOverHandlerAction,
  dropConversationItem,
  dropHandlerAction,
  editorEvents,
  eventDraft,
  handlerActionDropTarget,
  isConversationAddMenuOpen,
  isDraggingConversationItem,
  isDraggingHandlerAction,
  isExpandedItem,
  openExpandedItem,
  scriptAudioItems,
  setConversationAddMenuCheckId,
  setConversationAddMenuToolId,
  setIsConversationAddMenuOpen,
  toggleExpandedItem,
  toggleExpandedParent,
  updateEventChatCaptureDraft,
  updateEventChatToolActionCondition,
  updateEventChatToolActionConfig,
  updateEventChatToolActionConfigPatch,
  updateEventChatToolActionDraft,
  updateEventChatToolDraft,
  updateEventChatToolDraftField,
  updateEventClassifierDraft,
  updateEventClassifierDraftField,
  updateEventClassifierGroupActionCondition,
  updateEventClassifierGroupActionConfig,
  updateEventClassifierGroupActionConfigPatch,
  updateEventClassifierGroupActionDraft,
  updateEventClassifierGroupDraft,
  updateEventClassifierGroupDraftField,
  updateEventConversationCheckActionCondition,
  updateEventConversationCheckActionConfig,
  updateEventConversationCheckActionConfigPatch,
  updateEventConversationCheckActionDraft,
  updateEventConversationCheckDraft,
  updateEventConversationCheckDraftField,
  updateEventConversationChoiceDraft,
  updateEventConversationChoiceDraftField,
  updateEventDraft,
}: EventConversationEditorProps) {
  const conversationItemProps = {
    clearActionDragState,
    conversationItemDropTarget,
    dragConversationItem,
    dragLeaveConversationItem,
    dragOverConversationItem,
    dropConversationItem,
    editorEvents,
    isDraggingConversationItem,
    isExpandedItem,
    toggleExpandedItem,
  };
  const handlerActionProps = {
    closeExpandedItem,
    dragHandlerAction,
    dragLeaveHandlerAction,
    dragOverHandlerAction,
    dropHandlerAction,
    handlerActionDropTarget,
    isDraggingHandlerAction,
    openExpandedItem,
    scriptAudioItems,
  };

  return (
    <>
      <div className="event-context-line single-value event-chat-instructions-line">
        <span className="event-detail-label">CHAT INSTRUCTIONS</span>
        <input
          aria-label="Event chat instructions"
          onChange={(event) =>
            updateEventDraft("chatInstructions", event.target.value)
          }
          placeholder="Optional context-aware instructions for chat in this event."
          type="text"
          value={eventDraft.chatInstructions}
        />
      </div>

      <div className="event-sequence-header chat-exits-header">
        <span>Conversation</span>
      </div>

      <div className="event-step-list chat-exit-list">
        {eventDraft.chatTools.map((tool) => (
          <EventChatToolItem
            {...conversationItemProps}
            {...handlerActionProps}
            addEventChatCapture={addEventChatCapture}
            addEventChatToolAction={addEventChatToolAction}
            conversationAddBlockRef={conversationAddBlockRef}
            conversationAddMenuToolId={conversationAddMenuToolId}
            deleteEventChatCapture={deleteEventChatCapture}
            deleteEventChatTool={deleteEventChatTool}
            deleteEventChatToolAction={deleteEventChatToolAction}
            key={tool.id}
            setConversationAddMenuToolId={setConversationAddMenuToolId}
            toggleExpandedParent={toggleExpandedParent}
            tool={tool}
            updateEventChatCaptureDraft={updateEventChatCaptureDraft}
            updateEventChatToolActionCondition={
              updateEventChatToolActionCondition
            }
            updateEventChatToolActionConfig={updateEventChatToolActionConfig}
            updateEventChatToolActionConfigPatch={
              updateEventChatToolActionConfigPatch
            }
            updateEventChatToolActionDraft={updateEventChatToolActionDraft}
            updateEventChatToolDraft={updateEventChatToolDraft}
            updateEventChatToolDraftField={updateEventChatToolDraftField}
          />
        ))}
        {eventDraft.conversationChecks.map((check) => (
          <EventConversationCheckItem
            {...conversationItemProps}
            {...handlerActionProps}
            addEventConversationCheckAction={addEventConversationCheckAction}
            check={check}
            conversationAddMenuCheckId={conversationAddMenuCheckId}
            conversationCheckAddBlockRef={conversationCheckAddBlockRef}
            deleteEventConversationCheck={deleteEventConversationCheck}
            deleteEventConversationCheckAction={
              deleteEventConversationCheckAction
            }
            key={check.id}
            setConversationAddMenuCheckId={setConversationAddMenuCheckId}
            toggleExpandedParent={toggleExpandedParent}
            updateEventConversationCheckActionCondition={
              updateEventConversationCheckActionCondition
            }
            updateEventConversationCheckActionConfig={
              updateEventConversationCheckActionConfig
            }
            updateEventConversationCheckActionConfigPatch={
              updateEventConversationCheckActionConfigPatch
            }
            updateEventConversationCheckActionDraft={
              updateEventConversationCheckActionDraft
            }
            updateEventConversationCheckDraft={updateEventConversationCheckDraft}
            updateEventConversationCheckDraftField={
              updateEventConversationCheckDraftField
            }
          />
        ))}
        {eventDraft.classifierGroups.map((group) => (
          <EventClassifierGroupItem
            {...conversationItemProps}
            {...handlerActionProps}
            addEventClassifier={addEventClassifier}
            addEventClassifierGroupAction={addEventClassifierGroupAction}
            conversationAddMenuCheckId={conversationAddMenuCheckId}
            conversationCheckAddBlockRef={conversationCheckAddBlockRef}
            deleteEventClassifier={deleteEventClassifier}
            deleteEventClassifierGroup={deleteEventClassifierGroup}
            deleteEventClassifierGroupAction={deleteEventClassifierGroupAction}
            group={group}
            key={group.id}
            setConversationAddMenuCheckId={setConversationAddMenuCheckId}
            toggleExpandedParent={toggleExpandedParent}
            updateEventClassifierDraft={updateEventClassifierDraft}
            updateEventClassifierDraftField={updateEventClassifierDraftField}
            updateEventClassifierGroupActionCondition={
              updateEventClassifierGroupActionCondition
            }
            updateEventClassifierGroupActionConfig={
              updateEventClassifierGroupActionConfig
            }
            updateEventClassifierGroupActionConfigPatch={
              updateEventClassifierGroupActionConfigPatch
            }
            updateEventClassifierGroupActionDraft={
              updateEventClassifierGroupActionDraft
            }
            updateEventClassifierGroupDraft={updateEventClassifierGroupDraft}
            updateEventClassifierGroupDraftField={
              updateEventClassifierGroupDraftField
            }
          />
        ))}
        {eventDraft.conversationChoices.map((choice) => (
          <EventConversationChoiceItem
            {...conversationItemProps}
            choice={choice}
            choiceIconBackground={choiceIconBackground}
            deleteEventConversationChoice={deleteEventConversationChoice}
            isExpanded={isExpandedItem(choice.id)}
            key={choice.id}
            updateEventConversationChoiceDraft={
              updateEventConversationChoiceDraft
            }
            updateEventConversationChoiceDraftField={
              updateEventConversationChoiceDraftField
            }
          />
        ))}
        {!eventDraft.chatTools.length &&
        !eventDraft.conversationChecks.length &&
        !eventDraft.classifierGroups.length &&
        !eventDraft.conversationChoices.length ? (
          <div className="chat-exit-empty">---</div>
        ) : null}
      </div>

      <EventConversationAddMenu
        addEventChatTool={addEventChatTool}
        addEventClassifierGroup={addEventClassifierGroup}
        addEventConversationCheck={addEventConversationCheck}
        addEventConversationChoice={addEventConversationChoice}
        conversationItemAddBlockRef={conversationItemAddBlockRef}
        isConversationAddMenuOpen={isConversationAddMenuOpen}
        setIsConversationAddMenuOpen={setIsConversationAddMenuOpen}
      />
    </>
  );
}
