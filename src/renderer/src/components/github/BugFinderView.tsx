import type { CodeReference } from '@shared/codeReference';
import { loadPreferredApplication, selectApplication } from './preferredApplication';
import { BugFinderCode } from './BugFinderCode';
import { ModalSurface } from '../accessibility/ModalSurface';
import { useState } from 'react';
import type { DiffStyle } from '../commit/fileDetailUtils';
import { Bug, Check, Copy, X } from 'lucide-react';
import type { BugFinding, BugFindingContent } from '@shared/bugFinder';
import type { DiffSyntaxTheme, GitHubPullRequestDetail } from '@shared/types';
import { useBugFinder } from './useBugFinder';
import { ReviewCommentBody } from '../review/ReviewCommentBody';

type Filter = 'open' | 'dismissed' | 'posted' | 'removed';
export function BugFinderView({
  detail,
  repoPath,
  diffSyntaxTheme,
  diffStyle,
  onClose
}: {
  detail: GitHubPullRequestDetail;
  repoPath?: string;
  diffSyntaxTheme: DiffSyntaxTheme;
  diffStyle: DiffStyle;
  onClose: () => void;
}) {
  const { state, query, mutation } = useBugFinder(detail, true);
  const [filter, setFilter] = useState<Filter>('open');
  const [activeId, setActiveId] = useState<string>();
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<{
    finding: BugFinding;
    content: BugFindingContent;
  }>();
  const [dismiss, setDismiss] = useState<BugFinding>();
  const [reason, setReason] = useState('');
  const [review, setReview] =
    useState<
      Array<{ id: string; version: number; body: string; title: string }>
    >();
  const findings = state?.findings ?? [];
  const filtered = findings.filter((f) =>
    filter === 'posted'
      ? !!f.publication
      : f.status === filter && !f.publication
  );
  const active = filtered.find((f) => f.id === activeId) ?? filtered[0];
  const stale = !!state?.headSha && state.headSha !== detail.headSha;
  const selected = findings.filter(
    (f) =>
      selection[f.id] === f.version &&
      f.status === 'open' &&
      !f.publication &&
      f.headSha === detail.headSha
  );
  const changedSelection = Object.keys(selection).length - selected.length;
  const reviewChanged = review?.some((item) => !findings.some((finding) => finding.id === item.id && finding.version === item.version && finding.status === 'open' && !finding.publication && finding.headSha === detail.headSha)) ?? false;
  const pending = mutation.isPending;
  const error = mutation.error?.message ?? query.error?.message ?? state?.error;
  async function openEvidence(reference: CodeReference) {
    try {
      if (!repoPath) throw new Error('Open this pull request repository locally first, then choose an editor under “Open PR in…”.');
      const application = selectApplication(await window.api.listExternalApplications(), loadPreferredApplication(window.localStorage));
      if (!application) throw new Error('No supported code editor is installed.');
      setNotice('Opening evidence in your selected editor…');
      const result = await window.api.openGitHubPullRequestInApplication(repoPath, {
        applicationId: application.id, url: detail.url, owner: detail.owner,
        repository: detail.repository, number: detail.number,
        headSha: active?.headSha ?? detail.headSha, file: reference
      });
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Could not open the evidence file.');
    }
  }
  async function copy(items: BugFinding[]) {
    setNotice('');
    try {
      const result = await mutation.mutateAsync({
        action: 'prompt',
        headSha: detail.headSha,
        selected: items.map((f) => ({ id: f.id, version: f.version }))
      });
      if (!result.prompt) throw new Error('No handoff prompt returned.');
      await navigator.clipboard.writeText(result.prompt);
      setNotice(
        'Prompt copied. Your agent can investigate and update these findings through the Git Gud CLI.'
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not copy prompt.'
      );
    }
  }
  return (
    <section className="bug-finder-view" aria-label="PR bug finder">
      <header className="bug-finder-toolbar">
        <strong>
          <Bug size={14} /> Bug finder
        </strong>
        <span className="text-muted">
          {state?.headSha
            ? `Scanned ${state.headSha.slice(0, 8)}`
            : 'No scan yet'}
        </span>
        <button
          className="btn-subtle btn-regular"
          disabled={pending || state?.status === 'running'}
          onClick={() => {
            setNotice('');
            mutation.mutate({ action: 'start' });
          }}
        >
          {state?.status === 'idle' || !state
            ? 'Run bug finder'
            : state.status === 'failed'
              ? 'Retry scan'
              : 'Run again'}
        </button>
        <button
          className="icon-btn icon-btn-regular"
          onClick={onClose}
          aria-label="Close bug finder"
        >
          <X size={14} />
        </button>
      </header>
      {stale ? (
        <p className="bug-finder-warning" role="status">
          The PR changed since this scan. Run again and revalidate older
          findings before copying or posting them.
        </p>
      ) : null}
      {state?.status === 'running' ? (
        <p className="bug-finder-status" role="status">
          Inspecting this PR in the background. You can close this view and
          return when it finishes.
        </p>
      ) : null}
      {error ? (
        <p className="bug-finder-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="bug-finder-status" role="status">
          {notice}
        </p>
      ) : null}
      {changedSelection > 0 ? (
        <p className="bug-finder-warning">
          {changedSelection} selected findings changed. Inspect and select their
          updated versions again.
        </p>
      ) : null}
      <div className="bug-finder-columns">
        <aside className="bug-finder-list">
          <nav aria-label="Finding status">
            {(['open', 'dismissed', 'posted', 'removed'] as const).map(
              (value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setNotice('');
                    setEdit(undefined);
                    setDismiss(undefined);
                  }}
                >
                  {value[0].toUpperCase() + value.slice(1)}{' '}
                  <span>
                    {
                      findings.filter((f) =>
                        value === 'posted'
                          ? !!f.publication
                          : f.status === value && !f.publication
                      ).length
                    }
                  </span>
                </button>
              )
            )}
          </nav>
          {filtered.map((f) => (
            <article
              key={f.id}
              className="bug-finder-item"
              data-active={f.id === active?.id}
            >
              <div className="bug-finder-meta">
                {filter === 'open' ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${f.title}`}
                    checked={selection[f.id] === f.version}
                    disabled={stale || f.headSha !== detail.headSha || pending}
                    onChange={(event) =>
                      setSelection((current) => {
                        const next = { ...current };
                        if (event.target.checked) next[f.id] = f.version;
                        else delete next[f.id];
                        return next;
                      })
                    }
                  />
                ) : null}
                <span className="bug-finder-badge" data-severity={f.severity}>
                  {f.category === 'convention' ? 'Convention' : f.severity}
                </span>
                {f.headSha !== detail.headSha ? (
                  <span className="bug-finder-outdated">Outdated</span>
                ) : null}
                {f.publication ? (
                  <span>
                    {f.publication.status === 'posted'
                      ? 'Posted'
                      : 'Check GitHub'}
                  </span>
                ) : null}
              </div>
              <button
                className="bug-finder-item-link"
                onClick={() => {
                  setActiveId(f.id);
                  setNotice('');
                  setEdit(undefined);
                  setDismiss(undefined);
                }}
              >
                <strong>{f.title}</strong>
                <small>
                  {f.location.path}:{f.location.line}
                  {f.location.endLine !== f.location.line
                    ? `–${f.location.endLine}`
                    : ''}
                </small>
              </button>
            </article>
          ))}
          {!filtered.length ? (
            <p className="bug-finder-empty">
              {state?.status === 'ready' && filter === 'open'
                ? 'No open findings. See scan coverage for what was inspected.'
                : `No ${filter} findings.`}
            </p>
          ) : null}
        </aside>
        <div className="bug-finder-detail" key={active?.id}>
          {active ? (
            <>
              <div className="bug-finder-meta">
                <span
                  className="bug-finder-badge"
                  data-severity={active.severity}
                >
                  {active.category === 'convention'
                    ? 'Convention'
                    : `${active.severity} bug`}
                </span>
                <span>
                  {active.evidence.kind === 'reproduced'
                    ? 'Reproduced'
                    : active.evidence.kind === 'incomplete'
                      ? 'Incomplete evidence'
                      : 'Code evidence'}
                </span>
                <span className="bug-finder-actions">
                  {!active.publication ? (
                    <>
                      {active.status !== 'removed' ? (
                        <button
                          className="btn-subtle btn-compact"
                          disabled={pending || stale}
                          onClick={() => {
                            setEdit({
                              finding: active,
                              content: {
                                title: active.title,
                                body: active.body,
                                category: active.category,
                                severity: active.severity,
                                evidence: { ...active.evidence },
                                location: { ...active.location }
                              }
                            });
                            setDismiss(undefined);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                      {active.status === 'open' ? (
                        <button
                          className="btn-subtle btn-compact"
                          disabled={pending || stale}
                          onClick={() => {
                            setDismiss(active);
                            setReason('');
                            setEdit(undefined);
                          }}
                        >
                          Dismiss
                        </button>
                      ) : (
                        <button
                          className="btn-subtle btn-compact"
                          disabled={pending || stale}
                          onClick={() =>
                            mutation.mutate({
                              action: 'restore',
                              headSha: detail.headSha,
                              id: active.id,
                              version: active.version
                            })
                          }
                        >
                          Restore
                        </button>
                      )}
                      {active.status !== 'removed' ? (
                        <button
                          className="btn-subtle btn-compact"
                          disabled={pending || stale}
                          onClick={() =>
                            mutation.mutate({
                              action: 'remove',
                              headSha: detail.headSha,
                              id: active.id,
                              version: active.version
                            })
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </div>
              <h2>{active.title}</h2>
              <ReviewCommentBody body={active.body} aiMessageTheme={diffSyntaxTheme} onOpenFile={openEvidence} />
              {active.headSha !== detail.headSha ? (
                <p className="bug-finder-warning">
                  Recorded at {active.headSha.slice(0, 8)}. Code below is the
                  current PR revision; verify its location and save an edit to
                  revalidate.
                </p>
              ) : null}
              <BugFinderCode detail={detail} location={active.location} diffSyntaxTheme={diffSyntaxTheme} diffStyle={diffStyle} onOpenFile={active.location.side === 'right' ? () => void openEvidence({ path: active.location.path, line: active.location.line }) : undefined} />
              <div className="bug-finder-evidence">
                <strong>Evidence</strong>
                <ReviewCommentBody body={active.evidence.detail} aiMessageTheme={diffSyntaxTheme} onOpenFile={openEvidence} />
              </div>
              {active.publication?.status === 'uncertain' ||
              active.publication?.status === 'posting' ? (
                <p className="bug-finder-warning">
                  Submission is unconfirmed. Inspect the PR on GitHub; automatic
                  reposting is blocked to prevent duplicate comments.{' '}
                  <button
                    className="btn-subtle btn-compact"
                    disabled={pending}
                    onClick={() =>
                      mutation.mutate(
                        { action: 'reconcile', headSha: detail.headSha },
                        {
                          onSuccess: (result) =>
                            setNotice(
                              result.state.findings.find(
                                (f) => f.id === active.id
                              )?.publication?.status === 'posted'
                                ? 'Publication confirmed.'
                                : 'No published comment found yet. Check GitHub before taking further action.'
                            )
                        }
                      )
                    }
                  >
                    Check submission
                  </button>
                </p>
              ) : null}
              {dismiss?.id === active.id ? (
                <form
                  className="bug-finder-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutation.mutate(
                      {
                        action: 'dismiss',
                        headSha: detail.headSha,
                        id: dismiss.id,
                        version: dismiss.version,
                        reason
                      },
                      { onSuccess: () => setDismiss(undefined) }
                    );
                  }}
                >
                  <label>
                    Why is this finding incorrect?
                    <textarea
                      required
                      maxLength={2000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div>
                    <button
                      className="btn-primary btn-regular"
                      disabled={pending}
                    >
                      Dismiss finding
                    </button>
                    <button
                      type="button"
                      className="btn-subtle btn-regular"
                      onClick={() => setDismiss(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {edit?.finding.id === active.id ? (
                <form
                  className="bug-finder-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutation.mutate(
                      {
                        action: 'update',
                        headSha: detail.headSha,
                        id: edit.finding.id,
                        version: edit.finding.version,
                        content: edit.content
                      },
                      { onSuccess: () => setEdit(undefined) }
                    );
                  }}
                >
                  <label>
                    Title
                    <input
                      required
                      maxLength={200}
                      value={edit.content.title}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: { ...edit.content, title: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label>
                    Finding
                    <textarea
                      required
                      maxLength={8000}
                      value={edit.content.body}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: { ...edit.content, body: e.target.value }
                        })
                      }
                    />
                  </label>
                  <div className="bug-finder-form-row">
                    <label>
                      Category
                      <select
                        value={edit.content.category}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              ...edit.content,
                              category:
                                e.target.value === 'bug' ? 'bug' : 'convention',
                              severity:
                                e.target.value === 'bug' ? 'major' : null
                            }
                          })
                        }
                      >
                        <option value="bug">Bug</option>
                        <option value="convention">Convention</option>
                      </select>
                    </label>
                    {edit.content.category === 'bug' ? (
                      <label>
                        Severity
                        <select
                          value={edit.content.severity ?? 'major'}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              content: {
                                ...edit.content,
                                severity:
                                  e.target.value === 'critical'
                                    ? 'critical'
                                    : e.target.value === 'minor'
                                      ? 'minor'
                                      : 'major'
                              }
                            })
                          }
                        >
                          <option value="critical">Critical</option>
                          <option value="major">Major</option>
                          <option value="minor">Minor</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <label>
                    Evidence
                    <textarea
                      required
                      maxLength={8000}
                      value={edit.content.evidence.detail}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: {
                            ...edit.content,
                            evidence: {
                              ...edit.content.evidence,
                              detail: e.target.value
                            }
                          }
                        })
                      }
                    />
                  </label>
                  <div className="bug-finder-form-row">
                    <label>
                      Path
                      <input
                        required
                        value={edit.content.location.path}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              ...edit.content,
                              location: {
                                ...edit.content.location,
                                path: e.target.value
                              }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      Start line
                      <input
                        required
                        type="number"
                        min={1}
                        value={edit.content.location.line}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              ...edit.content,
                              location: {
                                ...edit.content.location,
                                line: Number(e.target.value)
                              }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      End line
                      <input
                        required
                        type="number"
                        min={1}
                        value={edit.content.location.endLine}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: {
                              ...edit.content,
                              location: {
                                ...edit.content.location,
                                endLine: Number(e.target.value)
                              }
                            }
                          })
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <button
                      className="btn-primary btn-regular"
                      disabled={pending}
                    >
                      Save finding
                    </button>
                    <button
                      type="button"
                      className="btn-subtle btn-regular"
                      onClick={() => setEdit(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              <details className="bug-finder-history">
                <summary>Finding history · version {active.version}</summary>
                {active.history.map((item, i) => (
                  <p key={i}>
                    {item.actor} · {item.action} ·{' '}
                    {new Date(item.at).toLocaleString()}
                    {item.reason ? ` — ${item.reason}` : ''}
                  </p>
                ))}
              </details>
            </>
          ) : (
            <div className="bug-finder-empty">
              <Bug size={24} />
              <h2>
                {state?.status === 'idle' || !state
                  ? 'Find bugs in this PR'
                  : 'Select a finding to inspect its evidence'}
              </h2>
              <p>
                Inspect changed code, review supported findings, or discuss them
                with your own agent.
              </p>
            </div>
          )}
          {state?.coverage ? (
            <details className="bug-finder-coverage">
              <summary>Scan coverage</summary>
              <p>{state.coverage}</p>
            </details>
          ) : null}
        </div>
      </div>
      <footer className="bug-finder-footer">
        <span>{selected.length} selected</span>
        <div>
          <button
            className="btn-subtle btn-regular"
            disabled={
              pending ||
              stale ||
              !findings.some(
                (f) =>
                  f.status === 'open' &&
                  !f.publication &&
                  f.headSha === detail.headSha
              )
            }
            onClick={() =>
              void copy(
                findings.filter(
                  (f) =>
                    f.status === 'open' &&
                    !f.publication &&
                    f.headSha === detail.headSha
                )
              )
            }
          >
            Copy all open
          </button>
          <button
            className="btn-subtle btn-regular"
            disabled={!selected.length || pending || stale}
            onClick={() => void copy(selected)}
          >
            <Copy size={13} /> Copy prompt · {selected.length}
          </button>
          <button
            className="btn-primary btn-regular"
            disabled={!selected.length || pending || stale}
            onClick={() => {
              setNotice('');
              setReview(
                selected.map((f) => ({
                  id: f.id,
                  version: f.version,
                  title: f.title,
                  body: `${f.title}\n\n${f.body}\n\n${f.evidence.detail}`
                }))
              );
            }}
          >
            Review selected · {selected.length}
          </button>
        </div>
      </footer>
      {review ? (
        <ModalSurface
          className="bug-finder-review-dialog"
          backdropClassName="bug-finder-review-backdrop"
          labelledBy="bug-review-title"
          onClose={() => {
            if (!pending) setReview(undefined);
          }}
        >
          <header>
            <h2 id="bug-review-title">Review selected findings</h2>
            <button
              className="icon-btn icon-btn-regular"
              aria-label="Close selected review"
              disabled={pending}
              onClick={() => setReview(undefined)}
            >
              <X size={14} />
            </button>
          </header>
          <div className="bug-finder-review-comments">
            {review.map((item) => (
              <label key={item.id}>
                {item.title}
                <textarea
                  aria-label={`Comment for ${item.title}`}
                  value={item.body}
                  maxLength={16000}
                  onChange={(e) =>
                    setReview(
                      review.map((r) =>
                        r.id === item.id ? { ...r, body: e.target.value } : r
                      )
                    )
                  }
                />
                <button
                  className="btn-subtle btn-compact"
                  onClick={() =>
                    setReview(review.filter((r) => r.id !== item.id))
                  }
                >
                  Remove from review
                </button>
              </label>
            ))}
          </div>
          {reviewChanged ? <p className="bug-finder-warning" role="alert">A finding changed after this preview opened. Close the preview, inspect the new version, and select it again.</p> : null}
          {error ? (
            <p className="bug-finder-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <span>Posts a comment review to GitHub</span>
            <button
              className="btn-primary btn-regular"
              disabled={
                pending ||
                stale ||
                !review.length ||
                reviewChanged || review.some((r) => !r.body.trim())
              }
              onClick={() =>
                mutation.mutate(
                  { action: 'post', headSha: detail.headSha, selected: review },
                  {
                    onSuccess: () => {
                      setReview(undefined);
                      setSelection({});
                      setFilter('posted');
                      setNotice('Selected findings posted as review comments.');
                    }
                  }
                )
              }
            >
              <Check size={13} />
              {pending ? 'Posting…' : `Post ${review.length} ${review.length === 1 ? 'comment' : 'comments'}`}
            </button>
          </footer>
        </ModalSurface>
      ) : null}
    </section>
  );
}
