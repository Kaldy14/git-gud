import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { GitReviewPlan } from '@shared/types';
import { createReviewPresentation, type ReviewPreferences } from './reviewFilters';
import {
  changedReviewLines, checkpointCoverage, compareReviewCheckpoint, loadReviewCheckpoint,
  reviewChangeKey, saveReviewCheckpoint, type ReviewCheckpoint
} from './reviewContinuity';

export type ReviewContinuityIdentity = { key: string; headSha: string; baseSha: string };

export function useReviewContinuity(
  identity: ReviewContinuityIdentity | undefined,
  plan: GitReviewPlan | undefined,
  preferences: ReviewPreferences,
  root: RefObject<HTMLElement | null>
) {
  // The parent remounts on PR identity/base/head changes, but not when context enrichment arrives.
  const [checkpoint, setCheckpoint] = useState(() => identity ? loadReviewCheckpoint(window.localStorage, identity.key) : undefined);
  const [hideSeen, setHideSeen] = useState(true);
  const [hasSavedCheckpoint, setHasSavedCheckpoint] = useState(Boolean(checkpoint));
  const [error, setError] = useState<string>();
  const [historyAcknowledged, setHistoryAcknowledged] = useState(false);
  const comparison = useMemo(() => plan && identity
    ? compareReviewCheckpoint(plan, identity.baseSha, checkpoint)
    : { hiddenIds: new Set<string>(), previousChanges: [], matchingIds: new Set<string>() }, [plan, identity, checkpoint]);
  const chunks = useMemo(() => plan?.units.flatMap((unit) => unit.chunks) ?? [], [plan]);
  const scope = useMemo(() => plan ? createReviewPresentation(plan, preferences, new Set()).units.flatMap((unit) => unit.visibleChunks) : [], [plan, preferences]);
  const seen = useRef(new Map<string, Set<string>>());
  const position = useRef<ReviewCheckpoint['position']>(checkpoint?.position);
  const dirty = useRef(false);
  const [manualUnseen, setManualUnseen] = useState(new Set<string>());
  const hiddenIds = useMemo(() => new Set([...comparison.hiddenIds].filter((id) => !manualUnseen.has(id))), [comparison, manualUnseen]);
  const initialChunk = chunks.find((chunk) => chunk.id === checkpoint?.position?.chunkId) ??
    chunks.find((chunk) => chunk.path === checkpoint?.position?.path && !hiddenIds.has(chunk.id));
  const initialUnitId = plan?.units.find((unit) => unit.chunks.some((chunk) => chunk.id === initialChunk?.id))?.id;
  const [resumePosition] = useState(() => checkpoint?.position);

  const persist = useCallback(() => {
    if (!identity || !plan || !dirty.current) return;
    const coverage = checkpointCoverage(scope, seen.current);
    if (!coverage.eligible) return;
    const next: ReviewCheckpoint = {
      version: 1, baseSha: identity.baseSha, headSha: identity.headSha, savedAt: new Date().toISOString(), position: position.current,
      chunks: plan.units.flatMap((unit) => unit.chunks.map((chunk) => {
        const lines = changedReviewLines(chunk);
        return { id: chunk.id, path: chunk.path, patch: chunk.omittedReason ? '' : chunk.patch, unitId: unit.id,
          seen: !chunk.omittedReason && lines.length > 0 && lines.every((line) => seen.current.get(chunk.id)?.has(line)) };
      }))
    };
    // Retain disappeared/replaced patches until the user explicitly inspects them.
    if (!historyAcknowledged) next.chunks.push(...comparison.previousChanges.map((chunk) => ({ ...chunk, seen: false })));
    const saved = saveReviewCheckpoint(window.localStorage, identity.key, next);
    setError(saved ? undefined : 'Could not save this review checkpoint. Storage is full or unavailable.');
    if (saved) { dirty.current = false; setHasSavedCheckpoint(true); }
  }, [identity, plan, scope, historyAcknowledged, comparison.previousChanges]);

  useEffect(() => {
    for (const chunk of chunks) {
      if (hiddenIds.has(chunk.id) && !manualUnseen.has(chunk.id)) seen.current.set(chunk.id, new Set(changedReviewLines(chunk)));
    }
  }, [chunks, hiddenIds, manualUnseen]);

  useEffect(() => {
    if (!identity || !plan) return;
    let previousVisible = new Set<string>();
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const allowedLines = new Map(chunks.map((chunk) => [chunk.id, new Set(changedReviewLines(chunk))]));
    const timer = window.setInterval(() => {
      const scroller = root.current?.querySelector<HTMLElement>('.review-chunks');
      if (!scroller || document.hidden || !document.hasFocus() || scroller.closest('[inert]')) {
        previousVisible.clear();
        return;
      }
      const bounds = scroller.getBoundingClientRect();
      if (bounds.height <= 0 || bounds.width <= 0) { previousVisible.clear(); return; }
      const visible = new Set<string>();
      let firstPosition: ReviewCheckpoint['position'];
      for (const host of scroller.querySelectorAll<HTMLElement>('[data-review-chunk-id]')) {
        const id = host.dataset.reviewChunkId!;
        const chunk = chunkById.get(id);
        const rect = host.getBoundingClientRect();
        if (!chunk || manualUnseen.has(id) || rect.height === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
        firstPosition ??= { chunkId: id, path: chunk.path, offset: Math.max(0, bounds.top - rect.top) };
        const shadow = host.querySelector('.gg-diff')?.shadowRoot;
        if (!shadow) continue;
        for (const row of shadow.querySelectorAll<HTMLElement>('[data-line][data-line-type]')) {
          const side = row.dataset.lineType === 'change-addition' ? 'right' : row.dataset.lineType === 'change-deletion' ? 'left' : undefined;
          if (!side) continue;
          const line = `${side}:${row.dataset.line}`;
          if (!allowedLines.get(id)?.has(line) || seen.current.get(id)?.has(line)) continue;
          const box = row.getBoundingClientRect();
          if (box.height === 0 || box.width === 0 || box.top < bounds.top || box.bottom > bounds.bottom || box.right <= bounds.left || box.left >= bounds.right) continue;
          const hit = document.elementFromPoint(
            Math.max(bounds.left, box.left) + Math.min(30, (Math.min(bounds.right, box.right) - Math.max(bounds.left, box.left)) / 2),
            box.top + box.height / 2
          );
          if (!hit || !host.contains(hit)) continue;
          const key = `${id}:${line}`;
          visible.add(key);
          // Two consecutive samples require at least 750ms on screen. A jump never marks skipped lines.
          if (previousVisible.has(key)) {
            const lines = seen.current.get(id) ?? new Set<string>();
            if (!lines.has(line)) { lines.add(line); seen.current.set(id, lines); dirty.current = true; }
          }
        }
      }
      if (firstPosition && JSON.stringify(firstPosition) !== JSON.stringify(position.current)) {
        position.current = firstPosition;
        dirty.current = true;
      }
      previousVisible = visible;
      persist();
    }, 750);
    const flush = () => persist();
    window.addEventListener('pagehide', flush);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', flush); persist(); };
  }, [identity, plan, chunks, root, persist, manualUnseen]);

  const markChunks = useCallback((ids: string[], viewed: boolean) => {
    for (const chunk of chunks) {
      if (!ids.includes(chunk.id)) continue;
      if (viewed) {
        seen.current.set(chunk.id, new Set(changedReviewLines(chunk)));
      } else {
        seen.current.delete(chunk.id);
      }
    }
    dirty.current = true;
    setManualUnseen((current) => {
      const next = new Set(current);
      for (const id of ids) { if (viewed) next.delete(id); else next.add(id); }
      return next;
    });
    persist();
    // Explicitly marking code unviewed must revoke a persisted match even below the halfway threshold.
    if (!viewed && identity) {
      const saved = loadReviewCheckpoint(window.localStorage, identity.key);
      if (saved) {
        const keys = new Set(chunks.filter((chunk) => ids.includes(chunk.id)).map(reviewChangeKey));
        const ok = saveReviewCheckpoint(window.localStorage, identity.key, { ...saved, chunks: saved.chunks.map((chunk) =>
          keys.has(reviewChangeKey(chunk)) ? { ...chunk, seen: false } : chunk) });
        setError(ok ? undefined : 'Could not save the unviewed changes.');
      }
    }
  }, [chunks, identity, persist]);

  const reset = () => {
    if (identity && !saveReviewCheckpoint(window.localStorage, identity.key)) {
      setError('Could not reset the saved review.');
      return;
    }
    dirty.current = false;
    seen.current.clear();
    position.current = undefined;
    setManualUnseen(new Set());
    setCheckpoint(undefined);
    setHasSavedCheckpoint(false);
    setHideSeen(false);
    setHistoryAcknowledged(true);
    setError(undefined);
  };

  return {
    enabled: Boolean(identity), checkpoint, hasSavedCheckpoint, hideSeen, setHideSeen, hiddenIds, initialUnitId, resumePosition,
    previousChanges: historyAcknowledged ? [] : comparison.previousChanges, error, markChunks, reset,
    acknowledgeHistory() {
      if (identity) {
        const saved = loadReviewCheckpoint(window.localStorage, identity.key);
        if (saved) {
          const previousKeys = new Set(comparison.previousChanges.map(reviewChangeKey));
          const ok = saveReviewCheckpoint(window.localStorage, identity.key, { ...saved,
            chunks: saved.chunks.filter((chunk) => !previousKeys.has(reviewChangeKey(chunk))) });
          if (!ok) {
            setError('Could not save the inspected changes.');
            return false;
          }
        }
      }
      setHistoryAcknowledged(true);
      setError(undefined);
      return true;
    },
    baseChanged: Boolean(checkpoint && identity?.baseSha !== checkpoint.baseSha)
  };
}
