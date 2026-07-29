import { describe, expect, it } from 'vitest';

import {
  isRepositoryUnavailableError,
  repositoryUnavailableErrorMessage
} from './repositoryAvailability';

describe('repository availability errors', () => {
  it('recognizes the message after Electron adds its IPC wrapper', () => {
    const error = new Error(
      `Error invoking remote method 'repo:overview': Error: ${repositoryUnavailableErrorMessage('/tmp/missing')}`
    );

    expect(isRepositoryUnavailableError(error)).toBe(true);
  });

  it('does not classify unrelated Git errors as missing repositories', () => {
    expect(
      isRepositoryUnavailableError(
        "Error invoking remote method 'repo:overview': Error: Git was not found."
      )
    ).toBe(false);
  });
});
