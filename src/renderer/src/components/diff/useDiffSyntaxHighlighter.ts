import { useEffect, useState } from 'react';
import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  preloadHighlighter
} from '@pierre/diffs';

const loadedLanguages = new Set<string>();
const languageLoads = new Map<string, Promise<void>>();

export function preloadDiffSyntaxHighlighter(filePath: string): Promise<void> {
  const language = getFiletypeFromFileName(filePath);
  const existingLoad = languageLoads.get(language);

  if (existingLoad) {
    return existingLoad;
  }

  const load = preloadHighlighter(getHighlighterOptions(language, {}))
    .then(() => {
      loadedLanguages.add(language);
    })
    .catch((error: unknown) => {
      languageLoads.delete(language);
      console.error(`Failed to preload ${language} diff syntax highlighting.`, error);
    });

  languageLoads.set(language, load);
  return load;
}

export function useDiffSyntaxHighlighter(filePath: string | undefined): boolean {
  const language = filePath ? getFiletypeFromFileName(filePath) : undefined;
  const [completedLanguage, setCompletedLanguage] = useState<string>();
  const isReady = language === undefined || loadedLanguages.has(language) || completedLanguage === language;

  useEffect(() => {
    if (!filePath || !language || isReady) {
      return;
    }

    let isCurrent = true;

    void preloadDiffSyntaxHighlighter(filePath).finally(() => {
      if (isCurrent) {
        setCompletedLanguage(language);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [filePath, isReady, language]);

  return isReady;
}
