import { describe, expect, it } from 'vitest';

import {
  findWorkflowJobMatches,
  stepWorkflowJobMatch,
  workflowJobNameSegments
} from './workflowJobSearch';

const jobs = [
  { id: 1, name: 'detect-changes' },
  { id: 2, name: 'Deploy RAG with Pulumi' },
  { id: 3, name: 'build-rag-admin' },
  { id: 4, name: 'Deploy packing with Pulumi / deploy' }
];

describe('workflow job search', () => {
  it('matches job names case-insensitively in listed order', () => {
    expect(findWorkflowJobMatches(jobs, 'rag')).toEqual([2, 3]);
    expect(findWorkflowJobMatches(jobs, '  PULUMI ')).toEqual([2, 4]);
  });

  it('returns no matches for blank or unmatched queries', () => {
    expect(findWorkflowJobMatches(jobs, '   ')).toEqual([]);
    expect(findWorkflowJobMatches(jobs, 'terraform')).toEqual([]);
  });

  it('wraps next and previous navigation', () => {
    expect(stepWorkflowJobMatch(2, 3, 1)).toBe(0);
    expect(stepWorkflowJobMatch(0, 3, -1)).toBe(2);
    expect(stepWorkflowJobMatch(-1, 3, 1)).toBe(0);
    expect(stepWorkflowJobMatch(-1, 3, -1)).toBe(2);
    expect(stepWorkflowJobMatch(0, 0, 1)).toBe(-1);
  });

  it('splits every occurrence of the query while preserving original casing', () => {
    expect(workflowJobNameSegments('Deploy packing / deploy', 'DEPLOY')).toEqual([
      { text: 'Deploy', match: true },
      { text: ' packing / ', match: false },
      { text: 'deploy', match: true }
    ]);
    expect(workflowJobNameSegments('build-rag', '')).toEqual([
      { text: 'build-rag', match: false }
    ]);
  });
});
