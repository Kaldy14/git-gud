import { describe, expect, it } from 'vitest';

import {
  dashboardTileDropPositionForPointer,
  dashboardTileRows,
  nearestDashboardTileForPointer,
  moveDashboardTile,
  moveDashboardTileToNewRow,
  reorderDashboardTiles
} from './dashboardTileLayout';

const tiles = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }];

describe('dashboard tile layout', () => {
  it('reorders a tile before or after another tile', () => {
    expect(
      reorderDashboardTiles(tiles, 'alpha', 'gamma', 'before').map((tile) => tile.id)
    ).toEqual(['beta', 'alpha', 'gamma']);
    expect(
      reorderDashboardTiles(tiles, 'alpha', 'gamma', 'after').map((tile) => tile.id)
    ).toEqual(['beta', 'gamma', 'alpha']);
    expect(
      reorderDashboardTiles(tiles, 'gamma', 'alpha', 'before').map((tile) => tile.id)
    ).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('keeps the original array when a drop cannot change the layout', () => {
    expect(reorderDashboardTiles(tiles, 'missing', 'alpha', 'before')).toBe(tiles);
    expect(reorderDashboardTiles(tiles, 'beta', 'beta', 'after')).toBe(tiles);
    expect(reorderDashboardTiles(tiles, 'alpha', 'beta', 'before')).toBe(tiles);
  });

  it('moves tiles one position with keyboard-compatible offsets', () => {
    expect(moveDashboardTile(tiles, 'beta', -1).map((tile) => tile.id)).toEqual([
      'beta',
      'alpha',
      'gamma'
    ]);
    expect(moveDashboardTile(tiles, 'beta', 1).map((tile) => tile.id)).toEqual([
      'alpha',
      'gamma',
      'beta'
    ]);
    expect(moveDashboardTile(tiles, 'alpha', -1)).toBe(tiles);
    expect(moveDashboardTile(tiles, 'gamma', 1)).toBe(tiles);
  });

  it('uses horizontal drop halves in a grid and vertical halves in one column', () => {
    const bounds = { left: 100, top: 200, width: 400, height: 300 };

    expect(dashboardTileDropPositionForPointer(250, 340, bounds, 2)).toBe('before');
    expect(dashboardTileDropPositionForPointer(350, 220, bounds, 2)).toBe('after');
    expect(dashboardTileDropPositionForPointer(450, 300, bounds, 1)).toBe('before');
    expect(dashboardTileDropPositionForPointer(110, 400, bounds, 1)).toBe('after');
  });

  it('moves a tile into its own row and keeps row grouping when reordering', () => {
    const onSecondRow = moveDashboardTileToNewRow(tiles, 'gamma');

    expect(onSecondRow).toEqual([
      { id: 'alpha', startsNewRow: undefined },
      { id: 'beta', startsNewRow: undefined },
      { id: 'gamma', startsNewRow: true }
    ]);
    expect(dashboardTileRows(onSecondRow).map((row) => row.map((tile) => tile.id))).toEqual([
      ['alpha', 'beta'],
      ['gamma']
    ]);

    expect(
      reorderDashboardTiles(onSecondRow, 'gamma', 'alpha', 'after')
    ).toEqual([
      { id: 'alpha', startsNewRow: undefined },
      { id: 'gamma', startsNewRow: undefined },
      { id: 'beta', startsNewRow: undefined }
    ]);
  });

  it('preserves a populated row when its first tile moves elsewhere', () => {
    const withSecondRow = [
      { id: 'alpha' },
      { id: 'beta', startsNewRow: true },
      { id: 'gamma' }
    ];

    expect(
      reorderDashboardTiles(withSecondRow, 'beta', 'alpha', 'before')
    ).toEqual([
      { id: 'beta', startsNewRow: undefined },
      { id: 'alpha', startsNewRow: undefined },
      { id: 'gamma', startsNewRow: true }
    ]);
  });
});

describe('nearest dashboard drop target', () => {
  const targets = [
    { id: 'short', bounds: { left: 0, top: 0, width: 400, height: 100 } },
    { id: 'tall', bounds: { left: 408, top: 0, width: 400, height: 400 } },
    { id: 'next-row', bounds: { left: 0, top: 408, width: 400, height: 100 } }
  ];

  it('accepts gaps between tiles and unused space beside a partial row', () => {
    expect(nearestDashboardTileForPointer(405, 50, targets)?.id).toBe('tall');
    expect(nearestDashboardTileForPointer(700, 500, targets)?.id).toBe('tall');
    expect(nearestDashboardTileForPointer(900, 508, [targets[2]!])?.id).toBe('next-row');
  });

  it('selects the row before its tile so empty columns belong to that row', () => {
    const rows = [
      { bounds: { left: 0, top: 0, width: 808, height: 400 }, tiles: targets.slice(0, 2) },
      { bounds: { left: 0, top: 408, width: 808, height: 100 }, tiles: targets.slice(2) }
    ];
    const row = nearestDashboardTileForPointer(700, 450, rows);
    expect(nearestDashboardTileForPointer(700, 450, row?.tiles ?? [])?.id).toBe('next-row');
  });

  it('uses distance to tile edges for unequal heights and row gaps', () => {
    expect(nearestDashboardTileForPointer(200, 150, targets)?.id).toBe('short');
    expect(nearestDashboardTileForPointer(200, 405, targets)?.id).toBe('next-row');
    expect(nearestDashboardTileForPointer(500, 300, targets)?.id).toBe('tall');
    expect(nearestDashboardTileForPointer(0, 0, [])).toBeUndefined();
  });
});
