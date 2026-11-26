import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode
} from 'react';
import { AlertTriangle } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';

// One owner for unsaved text in the pull request workspace. Editors holding typed text report it;
// every way out of the open pull request goes through `requestLeave`, which asks before discarding.

/** Which editors currently hold unsaved text, by a stable id per editor. */
export function createUnsavedTextRegistry() {
  const unsaved = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    report(id: string, hasText: boolean): void {
      const had = unsaved.size > 0;
      if (hasText) unsaved.add(id);
      else unsaved.delete(id);
      if (had !== unsaved.size > 0) for (const listener of listeners) listener();
    },
    // Notified whenever `hasUnsavedText` flips.
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Never cleared by a discard: the action may switch nothing (the same pull request, a failed profile
    // switch), and the editors that unmount report themselves gone.
    hasUnsavedText: (): boolean => unsaved.size > 0
  };
}

type UnsavedTextRegistry = ReturnType<typeof createUnsavedTextRegistry>;

// `onKeep` runs when the reader chooses "Keep editing", for callers that must know the way out was declined.
type RequestLeave = (action: () => void, onKeep?: () => void) => void;
type PendingLeave = { action: () => void; onKeep?: () => void };

/**
 * Runs a way out at once when nothing is unsaved, otherwise holds it for the reader's answer. One question
 * at a time: a request made while one is pending is declined (its `onKeep` runs), so no action is dropped
 * and no promise is left waiting.
 */
export function createLeaveGate(registry: Pick<UnsavedTextRegistry, 'hasUnsavedText'>, onPendingChange: (pending: boolean) => void) {
  let pending: PendingLeave | undefined;
  const settle = (): PendingLeave | undefined => {
    const settled = pending;
    pending = undefined;
    onPendingChange(false);
    return settled;
  };
  const request: RequestLeave = (action, onKeep) => {
    if (pending) onKeep?.();
    else if (!registry.hasUnsavedText()) action();
    else {
      pending = { action, onKeep };
      onPendingChange(true);
    }
  };
  return {
    request,
    keep: (): void => settle()?.onKeep?.(),
    discard: (): void => settle()?.action()
  };
}

type LeaveGuard = {
  registry: UnsavedTextRegistry;
  requestLeave: RequestLeave;
};

const LeaveGuardContext = createContext<LeaveGuard | null>(null);

// Ways out that live outside the workspace (title-bar tabs, deep links, profile switch) reach the
// mounted guard through this; with no workspace open the action simply runs.
let mountedRequestLeave: RequestLeave | undefined;

export function requestPullRequestLeave(action: () => void, onKeep?: () => void): void {
  (mountedRequestLeave ?? runNow)(action, onKeep);
}

/** Resolves true when the reader may leave the open pull request (at once when nothing is unsaved). */
export function confirmPullRequestLeave(): Promise<boolean> {
  return new Promise((resolve) => requestPullRequestLeave(() => resolve(true), () => resolve(false)));
}

const EDITOR_SELECTOR = 'textarea, input[type="text"], [contenteditable="true"]';

export function PullRequestLeaveGuardProvider({ children }: { children: ReactNode }): ReactElement {
  const [registry] = useState(createUnsavedTextRegistry);
  const [pending, setPending] = useState(false);
  const [gate] = useState(() => createLeaveGate(registry, setPending));
  // The editor typed in last, so "Keep editing" puts the caret back where it was.
  const lastEditorRef = useRef<HTMLElement | null>(null);
  const requestLeave = gate.request;
  const value = useMemo(() => ({ registry, requestLeave }), [registry, requestLeave]);

  useEffect(() => {
    mountedRequestLeave = requestLeave;
    const rememberEditor = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches(EDITOR_SELECTOR) && target.closest('[data-pull-request-workspace]')) {
        lastEditorRef.current = target;
      }
    };
    document.addEventListener('focusin', rememberEditor);
    return () => {
      if (mountedRequestLeave === requestLeave) mountedRequestLeave = undefined;
      document.removeEventListener('focusin', rememberEditor);
    };
  }, [requestLeave]);

  function keepEditing(): void {
    gate.keep();
    // The dialog returns focus to its trigger as it closes; the editor takes it back right after.
    window.setTimeout(() => {
      const editor = lastEditorRef.current;
      if (editor?.isConnected) editor.focus();
    }, 0);
  }

  return (
    <LeaveGuardContext.Provider value={value}>
      {children}
      {pending ? <LeaveGuardDialog onKeepEditing={keepEditing} onDiscard={gate.discard} /> : null}
    </LeaveGuardContext.Provider>
  );
}

function LeaveGuardDialog({ onKeepEditing, onDiscard }: { onKeepEditing: () => void; onDiscard: () => void }): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalSurface labelledBy={titleId} describedBy={descriptionId} className="pr-leave-dialog" onClose={onKeepEditing}>
      <div className="pr-leave-dialog-body">
        <AlertTriangle size={16} aria-hidden="true" />
        <div>
          <h2 id={titleId}>Discard your unsaved comment?</h2>
          <p id={descriptionId}>The text you typed has not been added to your review and will be lost.</p>
        </div>
      </div>
      <footer>
        {/* Escape and the safe default both keep the text. */}
        <button className="btn-subtle btn-regular" type="button" data-modal-initial-focus="true" onClick={onKeepEditing}>
          Keep editing
        </button>
        <button className="btn-danger btn-regular" type="button" onClick={onDiscard}>
          Discard and switch
        </button>
      </footer>
    </ModalSurface>
  );
}

/** Editors call this with whether they hold typed, unsaved text. Harmless outside the workspace. */
export function useReportUnsavedText(hasText: boolean): void {
  const guard = useContext(LeaveGuardContext);
  const id = useId();
  useEffect(() => {
    guard?.registry.report(id, hasText);
    return () => guard?.registry.report(id, false);
  }, [guard, id, hasText]);
}

const noUnsavedText = { subscribe: () => () => undefined, hasUnsavedText: () => false };

/** Whether any editor in the workspace holds unsaved text; re-renders when that changes. */
export function useHasUnsavedText(): boolean {
  const registry = useContext(LeaveGuardContext)?.registry ?? noUnsavedText;
  return useSyncExternalStore(registry.subscribe, registry.hasUnsavedText);
}

/** Wraps a way out of the open pull request. Outside the workspace the action simply runs. */
export function useRequestLeave(): RequestLeave {
  const guard = useContext(LeaveGuardContext);
  return guard?.requestLeave ?? runNow;
}

const runNow: RequestLeave = (action) => action();
