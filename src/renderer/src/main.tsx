import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions
} from '@pierre/diffs/react';

import { getDiffThemeName } from '@renderer/components/diff/diffTheme';
import { ChangelogDialog } from '@renderer/components/releases/ChangelogDialog';
import { createDefaultAppSettings } from '@shared/settings';

import { AppRouter } from './router';
import './styles/main.css';
import './styles/pr-workspace.css';

const diffWorkerPoolOptions: WorkerPoolOptions = {
  workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
  poolSize: Math.min(Math.max(Math.floor((navigator.hardwareConcurrency ?? 4) / 2), 1), 2),
  totalASTLRUCacheSize: 32
};
const diffHighlighterOptions: WorkerInitializationRenderOptions = {
  theme: getDiffThemeName(createDefaultAppSettings().diffSyntaxTheme),
  useTokenTransformer: true
};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found.');
}

const guideTestRepo = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('guide-test-repo')
  : null;
const GuidePlayground = import.meta.env.DEV && guideTestRepo
  ? lazy(() => import('./components/review/ReviewGuidePlayground'))
  : undefined;

createRoot(rootElement).render(
  <React.StrictMode>
    <WorkerPoolContextProvider poolOptions={diffWorkerPoolOptions} highlighterOptions={diffHighlighterOptions}>
      {GuidePlayground && guideTestRepo
        ? <Suspense fallback={<p>Loading guide test…</p>}><GuidePlayground repoPath={guideTestRepo} /></Suspense>
        : <AppRouter />}
      <ChangelogDialog releaseNotes={import.meta.env.VITE_RELEASE_NOTES} />
    </WorkerPoolContextProvider>
  </React.StrictMode>
);
