import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clipboard,
  GitCommit,
  GripVertical,
  Keyboard,
  Loader2,
  Play,
  RotateCcw,
  Workflow,
  X
} from 'lucide-react';

import type {
  GitInteractiveRebaseAction,
  GitInteractiveRebaseCommit,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan
} from '@shared/types';

type InteractiveRebaseDialogProps = {
  plan?: GitInteractiveRebasePlan;
  isLoading: boolean;
  isRunning: boolean;
  errorMessage?: string;
  onClose: () => void;
  onRun: (input: GitInteractiveRebaseInput) => Promise<void>;
};

type RebaseDraftItem = GitInteractiveRebaseCommit & {
  action: GitInteractiveRebaseAction;
  message: string;
};

const actionOptions: Array<{ value: GitInteractiveRebaseAction; label: string; shortcut: string }> = [
  { value: 'pick', label: 'Pick', shortcut: 'P' },
  { value: 'reword', label: 'Reword', shortcut: 'R' },
  { value: 'squash', label: 'Squash', shortcut: 'S' },
  { value: 'fixup', label: 'Fixup', shortcut: 'F' },
  { value: 'drop', label: 'Drop', shortcut: 'D' }
];

export function InteractiveRebaseDialog({
  plan,
  isLoading,
  isRunning,
  errorMessage,
  onClose,
  onRun
}: InteractiveRebaseDialogProps): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]">
      <header className="flex min-h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4">
        <Workflow size={17} className="text-[var(--accent-2)]" />
        <h2 className="shrink-0 text-sm font-semibold text-[var(--text-1)]">Interactive Rebase</h2>
        <div className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-2)]">
          {plan ? (
            <>
              Rebasing <RebasePill>{plan.branchName}</RebasePill> onto <RebasePill>{plan.baseShortSha}</RebasePill>
            </>
          ) : (
            'Preparing commit list'
          )}
        </div>
        <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close interactive rebase">
          <X size={14} />
        </button>
      </header>

      {isLoading ? (
        <InactiveDialogBody
          icon={<Loader2 size={15} className="animate-spin" />}
          label="Loading commits..."
          onClose={onClose}
        />
      ) : errorMessage ? (
        <InactiveDialogBody icon={<AlertTriangle size={15} />} label={errorMessage} onClose={onClose} />
      ) : plan ? (
        <InteractiveRebaseEditor key={`${plan.base}:${plan.headSha}`} plan={plan} isRunning={isRunning} onClose={onClose} onRun={onRun} />
      ) : (
        <InactiveDialogBody icon={<AlertTriangle size={15} />} label="Interactive rebase plan is unavailable." onClose={onClose} />
      )}
    </div>
  );
}

function RebasePill({ children }: { children: string }): ReactElement {
  return (
    <span className="mx-1 inline-flex max-w-[320px] items-center rounded border border-[var(--select-border)] bg-[var(--select-bg)] px-1.5 py-px align-middle font-semibold text-[var(--text-1)]">
      <span className="truncate">{children}</span>
    </span>
  );
}

