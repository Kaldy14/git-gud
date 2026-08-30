import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AgentNoteAnnotation, ReviewGuideFailureMessage } from './ReviewView';

describe('ReviewView AI guide failures', () => {
  it('renders the error persistently instead of hiding it in a hover title', () => {
    const markup = renderToStaticMarkup(
      <ReviewGuideFailureMessage errorMessage="Pi could not be found in the app environment." />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('AI guide failed');
    expect(markup).toContain('Pi could not be found in the app environment.');
  });
});

describe('ReviewView Agent Notes', () => {
  const note = {
    id: 'transaction-contract',
    path: 'src/main/git/exec.ts',
    line: 143,
    anchor: 'if (this.isInTransaction(options.cwd)) {',
    summary: 'Keep this check before spawning Git.',
    detail: 'Moving it lower can make a nested operation wait on its own lock.',
    author: 'Codex',
    createdAt: '2026-08-30T10:00:00.000Z'
  };

  it('renders the concise note and an explicit hide action inline', () => {
    const markup = renderToStaticMarkup(
      <AgentNoteAnnotation note={note} hidden={false} onHiddenChange={() => undefined} />
    );

    expect(markup).toContain('Agent note');
    expect(markup).toContain('Keep this check before spawning Git.');
    expect(markup).toContain('Hide note');
    expect(markup).toContain('src/main/git/exec.ts:143');
  });

  it('keeps a compact reopen control after the note is hidden', () => {
    const markup = renderToStaticMarkup(
      <AgentNoteAnnotation note={note} hidden onHiddenChange={() => undefined} />
    );

    expect(markup).toContain('agent-note-collapsed');
    expect(markup).toContain('Show Agent Note');
    expect(markup).not.toContain(note.detail);
  });
});
