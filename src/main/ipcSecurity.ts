import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isTrustedRendererUrl(
  senderUrl: string,
  devRendererUrl = process.env.ELECTRON_RENDERER_URL,
  packagedRendererPath = join(__dirname, '../renderer/index.html')
): boolean {
  try {
    const sender = new URL(senderUrl);

    if (sender.protocol === 'file:') {
      return sender.href === pathToFileURL(packagedRendererPath).href;
    }

    if (!devRendererUrl) {
      return false;
    }

    const trustedDevUrl = new URL(devRendererUrl);
    return sender.href === trustedDevUrl.href;
  } catch {
    return false;
  }
}
