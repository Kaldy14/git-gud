import { describe, expect, it } from 'vitest';

import { roundedRailCurveInPath, roundedRailCurveOutPath } from './graphGeometry';

describe('graph rail geometry', () => {
  it('uses a rounded right-angle junction for outgoing merge parents', () => {
    expect(roundedRailCurveOutPath(45, 67, 28)).toBe(
      'M 45 14 H 59 Q 67 14 67 22 V 28'
    );
  });

  it('uses a rounded right-angle junction when a side lane collapses', () => {
    expect(roundedRailCurveInPath(67, 45, 28)).toBe(
      'M 67 0 V 6 Q 67 14 59 14 H 45'
    );
  });

  it('keeps clamped lanes vertical when both endpoints share an edge', () => {
    expect(roundedRailCurveInPath(12, 12, 28)).toBe('M 12 0 V 14');
    expect(roundedRailCurveOutPath(12, 12, 28)).toBe('M 12 14 V 28');
  });
});
