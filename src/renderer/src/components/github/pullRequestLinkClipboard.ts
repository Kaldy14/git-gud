type ClipboardWriter = Pick<Clipboard, 'writeText'>;

export async function copyPullRequestLink(
  url: string,
  clipboard: ClipboardWriter
): Promise<void> {
  await clipboard.writeText(url);
}
