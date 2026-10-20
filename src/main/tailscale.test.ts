import { describe, expect, it } from 'vitest';

import { parseTailscaleStatus } from './tailscale';

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
