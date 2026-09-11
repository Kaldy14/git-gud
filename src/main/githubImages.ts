import type { GitHubPullRequestLocator } from '../shared/types';

const imageTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif'
};

// Only authenticate image reads from the PR's repository on the selected host.
export function repositoryImageRequest(source: string, host: string, locator: GitHubPullRequestLocator) {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
    if (url.hostname === host && (parts[2] === 'blob' || parts[2] === 'raw')) parts.splice(2, 1);
    else if (host !== 'github.com' || url.hostname !== 'raw.githubusercontent.com') return undefined;
    const [owner, repository, ref, ...path] = parts;
    if (owner?.toLowerCase() !== locator.owner.toLowerCase() || repository?.toLowerCase() !== locator.repository.toLowerCase() || !ref || !path.length) return undefined;
    if (path.some(segment => !segment || segment === '..' || segment.includes('/'))) return undefined;
    const mime = imageTypes[path.at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''];
    if (!mime) return undefined;
    return {
      endpoint: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${path.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
      mime
    };
  } catch {
    return undefined;
  }
}
