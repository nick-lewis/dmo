import { useState } from "react";

export function useEditorExpansion() {
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);

  function isExpandedItem(id: string) {
    return expandedItemIds.includes(id);
  }

  function openExpandedItem(id: string) {
    setExpandedItemIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }

  function closeExpandedItems(ids: string[]) {
    setExpandedItemIds((current) =>
      current.filter((expandedId) => !ids.includes(expandedId)),
    );
  }

  function closeExpandedItem(id: string) {
    closeExpandedItems([id]);
  }

  function resetExpandedItems() {
    setExpandedItemIds([]);
  }

  function toggleExpandedItem(id: string) {
    setExpandedItemIds((current) =>
      current.includes(id)
        ? current.filter((expandedId) => expandedId !== id)
        : [...current, id],
    );
  }

  function toggleExpandedParent(parentId: string, childIds: string[] = []) {
    const expandedIds = [parentId, ...childIds];
    const isOpen = expandedIds.some((id) => isExpandedItem(id));
    if (isOpen) {
      closeExpandedItems(expandedIds);
      return;
    }
    openExpandedItem(parentId);
  }

  return {
    closeExpandedItem,
    closeExpandedItems,
    isExpandedItem,
    openExpandedItem,
    resetExpandedItems,
    toggleExpandedItem,
    toggleExpandedParent,
  };
}
