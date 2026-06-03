import type { Dispatch, Ref, SetStateAction } from "react";

import { PlusIcon } from "../components/Icons";

type EventConversationAddMenuProps = {
  addEventChatTool: () => void;
  addEventClassifierGroup: () => void;
  addEventConversationCheck: () => void;
  addEventConversationChoice: () => void;
  conversationItemAddBlockRef: Ref<HTMLDivElement>;
  isConversationAddMenuOpen: boolean;
  setIsConversationAddMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function EventConversationAddMenu({
  addEventChatTool,
  addEventClassifierGroup,
  addEventConversationCheck,
  addEventConversationChoice,
  conversationItemAddBlockRef,
  isConversationAddMenuOpen,
  setIsConversationAddMenuOpen,
}: EventConversationAddMenuProps) {
  return (
    <div
      className="event-add-block conversation-add-block"
      ref={conversationItemAddBlockRef}
    >
      <button
        aria-expanded={isConversationAddMenuOpen}
        className="event-add-button"
        onClick={() => setIsConversationAddMenuOpen((current) => !current)}
        type="button"
      >
        <PlusIcon />
        Add conversation item
      </button>
      {isConversationAddMenuOpen ? (
        <div className="event-add-menu">
          <button
            className="event-add-option tone-flow"
            onClick={() => void addEventChatTool()}
            type="button"
          >
            <span>FC route</span>
            <small>Function call that can capture, act, and route</small>
          </button>
          <button
            className="event-add-option tone-state"
            onClick={() => void addEventConversationCheck()}
            type="button"
          >
            <span>Check</span>
            <small>Classifier that can save, act, and route</small>
          </button>
          <button
            className="event-add-option tone-state"
            onClick={() => void addEventClassifierGroup()}
            type="button"
          >
            <span>Classifier group</span>
            <small>Concurrent function-call style classifiers</small>
          </button>
          <button
            className="event-add-option tone-flow"
            onClick={addEventConversationChoice}
            type="button"
          >
            <span>Choice</span>
            <small>Button shown after entry script finishes</small>
          </button>
        </div>
      ) : null}
    </div>
  );
}
