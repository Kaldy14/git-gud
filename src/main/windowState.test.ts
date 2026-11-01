import { describe, expect, it } from 'vitest';

import { DEFAULT_WINDOW_SIZE, normalizeSavedWindowState, restoreWindowBounds } from './windowState';

const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: 0, width: 2560, height: 1415 };
const saved = { x: 1700, y: 120, width: 1800, height: 1100, maximized: false, fullScreen: false };

describe('window state', () => {
  it('uses the default size when nothing is saved', () => {
    expect(restoreWindowBounds(undefined, [external])).toEqual(DEFAULT_WINDOW_SIZE);
    expect(restoreWindowBounds(undefined, [laptop])).toEqual({ width: 1440, height: 920 });
  });

  it('restores saved bounds on the display that still shows the title bar', () => {
    expect(restoreWindowBounds(saved, [laptop, external])).toEqual({ x: 1700, y: 120, width: 1800, height: 1100 });
  });

  it('centers the saved size on the primary display after its display is disconnected', () => {
    expect(restoreWindowBounds(saved, [laptop])).toEqual({ x: 0, y: 25, width: 1512, height: 920 });
    expect(restoreWindowBounds({ ...saved, width: 900, height: 600 }, [laptop])).toEqual({
      x: 306,
      y: 185,
      width: 900,
      height: 600
    });
  });

  it('pulls a partly off-screen window back inside its display and enforces a minimum size', () => {
    expect(restoreWindowBounds({ ...saved, x: 1300, y: 100, width: 300, height: 200 }, [laptop])).toEqual({
      x: 872,
      y: 100,
      width: 640,
      height: 480
    });
  });

  it('centers a window whose title bar is hidden above the work area', () => {
    expect(restoreWindowBounds({ ...saved, x: 100, y: -40, width: 900, height: 600 }, [laptop])).toEqual({
      x: 306,
      y: 185,
      width: 900,
      height: 600
    });
  });

  it('accepts only finite numeric bounds from storage', () => {
    expect(normalizeSavedWindowState({ x: 1.4, y: 2, width: 800, height: 600, maximized: true })).toEqual({
      x: 1,
      y: 2,
      width: 800,
      height: 600,
      maximized: true,
      fullScreen: false
    });
    expect(normalizeSavedWindowState({ x: 'a', y: 2, width: 800, height: 600 })).toBeUndefined();
    expect(normalizeSavedWindowState(null)).toBeUndefined();
  });
});
