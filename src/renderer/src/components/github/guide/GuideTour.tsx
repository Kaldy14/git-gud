import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, ChevronUp, FileText, ShieldCheck } from 'lucide-react';

import {
  letterTourNotes,
  pullRequestTourExcerptPatch,
  pullRequestTourHunks,
  type PullRequestTour,
  type PullRequestTourAttentionKind,
  type PullRequestTourStop
} from '@shared/pullRequestTour';
import type { CodeReference } from '@shared/codeReference';
import type { DiffSyntaxTheme, GitReviewPlan } from '@shared/types';
import { createDiffOptionsBase, type DiffStyle } from '../../commit/fileDetailUtils';
import { ReviewCommentBody } from '../../review/ReviewCommentBody';
import { PullRequestLineStats } from '../PullRequestLineStats';
import { GuideExcerpt, GuideMarker, type GuideCodeLocation } from './GuideExcerpt';

// The call's run-in head on the stop; the rail uses the one-word kind.
const CALL_LABELS: Record<PullRequestTourAttentionKind, string> = {
  tradeoff: 'Tradeoff to weigh.',
  contract: 'Contract to check.',
  product: 'Product call.',
  risk: 'Risk to judge.',
  accessibility: 'Accessibility call.'
};
const RAIL_LABELS: Record<PullRequestTourAttentionKind, string> = {
  tradeoff: 'Tradeoff',
  contract: 'Contract',
  product: 'Product',
  risk: 'Risk',
  accessibility: 'Accessibility'
};

// Note keys link both ways: from the marker row inside an excerpt to its note, and back.
// The notes render twice (aside and inline) by width, so target whichever copy is visible.
function revealGuideReference(selector: string): void {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(selector),
    ...[...document.querySelectorAll('.pr-guide-excerpt .gg-diff')].flatMap((diff) =>
      [...(diff.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])])
  ];
  const target = candidates.find((element) => element.getClientRects().length > 0);
  if (!target) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
  target.removeAttribute('data-flash');
  // Restart the one-shot highlight even when the same reference is followed twice.
  void target.offsetWidth;
  target.setAttribute('data-flash', '');
  window.setTimeout(() => target.removeAttribute('data-flash'), 800);
}

type OpenFile = (location: GuideCodeLocation) => void;

// Guide prose renders inline code that names a changed file as a file link (as T3 Code does),
// opening it in the Code tab. Other inline code stays code.
const GuideProseContext = createContext<{
  resolve: (reference: CodeReference) => CodeReference | undefined;
  open: (reference: CodeReference) => void;
} | undefined>(undefined);

function GuideProse({ body }: { body: string }): ReactElement {
  const context = useContext(GuideProseContext);
  return (
    <ReviewCommentBody
      body={body}
      compact
      onOpenFile={context?.open}
      resolveCodeReference={context?.resolve}
      fileLinkTarget="the Code tab"
    />
  );
}

// A full changed path, or a unique path suffix such as a bare file name.
function resolveChangedFile(paths: readonly string[], reference: CodeReference): CodeReference | undefined {
  if (paths.includes(reference.path)) return reference;
  const matches = paths.filter((path) => path.endsWith(`/${reference.path}`));
  return matches.length === 1 ? { ...reference, path: matches[0]! } : undefined;
}
type Progress = { position: number; seen: number[] };

function loadProgress(key: string): Progress {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<Progress> | null;
    return {
      position: typeof value?.position === 'number' ? value.position : 0,
      seen: Array.isArray(value?.seen) ? value.seen.filter((item): item is number => typeof item === 'number') : []
    };
  } catch {
    return { position: 0, seen: [] };
  }
}

function hunkStart(patch: string): number {
  return Number(patch.match(/^@@ -\d+(?:,\d+)? \+(\d+)/mu)?.[1] ?? 0);
}