function InteractiveRebaseEditor({
  plan,
  isRunning,
  onClose,
  onRun
}: {
  plan: GitInteractiveRebasePlan;
  isRunning: boolean;
  onClose: () => void;
  onRun: (input: GitInteractiveRebaseInput) => Promise<void>;
}): ReactElement {
  const shellRef = useRef<HTMLDivElement>(null);
  const initialDraft = useMemo(() => createInitialDraft(plan), [plan]);
  const [draft, setDraft] = useState<RebaseDraftItem[]>(() => initialDraft);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggedSha, setDraggedSha] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();
  const selectedItem = draft[selectedIndex] ?? draft[0];
  const validationMessage = useMemo(() => validateDraft(draft), [draft]);
  const todoText = useMemo(() => formatTodo(draft), [draft]);
  const canRun = draft.length > 0 && !validationMessage && !isRunning;

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  async function handleRun(): Promise<void> {
    if (!canRun) {
      return;
    }

    await onRun({
      base: plan.base,
      commits: draft.map((item) => ({
        sha: item.sha,
        action: item.action,
        message: item.action === 'reword' ? item.message : undefined
      }))
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isRunning) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    const key = event.key.toLowerCase();
    const isMoveModifier = event.metaKey || event.ctrlKey;

    if (isMoveModifier && event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelected(-1);
      return;
    }

    if (isMoveModifier && event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelected(1);
      return;
    }

    if (isMoveModifier && event.shiftKey && key === 'c') {
      event.preventDefault();
      void copyTodo();
      return;
    }

    if (isMoveModifier && event.key === 'Enter') {
      event.preventDefault();
      void handleRun();
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectRelative(-1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectRelative(1);
      return;
    }

    const action = actionForShortcut(key);

    if (action) {
      event.preventDefault();
      updateSelectedAction(action);
    }
  }

  function resetDraft(): void {
    setDraft(initialDraft);
    setSelectedIndex(0);
    setCopyStatus(undefined);
  }

  function updateAction(sha: string, action: GitInteractiveRebaseAction): void {
    setDraft((items) => items.map((item) => (item.sha === sha ? { ...item, action } : item)));
    setCopyStatus(undefined);
  }

  function updateSelectedAction(action: GitInteractiveRebaseAction): void {
    const sha = selectedItem?.sha;

    if (sha) {
      updateAction(sha, action);
    }
  }

  function updateMessage(sha: string, message: string): void {
    setDraft((items) => items.map((item) => (item.sha === sha ? { ...item, message } : item)));
    setCopyStatus(undefined);
  }

  function selectRelative(direction: -1 | 1): void {
    setSelectedIndex((index) => clamp(index + direction, 0, Math.max(0, draft.length - 1)));
  }

  function moveSelected(direction: -1 | 1): void {
    const item = draft[selectedIndex];

    if (item) {
      moveItem(item.sha, direction);
    }
  }

  function moveItem(sha: string, direction: -1 | 1): void {
    const currentIndex = draft.findIndex((item) => item.sha === sha);
    const nextIndex = currentIndex + direction;

    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= draft.length) {
      return;
    }

    setDraft((items) => {
      const nextItems = [...items];
      const [item] = nextItems.splice(currentIndex, 1);

      if (!item) {
        return items;
      }

      nextItems.splice(nextIndex, 0, item);
      return nextItems;
    });
    setSelectedIndex(nextIndex);
    setCopyStatus(undefined);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, targetSha: string): void {
    event.preventDefault();

    if (!draggedSha || draggedSha === targetSha) {
      return;
    }

    const sourceIndex = draft.findIndex((item) => item.sha === draggedSha);
    const targetIndex = draft.findIndex((item) => item.sha === targetSha);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    setDraft((items) => {
      const nextItems = [...items];
      const [item] = nextItems.splice(sourceIndex, 1);

      if (!item) {
        return items;
      }

      nextItems.splice(targetIndex, 0, item);
      return nextItems;
    });
    setSelectedIndex(targetIndex);
    setDraggedSha(undefined);
    setCopyStatus(undefined);
  }

  async function copyTodo(): Promise<void> {
    try {
      await navigator.clipboard.writeText(todoText);
      setCopyStatus('Todo copied');
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  return (
    <div ref={shellRef} tabIndex={-1} onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-w-0 flex-col overflow-hidden bg-[var(--bg-graph)]">
          <div className="grid h-8 shrink-0 grid-cols-[118px_74px_minmax(0,1fr)_74px] items-center border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
            <span>Action</span>
            <span>Commit</span>
            <span>Message</span>
            <span className="text-right">Move</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {draft.map((item, index) => (
              <RebaseTodoRow
                key={item.sha}
                item={item}
                index={index}
                isRunning={isRunning}
                isSelected={selectedItem?.sha === item.sha}
                isDragged={draggedSha === item.sha}
                onSelect={() => setSelectedIndex(index)}
                onDragStart={() => setDraggedSha(item.sha)}
                onDragEnd={() => setDraggedSha(undefined)}
                onDrop={(event) => handleDrop(event, item.sha)}
                onChangeAction={(action) => updateAction(item.sha, action)}
                onMove={(direction) => moveItem(item.sha, direction)}
                canMoveUp={index > 0}
                canMoveDown={index < draft.length - 1}
              />
            ))}
          </div>
        </section>

        <aside className="hidden min-w-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)] xl:flex">
          {selectedItem ? (
            <CommitPreview
              item={selectedItem}
              index={selectedIndex}
              total={draft.length}
              isRunning={isRunning}
              onChangeMessage={(message) => updateMessage(selectedItem.sha, message)}
            />
          ) : null}
        </aside>
      </div>

      <footer className="flex min-h-16 shrink-0 items-end justify-between gap-4 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-3">
        <ShortcutRail validationMessage={validationMessage} copyStatus={copyStatus} />
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-subtle h-9 text-xs" type="button" onClick={copyTodo} disabled={isRunning}>
            <Clipboard size={13} />
            Copy todo
          </button>
          <button className="btn-subtle h-9 text-xs" type="button" onClick={resetDraft} disabled={isRunning}>
            <RotateCcw size={13} />
            Reset
          </button>
          <button
            className="btn-subtle h-9 border-[var(--danger-border)] text-xs text-[var(--danger-text)]"
            type="button"
            onClick={onClose}
            disabled={isRunning}
          >
            Cancel Rebase
          </button>
          <button className="btn-accent h-9 text-xs" type="button" onClick={() => void handleRun()} disabled={!canRun}>
            {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Start Rebase
          </button>
        </div>
      </footer>
    </div>
  );
}

function RebaseTodoRow({
  item,
  index,
  isRunning,
  isSelected,
  isDragged,
  onSelect,
  onDragStart,
  onDragEnd,
  onDrop,
  onChangeAction,
  onMove,
  canMoveUp,
  canMoveDown
}: {
  item: RebaseDraftItem;
  index: number;
  isRunning: boolean;
  isSelected: boolean;
  isDragged: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onChangeAction: (action: GitInteractiveRebaseAction) => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}): ReactElement {
  return (
    <div
      draggable={!isRunning}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="mx-4 grid min-h-9 cursor-pointer grid-cols-[118px_74px_minmax(0,1fr)_74px] items-start gap-2 rounded-md px-0 py-1.5"
      style={{
        background: isSelected ? 'var(--select-bg)' : undefined,
        boxShadow: isSelected ? 'inset 0 0 0 1px var(--select-border)' : undefined,
        opacity: isDragged ? 0.54 : 1
      }}
    >
      <select
        className="h-8 rounded border border-[var(--success-text)] bg-[var(--bg-field)] px-2 text-xs font-semibold text-[var(--text-1)] outline-none"
        value={item.action}
        disabled={isRunning}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChangeAction(event.target.value as GitInteractiveRebaseAction)}
        aria-label={`Action for ${item.shortSha}`}
      >
        {actionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="flex h-8 items-center">
        <div className="flex h-7 min-w-14 items-center gap-1.5 rounded bg-[var(--bg-surface)] px-2 text-[10.5px] font-semibold text-[var(--text-2)]">
          <GripVertical size={12} className="text-[var(--text-3)]" />
          <span className="mono">{index + 1}</span>
        </div>
      </div>

      <div className="min-w-0 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-6 w-[3px] shrink-0 rounded-full"
            style={{ background: isSelected ? 'var(--accent-2)' : 'var(--border-strong)' }}
          />
          <span className="mono shrink-0 text-[11px] text-[var(--text-3)]">{item.shortSha}</span>
          <span className="min-w-0 truncate text-[13px] font-medium text-[var(--text-1)]">{item.subject}</span>
        </div>
      </div>

      <div className="flex h-8 items-center justify-end gap-1">
        <button
          className="icon-btn h-7 w-7"
          type="button"
          disabled={isRunning || !canMoveUp}
          onClick={(event) => {
            event.stopPropagation();
            onMove(-1);
          }}
          aria-label={`Move ${item.shortSha} up`}
        >
          <ArrowUp size={13} />
        </button>
        <button
          className="icon-btn h-7 w-7"
          type="button"
          disabled={isRunning || !canMoveDown}
          onClick={(event) => {
            event.stopPropagation();
            onMove(1);
          }}
          aria-label={`Move ${item.shortSha} down`}
        >
          <ArrowDown size={13} />
        </button>
      </div>
    </div>
  );
}

function CommitPreview({
  item,
  index,
  total,
  isRunning,
  onChangeMessage
}: {
  item: RebaseDraftItem;
  index: number;
  total: number;
  isRunning: boolean;
  onChangeMessage: (message: string) => void;
}): ReactElement {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-4 text-[12px] text-[var(--text-2)]">
        <span>
          commit: <span className="mono text-[var(--text-1)]">{item.shortSha}</span>
        </span>
        <span>
          {index + 1} / {total}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-field)] p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--select-border)] bg-[var(--select-bg)] text-[var(--accent-2)]">
              <GitCommit size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <span className="badge-mini capitalize">{item.action}</span>
                <span className="mono text-[11px] text-[var(--text-3)]">{item.shortSha}</span>
              </div>
              <h3 className="text-[15px] font-semibold leading-6 text-[var(--text-1)]">{item.subject}</h3>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">Commit Message</span>
            {item.action === 'reword' ? <span className="badge-mini text-[var(--accent-2)]">Editable</span> : null}
          </div>
          {item.action === 'reword' ? (
            <textarea
              className="min-h-40 w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2 text-xs leading-5 text-[var(--text-1)] outline-none focus:border-[var(--select-border)]"
              value={item.message}
              disabled={isRunning}
              onChange={(event) => onChangeMessage(event.target.value)}
              aria-label={`New message for ${item.shortSha}`}
            />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--bg-field)] p-3 text-xs leading-5 text-[var(--text-2)]">
              {item.message}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

