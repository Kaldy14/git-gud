import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteMachine } from '@shared/types';

const data = vi.hoisted(() => ({ machines: [] as RemoteMachine[] }));
vi.mock('electron-store', () => ({
  default: class {
    get() { return data.machines; }
    set(_key: string, value: RemoteMachine[]) { data.machines = value; }
  }
}));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('./profiles', () => ({ createProfileCommandEnv: vi.fn() }));
vi.mock('./git/exec', () => ({
  gitExecutor: {
    run: vi.fn(),
    transaction: vi.fn((_directory: string, operation: () => Promise<unknown>) => operation())
  }
}));

import { gitExecutor } from './git/exec';
import { loadCommitGraphMachines, saveMachine, type RefMutationRunner } from './machines';

beforeEach(() => {
  vi.clearAllMocks();
  data.machines = [];
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    queueMicrotask(() => {
      child.stdout.end('__GG_MISSING__');
      child.emit('close', 0);
    });
    return child as ReturnType<typeof spawn>;
  });
});

describe('missing machine checkout', () => {
  it.each([true, false])('prunes only its mirrored refs and reports graph invalidation when refs exist=%s', async (hasRefs) => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const ref = `refs/machines/${machine!.id}/heads/main`;
    vi.mocked(gitExecutor.run).mockResolvedValue({ stdout: hasRefs ? `${ref}\n` : '', stderr: '', exitCode: 0 });
    const guard = vi.fn<RefMutationRunner>((_directory, operation) => operation());
    const tab = { path: '/repo', commonDir: '/repo/.git' };

    const result = await loadCommitGraphMachines(tab, guard);

    expect(result.refsChanged).toBe(hasRefs);
    expect(result.machines[0]).toMatchObject({ state: 'missing', current: true, branches: [] });
    expect(gitExecutor.transaction).toHaveBeenCalledWith(tab.commonDir, expect.any(Function));
    expect(guard).toHaveBeenCalledWith(tab.commonDir, expect.any(Function));
    if (hasRefs) {
      expect(gitExecutor.run).toHaveBeenCalledWith(['update-ref', '--stdin'], {
        cwd: '/repo', kind: 'mutation', input: `delete ${ref}\n`
      });
    } else {
      expect(gitExecutor.run).toHaveBeenCalledTimes(1);
    }
  });
});
