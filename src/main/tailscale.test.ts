import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn<(executable: string, args: string[], options: unknown, callback: (error: NodeJS.ErrnoException | null, stdout: string) => void) => void>()
}));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import { parseTailscaleStatus, readTailscaleStatus } from './tailscale';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Windows Tailscale discovery', () => {
  it('finds the MSI install without Tailscale on PATH', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('ProgramFiles', 'D:\\Applications');
    mocks.execFile.mockImplementation((executable, _args, _options, callback) => {
      callback(executable === 'D:\\Applications\\Tailscale\\tailscale.exe' ? null : Object.assign(new Error('missing'), { code: 'ENOENT' }),
        executable === 'D:\\Applications\\Tailscale\\tailscale.exe' ? '{"BackendState":"Running"}' : '');
    });
    await expect(readTailscaleStatus()).resolves.toMatchObject({ state: 'running' });
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to PATH when the standard install is absent', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    mocks.execFile.mockImplementation((executable, _args, _options, callback) => {
      callback(executable === 'tailscale' ? null : Object.assign(new Error('missing'), { code: 'ENOENT' }),
        executable === 'tailscale' ? '{"BackendState":"Running"}' : '');
    });
    await expect(readTailscaleStatus()).resolves.toMatchObject({ state: 'running' });
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
});

describe('tailscale status parsing', () => {
  it('lists computers on the tailnet, online and Tailscale SSH first, without phones', () => {
    const status = parseTailscaleStatus({
      BackendState: 'Running',
      CurrentTailnet: { Name: 'me@example.com' },
      Self: { DNSName: 'mac.tail1.ts.net.' },
      Peer: {
        a: { DNSName: 'nas.tail1.ts.net.', OS: 'linux', Online: false },
        b: { DNSName: 'omarchy.tail1.ts.net.', OS: 'linux', Online: true, sshHostKeys: ['ssh-ed25519 AAAA'] },
        c: { DNSName: 'iphone.tail1.ts.net.', OS: 'iOS', Online: true },
        d: { DNSName: 'box.tail1.ts.net.', OS: 'linux', Online: true },
        e: { OS: 'linux', Online: true }
      }
    });

    expect(status).toEqual({
      state: 'running',
      tailnet: 'me@example.com',
      peers: [
        { name: 'omarchy', host: 'omarchy.tail1.ts.net', os: 'linux', online: true, tailscaleSsh: true },
        { name: 'box', host: 'box.tail1.ts.net', os: 'linux', online: true, tailscaleSsh: false },
        { name: 'nas', host: 'nas.tail1.ts.net', os: 'linux', online: false, tailscaleSsh: false }
      ]
    });
  });

  it('reports a stopped or signed-out Tailscale', () => {
    expect(parseTailscaleStatus({ BackendState: 'Stopped' })).toMatchObject({ state: 'stopped' });
    expect(parseTailscaleStatus({ BackendState: 'NeedsLogin' })).toMatchObject({ state: 'stopped', message: expect.stringMatching(/Sign in/) });
    expect(parseTailscaleStatus(null)).toMatchObject({ state: 'stopped' });
  });
});
