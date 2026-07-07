import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions
} from '@pierre/diffs/react';

import { AppRouter } from './router';
import './styles/main.css';

const diffWorkerPoolOptions: WorkerPoolOptions = {
  workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
  poolSize: Math.min(Math.max(navigator.hardwareConcurrency ?? 4, 2), 4)
};
const diffHighlighterOptions: WorkerInitializationRenderOptions = {};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <WorkerPoolContextProvider poolOptions={diffWorkerPoolOptions} highlighterOptions={diffHighlighterOptions}>
      <AppRouter />
    </WorkerPoolContextProvider>
  </React.StrictMode>
);
