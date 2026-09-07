import { useMemo, useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

import type { GitReviewGuide, GitReviewGuideState, GitReviewPlan } from '@shared/types';
import { ReviewView } from './ReviewView';
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
  const [mode, setMode] = useState<Mode>('sample');
  const [session, setSession] = useState(0);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const query = useQuery({
    queryKey: ['review-guide-playground', repoPath],
    queryFn: async () => {
      const workspace = await window.api.openRepositoryAtPath(repoPath);
      const tab = workspace.tabs.find((item) => item.id === workspace.activeTabId);
      if (!tab) throw new Error('Unable to open the fixture repository.');
      return window.api.getReviewPlan(tab.path, target);
    }
  });
  const plan = query.data;
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
      <strong>AI guide test</strong><span>Local fixture · {mode === 'live' ? 'Live generation' : 'Sample AI output'}</span>
      <select aria-label="Guide test mode" value={mode} onChange={(event) => {
        const value = event.target.value;
        if (value === 'sample' || value === 'failure' || value === 'live') { setMode(value); setSession((n) => n + 1); }
      }}><option value="sample">Sample guide</option><option value="failure">Fail once, then retry</option><option value="live">Live AI generation</option></select>
      <button type="button" className="btn-subtle btn-compact" onClick={() => { setSession((n) => n + 1); void query.refetch(); }}>Reload changes</button>
    </header>
    {query.error ? <p role="alert">{query.error.message}</p> : plan && provider ? <ReviewView
      key={`${session}:${mode}`}
      repoPath={plan.repoPath} target={target} plan={plan} reviewGuideProvider={provider}
      reviewProgressKey={`guide-playground:${session}:${mode}`} initialPreferences={preferences}
      layout="pull-request" diffStyle={diffStyle} diffSyntaxTheme="git-gud-dark"
      onSetDiffStyle={setDiffStyle} onClose={() => { window.location.search = ''; }} showCloseButton={false}
    /> : <p>Loading the fixture…</p>}
  </div>;
}

function sampleGuide(plan: GitReviewPlan): GitReviewGuide {
  return {
    sourceFingerprint: plan.sourceFingerprint, targetKey: plan.targetKey,
    generatedAt: new Date().toISOString(), summary: 'Keeps search responses in order and updates status wording.',
    units: plan.units.map((unit) => {
      const paths = [...new Set(unit.chunks.map((chunk) => chunk.path))];
      const focus = paths.some((path) => path.endsWith('search-client.ts'));
      const review = paths.some((path) => path.endsWith('.test.ts') || path.includes('status'));
      return {
        unitId: unit.id, priority: focus ? 'focus' : review ? 'review' : 'skim',
        why: focus ? 'A slow response could replace results for the newest search.' : review ? 'Loading should stay active until the latest request finishes.' : '',
        what: focus ? 'Start with the request guard after await.' : '',
        files: paths.map((path) => ({
          path, priority: path.endsWith('search-client.ts') ? 'focus' : path.endsWith('.json') || path.endsWith('.md') ? 'skim' : 'review',
          reason: path.endsWith('search-client.ts') ? 'Controls which request may update results.' : path.endsWith('.json') || path.endsWith('.md') ? 'Wording changes only.' : 'Read the state transition.',
          ...(path.endsWith('search-client.ts') ? { line: 9 } : {})
        })),
        inlineNotes: focus ? [{ path: paths.find((path) => path.endsWith('search-client.ts'))!, line: 9,
          body: 'The check runs after the request resolves, when responses can arrive out of order.' }] : []
      };
    })
  };
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
