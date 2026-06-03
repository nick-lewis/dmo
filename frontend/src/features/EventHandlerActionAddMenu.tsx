import type { Dispatch, Ref, SetStateAction } from "react";

import {
  eventActionDescription,
  eventActionOptions,
  eventActionToneClass,
} from "../actionRegistry";
import { PlusIcon } from "../components/Icons";
import type { EventActionStep } from "../types";

type EventHandlerActionAddMenuProps = {
  addBlockRef: Ref<HTMLDivElement>;
  activeMenuId: string;
  menuId: string;
  onAddAction: (actionType: EventActionStep["actionType"]) => void;
  setActiveMenuId: Dispatch<SetStateAction<string>>;
};

export function EventHandlerActionAddMenu({
  activeMenuId,
  addBlockRef,
  menuId,
  onAddAction,
  setActiveMenuId,
}: EventHandlerActionAddMenuProps) {
  const isOpen = activeMenuId === menuId;

  return (
    <div
      className="event-add-block chat-tool-action-add"
      ref={isOpen ? addBlockRef : null}
    >
      <button
        aria-expanded={isOpen}
        className="event-add-button compact"
        onClick={() =>
          setActiveMenuId((current) => (current === menuId ? "" : menuId))
        }
        type="button"
      >
        <PlusIcon />
        Action
      </button>
      {isOpen ? (
        <div className="event-add-menu chat-tool-add-menu">
          {eventActionOptions.map((option) => (
            <button
              className={`event-add-option tone-${eventActionToneClass(
                option.id,
              )}`}
              key={option.id}
              onClick={() => onAddAction(option.id)}
              type="button"
            >
              <span>{option.label}</span>
              <small>{eventActionDescription(option.id)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
