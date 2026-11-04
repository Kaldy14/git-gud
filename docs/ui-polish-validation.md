# UI polish validation

These are unmodified screenshots of the running Git Gud Electron application. They show real Git history, local staging, an empty repository, a failed local clone, and read-only views of GitHub PR #4 and its workflow runs. Settings and repositories used for validation are isolated from the normal desktop workspace.

## Checks

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `TMPDIR=/private/tmp pnpm test` | 171 files, 1,346 tests passed, 4 skipped |
| `pnpm build` | Pass |
| `agent-browser --session git-gud-polish connect 9236` | Connected to the actual Electron renderer |

Focused validation at 1440×960 and 1100×760 passes 21 core checks, including history, file diffs, staging and unstaging a real file, settings, palette results and search scope, invalid clone/create forms, stash eligibility, and the empty-repository branch guard.

Keyboard resizing fits a preferred graph width from 266px to 210px and restores 266px when the window widens. The stored preference stays unchanged. Double-click resets automatic lane sizing. Inactive avatars recede to 0.42 opacity, and hover restores full emphasis; arrow keys change the palette selection, and Escape restores focus to Jump. Compact ref names reveal in full on hover. The stash checkbox keeps exactly the same position when inclusion changes.

Seventeen integration checks load the actual PR Code view, open and cancel a file comment composer, save a local Actions dashboard, and display its workflow graph. A clone from a missing local source fails with Git exit 128, keeps the entered values, and can be retried. The error summary expands to the exact Git output. A separate disposable repository has a real merge conflict between `hotfix/login` and `feature/login`; branch creation is disabled and the resolver exposes distinct A/B choices without saving a resolution. The completed release graph shows the actual dependency diamond: Verify release feeds both builds, and Publish waits for both. Expanded matrix job names retain their dependencies. Four SVG edges and the corresponding runtime job IDs are checked, along with card fit at both window sizes. Names render at 13px and durations at 12px. Both file and line comment drafts survive Escape and V when focus moves outside the textarea. The labelled gutter button opens a line composer beneath its selected diff line, and new line targets stay unavailable until that composer closes. Validation types into both composers and explicitly cancels without submitting. The PR comment composer clearly states that drafts remain local until review submission. Viewed & next and other block navigation stay disabled during composition, with visibly dimmed unavailable rows.

No unexpected renderer exceptions or console errors were recorded. The browser network log contains no captured requests, so it does not establish coverage of GitHub IPC or CLI traffic. The expected Git failures above are part of the validation. Reports, exact local commands, and validation scripts remain in the ignored `artifacts/ui-polish/round-7/` folder in the task workspace.

The final readability pass uses 13px commit subjects in 30px graph rows, 13px diff code with 21px line spacing, and 12px settings helpers. Dashboard run outcomes sit beside their titles, with one timestamp in the same group. In-progress CI uses info blue.

Compact sidebar rows hide hash metadata while keeping complete branch names and hashes in row tooltips; wide layouts restore hashes. Grouped workflow outcomes follow their names. Selected PR tabs keep teal while hovered. Queued workflow timestamps say Queued, and waiting jobs show no execution duration.

Muted metadata now uses `#a8afbb`, measuring 5.0:1 against the selected graph row, up from 4.3:1. The palette footer and PR navigation hints are easier to read. Pending context-loading text stays info blue at compact widths. The PR-grouped Actions tile uses at least 11px content text.

Eight line-comment checks verify the labelled action, UI typography, line placement, keyboard draft protection, compact fit and explicit cancellation. Five additional coverage checks verify compact diff, palette, PR Code, and grouped dashboard layouts. Summary, Guide, and Activity captures explicitly select their corresponding real panes. The Guide capture shows its initial empty state; no generation was invoked. Queued and completed CI states are captured from real GitHub runs. Queued rows identify waiting time, and both waiting job cards show a dash instead of execution time.

Tested renderer URL: `file:///Volumes/DevSSD/worktrees/git-gud/t3-8b4af8c3/out/renderer/index.html`.

Focused commands:

```sh
agent-browser --session git-gud-polish connect 9236
node /tmp/git-gud-polish-e2e-v7.mjs
node /tmp/git-gud-polish-layout-check-v7.mjs
node /tmp/git-gud-polish-broad-r7.mjs
node /tmp/git-gud-polish-interaction-r7.mjs
node /tmp/git-gud-polish-ref-hover-r7.mjs
node /tmp/git-gud-polish-release-r7.mjs
node /tmp/git-gud-polish-coverage-r7.mjs
node /tmp/git-gud-polish-line-comment-r7.mjs
```

Script copies and machine-readable reports are retained with the local screenshots.

## Screenshots

### History

![History with readable ref names and subdued inactive avatars](images/ui-polish-overhaul/history.png)

### Diff

![Diff with explicit addition and deletion indicators](images/ui-polish-overhaul/diff.png)

### Compact staging

![Working copy at 1100×760](images/ui-polish-overhaul/working-copy-compact.png)

### Repositories

![Repository launcher](images/ui-polish-overhaul/start.png)

### Command palette

![Palette with relevant matches and loaded-commit scope](images/ui-polish-overhaul/palette.png)

### Error recovery

![Clone failure with expandable Git details](images/ui-polish-overhaul/clone-error.png)

Other verified states: [settings](images/ui-polish-overhaul/settings.png), [stash](images/ui-polish-overhaul/stash.png), [PR Code](images/ui-polish-overhaul/pr-code.png), [Actions dashboard](images/ui-polish-overhaul/dashboard.png), [release job graph](images/ui-polish-overhaul/workflow-release.png), [local PR draft composer](images/ui-polish-overhaul/pr-comment-draft.png), and [conflict resolver](images/ui-polish-overhaul/conflict-resolver.png).

Additional coverage: [PR Summary](images/ui-polish-overhaul/pr-summary.png), [Guide empty state](images/ui-polish-overhaul/pr-guide.png), [Activity](images/ui-polish-overhaul/pr-activity.png), [PR-grouped Actions](images/ui-polish-overhaul/dashboard-pull-requests.png), [compact diff](images/ui-polish-overhaul/diff-compact.png), [compact palette](images/ui-polish-overhaul/palette-compact.png), [compact PR Code](images/ui-polish-overhaul/pr-code-compact.png), [queued dashboard](images/ui-polish-overhaul/dashboard-queued.png), [queued CI jobs](images/ui-polish-overhaul/workflow-queued.png), and [compact release graph](images/ui-polish-overhaul/workflow-release-compact.png).

[Accessible line-comment action](images/ui-polish-overhaul/pr-line-comment-affordance.png) and [protected line draft](images/ui-polish-overhaul/pr-line-comment-draft.png), and [compact line draft](images/ui-polish-overhaul/pr-line-comment-compact.png) are also captured from the running app.

## Scope and limits

The runtime checks use macOS. Linux and Windows CI also run the repository checks, but this does not establish visual parity of platform window chrome. No authenticated push, merge, review submission, workflow rerun, or conflict resolution was executed in the application. Screen-reader behavior and 200% zoom were not audited.

Plain file diffs cannot expand unchanged context absent from their patches. Existing graph-column preferences reset once to automatic sizing under the new storage key; subsequent preferred widths survive window resizing. Side-panel caps reserve room for content without automatically closing panels.

On this Mac, the full suite uses the canonical `/private/tmp` directory because an existing Pi shell test compares `/var` and `/private/var` paths literally. Its first run with the noncanonical temporary path failed that assertion; the canonical-path run passes without modifying the test.
