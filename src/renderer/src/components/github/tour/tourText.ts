// Titles and tooltips are plain text: drop the backticks around inline `code`.
export function plainTourText(text: string): string {
  return text.replace(/`([^`]+)`/gu, '$1');
}

/** "Steps 2 and 4", "Step 3", "Steps 1, 2 and 5" (1-based) for the finish check. */
export function listTourSteps(steps: readonly number[]): string {
  const numbers = steps.map((step) => String(step + 1));
  if (numbers.length <= 1) return `Step ${numbers[0] ?? ''}`.trim();
  return `Steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
