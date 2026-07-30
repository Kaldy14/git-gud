import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { ExternalLink } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';

import { copyPullRequestLink } from './pullRequestLinkClipboard';

type PullRequestGitHubLinkProps = {
  url: string;
};

export function PullRequestGitHubLink({
  url
}: PullRequestGitHubLinkProps): ReactElement {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <a
          className="btn-subtle btn-regular"
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open on GitHub · right-click for link actions"
          aria-haspopup="menu"
          onKeyDown={openContextMenuFromKeyboard}
        >
          <ExternalLink size={12} />
          GitHub
        </a>
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="context-menu-surface pr-link-context-menu"
          collisionPadding={8}
          aria-label="GitHub link actions"
        >
          <ContextMenuPrimitive.Item
            className="menu-row"
            onSelect={() => void copyPullRequestLink(url, navigator.clipboard)}
          >
            <span>Copy link</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

function openContextMenuFromKeyboard(
  event: ReactKeyboardEvent<HTMLAnchorElement>
): void {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
    return;
  }

  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom
    })
  );
}
