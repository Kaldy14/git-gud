import { useEffect, useState } from 'react';
import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  preloadHighlighter
} from '@pierre/diffs';

import { getDiffThemeName } from '@renderer/components/diff/diffTheme';
import type { DiffSyntaxTheme } from '@shared/types';

const loadedHighlighters = new Set<string>();
const highlighterLoads = new Map<string, Promise<void>>();

export function preloadDiffSyntaxHighlighter(filePath: string, syntaxTheme: DiffSyntaxTheme): Promise<void> {
  const language = getFiletypeFromFileName(filePath);
  const theme = getDiffThemeName(syntaxTheme);
  const highlighterKey = `${theme}:${language}`;
  const existingLoad = highlighterLoads.get(highlighterKey);

  if (existingLoad) {
    return existingLoad;
  }

  const load = preloadHighlighter(getHighlighterOptions(language, { theme }))
    .then(() => {
      loadedHighlighters.add(highlighterKey);
    })
    .catch((error: unknown) => {
      highlighterLoads.delete(highlighterKey);
      console.error(`Failed to preload ${language} diff syntax highlighting for ${syntaxTheme}.`, error);
    });

  highlighterLoads.set(highlighterKey, load);
  return load;
}

export function useDiffSyntaxHighlighter(filePath: string | undefined, syntaxTheme: DiffSyntaxTheme): boolean {
  const language = filePath ? getFiletypeFromFileName(filePath) : undefined;
  const theme = getDiffThemeName(syntaxTheme);
  const highlighterKey = language ? `${theme}:${language}` : undefined;
  const [completedHighlighter, setCompletedHighlighter] = useState<string>();
  const isReady =
    highlighterKey === undefined ||
    loadedHighlighters.has(highlighterKey) ||
    completedHighlighter === highlighterKey;

  useEffect(() => {
    if (!filePath || !highlighterKey || isReady) {
      return;
    }

    let isCurrent = true;

    void preloadDiffSyntaxHighlighter(filePath, syntaxTheme).finally(() => {
      if (isCurrent) {
        setCompletedHighlighter(highlighterKey);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [filePath, highlighterKey, isReady, syntaxTheme]);

  return isReady;
}
