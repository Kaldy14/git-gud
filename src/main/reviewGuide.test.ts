import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GitReviewGuide, GitReviewPlan } from '@shared/types';

import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';
import {
  buildReviewGuidePrompt,
  parseReviewGuideOutput,
  PiReviewGuideEngine,
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
            priority: 'focus',
            why: 'Connections now obey the configured timeout.',
            what: 'The open call receives the timeout value.',
            files: [{ path: 'src/client.ts', priority: 'focus', reason: 'Connection timeout behavior.', line: 2 }],
            inlineNotes: [{ path: 'src/client.ts', line: 2, body: 'The timeout is passed to the connection call.' }]
          }]
        }),
        '```'
      ].join('\n'),
      plan
    );

    expect(prompt).toContain('do not create, merge, split, or omit groups');
    expect(prompt).toContain('No note quota');
    expect(prompt).toContain('Use "AI guide" as the product term');
    expect(guide).toMatchObject({
      sourceFingerprint: plan.sourceFingerprint,
      summary: 'Adds timeout-aware connection handling.',
      units: [{
        unitId: unit.id,
        priority: 'focus',
        inlineNotes: [{ path: 'src/client.ts', line: 2 }]
      }]
    });
  });

  it('keeps generated walkthrough copy harness agnostic', () => {
    const plan = reviewPlan();
    const unit = plan.units[0]!;
    const guide = parseReviewGuideOutput(JSON.stringify({
      summary: 'Adds a Pi-powered walkthrough.',
      units: [{
        unitId: unit.id,
        priority: 'review',
        why: 'Pi ranks the groups in the background.',
        what: 'PiReviewGuideEngine produces the guide.',
        files: [{ path: 'src/client.ts', priority: 'review', reason: 'Connection behavior.' }],
        inlineNotes: []
      }]
    }), plan);

    expect(guide.summary).toBe('Adds an AI-powered walkthrough.');
    expect(guide.units[0]).toMatchObject({
      why: 'AI ranks the groups in the background.',
      what: 'AI review engine produces the guide.'
    });
  });

  it('rejects invented groups and notes that do not point to an added line', () => {
    const plan = reviewPlan();

    expect(() =>
      parseReviewGuideOutput(JSON.stringify({
        summary: 'A summary.',
        units: [{
          unitId: 'invented',
          priority: 'review',
          why: 'Why.',
          what: 'What.',
          files: [{ path: 'src/client.ts', priority: 'review', reason: 'Connection behavior.' }],
        inlineNotes: []
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
          files: [{ path: 'src/client.ts', priority: 'review', reason: 'Connection behavior.' }],
          inlineNotes: [{ path: 'src/client.ts', line: 99, body: 'Invalid location.' }]
        }]
      }), plan)
    ).toThrow('added line');
  });

  it('allows a quiet block and inline-only guidance without mandatory paragraphs', () => {
    const plan = reviewPlan();
    const output = validGuide(plan);
    output.units[0]!.why = '';
    output.units[0]!.what = '';
    output.units[0]!.inlineNotes = [{ path: 'src/client.ts', line: 2, body: 'Timeout units are milliseconds.' }];
    expect(parseReviewGuideOutput(JSON.stringify(output), plan).units[0]).toMatchObject({
      why: '', what: '', inlineNotes: [{ line: 2 }]
    });
  });

  it('rejects duplicate, missing, and invented file ranks and invalid entry lines', () => {
    const plan = reviewPlan();
    const output = validGuide(plan);
    const file = output.units[0]!.files[0]!;
    for (const files of [[], [file, file], [{ ...file, path: 'other.ts' }], [{ ...file, line: 99 }]]) {
      output.units[0]!.files = files;
      expect(() => parseReviewGuideOutput(JSON.stringify(output), plan)).toThrow();
    }
  });

  it('includes author intent as quoted context and identifies partial patches', () => {
    const plan = reviewPlan();
    plan.title = 'Respect connection timeout';
    plan.units[0]!.chunks[0]!.patch += 'x'.repeat(400_001);
    const prompt = buildReviewGuidePrompt(plan);
    expect(prompt).toContain('Respect connection timeout');
    expect(prompt).toContain('"truncated":true');
    expect(prompt).toContain('incomplete evidence');
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

  it('trims deferred cache entries after the oldest running guide completes', async () => {
    const firstPlan = reviewPlan();
    let resolveFirstGuide: (guide: GitReviewGuide) => void = () => undefined;
    const firstGuide = new Promise<GitReviewGuide>((resolve) => {
      resolveFirstGuide = resolve;
    });
    const engine: ReviewGuideEngine = {
      generate: async (plan) => {
        if (plan.sourceFingerprint === firstPlan.sourceFingerprint) {
          return firstGuide;
        }
        return validGuide(plan);
      },
      shutdown: () => undefined
    };
    const manager = new ReviewGuideManager(engine);
    const laterPlans = Array.from({ length: 30 }, (_, index) => ({
      ...reviewPlan(),
      sourceFingerprint: `later-${index}`
    }));

    manager.start(firstPlan);
    for (const plan of laterPlans) {
      manager.start(plan);
    }
    await vi.waitFor(() => {
      expect(manager.getState(
        laterPlans.at(-1)!.repoPath,
        laterPlans.at(-1)!.sourceFingerprint
      ).status).toBe('ready');
    });

    resolveFirstGuide(validGuide(firstPlan));
    await vi.waitFor(() => {
      expect(manager.getState(firstPlan.repoPath, firstPlan.sourceFingerprint).status).toBe('idle');
    });
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

  it('reports an early engine exit without leaking a broken-pipe error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-review-guide-'));
    const executable = join(directory, 'early-exit');
    await writeFile(executable, [
      '#!/usr/bin/env node',
      "process.stderr.write('Engine startup failed.\\n');",
      'process.exit(1);'
    ].join('\n'));
    await chmod(executable, 0o755);
    vi.stubEnv('PI_EXECUTABLE_PATH', executable);

    const plan = reviewPlan();
    plan.repoPath = directory;
    plan.units[0]!.chunks[0]!.patch = `+${'x'.repeat(400_000)}`;

    try {
      await expect(new PiReviewGuideEngine().generate(plan)).rejects.toThrow('Engine startup failed.');
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
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
      files: [{ path: 'src/client.ts', priority: 'review', reason: 'Connection behavior.' }],
        inlineNotes: []
    })),
    generatedAt: '2026-07-23T00:00:00.000Z'
  };
}
