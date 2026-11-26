import { useEffect, useRef } from 'react';

import { isModB, isWithinPullRequestWorkspace, pullRequestShortcutKey, singleKeyShortcutsEnabled } from '../shortcuts/pullRequestShortcuts';

// The workspace's own keys: J/K switch pull requests, H/L switch tabs, `/` searches the list,
// Mod+B shows or hides the list, `?` lists every shortcut. ReviewView and the Tour own their keys
// and mark what they handle with preventDefault, so this listener (window, bubble phase) runs last.

export type WorkspaceCommand = 'next' | 'previous' | 'next-tab' | 'previous-tab' | 'search' | 'toggle-rail' | 'help';

const SINGLE_KEY_COMMANDS: Record<string, WorkspaceCommand> = {
  j: 'next',
  k: 'previous',
  l: 'next-tab',
  h: 'previous-tab',
  '/': 'search',
  '?': 'help'
};

// A modal dialog, an open menu, the review/merge side panel or the bug scan (which covers the tabs) owns
// the keyboard while it is open.
const OVERLAY_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"], .pr-review-workspace[data-panel-open="true"], .bug-finder-view';

export function hasOpenOverlay(root: Pick<Document, 'querySelector'> | undefined = globalThis.document): boolean {
  return Boolean(root?.querySelector(OVERLAY_SELECTOR));
}

type CommandEvent = Parameters<typeof pullRequestShortcutKey>[0];

export function workspaceCommand(
  event: CommandEvent,
  { singleKeyEnabled, overlayOpen, mac }: { singleKeyEnabled: boolean; overlayOpen: boolean; mac?: boolean }
): WorkspaceCommand | undefined {
  if (event.defaultPrevented || overlayOpen || !isWithinPullRequestWorkspace(event.target)) return undefined;
  // Mod+B has a modifier, so it also works from a text field and with single-key shortcuts off.
  if (isModB(event, mac)) return 'toggle-rail';
  if (!singleKeyEnabled) return undefined;
  const key = pullRequestShortcutKey(event);
  return key === undefined ? undefined : SINGLE_KEY_COMMANDS[key];
}

export function useWorkspaceCommands(onCommand: (command: WorkspaceCommand) => void): void {
  const handler = useRef(onCommand);
  useEffect(() => { handler.current = onCommand; });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = workspaceCommand(event, { singleKeyEnabled: singleKeyShortcutsEnabled(), overlayOpen: hasOpenOverlay() });
      if (!command) return;
      event.preventDefault();
      handler.current(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
