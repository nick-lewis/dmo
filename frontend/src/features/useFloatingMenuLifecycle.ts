import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
} from "react";

import {
  clampFloatingMenuPosition,
  type FloatingMenuPosition,
} from "./floatingMenuPosition";

type FloatingMenuWithPosition = FloatingMenuPosition & Record<string, unknown>;

export function useFloatingMenuLifecycle<MenuState extends FloatingMenuWithPosition>({
  closeOnResize = true,
  isOpen,
  menuRef,
  onClose,
  position,
  setPosition,
  updateDependencies = [],
}: {
  closeOnResize?: boolean;
  isOpen: boolean;
  menuRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  position: MenuState | null;
  setPosition: Dispatch<SetStateAction<MenuState | null>>;
  updateDependencies?: readonly unknown[];
}) {
  useLayoutEffect(() => {
    if (!position) return;

    const menuElement = menuRef.current;
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      position.x,
      position.y,
      rect.width,
      rect.height,
    );
    if (nextPosition.x === position.x && nextPosition.y === position.y) return;

    setPosition((current) =>
      current
        ? {
            ...current,
            ...nextPosition,
          }
        : current,
    );
  }, [menuRef, position, setPosition, ...updateDependencies]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onClose();
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    if (closeOnResize) window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      if (closeOnResize) window.removeEventListener("resize", onClose);
    };
  }, [closeOnResize, isOpen, menuRef, onClose]);
}
