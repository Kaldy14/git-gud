import { createContext, useContext } from 'react';

// Workspace controls that live in the pull request header (shared by the loaded and loading views):
// the rail toggle before the back arrow and "Keyboard shortcuts" in the more menu.
export type PullRequestWorkspaceChrome = {
  railOpen: boolean;
  railId: string;
  toggleRail: () => void;
  openShortcuts: () => void;
};

export const PullRequestWorkspaceChromeContext = createContext<PullRequestWorkspaceChrome | null>(null);

/** Undefined outside the workspace, so the header renders without workspace controls there. */
export function usePullRequestWorkspaceChrome(): PullRequestWorkspaceChrome | null {
  return useContext(PullRequestWorkspaceChromeContext);
}
