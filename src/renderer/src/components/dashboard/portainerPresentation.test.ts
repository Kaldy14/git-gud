import { describe, expect, it } from 'vitest';

import {
  formatRunningAge,
  portainerImagePresentation,
  portainerImageSummary,
  portainerServiceHealthPresentation,
  portainerStackHealthPresentation
} from './portainerPresentation';

describe('Portainer dashboard presentation', () => {
  it('maps stack, service, and image states to concise labels and tones', () => {
    expect(portainerStackHealthPresentation('healthy')).toEqual({
      label: 'Healthy',
      tone: 'success'
    });
    expect(portainerStackHealthPresentation('degraded')).toEqual({
      label: 'Degraded',
      tone: 'danger'
    });
    expect(portainerServiceHealthPresentation('updating')).toEqual({
      label: 'Updating',
      tone: 'running'
    });
    expect(portainerImagePresentation('update-available')).toEqual({
      label: 'Update available',
      tone: 'running'
    });
  });

  it('marks images current only when every service is explicitly up to date', () => {
    expect(
      portainerImageSummary(['up-to-date', 'up-to-date'], {
        loading: false,
        error: false
      })
    ).toEqual({ value: 'Current', tone: 'success' });
    expect(
      portainerImageSummary(['up-to-date', 'unknown'], {
        loading: false,
        error: false
      })
    ).toEqual({ value: 'Unknown', detail: 'not reported', tone: 'neutral' });
    expect(
      portainerImageSummary([], { loading: false, error: false })
    ).toEqual({ value: 'Unknown', detail: 'not reported', tone: 'neutral' });
  });

  it('formats service running ages without overstating missing or future timestamps', () => {
    const now = Date.parse('2026-07-27T12:00:00.000Z');

    expect(formatRunningAge(undefined, now)).toBe('not running');
    expect(formatRunningAge('2026-07-27T12:01:00.000Z', now)).toBe('just started');
    expect(formatRunningAge('2026-07-27T10:00:00.000Z', now)).toBe('running 2h');
    expect(formatRunningAge('2026-07-24T12:00:00.000Z', now)).toBe('running 3d');
  });
});
