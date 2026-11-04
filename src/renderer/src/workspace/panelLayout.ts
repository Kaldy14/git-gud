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

function panelCap(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}
