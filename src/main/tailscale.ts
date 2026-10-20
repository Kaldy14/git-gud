import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

import type { TailscalePeer, TailscaleStatus } from '@shared/types';

const STATUS_TIMEOUT_MS = 5_000;
// Finder-launched apps get a minimal PATH, so check the usual install locations too.
const CANDIDATES: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale']
};
// Phones and TVs can't host a git checkout over SSH.
const HIDDEN_OPERATING_SYSTEMS = new Set(['ios', 'android', 'tvos']);

/** Reads the local Tailscale status. Only runs `tailscale status --json`, which changes nothing. */
export async function readTailscaleStatus(): Promise<TailscaleStatus> {
  const candidates = process.platform === 'win32'
    ? [win32.join(process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')]
    : CANDIDATES[process.platform] ?? [];
  for (const executable of [...candidates, 'tailscale']) {
    const result = await runStatus(executable);
    if (result === 'not-found') continue;
    if (result instanceof Error) return { state: 'stopped', message: 'Tailscale is installed but not running. Turn it on and try again.' };
    try {
      return parseTailscaleStatus(JSON.parse(result));
    } catch {
      return { state: 'stopped', message: 'Tailscale returned a status Git Gud could not read.' };
    }
  }
  return { state: 'missing' };
}

export function parseTailscaleStatus(value: unknown): TailscaleStatus {
  const status = asRecord(value);
  const backendState = typeof status.BackendState === 'string' ? status.BackendState : '';
  if (backendState === 'NeedsLogin') {
    return { state: 'stopped', message: 'Sign in to Tailscale, then try again.' };
  }
  if (backendState === 'NeedsMachineAuth') {
    return { state: 'stopped', message: 'Ask a tailnet administrator to approve this device on the Machines page in the Tailscale admin console, then try again.' };
  }
  if (backendState !== 'Running') return { state: 'stopped', message: 'Tailscale is not connected. Turn it on and try again.' };

  const peers = Object.values(asRecord(status.Peer)).flatMap((candidate): TailscalePeer[] => {
    const peer = asRecord(candidate);
    const dnsName = typeof peer.DNSName === 'string' ? peer.DNSName.replace(/\.$/, '') : '';
    const os = typeof peer.OS === 'string' ? peer.OS : '';
    if (!dnsName || HIDDEN_OPERATING_SYSTEMS.has(os.toLowerCase())) return [];
    return [{
      name: dnsName.split('.')[0] ?? dnsName,
      host: dnsName,
      os,
      online: peer.Online === true,
      tailscaleSsh: Array.isArray(peer.sshHostKeys) && peer.sshHostKeys.length > 0
    }];
  });
  peers.sort((left, right) =>
    Number(right.online) - Number(left.online) ||
    Number(right.tailscaleSsh) - Number(left.tailscaleSsh) ||
    left.name.localeCompare(right.name));

  const tailnet = asRecord(status.CurrentTailnet).Name;
  return { state: 'running', tailnet: typeof tailnet === 'string' ? tailnet : undefined, peers };
}

function runStatus(executable: string): Promise<string | Error | 'not-found'> {
  return new Promise((resolve) => {
    execFile(executable, ['status', '--json'], { timeout: STATUS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error && 'code' in error && error.code === 'ENOENT') resolve('not-found');
      // A stopped daemon still prints JSON with its BackendState, sometimes with a non-zero exit.
      else if (stdout.trim().startsWith('{')) resolve(stdout);
      else resolve(error ?? new Error('Empty Tailscale status.'));
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