// Titles and one-line notes are plain text: drop the backticks around inline `code`.
function plainProse(text: string): string {
  return text.replace(/`([^`]+)`/gu, '$1');
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function GuideTour({ tour, plan, progressKey, banner, active, diffStyle, diffSyntaxTheme, onOpenFile, onFinish, stopRequest, stale = false }: {
  tour: PullRequestTour;
  plan: GitReviewPlan;
  progressKey: string;
  banner: ReactNode;
  active: boolean;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onOpenFile: OpenFile;
  onFinish: () => void;
  stopRequest?: { index: number; signal: number };
  // Written for an older head: its line coordinates may now point at different code.
  stale?: boolean;
}): ReactElement {
  const [progress, setProgressState] = useState(() => loadProgress(progressKey));
  const [railOpen, setRailOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const hunks = useMemo(() => pullRequestTourHunks(plan), [plan]);
  const stopCount = tour.stops.length;
  const position = Math.max(0, Math.min(progress.position, stopCount - 1));
  const stop = tour.stops[position];
  const seen = new Set(progress.seen);

  function setProgress(next: Progress): void {
    setProgressState(next);
    try { window.localStorage.setItem(progressKey, JSON.stringify(next)); } catch { /* progress is a convenience */ }
  }

  function goTo(next: number): void {
    setProgress({ position: next, seen: next > position ? [...new Set([...progress.seen, position])] : progress.seen });
    setRailOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
    focusHeading.current = true;
  }

  // The stop remounts on navigation; move focus to its title so keyboard users keep their place.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus({ preventScroll: true });
  }, [position]);
  const step = (delta: 1 | -1) => goTo(Math.max(0, Math.min(position + delta, stopCount - 1)));
  const stepFromKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if ((event.key !== 'j' && event.key !== 'k') || isEditable(event.target)) return;
    // Single-key shortcuts only apply inside the Guide pane (or with nothing focused),
    // so J/K pressed in the header, menus, or the review panel stay untouched (WCAG 2.1.4).
    const pane = scrollRef.current?.closest('[role="tabpanel"]') ?? scrollRef.current;
    if (event.target !== document.body && !(event.target instanceof Node && pane?.contains(event.target))) return;
    event.preventDefault();
    step(event.key === 'j' ? 1 : -1);
  });

  // A note in Code links back to its stop; honour each request once.
  const handledStopSignal = useRef(stopRequest?.signal);
  const openRequestedStop = useEffectEvent((request: { index: number; signal: number }) => {
    if (handledStopSignal.current === request.signal) return;
    handledStopSignal.current = request.signal;
    if (request.index >= 0 && request.index < stopCount) goTo(request.index);
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot reaction to an outside request
    if (stopRequest) openRequestedStop(stopRequest);
  }, [stopRequest]);

  // J/K step through stops while the Guide tab is visible, as in T3 Code.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => stepFromKey(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const rail = <GuideRail stops={tour.stops} position={position} seen={seen} onSelect={goTo} />;
  const changedPaths = useMemo(() => [...new Set(plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.path)))], [plan]);
  const prose = {
    resolve: (reference: CodeReference) => resolveChangedFile(changedPaths, reference),
    open: (reference: CodeReference) => onOpenFile({ path: reference.path, line: reference.line, side: 'right' })
  };

  return (
    <GuideProseContext value={prose}>
    <div ref={scrollRef} className="pr-guide-scroll">
      <div className="pr-guide-layout">
        <aside className="pr-guide-rail-column">{rail}</aside>
        <main className="pr-guide-main">
          {banner}
          {stop ? (
            <GuideStop
              key={position}
              headingRef={headingRef}
              stop={stop}
              index={position}
              stopCount={stopCount}
              nextTitle={tour.stops[position + 1]?.title}
              railOpen={railOpen}
              onRailOpenChange={setRailOpen}
              rail={rail}
              plan={plan}
              hunks={hunks}
              stale={stale}
              diffStyle={diffStyle}
              diffSyntaxTheme={diffSyntaxTheme}
              onStep={step}
              onOpenFile={onOpenFile}
              onFinish={() => {
                setProgress({ position, seen: [...new Set([...progress.seen, position])] });
                onFinish();
              }}
            />
          ) : <p className="pr-guide-muted">This change has no files to tour.</p>}
        </main>
      </div>
    </div>
    </GuideProseContext>
  );
}

function GuideRail({ stops, position, seen, onSelect }: {
  stops: readonly PullRequestTourStop[];
  position: number;
  seen: ReadonlySet<number>;
  onSelect: (position: number) => void;
}): ReactElement {
  return (
    // The rail is drawn as a lane, like the commit graph: read stretches are teal, the stop you
    // are on is a ring, and what is ahead stays slate.
    <nav className="pr-guide-rail" aria-label="Review tour">
      <p className="pr-guide-rail-count">{seen.size} of {stops.length} read</p>
      <ol>
        {stops.map((stop, index) => (
          <li key={index} data-read={seen.has(index)} data-current={index === position}>
            <button
              type="button"
              aria-current={index === position ? 'step' : undefined}
              aria-label={`Stop ${index + 1} of ${stops.length}: ${plainProse(stop.title)}${seen.has(index) ? ', read' : ''}`}
              onClick={() => onSelect(index)}
            >
              <span className="pr-guide-rail-node" aria-hidden="true" />
              <span className="pr-guide-rail-text" aria-hidden="true">
                <span className="pr-guide-rail-title">{plainProse(stop.title)}</span>
                {stop.attention ? <span className="pr-guide-rail-call">{RAIL_LABELS[stop.attention.kind]}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function GuideStop({ stale, headingRef, stop, index, stopCount, nextTitle, railOpen, onRailOpenChange, rail, plan, hunks, diffStyle, diffSyntaxTheme, onStep, onOpenFile, onFinish }: {
  stale: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  stop: PullRequestTourStop;
  index: number;
  stopCount: number;
  nextTitle?: string;
  railOpen: boolean;
  onRailOpenChange: (open: boolean) => void;
  rail: ReactNode;
  plan: GitReviewPlan;
  hunks: ReturnType<typeof pullRequestTourHunks>;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onStep: (delta: 1 | -1) => void;
  onOpenFile: OpenFile;
  onFinish: () => void;
}): ReactElement {
  const lettered = letterTourNotes(stop);
  const excerptPaths = new Set(stop.excerpts.map((excerpt) => excerpt.path));
  const otherFiles = stop.files.filter((file) => !excerptPaths.has(file.path));

  return (
    <div className="pr-guide-stop" data-has-notes={lettered.length > 0}>
      <article>
        <header className="pr-guide-stop-header">
          <button type="button" className="btn-subtle btn-compact pr-guide-rail-toggle" aria-expanded={railOpen} onClick={() => onRailOpenChange(!railOpen)}>
            Stop {index + 1} of {stopCount}
            <ChevronDown size={12} aria-hidden="true" data-open={railOpen} />
          </button>
          <div className="pr-guide-stepper">
            <button type="button" className="icon-btn icon-btn-compact" aria-label="Previous stop" title="Previous stop (K)" disabled={index === 0} onClick={() => onStep(-1)}><ChevronUp size={15} /></button>
            <kbd aria-hidden="true">K</kbd>
            <button type="button" className="icon-btn icon-btn-compact" aria-label="Next stop" title="Next stop (J)" disabled={index === stopCount - 1} onClick={() => onStep(1)}><ChevronDown size={15} /></button>
            <kbd aria-hidden="true">J</kbd>
          </div>
        </header>
        {railOpen ? <div className="pr-guide-rail-popover">{rail}</div> : null}

        <div className="pr-guide-intro">
          <h2 ref={headingRef} tabIndex={-1}>
            <span className="pr-guide-ordinal" aria-hidden="true">{index + 1}</span>
            <span className="sr-only">Stop {index + 1} of {stopCount}: </span>
            {plainProse(stop.title)}
          </h2>
          {stop.summary ? <GuideProse body={stop.summary} /> : null}
        </div>

        {stop.attention ? (
          // A run-in head: the kind of judgement leads straight into the judgement itself.
          <section className="pr-guide-call" aria-labelledby={`pr-guide-call-${index}`}>
            <h3 id={`pr-guide-call-${index}`}>{CALL_LABELS[stop.attention.kind]}</h3>
            <GuideProse body={stop.attention.note} />
          </section>
        ) : null}

        {stop.excerpts.map((excerpt) => (
          <GuideExcerpt
            key={`${excerpt.path}:${excerpt.side}:${excerpt.start}-${excerpt.end}`}
            excerpt={excerpt}
            // A stale guide's lines may now hold different code: show the missing state and open
            // only the file, instead of drawing new code under old notes.
            slice={stale ? undefined : pullRequestTourExcerptPatch(plan, excerpt, hunks)}
            markers={lettered
              .filter(({ note }) => note.path === excerpt.path && note.line >= excerpt.start && note.line <= excerpt.end)
              .map(({ marker, note }) => ({ marker, title: plainProse(note.title), line: note.line }))}
            diffSyntaxTheme={diffSyntaxTheme}
            onOpenFile={stale ? (location) => onOpenFile({ path: location.path }) : onOpenFile}
            onRevealNote={(marker) => revealGuideReference(`[data-guide-note="${marker}"]`)}
          />
        ))}

        <GuideNotes notes={lettered} className="pr-guide-notes-inline" />

        {otherFiles.length ? (
          <section className="pr-guide-section">
            <h3>{stop.excerpts.length ? 'Also in this stop' : 'Files in this stop'}</h3>
            <ul className="pr-guide-files">
              {otherFiles.map((file) => (
                <GuideFileRow key={file.path} path={file.path} note={file.note} plan={plan} diffStyle={diffStyle} diffSyntaxTheme={diffSyntaxTheme} onOpenFile={onOpenFile} />
              ))}
            </ul>
          </section>
        ) : null}

        {stop.questions.length ? (
          <section className="pr-guide-section">
            <h3>Questions to consider</h3>
            <ul className="pr-guide-questions">
              {stop.questions.map((question) => (
                <li key={question}><GuideProse body={question} /></li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="pr-guide-footer">
          {nextTitle ? (
            <button type="button" className="pr-guide-next" onClick={() => onStep(1)}>
              <span className="pr-guide-next-label">Next, stop {index + 2} <kbd aria-hidden="true">J</kbd></span>
              <span className="pr-guide-next-title">{plainProse(nextTitle)}<ArrowRight size={16} aria-hidden="true" /></span>
            </button>
          ) : (
            <button type="button" className="btn-primary btn-regular" onClick={onFinish}>
              <ShieldCheck size={13} aria-hidden="true" />
              Finish review
            </button>
          )}
        </footer>
      </article>
      {lettered.length ? <aside className="pr-guide-notes-aside"><GuideNotes notes={lettered} /></aside> : null}
    </div>
  );
}

function GuideNotes({ notes, className }: { notes: ReturnType<typeof letterTourNotes>; className?: string }): ReactElement | null {
  if (!notes.length) return null;
  return (
    <section className={`pr-guide-notes ${className ?? ''}`}>
      <h4>Notes on this stop</h4>
      <ol>
        {notes.map(({ marker, note }) => (
          <li key={marker} data-guide-note={marker} tabIndex={-1}>
            <GuideMarker marker={marker} />
            <div>
              <p><strong>{plainProse(note.title)}</strong></p>
              <button
                type="button"
                className="pr-guide-note-where"
                title={`Show ${note.path}, line ${note.line} in the excerpt`}
                onClick={() => revealGuideReference(`[data-guide-marker-row="${marker}"]`)}
              >
                {note.path.split('/').at(-1)}, line {note.line}
                <ArrowUpRight size={11} aria-hidden="true" />
              </button>
              {note.body ? <GuideProse body={note.body} /> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Files a stop owns without excerpts; the diff renders only when expanded.
function GuideFileRow({ path, note, plan, diffStyle, diffSyntaxTheme, onOpenFile }: {
  path: string;
  note: string;
  plan: GitReviewPlan;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onOpenFile: OpenFile;
}): ReactElement {
  const [open, setOpen] = useState(false);
  // Sections can split a file; show its hunks in file order.
  const chunks = plan.units.flatMap((unit) => unit.chunks).filter((chunk) => chunk.path === path)
    .sort((a, b) => hunkStart(a.patch) - hunkStart(b.patch));
  const additions = chunks.reduce((sum, chunk) => sum + chunk.additions, 0);
  const deletions = chunks.reduce((sum, chunk) => sum + chunk.deletions, 0);
  const options = useMemo(() => ({ ...createDiffOptionsBase(diffSyntaxTheme), diffStyle, disableFileHeader: true, hunkSeparators: 'simple' as const }), [diffStyle, diffSyntaxTheme]);
  return (
    <li>
      <div className="pr-guide-file-row">
        <button type="button" className="pr-guide-file-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight size={13} aria-hidden="true" data-open={open} />
          <FileText size={13} aria-hidden="true" />
          <span className="pr-guide-path">{path}</span>
          {note ? <span className="pr-guide-file-note">{plainProse(note)}</span> : null}
        </button>
        <PullRequestLineStats additions={additions} deletions={deletions} />
        <button type="button" className="icon-btn icon-btn-compact pr-guide-open" aria-label={`Open ${path} in Code`} title="Open in Code" onClick={() => onOpenFile({ path })}><ArrowUpRight size={14} /></button>
      </div>
      {open ? (
        <div className="pr-guide-file-diff">
          {chunks.some((chunk) => chunk.patch.includes('@@'))
            ? chunks.filter((chunk) => chunk.patch.includes('@@')).map((chunk) => <PatchDiff key={chunk.id} className="gg-diff" patch={chunk.patch} options={options} />)
            : <p className="pr-guide-muted">No text diff for this file.</p>}
        </div>
      ) : null}
    </li>
  );
}
