export type DashboardTileDropPosition = 'before' | 'after';

type DashboardTileIdentity = {
  id: string;
};

type TileBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function reorderDashboardTiles<Tile extends DashboardTileIdentity>(
  tiles: Tile[],
  sourceTileId: string,
  targetTileId: string,
  position: DashboardTileDropPosition
): Tile[] {
  const sourceIndex = tiles.findIndex((tile) => tile.id === sourceTileId);
  const targetIndex = tiles.findIndex((tile) => tile.id === targetTileId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return tiles;
  }

  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  const reorderedIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;

  if (reorderedIndex === sourceIndex) {
    return tiles;
  }

  const reorderedTiles = [...tiles];
  const [sourceTile] = reorderedTiles.splice(sourceIndex, 1);

  if (!sourceTile) {
    return tiles;
  }

  reorderedTiles.splice(reorderedIndex, 0, sourceTile);
  return reorderedTiles;
}

export function moveDashboardTile<Tile extends DashboardTileIdentity>(
  tiles: Tile[],
  tileId: string,
  offset: -1 | 1
): Tile[] {
  const sourceIndex = tiles.findIndex((tile) => tile.id === tileId);
  const targetIndex = sourceIndex + offset;

  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= tiles.length) {
    return tiles;
  }

  const reorderedTiles = [...tiles];
  const [sourceTile] = reorderedTiles.splice(sourceIndex, 1);

  if (!sourceTile) {
    return tiles;
  }

  reorderedTiles.splice(targetIndex, 0, sourceTile);
  return reorderedTiles;
}

export function dashboardTileDropPositionForPointer(
  clientX: number,
  clientY: number,
  bounds: TileBounds,
  columnCount: number
): DashboardTileDropPosition {
  if (columnCount > 1) {
    return clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
  }

  return clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}
