import {
  MAX_DETAIL_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_DETAIL_PANEL_WIDTH,
  MIN_SIDEBAR_WIDTH
} from '@shared/workspace';

export type WorkspacePanelCaps = {
  sidebar: number;
  detail: number;
};

export const COMPACT_WORKSPACE_WIDTH = 1240;
export const NARROW_WORKSPACE_WIDTH = 900;
export const MAX_SIDEBAR_FLYOUT_WIDTH = 320;

/** Session-only detail panel choices. Unset means "follow the saved preference". */
export type CompactDetailChoice = { history?: boolean; code?: boolean };

export const NO_COMPACT_DETAIL_CHOICE: CompactDetailChoice = {};

export type WorkspacePanelInput = {
  viewportWidth: number;
  isCodeFocused: boolean;
  sidebarCollapsed: boolean;
  detailPanelCollapsed: boolean;
  sidebarFlyoutOpen: boolean;
  compactDetail: CompactDetailChoice;
};

export type WorkspacePanels = {
  isCompact: boolean;
  sidebar: 'docked' | 'rail' | 'flyout';
  isDetailCollapsed: boolean;
  detailChoiceKey: keyof CompactDetailChoice;
};

const SIDEBAR_VIEWPORT_SHARE = 0.2;
const DETAIL_VIEWPORT_SHARE = 0.26;
const CODE_SIDEBAR_VIEWPORT_SHARE = 0.16;
const CODE_DETAIL_VIEWPORT_SHARE = 0.22;

/**
 * Side panels narrow with the window and give extra room to code while a diff is open.
 * These caps only limit what is drawn: stored widths are left alone, so a wider window
 * or closing the diff restores them, and a panel the user opened stays open.
 */
export function workspacePanelCaps(viewportWidth: number, isCodeFocused: boolean): WorkspacePanelCaps {
  return {
    sidebar: panelCap(
      viewportWidth * (isCodeFocused ? CODE_SIDEBAR_VIEWPORT_SHARE : SIDEBAR_VIEWPORT_SHARE),
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH
    ),
    detail: panelCap(
      viewportWidth * (isCodeFocused ? CODE_DETAIL_VIEWPORT_SHARE : DETAIL_VIEWPORT_SHARE),
      MIN_DETAIL_PANEL_WIDTH,
      MAX_DETAIL_PANEL_WIDTH
    )
  };
}

/**
 * Below the compact width the sidebar is a rail with a floating flyout, and panel choices
 * live in session state. Saved preferences are read here but only change at wide widths.
 * Below the narrow width history and code share one detail choice, so opening a file from
 * the panel keeps it open.
 */
export function resolveWorkspacePanels(input: WorkspacePanelInput): WorkspacePanels {
  const isCompact = input.viewportWidth < COMPACT_WORKSPACE_WIDTH;
  const isNarrow = input.viewportWidth < NARROW_WORKSPACE_WIDTH;
  const detailChoiceKey = input.isCodeFocused && !isNarrow ? 'code' : 'history';
  const detailOpen =
    (isCompact ? input.compactDetail[detailChoiceKey] : undefined) ??
    (!input.detailPanelCollapsed && !isNarrow);
  const dockedSidebar = input.sidebarCollapsed ? 'rail' : 'docked';

  return {
    isCompact,
    sidebar: isCompact ? (input.sidebarFlyoutOpen ? 'flyout' : 'rail') : dockedSidebar,
    isDetailCollapsed: !detailOpen,
    detailChoiceKey
  };
}

function panelCap(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}
