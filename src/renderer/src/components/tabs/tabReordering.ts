export type TabDropPosition = 'before' | 'after';

export function resolveTabDropIndex(
  tabIds: string[],
  sourceTabId: string,
  targetTabId: string,
  position: TabDropPosition
): number | undefined {
  const sourceIndex = tabIds.indexOf(sourceTabId);
  const targetIndex = tabIds.indexOf(targetTabId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return undefined;
  }

  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  const reorderedIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;
  return Math.max(0, Math.min(tabIds.length - 1, reorderedIndex));
}
