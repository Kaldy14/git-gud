export function resolvePullRequestGroupExpansion(
  override: boolean | undefined,
  itemCount: number
): boolean {
  return override ?? itemCount > 0;
}
