import { createHash } from 'node:crypto';

const MAX_GRAVATAR_URL_CACHE_ENTRIES = 4_096;
const gravatarUrlCache = new Map<string, string>();

export function gravatarUrlForEmail(email: string | undefined, size = 64): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return undefined;
  }

  const cacheKey = `${normalizedEmail}:${size}`;
  const cachedUrl = gravatarUrlCache.get(cacheKey);

  if (cachedUrl !== undefined) {
    gravatarUrlCache.delete(cacheKey);
    gravatarUrlCache.set(cacheKey, cachedUrl);
    return cachedUrl;
  }

  const hash = createHash('sha256').update(normalizedEmail).digest('hex');
  const params = new URLSearchParams({
    s: String(size),
    d: 'retro',
    r: 'g'
  });

  const url = `https://www.gravatar.com/avatar/${hash}?${params.toString()}`;
  gravatarUrlCache.set(cacheKey, url);

  if (gravatarUrlCache.size > MAX_GRAVATAR_URL_CACHE_ENTRIES) {
    const oldestCacheKey = gravatarUrlCache.keys().next().value;

    if (oldestCacheKey !== undefined) {
      gravatarUrlCache.delete(oldestCacheKey);
    }
  }

  return url;
}
