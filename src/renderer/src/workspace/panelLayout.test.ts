import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DETAIL_PANEL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_DETAIL_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_DETAIL_PANEL_WIDTH,
  MIN_SIDEBAR_WIDTH
} from '@shared/workspace';

import { resolveWorkspacePanels, workspacePanelCaps, type WorkspacePanelInput } from './panelLayout';

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

function panelsAt(viewportWidth: number, input: Partial<WorkspacePanelInput> = {}) {
  return resolveWorkspacePanels({
    viewportWidth,
    isCodeFocused: false,
    sidebarCollapsed: false,
    detailPanelCollapsed: false,
    sidebarFlyoutOpen: false,
    compactDetail: {},
    ...input
  });
}

describe('workspace panel tiers', () => {
  it('switches the sidebar to a rail below 1240', () => {
    expect(panelsAt(1240)).toMatchObject({ isCompact: false, sidebar: 'docked' });
    expect(panelsAt(1239)).toMatchObject({ isCompact: true, sidebar: 'rail' });
  });

  it('follows the saved sidebar preference only at wide widths', () => {
    expect(panelsAt(1240, { sidebarCollapsed: true }).sidebar).toBe('rail');
    expect(panelsAt(1239, { sidebarCollapsed: true, sidebarFlyoutOpen: true }).sidebar).toBe('flyout');
  });

  it('keeps details docked from 900 and starts them closed below it', () => {
    expect(panelsAt(900).isDetailCollapsed).toBe(false);
    expect(panelsAt(899).isDetailCollapsed).toBe(true);
  });

  it('honours saved collapsed details until a session choice exists', () => {
    expect(panelsAt(1100, { detailPanelCollapsed: true }).isDetailCollapsed).toBe(true);
    expect(
      panelsAt(1100, { detailPanelCollapsed: true, compactDetail: { history: true } }).isDetailCollapsed
    ).toBe(false);
  });

  it('keeps history and code choices apart from 900 to 1239', () => {
    const compactDetail = { code: false };

    expect(panelsAt(1100, { isCodeFocused: true, compactDetail })).toMatchObject({
      detailChoiceKey: 'code',
      isDetailCollapsed: true
    });
    expect(panelsAt(1100, { compactDetail })).toMatchObject({
      detailChoiceKey: 'history',
      isDetailCollapsed: false
    });
  });

  it('shares one detail choice below 900', () => {
    const compactDetail = { history: true };

    expect(panelsAt(899, { isCodeFocused: true, compactDetail })).toMatchObject({
      detailChoiceKey: 'history',
      isDetailCollapsed: false
    });
  });

  it('restores saved state at 1240 even if session flags are still set', () => {
    const stale = { sidebarFlyoutOpen: true, compactDetail: { history: false, code: false } };

    expect(panelsAt(1240, stale)).toMatchObject({ sidebar: 'docked', isDetailCollapsed: false });
    expect(panelsAt(1240, { ...stale, sidebarCollapsed: true, detailPanelCollapsed: true })).toMatchObject({
      sidebar: 'rail',
      isDetailCollapsed: true
    });
  });
});
