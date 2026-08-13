import type {
  GitReviewFileContext,
  GitReviewSyntaxContext,
  GitReviewTypeDefinitionInput,
  GitReviewTarget
} from '@shared/types';

type DefinitionGesture = Pick<
  MouseEvent,
  'altKey' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

type DefinitionToken = {
  lineCharStart: number;
  tokenElement: HTMLElement;
  tokenText: string;
};

export function isReviewTypeDefinitionGesture(event: DefinitionGesture): boolean {
  return event.button === 0 &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey;
}

export function getReviewTypeDefinitionCharacter(
  token: DefinitionToken,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>
): number {
  const root = token.tokenElement.getRootNode();
  const caret = document.caretPositionFromPoint(
    event.clientX,
    event.clientY,
    root instanceof ShadowRoot ? { shadowRoots: [root] } : undefined
  );

  if (caret && token.tokenElement.contains(caret.offsetNode)) {
    const range = document.createRange();
    range.setStart(token.tokenElement, 0);
    range.setEnd(caret.offsetNode, caret.offset);
    return token.lineCharStart + clampTokenOffset(range.toString().length, token.tokenText);
  }

  const bounds = token.tokenElement.getBoundingClientRect();
  const fraction = bounds.width > 0
    ? (event.clientX - bounds.left) / bounds.width
    : 0;
  return token.lineCharStart + clampTokenOffset(
    Math.floor(fraction * token.tokenText.length),
    token.tokenText
  );
}

export function isTypeScriptReviewContext(
  context: Pick<GitReviewFileContext, 'path'> & {
    language?: GitReviewSyntaxContext['language'];
  }
): boolean {
  return context.language === 'typescript' || context.language === 'tsx';
}

function clampTokenOffset(offset: number, tokenText: string): number {
  return Math.max(0, Math.min(offset, Math.max(0, tokenText.length - 1)));
}

export function createReviewTypeDefinitionInput(
  clickedPath: string,
  side: GitReviewTypeDefinitionInput['side'],
  line: number,
  character: number,
  target: GitReviewTarget,
  sourceFingerprint: string,
  contexts: readonly GitReviewFileContext[]
): GitReviewTypeDefinitionInput | undefined {
  const clickedContext = contexts.find((context) => context.path === clickedPath);

  if (!clickedContext || !isTypeScriptReviewContext({
    path: clickedContext.path,
    language: clickedContext.syntax?.language
  })) {
    return undefined;
  }

  return {
    target,
    sourceFingerprint,
    filePath: side === 'old' ? clickedContext.originalPath ?? clickedContext.path : clickedContext.path,
    side,
    line,
    character
  };
}
