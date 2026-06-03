import type { CheckpointRecordingMode } from "./types";

export type StoredPanelLayout = {
  leftWidth?: number;
  lowerHeight?: number;
  workspaceWidth?: number;
};

export type SlideSettings = {
  deckUrl: string;
  slideRef: string;
};

const panelLayoutStorageKey = "dlu.panel-layout.v1";
const slideSettingsStorageKey = "dlu.slide-settings.v1";
const experienceSelectionStorageKey = "dlu.selected-experience.v1";
const checkpointRecordingModeStorageKey = "dlu.checkpoint-recording-mode.v1";

function storedNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(value, min), max);
}

export function readPanelLayout() {
  if (typeof window === "undefined") return {};

  try {
    const rawValue = window.localStorage.getItem(panelLayoutStorageKey);
    if (!rawValue) return {};

    const value = JSON.parse(rawValue) as StoredPanelLayout;
    return {
      leftWidth: storedNumber(value.leftWidth, 260, 1180),
      lowerHeight: storedNumber(value.lowerHeight, 170, 900),
      workspaceWidth: storedNumber(value.workspaceWidth, 320, 1800),
    };
  } catch {
    return {};
  }
}

export function writePanelLayout(layout: StoredPanelLayout) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(panelLayoutStorageKey, JSON.stringify(layout));
  } catch {
    // Ignore storage failures; panel sizing should still work for this view.
  }
}

export function readSlideSettings(): SlideSettings {
  if (typeof window === "undefined") return { deckUrl: "", slideRef: "1" };

  try {
    const rawValue = window.localStorage.getItem(slideSettingsStorageKey);
    if (!rawValue) return { deckUrl: "", slideRef: "1" };

    const value = JSON.parse(rawValue) as Partial<SlideSettings>;
    return {
      deckUrl: typeof value.deckUrl === "string" ? value.deckUrl : "",
      slideRef:
        typeof value.slideRef === "string" && value.slideRef.trim()
          ? value.slideRef
          : "1",
    };
  } catch {
    return { deckUrl: "", slideRef: "1" };
  }
}

export function writeSlideSettings(settings: SlideSettings) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(slideSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; slide display can still run from local state.
  }
}

export function readSelectedExperienceId() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(experienceSelectionStorageKey) ?? "";
  } catch {
    return "";
  }
}

export function writeSelectedExperienceId(experienceId: string) {
  if (typeof window === "undefined") return;

  try {
    if (experienceId) {
      window.localStorage.setItem(experienceSelectionStorageKey, experienceId);
    } else {
      window.localStorage.removeItem(experienceSelectionStorageKey);
    }
  } catch {
    // Ignore storage failures; the backend still chooses a current experience.
  }
}

export function normalizeCheckpointRecordingMode(
  value: unknown,
  fallback: CheckpointRecordingMode = "structural",
): CheckpointRecordingMode {
  return value === "off" || value === "structural" || value === "full"
    ? value
    : fallback;
}

export function readCheckpointRecordingMode(): CheckpointRecordingMode {
  if (typeof window === "undefined") return "structural";

  try {
    return normalizeCheckpointRecordingMode(
      window.localStorage.getItem(checkpointRecordingModeStorageKey),
    );
  } catch {
    return "structural";
  }
}

export function writeCheckpointRecordingMode(mode: CheckpointRecordingMode) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(checkpointRecordingModeStorageKey, mode);
  } catch {
    // Ignore storage failures; the run request still carries the current choice.
  }
}
