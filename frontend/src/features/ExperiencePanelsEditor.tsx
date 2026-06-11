import { useEffect, useRef, useState } from "react";

import { publicAsset } from "../assets";
import {
  sidePanelMetadataDefinitions,
  type SidePanelOverride,
} from "../sidePanelMetadata";
import { ImageLibraryPicker, type ImageLibraryOption } from "./ImageLibraryPicker";

// Per-experience side panel settings: panels are registered globally in code,
// but each experience can override a panel's title and icon. Turning panels
// on/off happens through actions (panel() in the DSL, [panel_on] in scripts).

type ExperiencePanelsEditorProps = {
  deletingScriptImagePath: string;
  isLoadingScriptImages: boolean;
  onDeleteImage: (path: string, label: string) => void;
  onLoadImages: () => void;
  onSave: (next: SidePanelOverride[]) => void;
  scriptImageOptions: ImageLibraryOption[];
  sidePanels: SidePanelOverride[];
};

function upsertOverride(
  overrides: SidePanelOverride[],
  panelId: string,
  patch: Partial<SidePanelOverride>,
) {
  const existing = overrides.find((override) => override.panelId === panelId);
  const next: SidePanelOverride = {
    iconPath: existing?.iconPath ?? "",
    panelId,
    title: existing?.title ?? "",
    ...patch,
  };
  const others = overrides.filter((override) => override.panelId !== panelId);
  if (!next.iconPath.trim() && !next.title.trim()) return others;
  return [...others, next];
}

export function ExperiencePanelsEditor({
  deletingScriptImagePath,
  isLoadingScriptImages,
  onDeleteImage,
  onLoadImages,
  onSave,
  scriptImageOptions,
  sidePanels,
}: ExperiencePanelsEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [iconPickerPanelId, setIconPickerPanelId] = useState("");
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setIsOpen(false);
      setIconPickerPanelId("");
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeIfOutside, true);
  }, [isOpen]);

  function overrideFor(panelId: string) {
    return sidePanels.find((override) => override.panelId === panelId);
  }

  function saveTitle(panelId: string) {
    const draft = titleDrafts[panelId];
    if (draft === undefined) return;
    onSave(upsertOverride(sidePanels, panelId, { title: draft.trim() }));
    setTitleDrafts((current) => {
      const next = { ...current };
      delete next[panelId];
      return next;
    });
  }

  function selectIcon(panelId: string, iconPath: string) {
    onSave(upsertOverride(sidePanels, panelId, { iconPath }));
    setIconPickerPanelId("");
  }

  return (
    <div className="experience-panels" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className="experience-panels-trigger"
        onClick={() => {
          setIsOpen((current) => !current);
          setIconPickerPanelId("");
        }}
        title="Side panels available to this experience"
        type="button"
      >
        Panels
      </button>
      {isOpen ? (
        <div className="experience-panels-popover" role="dialog">
          <p className="experience-panels-hint">
            Panels turn on through actions: <code>panel("roadmap")</code> on
            entry or in conversation, <code>[panel_on: roadmap]</code> inside a
            script. Customize how each one appears in this experience.
          </p>
          {sidePanelMetadataDefinitions.map((panel) => {
            const override = overrideFor(panel.id);
            const titleValue =
              titleDrafts[panel.id] ?? override?.title ?? "";
            const iconPath = override?.iconPath ?? "";
            return (
              <div className="experience-panels-row" key={panel.id}>
                <button
                  aria-label={`Choose icon for ${panel.label}`}
                  className="experience-panels-icon"
                  onClick={() => {
                    const nextId =
                      iconPickerPanelId === panel.id ? "" : panel.id;
                    setIconPickerPanelId(nextId);
                    if (nextId) onLoadImages();
                  }}
                  title="Choose a custom icon"
                  type="button"
                >
                  {iconPath ? (
                    <img alt="" src={publicAsset(iconPath)} />
                  ) : (
                    <span aria-hidden="true">{panel.glyph}</span>
                  )}
                </button>
                <div className="experience-panels-fields">
                  <span className="experience-panels-id">{panel.id}</span>
                  <input
                    aria-label={`Title for ${panel.label}`}
                    onBlur={() => saveTitle(panel.id)}
                    onChange={(event) =>
                      setTitleDrafts((current) => ({
                        ...current,
                        [panel.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder={panel.label}
                    type="text"
                    value={titleValue}
                  />
                </div>
                {iconPath ? (
                  <button
                    aria-label={`Reset icon for ${panel.label}`}
                    className="experience-panels-reset"
                    onClick={() => selectIcon(panel.id, "")}
                    title="Reset to default glyph"
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
                {iconPickerPanelId === panel.id ? (
                  <div className="experience-panels-picker">
                    <ImageLibraryPicker
                      ariaLabel={`Icon options for ${panel.label}`}
                      classNames={{
                        deleteButton: "next-script-image-delete-button",
                        empty: "next-script-image-picker-empty",
                        option: "next-script-image-option",
                        optionMain: "next-script-image-option-main",
                        picker: "next-script-image-picker",
                      }}
                      deletingPath={deletingScriptImagePath}
                      emptyLabel="No images yet"
                      isLoading={isLoadingScriptImages}
                      onDelete={onDeleteImage}
                      onSelect={(path) => selectIcon(panel.id, path)}
                      options={scriptImageOptions}
                      selectedPath={iconPath}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