function ShortcutRail({
  validationMessage,
  copyStatus
}: {
  validationMessage?: string;
  copyStatus?: string;
}): ReactElement {
  return (
    <div className="min-w-0 text-[11.5px] text-[var(--text-3)]">
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        <Keyboard size={13} />
        <span>shortcuts:</span>
      </div>
      {validationMessage ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[var(--danger-text)]">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="truncate">{validationMessage}</span>
        </span>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <ShortcutLabel label="Pick" value="P" />
          <ShortcutLabel label="Squash" value="S" />
          <ShortcutLabel label="Reword" value="R" />
          <ShortcutLabel label="Drop" value="D" />
          <ShortcutLabel label="Move Up" value="⌘ + ↑" />
          <ShortcutLabel label="Move Down" value="⌘ + ↓" />
          <ShortcutLabel label="Copy todo" value="⌘⇧C" />
          <ShortcutLabel label="Start" value="⌘↵" />
          {copyStatus ? (
            <span className="inline-flex items-center gap-1 text-[var(--success-text)]">
              <Check size={12} />
              {copyStatus}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ShortcutLabel({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded border border-[var(--border-strong)] bg-[var(--bg-field)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--text-2)]">
        {value}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function InactiveDialogBody({
  icon,
  label,
  onClose
}: {
  icon: ReactElement;
  label: string;
  onClose: () => void;
}): ReactElement {
  return (
    <>
      <div className="grid min-h-0 flex-1 place-items-center p-4 text-xs text-[var(--text-3)]">
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-end border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-3">
        <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </>
  );
}

function createInitialDraft(plan: GitInteractiveRebasePlan): RebaseDraftItem[] {
  return plan.commits.map((commit) => ({
    ...commit,
    action: 'pick',
    message: commit.message
  }));
}

function validateDraft(items: RebaseDraftItem[]): string | undefined {
  const firstReplayedCommit = items.find((item) => item.action !== 'drop');

  if (firstReplayedCommit?.action === 'squash' || firstReplayedCommit?.action === 'fixup') {
    return 'The first replayed commit cannot be squash or fixup.';
  }

  const emptyReword = items.find((item) => item.action === 'reword' && item.message.trim().length === 0);

  if (emptyReword) {
    return `Reword message for ${emptyReword.shortSha} cannot be empty.`;
  }

  return undefined;
}

function formatTodo(items: RebaseDraftItem[]): string {
  return items.map((item) => `${item.action} ${item.sha} ${item.subject.replace(/\s+/g, ' ').trim()}`).join('\n');
}

function actionForShortcut(key: string): GitInteractiveRebaseAction | undefined {
  const option = actionOptions.find((candidate) => candidate.shortcut.toLowerCase() === key);
  return option?.value;
}

function isEditableTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
