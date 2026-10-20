import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, GitBranch, Monitor } from 'lucide-react';

import type { RemoteMachine, RemoteMachineBranch, RemoteMachineRepository } from '@shared/types';

/** One collapsible, view-only section per configured machine. */
export function MachineSidebarSections({
  machines,
  snapshots,
  filter,
  onSetMachineEnabled,
  onRevealCommit,
  onTreeKeyDown
}: {
  machines: readonly RemoteMachine[];
  snapshots: readonly RemoteMachineRepository[];
  filter: string;
  onSetMachineEnabled: (machine: RemoteMachine, enabled: boolean) => void;
  onRevealCommit: (sha: string) => void;
  onTreeKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}): ReactElement | null {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const normalizedFilter = filter.trim().toLowerCase();

  return (
    <>
      {machines.map((machine) => {
        const snapshot = snapshots.find((candidate) => candidate.machine.id === machine.id);
        const isExpanded = machine.enabled && !collapsed[machine.id];
        const branches = (snapshot?.branches ?? []).filter((branch) => branch.name.toLowerCase().includes(normalizedFilter));
        const state = machineStateLabel(machine, snapshot);

        return (
          <section key={machine.id} className="sidebar-section m-0" role="group" aria-label={`${machine.name}, view-only`}>
            <div className="side-section-header">
              <button
                className="side-section side-section--with-action"
                type="button"
                role="treeitem"
                aria-expanded={isExpanded}
                aria-level={1}
                disabled={!machine.enabled}
                title={`${machine.name} via ${machine.sshHost}: ${state.title}`}
                onClick={() => setCollapsed((value) => ({ ...value, [machine.id]: !value[machine.id] }))}
                onKeyDown={onTreeKeyDown}
              >
                {isExpanded ? (
                  <ChevronDown size={13} className="shrink-0 text-[var(--text-3)]" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-[var(--text-3)]" />
                )}
                <Monitor size={14} className="shrink-0 text-[var(--machine)]" aria-hidden="true" />
                <span className="min-w-0 truncate text-left uppercase">{machine.name}</span>
                <span className="min-w-0 flex-1 truncate text-left text-[11px] font-normal normal-case text-[var(--text-3)]">
                  {state.label}
                </span>
                {snapshot && machine.enabled ? (
                  <span className="shrink-0 text-[11px] font-normal text-[var(--text-3)]">{snapshot.branches.length}</span>
                ) : null}
              </button>
              <button
                className="side-section-action"
                type="button"
                aria-label={machine.enabled ? `Hide ${machine.name} from the graph` : `Show ${machine.name} in the graph`}
                title={machine.enabled ? `Hide ${machine.name} from the graph` : `Show ${machine.name} in the graph`}
                onClick={() => onSetMachineEnabled(machine, !machine.enabled)}
              >
                {machine.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
            {isExpanded ? (
              <div className="py-1" data-stale={snapshot && !snapshot.current ? 'true' : undefined}>
                {branches.map((branch) => (
                  <MachineBranchRow
                    key={branch.name}
                    machineName={machine.name}
                    branch={branch}
                    onReveal={() => onRevealCommit(branch.sha)}
                    onTreeKeyDown={onTreeKeyDown}
                  />
                ))}
                {snapshot && branches.length === 0 ? (
                  <div className="px-[34px] py-1.5 text-xs text-[var(--text-3)]">
                    {snapshot.state === 'online' || snapshot.branches.length > 0 ? 'No branches.' : snapshot.message ?? 'Unavailable.'}
                  </div>
                ) : null}
                {!snapshot ? <div className="px-[34px] py-1.5 text-xs text-[var(--text-3)]">Connecting…</div> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function MachineBranchRow({
  machineName,
  branch,
  onReveal,
  onTreeKeyDown
}: {
  machineName: string;
  branch: RemoteMachineBranch;
  onReveal: () => void;
  onTreeKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}): ReactElement {
  const meta = [
    branch.ahead > 0 ? `↑${branch.ahead}` : '',
    branch.behind > 0 ? `↓${branch.behind}` : '',
    branch.upstream ? '' : 'local'
  ].filter(Boolean).join(' ');

  return (
    <div
      className="side-row"
      style={{ paddingLeft: 34 }}
      role="treeitem"
      aria-level={2}
      tabIndex={-1}
      title={`${branch.name} on ${machineName}${branch.current ? ' (checked out there)' : ''}${branch.upstream ? `, tracks ${branch.upstream}` : ', no upstream'}\nDouble-click to show it in the graph.`}
      onDoubleClick={onReveal}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onReveal();
          return;
        }
        onTreeKeyDown(event);
      }}
    >
      <span className="side-row-icon">
        {branch.current ? <Check size={12} className="text-[var(--machine)]" aria-label="checked out" /> : <GitBranch size={12} />}
      </span>
      <span className="side-row-label">{branch.name}</span>
      {meta ? <span className="side-row-meta">{meta}</span> : null}
    </div>
  );
}

function machineStateLabel(machine: RemoteMachine, snapshot: RemoteMachineRepository | undefined): { label: string; title: string } {
  if (!machine.enabled) return { label: 'hidden', title: 'hidden from the graph' };
  if (!snapshot) return { label: '…', title: 'connecting' };
  if (snapshot.state === 'missing') return { label: 'not found', title: snapshot.message ?? 'no checkout at this path' };
  if (!snapshot.current) {
    const time = new Date(snapshot.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { label: snapshot.status ? `offline · as of ${time}` : 'offline', title: snapshot.message ?? 'unreachable' };
  }
  return { label: 'online', title: `online, checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}` };
}
