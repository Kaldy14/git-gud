import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitReviewGuide, GitReviewPlan } from '@shared/types';

import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';
import * as piHarness from './piHarness';
import {
  buildReviewGuidePrompt,
  parseReviewGuideOutput,
  PiReviewGuideEngine,
  ReviewGuideManager,
  type ReviewGuideEngine
} from './reviewGuide';

afterEach(() => vi.restoreAllMocks());

describe('AI review guides', () => {
  it('preserves source coverage and accepts an older fenced response', () => {
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

    expect(prompt).toContain('never split, duplicate, or omit a source block');
    expect(prompt).toContain('No note quota');
    expect(prompt).toContain('Use "AI brief" as the product term');
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
    plan.units[0]!.chunks[0]!.patch += `+${'x'.repeat(400_001)}`;
    const prompt = buildReviewGuidePrompt(plan);
    expect(prompt).toContain('Respect connection timeout');
    expect(prompt).toContain('"truncated":true');
    expect(prompt).toContain('incomplete evidence');
    expect(prompt).not.toContain('xxxxx');
  });

  it('combines source blocks only in the generated layer and validates dependency order', () => {
    const plan = reviewPlan();
    const source = plan.units[0]!;
    plan.units.push({ ...source, id: 'second', chunks: source.chunks.map((chunk) => ({ ...chunk, id: 'second-chunk', path: 'src/other.ts' })) });
    const guide = validGuide(plan);
    const first = guide.units[0]!;
    first.sourceUnitIds = [source.id, 'second'];
    first.title = 'Respect timeouts across clients';
    first.files.push({ ...first.files[0]!, path: 'src/other.ts' });
    guide.units = [first];
    const parsed = parseReviewGuideOutput(JSON.stringify(guide), plan);
    expect(parsed.units[0]?.sourceUnitIds).toEqual([source.id, 'second']);
    expect(plan.units).toHaveLength(2);
    expect(plan.units[0]?.chunks).toHaveLength(1);
    first.dependsOn = ['second'];
    expect(() => parseReviewGuideOutput(JSON.stringify(guide), plan)).toThrow('earlier layers');
    first.dependsOn = [];
    first.sourceUnitIds = [source.id, source.id];
    expect(() => parseReviewGuideOutput(JSON.stringify(guide), plan)).toThrow('exactly once');
    first.sourceUnitIds = [source.id];
    first.files.pop();
    expect(() => parseReviewGuideOutput(JSON.stringify(guide), plan)).toThrow('every existing review group');
  });

  it('accepts context endpoints around changes, but rejects ungrounded summary ranges', () => {
    const plan = reviewPlan();
    const guide = validGuide(plan);
    const summary = { path: 'src/client.ts', line: 1, endLine: 2, side: 'left' as const, complexity: 'low' as const, body: 'Replace the unbounded connection call.' };
    guide.units[0]!.summaries = [summary];
    expect(parseReviewGuideOutput(JSON.stringify(guide), plan).units[0]?.summaries).toEqual([summary]);
    for (const invalid of [
      { ...summary, endLine: 1 }, { ...summary, endLine: 99 }, { ...summary, path: 'secret.ts' },
      { ...summary, side: 'unknown' }, { ...summary, line: -1 }, { ...summary, line: '2' },
      { ...summary, line: 2.5 }, { ...summary, endLine: 0 }
    ]) {
      const output = { ...guide, units: [{ ...guide.units[0], summaries: [invalid] }] };
      expect(() => parseReviewGuideOutput(JSON.stringify(output), plan)).toThrow('Invalid summary range');
    }
  });

  it('accepts a visible context line as a file starting point without allowing invented lines', () => {
    const plan = reviewPlan();
    const guide = validGuide(plan);
    guide.units[0]!.files[0]!.line = 1;
    expect(parseReviewGuideOutput(JSON.stringify(guide), plan).units[0]?.files[0]?.line).toBe(1);
    guide.units[0]!.files[0]!.line = 99;
    expect(() => parseReviewGuideOutput(JSON.stringify(guide), plan)).toThrow('Invalid file starting line src/client.ts:99');
  });

  it('supplies explicit left and right coordinates instead of requiring diff line counting', () => {
    const prompt = buildReviewGuidePrompt(reviewPlan());
    expect(prompt).toContain('H1 L1 R1 | export function connect() {');
    expect(prompt).toContain('H1 L2 R- |-  return open();');
    expect(prompt).toContain('H1 L- R2 |+  return open(timeout);');
    expect(prompt).toContain('Visible unchanged context');
  });

  it('corrects invalid locations once and preserves explanations in the completed brief', async () => {
    const plan = reviewPlan();
    const corrected = validGuide(plan);
    corrected.units[0]!.summaries = [{ path: 'src/client.ts', line: 1, endLine: 2, side: 'right', complexity: 'medium', body: 'Bound the connection attempt with the requested timeout.' }];
    const invalid = structuredClone(corrected);
    invalid.units[0]!.summaries![0]!.endLine = 99;
    const run = vi.spyOn(piHarness, 'runPiPrompt')
      .mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(corrected));
    const manager = new ReviewGuideManager(new PiReviewGuideEngine());
    manager.start(plan);
    await vi.waitFor(() => expect(manager.getState(plan.repoPath, plan.sourceFingerprint)).toMatchObject({
      status: 'ready', guide: { units: [{ summaries: corrected.units[0]!.summaries }] }
    }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0].prompt).toContain('Invalid summary range src/client.ts:1-99');
    expect(run.mock.calls[1]![0].prompt).toContain('Bound the connection attempt');
    expect(run.mock.calls[1]![0].timeoutMs).toBeLessThanOrEqual(run.mock.calls[0]![0].timeoutMs);
  });

  it('does not turn repeated invalid output into a ready brief with missing explanations', async () => {
    const plan = reviewPlan();
    const guide = validGuide(plan);
    guide.units[0]!.files[0]!.line = 99;
    const run = vi.spyOn(piHarness, 'runPiPrompt').mockResolvedValue(JSON.stringify(guide));
    await expect(new PiReviewGuideEngine().generate(plan)).rejects.toThrow('Invalid file starting line');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry provider failures as output corrections', async () => {
    const run = vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('Provider unavailable.'));
    await expect(new PiReviewGuideEngine().generate(reviewPlan())).rejects.toThrow('Provider unavailable.');
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not start a correction after the generation deadline', async () => {
    const plan = reviewPlan();
    const run = vi.spyOn(piHarness, 'runPiPrompt').mockResolvedValue('invalid JSON');
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(600_000);
    await expect(new PiReviewGuideEngine().generate(plan)).rejects.toThrow('not valid JSON');
    expect(run).toHaveBeenCalledOnce();
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
