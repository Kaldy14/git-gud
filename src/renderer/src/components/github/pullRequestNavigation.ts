/** A place in the Code tab: a file, optionally a line range on one side of the diff, optionally a thread on it. */
export type PullRequestCodeLocation = { path: string; line?: number; endLine?: number; side?: 'left' | 'right'; commentId?: number };

