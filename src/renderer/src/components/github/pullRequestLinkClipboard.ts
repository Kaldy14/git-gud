import { createPullRequestDeepLinkFromGitHubUrl } from '@shared/pullRequestDeepLink';

type ClipboardWriter = Pick<Clipboard, 'writeText'>;

export async function copyPullRequestLink(
  url: string,
  clipboard: ClipboardWriter
): Promise<void> {
  await clipboard.writeText(url);
}

export async function copyGitGudPullRequestLink(
  githubUrl: string,
  clipboard: ClipboardWriter
): Promise<void> {
  await copyPullRequestLink(
    createPullRequestDeepLinkFromGitHubUrl(githubUrl),
    clipboard
  );
}
