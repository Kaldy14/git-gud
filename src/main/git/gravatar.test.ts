import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { gravatarUrlForEmail } from './gravatar';

describe('gravatarUrlForEmail', () => {
  it('keeps normalized emails and sizes deterministic across cache hits', () => {
    const email = 'author@example.test';
    const hash = createHash('sha256').update(email).digest('hex');
    const expected = `https://www.gravatar.com/avatar/${hash}?s=96&d=retro&r=g`;

    expect(gravatarUrlForEmail(`  ${email.toUpperCase()}  `, 96)).toBe(expected);
    expect(gravatarUrlForEmail(email, 96)).toBe(expected);
    expect(gravatarUrlForEmail(email, 64)).not.toBe(expected);
  });

  it('does not create URLs for missing addresses', () => {
    expect(gravatarUrlForEmail(undefined)).toBeUndefined();
    expect(gravatarUrlForEmail('   ')).toBeUndefined();
  });
});
