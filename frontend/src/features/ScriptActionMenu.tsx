import type { RefObject } from "react";

import {
  scriptMarkerGroups,
  scriptMarkerIcon,
  scriptMarkerOptions,
} from "../scriptMarkers";
import { scriptMarkerTypeForOption } from "./scriptActionEditorUtils";

export type ScriptActionMenuState = {
  insertionIndex: number;
  x: number;
  y: number;
};

type ScriptActionMenuProps = {
  inputRef: RefObject<HTMLInputElement>;
  menu: ScriptActionMenuState;
  menuRef: RefObject<HTMLDivElement>;
  onChooseOption: (option: (typeof scriptMarkerOptions)[number]) => void;
  onSubmitText: () => void;
  onTextChange: (value: string) => void;
  scriptLength: number;
  text: string;
};

export function ScriptActionMenu({
  inputRef,
  menu,
  menuRef,
  onChooseOption,
  onSubmitText,
  onTextChange,
  scriptLength,
  text,
}: ScriptActionMenuProps) {
  return (
    <div
      aria-label="Insert script content"
      className="script-action-menu"
      onClick={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="script-action-menu-title">
        <strong>Add here</strong>
        <span>{menu.insertionIndex === scriptLength ? "End of script" : "Cursor"}</span>
      </div>
      <form
        className="script-action-menu-text"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitText();
        }}
      >
        <input
          aria-label="Text to insert"
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Type text to insert"
          ref={inputRef}
          type="text"
          value={text}
        />
        <button disabled={!text.trim()} type="submit">
          Text
        </button>
      </form>
      <div className="script-action-menu-groups">
        {scriptMarkerGroups.map((group) => (
          <section className="script-action-menu-group" key={group.label}>
            <div className="script-action-menu-group-head">
              <h4>{group.label}</h4>
              <small>{group.description}</small>
            </div>
            <div className="script-action-menu-options">
              {group.options.map((option) => (
                <button
                  className="script-action-menu-option"
                  key={option.marker}
                  onClick={() => onChooseOption(option)}
                  role="menuitem"
                  title={option.title}
                  type="button"
                >
                  <span className="script-marker-chip-icon">
                    {scriptMarkerIcon(scriptMarkerTypeForOption(option))}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.title}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
