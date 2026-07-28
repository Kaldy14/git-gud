export type DashboardTileDropPosition = 'before' | 'after';

type DashboardTileIdentity = {
  id: string;
  startsNewRow?: boolean;
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
  if (sourceTileId === targetTileId) {
    return tiles;
  }

  const rows = dashboardTileRows(tiles).map((row) => [...row]);
  const sourceRow = rows.find((row) =>
    row.some((tile) => tile.id === sourceTileId)
  );
  const sourceIndex = sourceRow?.findIndex((tile) => tile.id === sourceTileId) ?? -1;

  if (!sourceRow || sourceIndex === -1) {
    return tiles;
  }

  const [sourceTile] = sourceRow.splice(sourceIndex, 1);

  if (!sourceTile) {
    return tiles;
  }

  const nonEmptyRows = rows.filter((row) => row.length > 0);
  const targetRow = nonEmptyRows.find((row) =>
    row.some((tile) => tile.id === targetTileId)
  );
  const targetIndex = targetRow?.findIndex((tile) => tile.id === targetTileId) ?? -1;

  if (!targetRow || targetIndex === -1) {
    return tiles;
  }

  targetRow.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourceTile);
  return flattenDashboardTileRows(tiles, nonEmptyRows);
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

  const targetTile = tiles[targetIndex];

  if (!targetTile) {
    return tiles;
  }

  return reorderDashboardTiles(
    tiles,
    tileId,
    targetTile.id,
    offset === -1 ? 'before' : 'after'
  );
}

export function moveDashboardTileToNewRow<Tile extends DashboardTileIdentity>(
  tiles: Tile[],
  tileId: string
): Tile[] {
  const rows = dashboardTileRows(tiles).map((row) => [...row]);
  const sourceRow = rows.find((row) => row.some((tile) => tile.id === tileId));
  const sourceIndex = sourceRow?.findIndex((tile) => tile.id === tileId) ?? -1;

  if (!sourceRow || sourceIndex === -1) {
    return tiles;
  }

  const [sourceTile] = sourceRow.splice(sourceIndex, 1);

  if (!sourceTile) {
    return tiles;
  }

  const nonEmptyRows = rows.filter((row) => row.length > 0);
  nonEmptyRows.push([sourceTile]);
  return flattenDashboardTileRows(tiles, nonEmptyRows);
}

export function dashboardTileRows<Tile extends DashboardTileIdentity>(
  tiles: Tile[]
): Tile[][] {
  return tiles.reduce<Tile[][]>((rows, tile, index) => {
    if (index === 0 || tile.startsNewRow) {
      rows.push([tile]);
    } else {
      rows.at(-1)?.push(tile);
    }

    return rows;
  }, []);
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

function flattenDashboardTileRows<Tile extends DashboardTileIdentity>(
  originalTiles: Tile[],
  rows: Tile[][]
): Tile[] {
  const flattened = rows.flatMap((row, rowIndex) =>
    row.map((tile, tileIndex) => ({
      ...tile,
      startsNewRow: rowIndex > 0 && tileIndex === 0 ? true : undefined
    }))
  );
  const unchanged = flattened.every(
    (tile, index) =>
      tile.id === originalTiles[index]?.id &&
      Boolean(tile.startsNewRow) === Boolean(originalTiles[index]?.startsNewRow)
  );

  return unchanged ? originalTiles : flattened;
}
