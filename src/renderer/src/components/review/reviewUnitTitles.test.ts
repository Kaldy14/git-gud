import { describe, expect, it } from 'vitest';
import type { GitReviewUnit } from '@shared/types';
import { guideUnitTitles } from './reviewUnitTitles';

const unit = (id: string, paths: string[]) => ({ id, title: `Generated ${id}`, chunks: paths.map((path) => ({ path })) }) as unknown as GitReviewUnit;

describe('guide unit titles', () => {
  const stops = [
    { title: 'One HTTP client every app configures', paths: ['packages/client.ts', 'apps/admin/client.ts'] },
    { title: 'Package wiring', paths: ['package.json', 'pnpm-lock.yaml'] }
  ];

  it('uses the stop covering at least half of a block', () => {
    const titles = guideUnitTitles([unit('a', ['packages/client.ts', 'apps/admin/client.ts', 'README.md'])], stops);
    expect(titles.get('a')).toBe('One HTTP client every app configures');
  });

  it('keeps the generated title when no stop covers half the files', () => {
    const titles = guideUnitTitles([unit('b', ['package.json', 'a.ts', 'b.ts'])], stops);
    expect(titles.has('b')).toBe(false);
  });

  it('returns nothing without a guide', () => {
    expect(guideUnitTitles([unit('a', ['package.json'])], undefined).size).toBe(0);
  });

  it('gives a stop title to only the block it covers most', () => {
    const titles = guideUnitTitles([unit('c', ['package.json']), unit('d', ['package.json', 'pnpm-lock.yaml'])], stops);
    expect(titles.get('d')).toBe('Package wiring');
    expect(titles.has('c')).toBe(false);
  });
});
