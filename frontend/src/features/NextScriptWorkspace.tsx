import type { MouseEvent, ReactNode } from "react";

import { MicIcon, StopIcon } from "../components/Icons";
import type { ScriptDetailTab } from "./nextEditorUiState";

type NextScriptWorkspaceProps = {
  activeTab: ScriptDetailTab;
  audioPanel: ReactNode;
  canUseGeneratedAudioTabs: boolean;
  children?: ReactNode;
  displayPanel: ReactNode;
  fineTuningPanel: ReactNode;
  isAudioPreviewDisabled: boolean;
  isAudioPreviewPlaying: boolean;
  onAudioPreview: () => void;
  onAudioPreviewMenu: (event: MouseEvent<HTMLElement>) => void;
  onTabChange: (tab: ScriptDetailTab) => void;
  previewButtonClassName: string;
  previewLabel: string;
  scriptAudioError: string;
  scriptPanel: ReactNode;
};

export function NextScriptWorkspace({
  activeTab,
  audioPanel,
  canUseGeneratedAudioTabs,
  children,
  displayPanel,
  fineTuningPanel,
  isAudioPreviewDisabled,
  isAudioPreviewPlaying,
  onAudioPreview,
  onAudioPreviewMenu,
  onTabChange,
  previewButtonClassName,
  previewLabel,
  scriptAudioError,
  scriptPanel,
}: NextScriptWorkspaceProps) {
  return (
    <div aria-label="Spoken voice script" className="next-event-action-detail">
      <div className="next-script-tabbar">
        <button
          aria-label={previewLabel}
          className={[
            "next-script-audio-preview-button",
            previewButtonClassName,
            isAudioPreviewPlaying ? "is-playing" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={isAudioPreviewDisabled}
          onClick={onAudioPreview}
          onContextMenu={onAudioPreviewMenu}
          title={`${previewLabel}. Right-click for audio options.`}
          type="button"
        >
          {isAudioPreviewPlaying ? <StopIcon /> : <MicIcon />}
        </button>
        <div
          aria-label="Script detail views"
          className="next-script-tabs"
          role="tablist"
        >
          <button
            aria-selected={activeTab === "audio" ? "true" : "false"}
            className={activeTab === "audio" ? "is-active" : ""}
            onClick={() => onTabChange("audio")}
            onContextMenu={onAudioPreviewMenu}
            role="tab"
            title="Right-click for audio options."
            type="button"
          >
            Audio
          </button>
          <button
            aria-disabled={canUseGeneratedAudioTabs ? "false" : "true"}
            aria-selected={activeTab === "display" ? "true" : "false"}
            className={activeTab === "display" ? "is-active" : ""}
            onClick={() => {
              if (!canUseGeneratedAudioTabs) return;
              onTabChange("display");
            }}
            role="tab"
            title={
              canUseGeneratedAudioTabs
                ? "Edit display text"
                : "Generate this audio before editing display text."
            }
            type="button"
          >
            Display Text
          </button>
          <button
            aria-selected={activeTab === "script" ? "true" : "false"}
            className={activeTab === "script" ? "is-active" : ""}
            onClick={() => onTabChange("script")}
            role="tab"
            title="Place slides and actions"
            type="button"
          >
            Slides &amp; Actions
          </button>
          <button
            aria-disabled={canUseGeneratedAudioTabs ? "false" : "true"}
            aria-selected={activeTab === "fine-tuning" ? "true" : "false"}
            className={activeTab === "fine-tuning" ? "is-active" : ""}
            onClick={() => {
              if (!canUseGeneratedAudioTabs) return;
              onTabChange("fine-tuning");
            }}
            role="tab"
            title={
              canUseGeneratedAudioTabs
                ? "Fine tune generated audio"
                : "Generate this audio before fine tuning."
            }
            type="button"
          >
            Fine Tuning
          </button>
        </div>
      </div>

      {activeTab === "audio" ? (
        audioPanel
      ) : activeTab === "script" ? (
        scriptPanel
      ) : activeTab === "fine-tuning" ? (
        fineTuningPanel
      ) : (
        <>
          {displayPanel}
          {scriptAudioError ? (
            <p className="control-error next-display-text-error">
              {scriptAudioError}
            </p>
          ) : null}
        </>
      )}
      {children}
    </div>
  );
}
