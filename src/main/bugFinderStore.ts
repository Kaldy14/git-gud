import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import type {
  BugFinderState,
  BugFinding,
  BugFindingContent
} from '@shared/bugFinder';
import type { GitHubPullRequestLocator } from '@shared/types';

export class BugFinderStore {
  private states: Record<string, BugFinderState>;
  constructor(private readonly path: string) {
    this.states = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : {};
    // An interrupted scan cannot remain running forever after restarting the app.
    for (const state of Object.values(this.states)) {
      if (state.status === 'running') {
        state.status = 'failed';
        state.error = 'Scan interrupted. Run again.';
      }
      for (const finding of state.findings)
        if (finding.publication?.status === 'posting')
          finding.publication.status = 'uncertain';
    }
  }
  get(locator: GitHubPullRequestLocator): BugFinderState {
    return structuredClone(
      this.states[this.key(locator)] ?? { status: 'idle', findings: [] }
    );
  }
  save(locator: GitHubPullRequestLocator, state: BugFinderState): void {
    const next = {
      ...this.states,
      [this.key(locator)]: structuredClone(state)
    };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    renameSync(temp, this.path);
    this.states = next;
  }
  private key(l: GitHubPullRequestLocator): string {
    return JSON.stringify([
      l.profileId,
      l.owner.toLowerCase(),
      l.repository.toLowerCase(),
      l.number
    ]);
  }
}
export function newBugFinding(
  content: BugFindingContent,
  headSha: string,
  actor: string
): BugFinding {
  return {
    ...content,
    id: randomUUID(),
    version: 1,
    headSha,
    status: 'open',
    history: [{ at: new Date().toISOString(), actor, action: 'add' }]
  };
}
export function checkedFinding(
  state: BugFinderState,
  id: string,
  version: number
): BugFinding {
  const finding = state.findings.find((f) => f.id === id);
  if (!finding || finding.version !== version)
    throw new Error('CONFLICT: Finding changed. Reload before editing.');
  return finding;
}
export function reconcileBugScan(
  state: BugFinderState,
  content: BugFindingContent[],
  headSha: string
): BugFinding[] {
  const findings = structuredClone(state.findings);
  for (const item of content) {
    // Preserve human/agent decisions. Only untouched scan records are refreshed automatically.
    const match = findings.find(
      (f) =>
        f.location.path === item.location.path &&
        f.location.side === item.location.side &&
        f.title.toLowerCase() === item.title.toLowerCase()
    );
    if (!match) findings.push(newBugFinding(item, headSha, 'scan'));
    else if (
      match.history.every((entry) => entry.actor === 'scan') &&
      match.status === 'open' &&
      !match.publication
    ) {
      Object.assign(match, item, { headSha });
      match.version++;
      match.history.push({
        at: new Date().toISOString(),
        actor: 'scan',
        action: 'revalidated'
      });
    }
  }
  return findings;
}
