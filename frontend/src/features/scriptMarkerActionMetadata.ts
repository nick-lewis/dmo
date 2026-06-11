import type { ScriptMarkerInstance } from "../scriptMarkers";
import { clamp, isSlideMarker } from "./scriptActionEditorUtils";

export const defaultScriptSideImagePath = "test-images/dLU-right.png";
export const scriptSideImageScaleMin = 0.2;
export const scriptSideImageScaleMax = 3;

const scriptSideImageSideAliases = [
  "agent",
  "avatar",
  "left",
  "main",
  "right",
  "side",
  "tutor",
];
const scriptSideImageHideModes = ["hide", "hidden", "off", "false", "0"];
const scriptSideImageShowModes = ["show", "on", "visible", "true", "1"];

export type ScriptSideImageState = {
  imagePath: string;
  scale: number;
  scaleText: string;
  side: "left" | "right";
  visible: boolean;
};

export function normalizeScriptSideImageScale(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return clamp(numeric, scriptSideImageScaleMin, scriptSideImageScaleMax);
}

export function scriptSideImageStateFromArgs(
  args: string[],
  defaultImagePath = "",
): ScriptSideImageState {
  const firstArg = args[0]?.trim().toLowerCase() || "";
  const hasSideArg = scriptSideImageSideAliases.includes(firstArg);
  const side = ["right", "side"].includes(firstArg) ? "right" : "left";
  const remainingArgs = hasSideArg ? args.slice(1) : args;
  const rawMode = remainingArgs[0]?.trim() || "show";
  const mode = rawMode.toLowerCase();
  const usesExplicitMode =
    scriptSideImageShowModes.includes(mode) ||
    scriptSideImageHideModes.includes(mode);
  const imageArgIndex = usesExplicitMode ? 1 : 0;
  const imagePath =
    remainingArgs.length > imageArgIndex
      ? remainingArgs[imageArgIndex]
      : usesExplicitMode
        ? defaultImagePath
        : remainingArgs[0] || defaultImagePath;
  const scaleText = remainingArgs[imageArgIndex + 1]?.trim() || "1";
  const scale = normalizeScriptSideImageScale(scaleText);

  return {
    imagePath,
    scale,
    scaleText,
    side,
    visible: !scriptSideImageHideModes.includes(mode),
  };
}

export function scriptSideImageStateFromMarker(
  marker: ScriptMarkerInstance,
): ScriptSideImageState {
  if (marker.type === "show_image" || marker.type === "agent_image_on") {
    return {
      imagePath: marker.argList[0] || defaultScriptSideImagePath,
      scale: 1,
      scaleText: "1",
      side: "left",
      visible: true,
    };
  }

  if (marker.type === "agent_image_off") {
    return {
      imagePath: marker.argList[0] || "",
      scale: 1,
      scaleText: "1",
      side: "left",
      visible: false,
    };
  }

  return scriptSideImageStateFromArgs(marker.argList);
}

export function scriptSideImageArgsFromState(state: ScriptSideImageState) {
  const imagePath = state.imagePath.trim();
  const rawScaleText = state.scaleText.trim();
  const scale = normalizeScriptSideImageScale(rawScaleText || state.scale);
  const scaleArg =
    imagePath &&
    rawScaleText &&
    (Math.abs(scale - 1) > 0.001 || rawScaleText.endsWith("."))
      ? rawScaleText
      : "";
  const args = imagePath
    ? [state.side, state.visible ? "show" : "hide", imagePath]
    : [state.side, state.visible ? "show" : "hide"];
  if (scaleArg) args.push(scaleArg);
  return args;
}

export function fineTuningMarkerLabel(marker: ScriptMarkerInstance) {
  if (isSlideMarker(marker)) {
    return `Slide ${marker.argList[0]?.trim() || "1"}`;
  }
  if (marker.type === "show_image" || marker.type === "agent_image_on") {
    return "left show";
  }
  if (marker.type === "agent_image_off") {
    return "left hide";
  }
  if (marker.type === "side_image") {
    const state = scriptSideImageStateFromMarker(marker);
    return `${state.side} ${state.visible ? "show" : "hide"}`;
  }
  return marker.detail || marker.label;
}

export function fineTuningMarkerHasIcon(marker: ScriptMarkerInstance) {
  return !isSlideMarker(marker) && marker.type !== "side_image";
}

export function markerSupportsFineTuningSettings(marker: ScriptMarkerInstance) {
  return (
    isSlideMarker(marker) ||
    marker.type === "play_sound" ||
    marker.type === "side_image" ||
    marker.type === "show_image" ||
    marker.type === "agent_image_on" ||
    marker.type === "agent_image_off" ||
    marker.type === "highlight" ||
    marker.type === "highlight_on" ||
    marker.type === "highlight_off" ||
    marker.type === "panel_on" ||
    marker.type === "panel_off"
  );
}

export function markerContextMenuEstimatedHeight(marker: ScriptMarkerInstance) {
  if (!markerSupportsFineTuningSettings(marker)) return 150;
  if (
    marker.type === "side_image" ||
    marker.type === "show_image" ||
    marker.type === "agent_image_on" ||
    marker.type === "agent_image_off"
  ) {
    return 420;
  }
  if (marker.type === "play_sound") return 300;
  if (
    marker.type === "highlight" ||
    marker.type === "highlight_on" ||
    marker.type === "panel_on"
  ) {
    return 260;
  }
  if (marker.type === "highlight_off" || marker.type === "panel_off") {
    return 210;
  }
  return 224;
}

export function estimateFineTuningMarkerWidthPx(marker: ScriptMarkerInstance) {
  const labelLength = fineTuningMarkerLabel(marker).length;
  const iconWidth = fineTuningMarkerHasIcon(marker) ? 20 : 0;
  return Math.min(178, Math.max(74, 48 + iconWidth + labelLength * 6.2));
}
