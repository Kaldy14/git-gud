import type { ReactElement } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';

import { openContextMenuFromKeyboard } from '@renderer/components/accessibility/menuKeyboard';

import { copyPullRequestLink } from './pullRequestLinkClipboard';

type PullRequestGitHubLinkProps = {
  url: string;
  onNotice?: (notice: { tone: 'success' | 'danger'; message: string }) => void;
};

export function PullRequestGitHubLink({
  url,
  onNotice
}: PullRequestGitHubLinkProps): ReactElement {
  function copyLink(): void {
    void copyPullRequestLink(url, navigator.clipboard)
      .then(() => {
        onNotice?.({
          tone: 'success',
          message: 'GitHub link copied.'
        });
      })
      .catch(() => {
        onNotice?.({
          tone: 'danger',
          message: 'The pull request link could not be copied.'
        });
      });
  }

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
            onSelect={copyLink}
          >
            <Copy size={14} />
            <span>Copy GitHub link</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
