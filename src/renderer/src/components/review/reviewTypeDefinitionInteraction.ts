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

type DefinitionModifier = Pick<
  MouseEvent,
  'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

type DefinitionToken = {
  lineCharStart: number;
  tokenElement: HTMLElement;
  tokenText: string;
};

export function isReviewTypeDefinitionGesture(event: DefinitionGesture): boolean {
  return event.button === 0 &&
    isReviewTypeDefinitionModifier(event);
}

export function isReviewTypeDefinitionModifier(event: DefinitionModifier): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

export const REVIEW_TYPE_DEFINITION_HOVER_CSS = `
  [data-review-type-definition-link='true'] {
    cursor: pointer;
    font-weight: 700;
    text-decoration-line: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
`;

export function setReviewTypeDefinitionHoverAvailable(
  tokenElement: HTMLElement,
  isAvailable: boolean
): void {
  if (isAvailable) {
    tokenElement.setAttribute('data-review-type-definition-link', 'true');
    return;
  }

  tokenElement.removeAttribute('data-review-type-definition-link');
}

export function reviewTypeDefinitionHoverCacheKey(
  request: Pick<GitReviewTypeDefinitionInput, 'character' | 'filePath' | 'line' | 'side' | 'source'>
): string {
  return [request.source, request.filePath, request.side, request.line, request.character].join(':');
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
  return context.language === 'typescript' || context.language === 'tsx' ||
    /\.(?:[cm]?ts|tsx)$/i.test(context.path);
}

function clampTokenOffset(offset: number, tokenText: string): number {
  return Math.max(0, Math.min(offset, Math.max(0, tokenText.length - 1)));
}

export function createReviewTypeDefinitionInput(
  clickedPath: string,
  source: GitReviewTypeDefinitionInput['source'],
  side: GitReviewTypeDefinitionInput['side'],
  line: number,
  character: number,
  target: GitReviewTarget,
  sourceFingerprint: string,
  contexts: readonly GitReviewFileContext[]
): GitReviewTypeDefinitionInput | undefined {
  const clickedContext = contexts.find((context) =>
    context.path === clickedPath && context.source === source
  );

  if (!clickedContext || !isTypeScriptReviewContext({
    path: clickedContext.path,
    language: clickedContext.syntax?.language
  })) {
    return undefined;
  }

  return {
    target,
    sourceFingerprint,
    source,
    filePath: side === 'old' ? clickedContext.originalPath ?? clickedContext.path : clickedContext.path,
    side,
    line,
    character
  };
}
