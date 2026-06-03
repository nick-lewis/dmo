import type { CSSProperties } from "react";


export const defaultChoiceIconBackground = "#f8ded8";


export function choiceIconBackgroundValue(value?: string) {
  return value?.trim() || defaultChoiceIconBackground;
}


export function choiceIconBackgroundInputValue(value?: string) {
  const color = choiceIconBackgroundValue(value);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : defaultChoiceIconBackground;
}


export function choiceIconBackgroundStyle(value?: string): CSSProperties {
  return {
    "--choice-icon-bg": choiceIconBackgroundValue(value),
  } as CSSProperties;
}


function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}


export function resizeTextareaToContent(
  textarea: HTMLTextAreaElement | null,
  options: { maxHeight?: number; minHeight?: number } = {},
) {
  if (!textarea) return;
  const computedStyle = window.getComputedStyle(textarea);
  const cssMinHeight = Number.parseFloat(computedStyle.minHeight) || 0;
  const minHeight = options.minHeight ?? cssMinHeight;
  const maxHeight = options.maxHeight ?? Number.POSITIVE_INFINITY;

  textarea.style.height = "auto";
  const nextHeight = Math.ceil(clamp(textarea.scrollHeight, minHeight, maxHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY =
    Number.isFinite(maxHeight) && textarea.scrollHeight > maxHeight
      ? "auto"
      : "hidden";
}
