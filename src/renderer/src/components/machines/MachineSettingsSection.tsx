import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Monitor, Plus, Plug, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';

import { useMachines, useTailscaleStatus } from '@renderer/queries/repository';
import type { RemoteMachine, RemoteMachineInput, RemoteMachineTestResult, TailscalePeer } from '@shared/types';

type TestState = RemoteMachineTestResult | 'pending';

/** Adds, tests, hides, and removes view-only SSH machines. Changes apply immediately, independent of Save Settings. */
export function MachineSettingsSection({ heading }: { heading: ReactNode }): ReactElement {
  const queryClient = useQueryClient();
  const machines = useMachines();
  const tailscale = useTailscaleStatus();
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [name, setName] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [errorMessage, setErrorMessage] = useState<string>();

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['machines'] }),
      queryClient.invalidateQueries({ queryKey: ['commit-graph-machines'] }),
      queryClient.invalidateQueries({ queryKey: ['commit-graph'] })
    ]);
  }

  const save = useMutation({
    mutationFn: (input: RemoteMachineInput) => window.api.saveMachine(input),
    onSuccess: refresh,
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Could not save the machine.')
  });
  const remove = useMutation({
    mutationFn: (id: string) => window.api.deleteMachine(id),
    onSuccess: refresh,
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Could not remove the machine.')
  });

  async function runTest(key: string, input: RemoteMachineInput): Promise<RemoteMachineTestResult> {
    setTests((value) => ({ ...value, [key]: 'pending' }));
    const result = await window.api.testMachine(input).catch((error: unknown): RemoteMachineTestResult => ({
      ok: false,
      message: error instanceof Error ? error.message : 'Test failed.'
    }));
    setTests((value) => ({ ...value, [key]: result }));
    return result;
  }

  /** Adds a tailnet device after a successful connection test, or straight away when the user insists. */
  async function addPeer(peer: TailscalePeer, skipTest = false): Promise<void> {
    setErrorMessage(undefined);
    const input = { name: peer.name, sshHost: peer.host, enabled: true };
    if (!skipTest && !(await runTest(peer.host, input)).ok) return;
    save.mutate(input);
  }

  function handleAdd(): void {
    if (!name.trim() || !sshHost.trim()) return;
    setErrorMessage(undefined);
    save.mutate(
      { name: name.trim(), sshHost: sshHost.trim(), enabled: true },
      {
        onSuccess: () => {
          setName('');
          setSshHost('');
          setTests((value) => {
            const next = { ...value };
            delete next.new;
            return next;
          });
        }
      }
    );
  }

  function preventFormSubmit(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAdd();
    }
  }

  const isBusy = save.isPending || remove.isPending;
  const status = tailscale.data;
  const isManualShown = isManualOpen || (status !== undefined && status.state !== 'running');

  return (
    <section className="space-y-3 border-b border-[var(--border)] py-4" aria-label="Machines">
      {heading}
      <p className="text-[11px] leading-5 text-[var(--text-3)]">
        See another computer's branches and uncommitted changes in the graph. Git Gud looks for the same repository
        path under that computer's home folder and only reads it; it never changes anything there.
      </p>

      {(machines.data ?? []).map((machine) => (
        <MachineRow
          key={machine.id}
          machine={machine}
          test={tests[machine.id]}
          isBusy={isBusy}
          onToggle={(enabled) => save.mutate({ id: machine.id, name: machine.name, sshHost: machine.sshHost, enabled })}
          onTest={() => void runTest(machine.id, machine)}
          onRemove={() => remove.mutate(machine.id)}
        />
      ))}

      <div className="rounded border border-[var(--border)] bg-[var(--bg-field)]" aria-label="Tailscale devices" role="group">
        <div className="flex h-9 items-center gap-2 border-b border-[var(--border)] px-3">
          <span className="text-xs font-semibold text-[var(--text-1)]">Add from Tailscale</span>
          {status?.state === 'running' && status.tailnet ? (
            <span className="min-w-0 truncate text-[11px] text-[var(--text-3)]">{status.tailnet}</span>
          ) : null}
          <button
            className="icon-btn ml-auto h-7 w-7"
            type="button"
            onClick={() => void tailscale.refetch()}
            disabled={tailscale.isFetching}
            aria-label="Refresh Tailscale devices"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {!status ? (
          <p className="flex items-center gap-1.5 px-3 py-3 text-[11px] text-[var(--text-3)]">
            <Loader2 size={12} aria-hidden="true" /> Looking for Tailscale…
          </p>
        ) : status.state === 'missing' ? (
          <p className="px-3 py-3 text-[11px] leading-5 text-[var(--text-2)]">
            Tailscale isn't installed. Install it on both computers and sign in with the same account to pick a machine
            here, or enter an SSH host below.
          </p>
        ) : status.state === 'stopped' ? (
          <p className="px-3 py-3 text-[11px] leading-5 text-[var(--text-2)]">{status.message}</p>
        ) : status.peers.length === 0 ? (
          <p className="px-3 py-3 text-[11px] leading-5 text-[var(--text-2)]">No other computers on your tailnet yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {status.peers.map((peer) => (
              <TailscalePeerRow
                key={peer.host}
                peer={peer}
                isAdded={(machines.data ?? []).some((machine) => matchesPeer(machine, peer))}
                isBusy={isBusy}
                test={tests[peer.host]}
                onAdd={(skipTest) => void addPeer(peer, skipTest)}
              />
            ))}
          </ul>
        )}

        {status?.state === 'running' && !isManualOpen ? (
          <button
            className="w-full border-t border-[var(--border)] px-3 py-2 text-left text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)]"
            type="button"
            onClick={() => setIsManualOpen(true)}
          >
            Use an SSH host instead…
          </button>
        ) : null}

        {isManualShown ? (
          <div className="border-t border-[var(--border)] px-3 py-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] text-[var(--text-3)]">
                Name
                <input
                  className="mt-1 h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
                  value={name}
                  placeholder="omarchy"
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={preventFormSubmit}
                />
              </label>
              <label className="block text-[11px] text-[var(--text-3)]">
                SSH host
                <input
                  className="mt-1 font-mono h-8 w-full rounded border border-[var(--border)] bg-[var(--bg-panel)] px-2.5 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
                  value={sshHost}
                  placeholder="omarchy or user@host"
                  maxLength={253}
                  spellCheck={false}
                  autoCapitalize="off"
                  onChange={(event) => setSshHost(event.target.value)}
                  onKeyDown={preventFormSubmit}
                />
              </label>
            </div>
            <TestResult test={tests.new} />
            <div className="mt-3 flex items-center gap-2">
              <button
                className="btn-primary h-8 text-xs"
                type="button"
                disabled={isBusy || !name.trim() || !sshHost.trim()}
                onClick={handleAdd}
              >
                <Plus size={12} />
                Add machine
              </button>
              <button
                className="btn-subtle h-8 text-xs"
                type="button"
                disabled={!sshHost.trim() || tests.new === 'pending'}
                onClick={() => void runTest('new', { name: name.trim() || sshHost.trim(), sshHost: sshHost.trim() })}
              >
                <Plug size={12} />
                Test connection
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {errorMessage ? <p className="text-[11px] text-[var(--danger-text)]" role="alert">{errorMessage}</p> : null}
    </section>
  );
}

function TailscalePeerRow({
  peer,
  isAdded,
  isBusy,
  test,
  onAdd
}: {
  peer: TailscalePeer;
  isAdded: boolean;
  isBusy: boolean;
  test: TestState | undefined;
  onAdd: (skipTest: boolean) => void;
}): ReactElement {
  const failure = test !== undefined && test !== 'pending' && !test.ok ? test : undefined;
  const failed = failure !== undefined;

  return (
    <li className={`px-3 py-1.5 ${peer.online || isAdded ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <Monitor size={14} className="shrink-0 text-[var(--machine)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[var(--text-1)]">{peer.name}</span>
          <span className="block truncate text-[11px] text-[var(--text-3)]">
            {[peer.os, peer.online ? 'online' : 'offline', peer.tailscaleSsh ? 'Tailscale SSH' : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        {isAdded ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-2)]">
            <Check size={12} aria-hidden="true" /> Added
          </span>
        ) : test === 'pending' ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-3)]">
            <Loader2 size={12} aria-hidden="true" /> Connecting…
          </span>
        ) : (
          <button
            className="btn-subtle h-7 shrink-0 text-xs"
            type="button"
            disabled={isBusy}
            onClick={() => onAdd(failed)}
            aria-label={failed ? `Add ${peer.name} anyway` : `Add ${peer.name}`}
          >
            <Plus size={12} />
            {failed ? 'Add anyway' : 'Add'}
          </button>
        )}
      </div>
      {failure && !isAdded ? (
        <p className="mt-1.5 flex items-start gap-1.5 pl-[22px] text-[11px] leading-5 text-[var(--danger-text)]" role="alert">
          <TriangleAlert size={12} className="mt-1 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {failure.message}
            {peer.tailscaleSsh ? null : (
              <span className="text-[var(--text-2)]">
                {' '}To turn on SSH there, run <code className="font-mono">sudo tailscale set --ssh</code> on {peer.name}.
              </span>
            )}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function matchesPeer(machine: RemoteMachine, peer: TailscalePeer): boolean {
  const host = machine.sshHost.slice(machine.sshHost.lastIndexOf('@') + 1).toLowerCase();
  return host === peer.host.toLowerCase() || host === peer.name.toLowerCase();
}

function MachineRow({
  machine,
  test,
  isBusy,
  onToggle,
  onTest,
  onRemove
}: {
  machine: RemoteMachine;
  test: TestState | undefined;
  isBusy: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Monitor size={14} className="shrink-0 text-[var(--machine)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[var(--text-1)]">{machine.name}</span>
          <span className="block truncate font-mono text-[11px] text-[var(--text-3)]">{machine.sshHost}</span>
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-2)]">
          <input type="checkbox" checked={machine.enabled} disabled={isBusy} onChange={(event) => onToggle(event.target.checked)} />
          In graph
        </label>
        <button className="icon-btn h-7 w-7" type="button" onClick={onTest} disabled={test === 'pending'} aria-label={`Test ${machine.name}`} title="Test connection">
          <Plug size={13} />
        </button>
        <button
          className="icon-btn h-7 w-7"
          type="button"
          onClick={onRemove}
          disabled={isBusy}
          aria-label={`Remove ${machine.name}`}
          title="Remove (deletes only Git Gud's local copy of its refs)"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <TestResult test={test} />
    </div>
  );
}

function TestResult({ test }: { test: TestState | undefined }): ReactElement | null {
  if (!test) return null;
  if (test === 'pending') {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
        <Loader2 size={12} aria-hidden="true" /> Connecting…
      </p>
    );
  }
  return (
    <p
      className={`mt-2 flex items-start gap-1.5 text-[11px] leading-5 ${test.ok ? 'text-[var(--text-2)]' : 'text-[var(--danger-text)]'}`}
      role={test.ok ? 'status' : 'alert'}
    >
      {test.ok ? <Check size={12} className="mt-1 shrink-0" aria-hidden="true" /> : <TriangleAlert size={12} className="mt-1 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 break-words">{test.message}</span>
    </p>
  );
}
