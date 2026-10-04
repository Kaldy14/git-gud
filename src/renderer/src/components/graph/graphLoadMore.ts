/** True when the list is within a viewport (or 20 rows) of its loaded end. */
export function isNearGraphBottom(
  element: { scrollTop: number; clientHeight: number; scrollHeight: number },
  rowHeight: number
): boolean {
  const threshold = Math.max(element.clientHeight, rowHeight * 20);

  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}
