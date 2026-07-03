/**
 * Hand-authored preview dataset for the commit graph shell.
 * Rendered until the real Git log/lane engine lands in M2, so the
 * UI can be designed and reviewed against realistic content.
 */

export const LANE_COLORS = ['#4c9df3', '#b46bf5', '#2ec8a6', '#f0a13f', '#ef5b9c', '#e8615a'] as const;

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export type CommitAuthor = {
  name: string;
  initials: string;
  color: string;
};

export type GraphNodeKind = 'commit' | 'merge' | 'wip' | 'stash';

export type RefChipKind = 'branch' | 'remote' | 'tag' | 'stash' | 'wip';

export type RefChip = {
  label: string;
  kind: RefChipKind;
};

export type RailSegment =
  | { type: 'through'; lane: number }
  | { type: 'stopTop'; lane: number }
  | { type: 'startBottom'; lane: number }
  | { type: 'curveIn'; from: number; to: number }
  | { type: 'curveOut'; from: number; to: number };

export type SampleFileStatus = 'modified' | 'added' | 'deleted';

export type SampleFile = {
  path: string;
  status: SampleFileStatus;
};

export type GraphRow = {
  sha: string;
  subject: string;
  body?: string;
  author: CommitAuthor;
  dateLabel: string;
  node: { lane: number; kind: GraphNodeKind };
  /** Node/chip color override (used by stash and WIP rows). */
  colorOverride?: string;
  rails: RailSegment[];
  refs?: RefChip[];
  dateMarker?: string;
  files: SampleFile[];
};

const KALDY: CommitAuthor = { name: 'Kaldy', initials: 'K', color: '#38bdf8' };
const VOSIME: CommitAuthor = { name: 'Vosime', initials: 'V', color: '#c084fc' };

function f(path: string, status: SampleFileStatus): SampleFile {
  return { path, status };
}

