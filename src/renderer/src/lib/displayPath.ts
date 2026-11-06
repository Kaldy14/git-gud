/** Shows the user's home folder as ~ (macOS /Users/name, Linux /home/name); the full path stays in the tooltip. */
export function abbreviateHomePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, '~');
}
