import { useMemo, useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

import type { GitReviewGuide, GitReviewGuideState, GitReviewPlan, GitReviewGuideSummary } from '@shared/types';
import { ReviewView, type ReviewLineComment } from './ReviewView';
import { DEFAULT_REVIEW_PREFERENCES } from './reviewFilters';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const target = { kind: 'wip', scope: 'unstaged' } as const;
const preferences = { ...DEFAULT_REVIEW_PREFERENCES, skipTests: false };

type Mode = 'sample' | 'failure' | 'live';

// Development-only, using the real review UI and Git plan from a disposable repository.
export default function ReviewGuidePlayground({ repoPath }: { repoPath: string }): ReactElement {
  return <QueryClientProvider client={queryClient}><Playground repoPath={repoPath} /></QueryClientProvider>;
}

function Playground({ repoPath }: { repoPath: string }): ReactElement {
  const [guideHeaderTarget, setGuideHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>('sample');
  const [session, setSession] = useState(0);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const query = useQuery({
    queryKey: ['review-guide-playground', repoPath],
    // Keep the sample provider stable when the Electron window regains focus.
    staleTime: Infinity,
    queryFn: async () => {
      const workspace = await window.api.openRepositoryAtPath(repoPath);
      const tab = workspace.tabs.find((item) => item.id === workspace.activeTabId);
      if (!tab) throw new Error('Unable to open the fixture repository.');
      return window.api.getReviewPlan(tab.path, target);
    }
  });
  const plan = query.data;
  const [drafts, setDrafts] = useState<ReviewLineComment[]>([]);
  const comments = useMemo(() => plan ? sampleComments(plan) : [], [plan]);
  const provider = useMemo(() => {
    if (!plan) return undefined;
    if (mode === 'live') return {
      getState: (fingerprint: string) => window.api.getReviewGuideState(plan.repoPath, fingerprint),
      start: (fingerprint: string) => window.api.startReviewGuide(plan.repoPath, target, fingerprint)
    };
    return createSampleProvider(plan, mode);
  }, [mode, plan]);

  return <div className="review-guide-playground">
    <header>
      <strong>AI brief test</strong><span>Local fixture and review comments · {mode === 'live' ? 'Live generation' : 'Sample AI output'}</span>
      <select aria-label="Guide test mode" value={mode} onChange={(event) => {
        const value = event.target.value;
        if (value === 'sample' || value === 'failure' || value === 'live') { setMode(value); setSession((n) => n + 1); }
      }}><option value="sample">Sample guide</option><option value="failure">Fail once, then retry</option><option value="live">Live AI generation</option></select>
      <button type="button" className="btn-subtle btn-compact" onClick={() => { setSession((n) => n + 1); void query.refetch(); }}>Reload changes</button>
      <div ref={setGuideHeaderTarget} className="pr-review-guide-slot" />
    </header>
    {query.error ? <p role="alert">{query.error.message}</p> : plan && provider ? <ReviewView
      key={`${session}:${mode}`}
      repoPath={plan.repoPath} target={target} plan={plan} reviewGuideProvider={provider}
      guideHeaderTarget={guideHeaderTarget}
      lineComments={[...comments, ...drafts]}
      onAddDraftLineComment={async (input) => {
        const id = crypto.randomUUID();
        setDrafts((current) => [...current, { ...input, id, author: 'You', createdAt: new Date().toISOString(), subjectType: 'line', isDraft: true }]);
      }}
      onAddDraftFileComment={async (input) => {
        const id = crypto.randomUUID();
        setDrafts((current) => [...current, { ...input, id, author: 'You', createdAt: new Date().toISOString(), subjectType: 'file', isDraft: true }]);
      }}
      onRemoveDraftComment={(id) => setDrafts((current) => current.filter((draft) => draft.id !== id))}
      reviewProgressKey={`guide-playground:${session}:${mode}`} initialPreferences={preferences}
      layout="pull-request" diffStyle={diffStyle} diffSyntaxTheme="git-gud-dark"
      onSetDiffStyle={setDiffStyle} onClose={() => { window.location.search = ''; }} showCloseButton={false}
    /> : <p>Loading the fixture…</p>}
  </div>;
}

function sampleGuide(plan: GitReviewPlan): GitReviewGuide {
  const groups = [
    plan.units.filter((unit) => unit.chunks.some((chunk) => chunk.path.endsWith('search-client.ts'))),
    plan.units.filter((unit) => !unit.chunks.some((chunk) => chunk.path.endsWith('search-client.ts')) && unit.chunks.some((chunk) => chunk.path.includes('/status/'))),
    plan.units.filter((unit) => !unit.chunks.some((chunk) => chunk.path.endsWith('search-client.ts') || chunk.path.includes('/status/')))
  ].filter((group) => group.length > 0);
  return {
    sourceFingerprint: plan.sourceFingerprint, targetKey: plan.targetKey, generatedAt: new Date().toISOString(),
    summary: 'Keep the latest search result, track pending requests, and clarify search labels.',
    units: groups.map((sources) => {
      const chunks = sources.flatMap((unit) => unit.chunks);
      const paths = [...new Set(chunks.map((chunk) => chunk.path))];
      const focus = paths.some((path) => path.endsWith('search-client.ts'));
      const status = paths.some((path) => path.includes('/status/'));
      const summaries: GitReviewGuideSummary[] = [];
      for (const chunk of chunks) {
        let line = 0;
        for (const text of chunk.patch.split('\n')) {
          const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
          if (hunk) { line = Number(hunk[1]); continue; }
          if (!line || text.startsWith('-') || text.startsWith('\\')) continue;
          if (text.startsWith('+')) {
            const guard = text.includes('request !== latestRequest');
            const error = text.includes('!response.ok');
            if (guard || error || text.includes('.trim()') || !summaries.some((summary) => summary.path === chunk.path)) {
              summaries.push({ path: chunk.path, line, endLine: line, side: 'right',
                complexity: guard ? 'high' : error || status ? 'medium' : 'low',
                body: guard ? 'A slow response cannot overwrite newer results. The request guard runs after the response arrives, when completion order can differ from request order.' :
                  error ? 'Reject unsuccessful HTTP responses before parsing their body. A failed response never replaces the current results.' :
                  status ? 'Loading stays active while any request is pending, including overlapping searches.' :
                  chunk.path.endsWith('search-client.ts') ? 'Trim the search term before encoding it into the request URL.' : 'Update the wording without changing the keyboard action.' });
            }
          }
          line++;
        }
      }
      return {
        unitId: sources[0]!.id, sourceUnitIds: sources.map((unit) => unit.id),
        title: focus ? 'Keep the latest search result' : status ? 'Track overlapping requests' : 'Clarify labels and keyboard help',
        dependsOn: status && groups[0] !== sources ? [groups[0]![0]!.id] : [],
        priority: focus ? 'focus' : status ? 'review' : 'skim',
        why: focus ? 'Search responses can finish out of order. Only the newest request may update results.' : status ? 'The loading indicator must include every pending request.' : 'Keep the search label and keyboard help consistent.',
        what: '', summaries,
        files: paths.map((path) => ({ path, priority: path.endsWith('search-client.ts') ? 'focus' : path.includes('/status/') ? 'review' : 'skim', reason: 'Read the changed behavior.',
          line: summaries.find((summary) => summary.path === path)?.line })), inlineNotes: []
      };
    })
  };
}

function sampleComments(plan: GitReviewPlan): ReviewLineComment[] {
  const guide = sampleGuide(plan);
  const summary = guide.units.flatMap((unit) => unit.summaries ?? []).find((item) => item.complexity === 'high');
  if (!summary) return [];
  const root: ReviewLineComment = { id: 42, author: 'coderabbitai[bot]', createdAt: '2026-09-08T10:00:00Z',
    body: '🟡 Minor\n\n**Cover responses arriving out of order.**\n\nAdd a regression case where the first search resolves after the second. The displayed results should still belong to the newest request.',
    path: summary.path, subjectType: 'line', line: summary.line, side: 'right', isResolved: false, isOutdated: false };
  return [root, { ...root, id: 43, inReplyToId: root.id, author: 'teammate', body: 'I will add the regression case.' },
    { ...root, id: 44, isResolved: true, body: '🔴 Critical\n\nA resolved sample finding should not be counted.' },
    { ...root, id: 45, isOutdated: true, body: '🟠 Major\n\nAn outdated sample finding should not be counted.' }];
}

function createSampleProvider(plan: GitReviewPlan, mode: Mode) {
    let startedAt = 0;
    let attempt = 0;
    const guide = sampleGuide(plan);
    const getState = async (): Promise<GitReviewGuideState> => {
      const sourceFingerprint = plan.sourceFingerprint;
      if (!startedAt) return { status: 'idle', sourceFingerprint };
      if (Date.now() - startedAt < 2200) return { status: 'running', sourceFingerprint, startedAt: new Date(startedAt).toISOString() };
      if (mode === 'failure' && attempt === 1) return { status: 'failed', sourceFingerprint, errorMessage: 'Simulated unavailable provider. Retry will succeed.' };
      return { status: 'ready', sourceFingerprint, guide: { ...guide, generatedAt: new Date(startedAt).toISOString() } };
    };
    return { getState, start: async () => { startedAt = Date.now(); attempt++; return getState(); } };
}
