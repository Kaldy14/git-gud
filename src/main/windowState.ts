export type WindowRectangle = { x: number; y: number; width: number; height: number };

export type SavedWindowState = WindowRectangle & {
  maximized: boolean;
  fullScreen: boolean;
};

export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 920 } as const;
const MIN_RESTORED_SIZE = { width: 640, height: 480 } as const;
// The title bar must stay reachable so a restored window can always be dragged back.
const MIN_VISIBLE_TITLE_BAR = { width: 120, height: 32 } as const;

export function normalizeSavedWindowState(value: unknown): SavedWindowState | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const [x, y, width, height] = [record.x, record.y, record.width, record.height];

  if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))) {
    return undefined;
  }

  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number),
    maximized: record.maximized === true,
    fullScreen: record.fullScreen === true
  };
}

/**
 * Returns the bounds to create the window with. Saved bounds are kept only when their title bar is
 * on a connected display; otherwise the saved size is centered on the primary display.
 */
export function restoreWindowBounds(
  saved: SavedWindowState | undefined,
  workAreas: readonly WindowRectangle[]
): Partial<WindowRectangle> & Pick<WindowRectangle, 'width' | 'height'> {
  const primary = workAreas[0];

  if (!saved || !primary) {
    return primary ? clampSize(DEFAULT_WINDOW_SIZE, primary) : { ...DEFAULT_WINDOW_SIZE };
  }

  const titleBar = { x: saved.x, y: saved.y, width: saved.width, height: MIN_VISIBLE_TITLE_BAR.height };
  const display = workAreas.find((area) => {
    const overlap = intersection(titleBar, area);
    return overlap.width >= MIN_VISIBLE_TITLE_BAR.width && overlap.height >= MIN_VISIBLE_TITLE_BAR.height;
  });

  if (!display) {
    const size = clampSize(saved, primary);
    return {
      ...size,
      x: Math.round(primary.x + (primary.width - size.width) / 2),
      y: Math.round(primary.y + (primary.height - size.height) / 2)
    };
  }

  const size = clampSize(saved, display);
  return {
    ...size,
    x: Math.min(Math.max(saved.x, display.x), display.x + display.width - size.width),
    y: Math.min(Math.max(saved.y, display.y), display.y + display.height - size.height)
  };
}

function clampSize(
  size: Pick<WindowRectangle, 'width' | 'height'>,
  area: WindowRectangle
): Pick<WindowRectangle, 'width' | 'height'> {
  return {
    width: Math.min(Math.max(size.width, MIN_RESTORED_SIZE.width), area.width),
    height: Math.min(Math.max(size.height, MIN_RESTORED_SIZE.height), area.height)
  };
}

function intersection(left: WindowRectangle, right: WindowRectangle): Pick<WindowRectangle, 'width' | 'height'> {
  return {
    width: Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)),
    height: Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  };
}
