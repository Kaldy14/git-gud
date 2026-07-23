import { describe, expect, it, vi } from 'vitest';

import type { GitReviewGuide, GitReviewPlan } from '@shared/types';

import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';
import {
  buildReviewGuidePrompt,
  parseReviewGuideOutput,
  ReviewGuideManager,
  type ReviewGuideEngine
} from './reviewGuide';

describe('AI review guides', () => {
  it('builds an immutable-group prompt and accepts a valid fenced response', () => {
    const plan = reviewPlan();
    const unit = plan.units[0]!;
    const prompt = buildReviewGuidePrompt(plan);
    const guide = parseReviewGuideOutput(
      [
        '```json',
        JSON.stringify({
          summary: 'Adds timeout-aware connection handling.',
          units: [{
            unitId: unit.id,
            priority: 'critical',
            why: 'Connections now obey the configured timeout.',
            what: 'The open call receives the timeout value.',
            confirmedIssues: [{
              summary: 'The new timeout value is undefined.',
              path: 'src/client.ts',
              line: 2,
              evidence: 'The added call references timeout without a declaration.'
            }]
          }]
        }),
        '```'
      ].join('\n'),
      plan
    );

    expect(prompt).toContain('do not create, merge, split, or omit groups');
    expect(prompt).toContain('confirmedIssues is not a todo list');
    expect(guide).toMatchObject({
      sourceFingerprint: plan.sourceFingerprint,
      summary: 'Adds timeout-aware connection handling.',
      units: [{
        unitId: unit.id,
        priority: 'critical',
        confirmedIssues: [{ path: 'src/client.ts', line: 2 }]
      }]
    });
  });

  it('rejects invented groups and issues that do not point to an added line', () => {
    const plan = reviewPlan();

    expect(() =>
      parseReviewGuideOutput(JSON.stringify({
        summary: 'A summary.',
        units: [{
          unitId: 'invented',
          priority: 'review',
          why: 'Why.',
          what: 'What.',
          confirmedIssues: []
        }]
      }), plan)
    ).toThrow('each existing review group exactly once');

    expect(() =>
      parseReviewGuideOutput(JSON.stringify({
        summary: 'A summary.',
        units: [{
          unitId: plan.units[0]!.id,
          priority: 'review',
          why: 'Why.',
          what: 'What.',
          confirmedIssues: [{
            summary: 'Issue.',
            path: 'src/client.ts',
            line: 99,
            evidence: 'Evidence.'
          }]
        }]
      }), plan)
    ).toThrow('added line');
  });

  it('runs generation in the background and deduplicates an active job', async () => {
    const plan = reviewPlan();
    let resolveGuide: (guide: GitReviewGuide) => void = () => undefined;
    const pendingGuide = new Promise<GitReviewGuide>((resolve) => {
      resolveGuide = resolve;
    });
    const engine = new FakeEngine(() => pendingGuide);
    const manager = new ReviewGuideManager(engine);

    expect(manager.start(plan).status).toBe('running');
    expect(manager.start(plan).status).toBe('running');
    expect(engine.calls).toBe(1);

    resolveGuide(validGuide(plan));
    await vi.waitFor(() => expect(manager.getState(plan.repoPath, plan.sourceFingerprint).status).toBe('ready'));
  });

  it('keeps a failed guide isolated from the ordinary review plan', async () => {
    const plan = reviewPlan();
    const manager = new ReviewGuideManager(new FakeEngine(async () => {
      throw new Error('Engine unavailable.');
    }));

    manager.start(plan);
    await vi.waitFor(() => {
      expect(manager.getState(plan.repoPath, plan.sourceFingerprint)).toEqual({
        status: 'failed',
        sourceFingerprint: plan.sourceFingerprint,
        errorMessage: 'Engine unavailable.'
      });
    });
  });
});

class FakeEngine implements ReviewGuideEngine {
  calls = 0;

  constructor(private readonly result: () => Promise<GitReviewGuide>) {}

  generate(): Promise<GitReviewGuide> {
    this.calls += 1;
    return this.result();
  }

  shutdown(): void {}
}

function reviewPlan(): GitReviewPlan {
  const input: ReviewPatchInput = {
    path: 'src/client.ts',
    status: 'modified',
    source: 'unstaged',
    diff: {
      repoPath: '/repo',
      path: 'src/client.ts',
      mode: 'wip-unstaged',
      patch: '@@ -1,2 +1,2 @@\n export function connect() {\n-  return open();\n+  return open(timeout);\n',
      isBinary: false,
      loadedAt: '2026-07-23T00:00:00.000Z'
    }
  };
  return buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [input]);
}

function validGuide(plan: GitReviewPlan): GitReviewGuide {
  return {
    sourceFingerprint: plan.sourceFingerprint,
    targetKey: plan.targetKey,
    summary: 'Adds timeout-aware connection handling.',
    units: plan.units.map((unit) => ({
      unitId: unit.id,
      priority: 'review',
      why: 'Connections should obey the configured timeout.',
      what: 'The open call now receives the timeout value.',
      confirmedIssues: []
    })),
    generatedAt: '2026-07-23T00:00:00.000Z'
  };
}
