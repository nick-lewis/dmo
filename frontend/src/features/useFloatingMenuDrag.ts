import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";

import { clampFloatingMenuPosition } from "./floatingMenuPosition";

type FloatingMenuPosition = {
  x: number;
  y: number;
};

type FloatingMenuDragState = {
  menuX: number;
  menuY: number;
  pointerId: number;
  startX: number;
  startY: number;
};

type UseFloatingMenuDragOptions<T extends FloatingMenuPosition> = {
  fallbackHeight: number;
  fallbackWidth: number;
  menuRef: RefObject<HTMLDivElement | null>;
  position: T | null;
  setPosition: Dispatch<SetStateAction<T | null>>;
};

export function useFloatingMenuDrag<T extends FloatingMenuPosition>({
  fallbackHeight,
  fallbackWidth,
  menuRef,
  position,
  setPosition,
}: UseFloatingMenuDragOptions<T>) {
  const dragRef = useRef<FloatingMenuDragState | null>(null);

  function moveToPointer(clientX: number, clientY: number) {
    const dragState = dragRef.current;
    if (!dragState) return;

    const rect = menuRef.current?.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      dragState.menuX + clientX - dragState.startX,
      dragState.menuY + clientY - dragState.startY,
      rect?.width ?? fallbackWidth,
      rect?.height ?? fallbackHeight,
    );
    setPosition((current) =>
      current
        ? {
            ...current,
            ...nextPosition,
          }
        : current,
    );
  }

  useEffect(() => {
    if (!position) return;

    function moveWhileDragging(event: PointerEvent) {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      moveToPointer(event.clientX, event.clientY);
    }

    function stopDragging(event: PointerEvent) {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      dragRef.current = null;
    }

    window.addEventListener("pointermove", moveWhileDragging);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", moveWhileDragging);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
    // moveToPointer is re-created each render; the effect already
    // re-subscribes whenever the menu position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!position || event.button > 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      menuX: position.x,
      menuY: position.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    moveToPointer(event.clientX, event.clientY);
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return { beginDrag, endDrag, moveDrag };
}
