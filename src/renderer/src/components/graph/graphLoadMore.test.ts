import { describe, expect, it } from 'vitest';

import { isNearGraphBottom } from './graphLoadMore';

describe('graph lazy loading', () => {
  it('loads older commits only once the loaded end is within reach', () => {
    expect(isNearGraphBottom({ scrollTop: 0, clientHeight: 800, scrollHeight: 1400 }, 28)).toBe(true);
    expect(isNearGraphBottom({ scrollTop: 0, clientHeight: 800, scrollHeight: 42_000 }, 28)).toBe(false);
    expect(isNearGraphBottom({ scrollTop: 40_500, clientHeight: 800, scrollHeight: 42_000 }, 28)).toBe(true);
  });
});
