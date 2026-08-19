import type { GitBranchRef, GitRefsSummary, GitRemote, GitRemoteBranchRef, GitTagRef } from '@shared/types';

export function parseForEachRef(output: string): GitRefsSummary {
  const localBranches: GitBranchRef[] = [];
  const remoteBranches: GitRemoteBranchRef[] = [];
  const tags: GitTagRef[] = [];

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const [fullName, name, sha, upstream, track, head, date, objectType, peeledSha, peeledType] = line.split('\0');

    if (!fullName || !name || !sha) {
      continue;
    }

    if (fullName.startsWith('refs/heads/')) {
      const counts = parseTrackCounts(track);
      localBranches.push({
        name,
        fullName,
        sha,
        current: head === '*',
        upstream: upstream || undefined,
        ahead: counts.ahead,
        behind: counts.behind
      });
      continue;
    }

    if (fullName.startsWith('refs/remotes/')) {
      if (fullName.endsWith('/HEAD')) {
        continue;
      }

      remoteBranches.push({
        name,
        fullName,
        sha,
        remote: name.split('/')[0] ?? name
      });
      continue;
    }

    if (fullName.startsWith('refs/tags/')) {
      tags.push({
        name,
        fullName,
        sha: objectType === 'tag' && peeledSha && peeledType === 'commit' ? peeledSha : sha,
        date: date || undefined
      });
    }
  }

  localBranches.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  remoteBranches.sort((a, b) => a.name.localeCompare(b.name));
  tags.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    localBranches,
    remoteBranches,
    tags
  };
}

export function parseRemoteVerbose(output: string): GitRemote[] {
  const remotes = new Map<string, GitRemote>();

  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const [, name, url, direction] = match;
    const remote = remotes.get(name) ?? { name };

    if (direction === 'fetch') {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
    }

    remotes.set(name, remote);
  }

  return [...remotes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function parseRemoteConfig(output: string): GitRemote[] {
  const remotes = new Map<string, GitRemote>();

  for (const entry of output.split('\0')) {
    const separatorIndex = entry.indexOf('\n');

    if (separatorIndex < 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex);
    const url = entry.slice(separatorIndex + 1);
    const match = /^remote\.(.+)\.(url|pushurl)$/.exec(key);

    if (!match || !url) {
      continue;
    }

    const [, name, kind] = match;
    const remote = remotes.get(name) ?? { name };

    if (kind === 'url') {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
      remote.pushUrlExplicit = true;
    }

    remotes.set(name, remote);
  }

  return [...remotes.values()]
    .map((remote) => ({
      ...remote,
      pushUrl: remote.pushUrl ?? remote.fetchUrl,
      pushUrlExplicit: remote.pushUrlExplicit ?? false
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseTrackCounts(track: string | undefined): { ahead: number; behind: number } {
  if (!track) {
    return { ahead: 0, behind: 0 };
  }

  const aheadMatch = /ahead (\d+)/.exec(track);
  const behindMatch = /behind (\d+)/.exec(track);

  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0
  };
}
