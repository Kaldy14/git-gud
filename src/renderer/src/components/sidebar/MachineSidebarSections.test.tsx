import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RemoteMachine, RemoteMachineRepository } from '@shared/types';

import { MachineSidebarSections } from './MachineSidebarSections';

describe('machine branch sync status', () => {
  const machine: RemoteMachine = { id: 'm1', name: 'Other PC', sshHost: 'other', enabled: true, createdAt: 'now', updatedAt: 'now' };
  const snapshot: RemoteMachineRepository = {
    machine, remotePath: '~/repo', state: 'online', current: true, checkedAt: '2026-10-20T10:00:00Z',
    branches: [{ name: 'main', sha: 'a'.repeat(40), ahead: 0, behind: 0, current: true }]
  };
  const render = (value: RemoteMachineRepository) => renderToStaticMarkup(
    <MachineSidebarSections machines={[machine]} snapshots={[value]} filter="" onSetMachineEnabled={() => {}} onRevealCommit={() => {}} onTreeKeyDown={() => {}} />
  );

  it('shows a fetch failure even when the checkout has no WIP panel', () => {
    const html = render({ ...snapshot, message: 'Branch tips could not be fetched: index locked' });
    expect(html).toContain('sync failed');
    expect(html).toContain('Branches may be missing or outdated.');
    expect(html).toContain('Branch tips could not be fetched: index locked');
    expect(html).toContain('role="status"');
  });

  it('clears the warning after branch synchronization succeeds', () => {
    const html = render(snapshot);
    expect(html).toContain('online');
    expect(html).not.toContain('sync failed');
    expect(html).not.toContain('role="status"');
  });
});
