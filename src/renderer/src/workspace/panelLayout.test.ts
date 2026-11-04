import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DETAIL_PANEL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_DETAIL_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_DETAIL_PANEL_WIDTH,
  MIN_SIDEBAR_WIDTH
} from '@shared/workspace';

import { workspacePanelCaps } from './panelLayout';

describe('workspace panel caps', () => {
  it('keeps default panel widths at an ordinary desktop size', () => {
    const caps = workspacePanelCaps(1440, false);

    expect(caps.sidebar).toBeGreaterThanOrEqual(DEFAULT_SIDEBAR_WIDTH);
    expect(caps.detail).toBeGreaterThanOrEqual(DEFAULT_DETAIL_PANEL_WIDTH);
  });

  it('leaves more than half of a compact window for history', () => {
    const caps = workspacePanelCaps(1100, false);

    expect(1100 - caps.sidebar - caps.detail).toBeGreaterThan(550);
  });

  it('gives an open diff more room than history at the same window size', () => {
    const history = workspacePanelCaps(1440, false);
    const diff = workspacePanelCaps(1440, true);

    expect(diff.sidebar).toBeLessThan(history.sidebar);
    expect(diff.detail).toBeLessThan(history.detail);
  });

  it('never caps a panel outside its supported range', () => {
    expect(workspacePanelCaps(600, true)).toEqual({ sidebar: MIN_SIDEBAR_WIDTH, detail: MIN_DETAIL_PANEL_WIDTH });
    expect(workspacePanelCaps(4000, false)).toEqual({ sidebar: MAX_SIDEBAR_WIDTH, detail: MAX_DETAIL_PANEL_WIDTH });
  });
});