export const SAMPLE_GRAPH_ROWS: GraphRow[] = [
  {
    sha: 'wip',
    subject: '// WIP',
    author: KALDY,
    dateLabel: 'now',
    node: { lane: 0, kind: 'wip' },
    colorOverride: '#8b95a5',
    rails: [{ type: 'startBottom', lane: 0 }],
    refs: [{ label: 'WIP', kind: 'wip' }],
    files: [
      f('src/renderer/src/workspace/WorkspaceShell.tsx', 'modified'),
      f('src/renderer/src/styles/main.css', 'modified'),
      f('src/renderer/src/components/graph/GraphView.tsx', 'added')
    ]
  },
  {
    sha: 'e3f8c21',
    subject: 'shell: rebuild workspace UI with GitKraken-style theme',
    body: 'Replaces the placeholder shell with the slate theme, stacked toolbar, ref sidebar, and rail-based graph preview.',
    author: KALDY,
    dateLabel: 'Jul 2, 2026 · 9:41 AM',
    node: { lane: 0, kind: 'commit' },
    rails: [{ type: 'through', lane: 0 }],
    refs: [
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ],
    dateMarker: '2 hours ago',
    files: [
      f('src/renderer/src/styles/main.css', 'modified'),
      f('src/renderer/src/workspace/WorkspaceShell.tsx', 'modified'),
      f('src/renderer/src/components/toolbar/Toolbar.tsx', 'added'),
      f('src/renderer/src/components/sidebar/Sidebar.tsx', 'added'),
      f('src/renderer/src/components/statusbar/StatusBar.tsx', 'added')
    ]
  },
  {
    sha: 'a91d4be',
    subject: 'graph: virtualize rows with TanStack Virtual',
    body: 'Rows render through a virtualizer so 1,500-commit pages stay smooth.',
    author: VOSIME,
    dateLabel: 'Jul 2, 2026 · 8:05 AM',
    node: { lane: 1, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'startBottom', lane: 1 }
    ],
    refs: [{ label: 'feature/commit-graph', kind: 'branch' }],
    files: [
      f('src/renderer/src/components/graph/GraphView.tsx', 'modified'),
      f('src/renderer/src/components/graph/useRowVirtualizer.ts', 'added')
    ]
  },
  {
    sha: '7c02f9d',
    subject: 'graph: add per-row SVG rail renderer',
    author: VOSIME,
    dateLabel: 'Jul 2, 2026 · 6:18 AM',
    node: { lane: 1, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 }
    ],
    dateMarker: '5 hours ago',
    files: [
      f('src/renderer/src/components/graph/RailCell.tsx', 'added'),
      f('src/renderer/src/components/graph/GraphView.tsx', 'modified'),
      f('src/renderer/src/theme/lanes.ts', 'added')
    ]
  },
  {
    sha: 'f5b7a10',
    subject: 'profiles: apply repo-local identity on assignment',
    body: 'Writes user.name/user.email into repo-local config when a profile is attached to a tab.',
    author: KALDY,
    dateLabel: 'Jul 1, 2026 · 10:52 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 }
    ],
    files: [
      f('src/main/profiles.ts', 'added'),
      f('src/shared/types.ts', 'modified'),
      f('src/main/store.ts', 'modified')
    ]
  },
  {
    sha: '2d6e88c',
    subject: 'WIP on feature/commit-graph: lane engine spike',
    author: VOSIME,
    dateLabel: 'Jul 1, 2026 · 9:03 PM',
    node: { lane: 2, kind: 'stash' },
    colorOverride: '#f0a13f',
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'curveOut', from: 2, to: 1 }
    ],
    refs: [{ label: 'stash@{0}', kind: 'stash' }],
    files: [
      f('src/renderer/src/components/graph/laneEngine.ts', 'modified'),
      f('src/renderer/src/components/graph/laneEngine.test.ts', 'modified')
    ]
  },
  {
    sha: '90cbe4f',
    subject: 'graph: topo-order parser with NUL-safe fields',
    body: 'Parses the flat NUL token stream by fixed field count instead of naive record splitting.',
    author: VOSIME,
    dateLabel: 'Jul 1, 2026 · 4:47 PM',
    node: { lane: 1, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 }
    ],
    dateMarker: 'yesterday',
    files: [
      f('src/main/git/parsers/log.ts', 'added'),
      f('src/main/git/parsers/log.test.ts', 'added'),
      f('src/shared/ipc.ts', 'modified')
    ]
  },
  {
    sha: 'c47a3d2',
    subject: "Merge branch 'diff-view' into main",
    author: KALDY,
    dateLabel: 'Jul 1, 2026 · 2:20 PM',
    node: { lane: 0, kind: 'merge' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'curveOut', from: 0, to: 2 }
    ],
    files: [
      f('src/renderer/src/components/diff/DiffPanel.tsx', 'modified'),
      f('package.json', 'modified')
    ]
  },
  {
    sha: '61f0ab9',
    subject: 'diffs: unified/split toggle with Shiki dark theme',
    author: KALDY,
    dateLabel: 'Jun 30, 2026 · 11:32 PM',
    node: { lane: 2, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'through', lane: 2 }
    ],
    dateMarker: '2 days ago',
    files: [
      f('src/renderer/src/components/diff/DiffPanel.tsx', 'modified'),
      f('src/renderer/src/components/diff/DiffToolbar.tsx', 'added')
    ]
  },
  {
    sha: '5be29c7',
    subject: 'diffs: wire @pierre/diffs PatchDiff rendering',
    author: KALDY,
    dateLabel: 'Jun 30, 2026 · 8:14 PM',
    node: { lane: 2, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'through', lane: 2 }
    ],
    files: [
      f('src/renderer/src/components/diff/DiffPanel.tsx', 'added'),
      f('package.json', 'modified'),
      f('pnpm-lock.yaml', 'modified')
    ]
  },
  {
    sha: '38d1c05',
    subject: 'sidebar: refs sections with live counts',
    author: KALDY,
    dateLabel: 'Jun 30, 2026 · 3:41 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'through', lane: 2 }
    ],
    files: [
      f('src/renderer/src/components/sidebar/Sidebar.tsx', 'modified'),
      f('src/renderer/src/queries/refs.ts', 'added')
    ]
  },
  {
    sha: 'de84b61',
    subject: 'tabs: persist workspace state via electron-store',
    author: KALDY,
    dateLabel: 'Jun 30, 2026 · 11:09 AM',
    node: { lane: 0, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 },
      { type: 'curveIn', from: 2, to: 0 }
    ],
    files: [
      f('src/main/store.ts', 'added'),
      f('src/shared/workspace.ts', 'added'),
      f('src/shared/workspace.test.ts', 'added')
    ]
  },
  {
    sha: '1a7f6e3',
    subject: 'graph: lane assignment engine with DAG fixtures',
    body: 'Pure lane engine over topo-ordered commits; fixtures cover linear, branch, merge, and criss-cross graphs.',
    author: VOSIME,
    dateLabel: 'Jun 29, 2026 · 9:55 PM',
    node: { lane: 1, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 }
    ],
    dateMarker: '3 days ago',
    files: [
      f('src/renderer/src/components/graph/laneEngine.ts', 'added'),
      f('src/renderer/src/components/graph/laneEngine.test.ts', 'added'),
      f('src/renderer/src/components/graph/fixtures.ts', 'added')
    ]
  },
  {
    sha: '84c92aa',
    subject: 'kernel: GitExecutor with per-repo mutation queue',
    author: KALDY,
    dateLabel: 'Jun 29, 2026 · 5:28 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'through', lane: 1 }
    ],
    refs: [{ label: 'v0.1.0', kind: 'tag' }],
    files: [
      f('src/main/git/exec.ts', 'added'),
      f('src/main/git/exec.test.ts', 'added')
    ]
  },
  {
    sha: '96e01dd',
    subject: 'ipc: typed channel map shared across processes',
    author: KALDY,
    dateLabel: 'Jun 29, 2026 · 1:16 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [
      { type: 'through', lane: 0 },
      { type: 'curveIn', from: 1, to: 0 }
    ],
    files: [
      f('src/shared/ipc.ts', 'added'),
      f('src/preload/index.ts', 'modified'),
      f('src/main/ipc.ts', 'modified')
    ]
  },
  {
    sha: '0b3da7c',
    subject: 'watcher: chokidar over resolved git/common dirs',
    author: KALDY,
    dateLabel: 'Jun 25, 2026 · 7:44 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [{ type: 'through', lane: 0 }],
    dateMarker: 'last week',
    files: [
      f('src/main/git/watcher.ts', 'added'),
      f('package.json', 'modified')
    ]
  },
  {
    sha: '4f88b12',
    subject: 'scaffold: electron-vite + react + tailwind shell',
    author: KALDY,
    dateLabel: 'Jun 25, 2026 · 2:31 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [{ type: 'through', lane: 0 }],
    files: [
      f('electron.vite.config.ts', 'added'),
      f('src/renderer/src/main.tsx', 'added'),
      f('tsconfig.json', 'added')
    ]
  },
  {
    sha: '7af5664',
    subject: 'Initial scaffold',
    author: KALDY,
    dateLabel: 'Jun 25, 2026 · 1:02 PM',
    node: { lane: 0, kind: 'commit' },
    rails: [{ type: 'stopTop', lane: 0 }],
    files: [f('.gitignore', 'added'), f('package.json', 'added'), f('PLAN.md', 'added')]
  }
];

export function findGraphRow(sha: string | undefined): GraphRow | undefined {
  return SAMPLE_GRAPH_ROWS.find((row) => row.sha === sha);
}
