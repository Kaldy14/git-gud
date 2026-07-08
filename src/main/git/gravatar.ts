import { createHash } from 'node:crypto';

export function gravatarUrlForEmail(email: string | undefined, size = 64): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return undefined;
  }

  const hash = createHash('sha256').update(normalizedEmail).digest('hex');
  const params = new URLSearchParams({
    s: String(size),
    d: 'retro',
    r: 'g'
  });

  return `https://www.gravatar.com/avatar/${hash}?${params.toString()}`;
}
