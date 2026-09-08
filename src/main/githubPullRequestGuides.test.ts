import { describe, expect, it, vi } from 'vitest';
import type { GitReviewPlan, GitReviewGuideState } from '@shared/types';
import { GitHubPullRequestGuides } from './githubPullRequestGuides';
import { validateIpcArgs } from './ipcValidation';

const locator = { profileId: 'work', owner: 'acme', repository: 'app', number: 1 };
const plan: GitReviewPlan = {
  repoPath: 'github://github.com/acme/app', target: { kind: 'branch', name: 'feature', sha: 'head-1' },
  targetKey: 'pr-1', sourceFingerprint: 'fingerprint-1', units: [], fileContexts: [], reviewedChunkIds: [], loadedAt: ''
};

function fixture() {
  const states = new Map<string, GitReviewGuideState>();
  const manager = {
    getState: vi.fn((_path: string, fingerprint: string): GitReviewGuideState =>
      states.get(fingerprint) ?? { status: 'idle', sourceFingerprint: fingerprint }),
    start: vi.fn((input: GitReviewPlan): GitReviewGuideState => {
      const state = { status: 'running' as const, sourceFingerprint: input.sourceFingerprint, startedAt: '' };
      states.set(input.sourceFingerprint, state);
      return state;
    })
  };
  return { states, manager, guides: new GitHubPullRequestGuides(manager) };
}

describe('pull request guide status', () => {
  it('validates the status lookup at the IPC boundary', () => {
    expect(validateIpcArgs('github:pull-request-guide-status', [locator])).toEqual([locator]);
    expect(() => validateIpcArgs('github:pull-request-guide-status', [{ ...locator, number: -1 }])).toThrow();
    expect(() => validateIpcArgs('github:pull-request-guide-status', [])).toThrow();
  });

  it('reads live job state without loading a PR plan and scopes it to the profile and PR', () => {
    const { guides, manager, states } = fixture();
    expect(guides.getStatus(locator)).toEqual({ status: 'idle' });
    expect(manager.getState).not.toHaveBeenCalled();
    guides.start(locator, plan);
    expect(guides.getStatus({ ...locator, owner: 'ACME' })).toMatchObject({ status: 'running', headSha: 'head-1' });
    expect(guides.getStatus({ ...locator, profileId: 'personal' })).toEqual({ status: 'idle' });
    expect(guides.getStatus({ ...locator, number: 2 })).toEqual({ status: 'idle' });
    states.set(plan.sourceFingerprint, { status: 'failed', sourceFingerprint: plan.sourceFingerprint, errorMessage: 'Provider unavailable' });
    expect(guides.getStatus(locator)).toMatchObject({ status: 'failed', errorMessage: 'Provider unavailable' });
    states.set(plan.sourceFingerprint, { status: 'ready', sourceFingerprint: plan.sourceFingerprint, guide: { sourceFingerprint: plan.sourceFingerprint, targetKey: plan.targetKey, generatedAt: '', summary: 'Ready', units: [] } });
    expect(guides.getStatus(locator)).toEqual({ status: 'ready', headSha: 'head-1', errorMessage: undefined });
    expect(manager.start).toHaveBeenCalledTimes(1);
  });

  it('retains the generated revision until a replacement starts', () => {
    const { guides } = fixture();
    guides.start(locator, plan);
    expect(guides.getStatus(locator).headSha).toBe('head-1');
    guides.start(locator, { ...plan, sourceFingerprint: 'fingerprint-2', target: { kind: 'branch', name: 'feature', sha: 'head-2' } });
    expect(guides.getStatus(locator).headSha).toBe('head-2');
  });

  it('keeps running jobs visible when completed revision entries are evicted', () => {
    const { guides, states } = fixture();
    guides.start(locator, plan);
    for (let number = 2; number <= 32; number++) {
      const fingerprint = `fingerprint-${number}`;
      guides.start({ ...locator, number }, { ...plan, sourceFingerprint: fingerprint });
      states.set(fingerprint, { status: 'idle', sourceFingerprint: fingerprint });
    }
    expect(guides.getStatus(locator).status).toBe('running');
    expect(guides.getStatus({ ...locator, number: 2 })).toEqual({ status: 'idle' });
  });
});
