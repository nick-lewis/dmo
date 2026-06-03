import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

function useDismissibleMenu(
  isOpen: boolean,
  blockRef: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;

    function closeOnPointerDown(event: globalThis.MouseEvent) {
      const target = event.target;
      if (target instanceof Node && blockRef.current?.contains(target)) {
        return;
      }

      close();
    }

    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);

    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [blockRef, close, isOpen]);
}

export function useEditorMenus() {
  const [isEventAddMenuOpen, setIsEventAddMenuOpen] = useState(false);
  const [isConversationAddMenuOpen, setIsConversationAddMenuOpen] =
    useState(false);
  const [conversationAddMenuToolId, setConversationAddMenuToolId] = useState("");
  const [conversationAddMenuCheckId, setConversationAddMenuCheckId] =
    useState("");
  const eventAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationItemAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationCheckAddBlockRef = useRef<HTMLDivElement | null>(null);
  const closeEventAddMenu = useCallback(() => setIsEventAddMenuOpen(false), []);
  const closeConversationItemAddMenu = useCallback(
    () => setIsConversationAddMenuOpen(false),
    [],
  );
  const closeConversationToolAddMenu = useCallback(
    () => setConversationAddMenuToolId(""),
    [],
  );
  const closeConversationCheckAddMenu = useCallback(
    () => setConversationAddMenuCheckId(""),
    [],
  );

  useDismissibleMenu(isEventAddMenuOpen, eventAddBlockRef, closeEventAddMenu);
  useDismissibleMenu(
    isConversationAddMenuOpen,
    conversationItemAddBlockRef,
    closeConversationItemAddMenu,
  );
  useDismissibleMenu(
    Boolean(conversationAddMenuToolId),
    conversationAddBlockRef,
    closeConversationToolAddMenu,
  );
  useDismissibleMenu(
    Boolean(conversationAddMenuCheckId),
    conversationCheckAddBlockRef,
    closeConversationCheckAddMenu,
  );

  return {
    conversationAddBlockRef,
    conversationAddMenuCheckId,
    conversationAddMenuToolId,
    conversationCheckAddBlockRef,
    conversationItemAddBlockRef,
    eventAddBlockRef,
    isConversationAddMenuOpen,
    isEventAddMenuOpen,
    setConversationAddMenuCheckId,
    setConversationAddMenuToolId,
    setIsConversationAddMenuOpen,
    setIsEventAddMenuOpen,
  };
}
