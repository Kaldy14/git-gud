const MAX_RAIL_CORNER_RADIUS = 8;

export function roundedRailCurveInPath(fromX: number, toX: number, height: number): string {
  const mid = height / 2;
  const delta = toX - fromX;

  if (delta === 0) {
    return `M ${fromX} 0 V ${mid}`;
  }

  const direction = Math.sign(delta);
  const radius = Math.min(MAX_RAIL_CORNER_RADIUS, Math.abs(delta), mid);

  return `M ${fromX} 0 V ${mid - radius} Q ${fromX} ${mid} ${fromX + direction * radius} ${mid} H ${toX}`;
}

export function roundedRailCurveOutPath(fromX: number, toX: number, height: number): string {
  const mid = height / 2;
  const delta = toX - fromX;

  if (delta === 0) {
    return `M ${fromX} ${mid} V ${height}`;
  }

  const direction = Math.sign(delta);
  const radius = Math.min(MAX_RAIL_CORNER_RADIUS, Math.abs(delta), mid);

  return `M ${fromX} ${mid} H ${toX - direction * radius} Q ${toX} ${mid} ${toX} ${mid + radius} V ${height}`;
}
