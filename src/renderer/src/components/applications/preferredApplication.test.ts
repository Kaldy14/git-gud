import { describe, expect, it } from 'vitest';

import type { ExternalApplication } from '@shared/externalApplications';

import { repositoryApplications, selectApplication } from './preferredApplication';

const application = (id: ExternalApplication['id'], name: string): ExternalApplication => ({ id, name, iconDataUrl: '' });
const installed = [application('finder', 'Finder'), application('terminal', 'Terminal'), application('xcode', 'Xcode')];

describe('repository applications', () => {
  it('leaves Xcode out of the applications offered for a whole repository', () => {
    expect(repositoryApplications(installed).map((candidate) => candidate.id)).toEqual(['finder', 'terminal']);
  });

  it('falls back from a saved Xcode preference to the first repository application', () => {
    expect(selectApplication(repositoryApplications(installed), 'xcode')?.id).toBe('finder');
  });

  it('prefers VS Code by default once it is installed', () => {
    expect(selectApplication(repositoryApplications([...installed, application('vscode', 'VS Code')]), undefined)?.id).toBe('vscode');
  });
});
