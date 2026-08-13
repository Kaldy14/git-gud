type ClipboardWriter = Pick<Clipboard, 'writeText'>;

export function copyReviewFilePath(
  path: string,
  clipboard: ClipboardWriter = navigator.clipboard
): Promise<void> {
  return clipboard.writeText(path);
}
