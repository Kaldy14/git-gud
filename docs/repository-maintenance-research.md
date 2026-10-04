# Repository maintenance research

Researched 2026-10-04 against official Git documentation and maintainers' repositories.

Git Gud should provide a built-in branch cleanup review using the installed Git executable. The useful combination is branch age filtering, explicit integration evidence, protected branches, a preview of exact deletions, and fresh checks when applying the selection. This keeps the account-free workflow available on every Git host and avoids requiring another runtime or command-line plugin.

## Options

| Option | What it offers | Fit for Git Gud |
| --- | --- | --- |
| [Native Git](https://git-scm.com/docs/git-branch) | Ancestry-based `branch --merged`, local deletion, and, in Git 2.56.0, `branch --delete-merged <upstream-pattern>` with `--dry-run`. | Best foundation. Use portable plumbing for a consistent preview and compatibility with older installations. |
| [git-trim](https://github.com/foriequal0/git-trim) | Rust tool supporting local/remote cleanup, multiple base branches, dry run, merge/rebase/squash detection, and distinction between merged and stray branches. Uses `git2`. | Good product precedent; requiring a separate binary and libgit2 behavior adds integration work. |
| [git-delete-merged-branches](https://github.com/hartwork/git-delete-merged-branches) | Python tool with local/remote cleanup, multiple required merge targets, dry run, confirmation, and remote force-with-lease. Patch comparison supports rebase; squash comparison needs `--effort=3`. GPL-3.0. | Strong reference for evidence and safeguards; adds Python/package installation and another configuration model. |
| [git-extras](https://github.com/tj/git-extras/blob/master/Commands.md#git-delete-merged-branches) | Collection including ancestry-based merged-branch deletion and a separate squash-deletion command. Squash deletion checks out the target branch as a side effect. | Useful terminal commands; a checkout side effect is undesirable for a desktop inspection flow. |
| [git-delete-squashed](https://github.com/not-an-aardvark/git-delete-squashed) | Focused MIT tool available as an alias or Node package. Creates a dangling aggregate commit and checks it with `git cherry`. | Small algorithm reference; aggregate patch equivalence still needs careful wording. |
| [gh-poi](https://github.com/seachicken/gh-poi) | GitHub CLI extension using PR state and associated commits, with dry run and branch locks. Handles squash-merged GitHub PRs. | Useful future GitHub enhancement; GitHub authentication and PR availability cannot be required for core cleanup. |

The similarly named `git-delete-merged-branches` command in git-extras is a different implementation from hartwork's tool. The latter documents this command-name collision. [Maintainer README](https://github.com/hartwork/git-delete-merged-branches#name-clash-on-git-delete-merged-branches-with-git-extras).

## What the app can establish

**Merged by ancestry.** `git merge-base --is-ancestor <candidateOid> <targetOid>` establishes that the candidate tip is reachable from the selected target. Exit 0 means yes, 1 means no; other statuses are errors. This preserves actual commit history and works for ordinary merges and fast-forwards. A rewritten commit may have equivalent contents without its original object ID being reachable. [Git merge-base](https://git-scm.com/docs/git-merge-base).

**Patch equivalents exist in target history.** `git cherry <targetOid> <candidateOid>` marks an equivalent commit with `-` and an unmatched commit with `+`. Git compares diffs with whitespace and line numbers removed, making this useful for rebases and cherry-picks. A nonempty result consisting entirely of `-` is evidence that the compared patches occur in target history; it does not identify the integration operation or prove that later commits retained the changes. For example, the target may subsequently revert a matching patch. [Git cherry](https://git-scm.com/docs/git-cherry).

The implementation of `git cherry` excludes merge commits using `max_parents = 1`. Therefore the app must reject patch-only classification when `target..candidate` contains a merge commit: unique merge conflict resolutions would otherwise be overlooked. Empty cherry output alone must not establish integration. [Git's implementation](https://raw.githubusercontent.com/git/git/master/builtin/log.c).

Patch IDs are intended to identify likely duplicate patches. Stable IDs ignore whitespace and the order of file diffs; they are not an exact tree comparison. Conflict resolutions, patch edits, reordered or combined changes, and whitespace-sensitive languages limit how much the app can infer. [Git patch-id](https://git-scm.com/docs/git-patch-id).

**Aggregate squash patch matches.** A common alternative creates a synthetic commit whose parent is the merge base and whose tree is the candidate tip, then checks it with `git cherry`. This can recognize a straightforward single squash commit. It can miss adjusted squash merges and squash merges containing additional edits, and still inherits patch-equivalence limitations. An aggregate match is evidence of a matching change, not proof that a named branch or PR was squash-merged. [git-delete-squashed's algorithm](https://github.com/not-an-aardvark/git-delete-squashed#details).

**A merge would add no changes.** The recommended squash/content heuristic is `git merge-tree --write-tree <targetOid> <candidateOid>` followed by exact equality between the returned tree and `targetOid^{tree}`. Accept only exit 0. The command handles normal three-way merging and renames without changing the working tree, index, or refs; it writes tree objects. Conflicts have exit 1; unsupported commands and other failures must leave the evidence unknown. This is an inference about the resulting content, not evidence of a historical squash operation. Use wording such as “Merge would add no changes” or “Content integrated.” [Git merge-tree](https://git-scm.com/docs/git-merge-tree).

Modern `merge-tree --write-tree` is documented in Git 2.38.0. Older Git installations should retain ancestry and patch checks while reporting this check unavailable. [Git 2.38.0 manual](https://git-scm.com/docs/git-merge-tree/2.38.0).

Custom merge drivers can intentionally keep one side's contents and report a clean merge. Consequently, a tree-equality result under such a driver cannot establish that candidate content is retained. Conservatively skip the content heuristic when effective `merge.*.driver` configuration is present; keep the branch available for explicit manual review. [Git attributes and custom merge drivers](https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver).

**No integration evidence.** An old branch, a missing upstream, a failed comparison, and incomplete history are separate facts. None establishes that work reached the selected mainline. git-trim explicitly distinguishes stray branches because an upstream can disappear after a rejected PR or after local work diverged from what was merged. [git-trim FAQ](https://github.com/foriequal0/git-trim#what-is-the-difference-between-the-merged-and-stray-branch).

## Age means tip commit age

Use `%(committerdate:unix)` from the commit pointed to by each branch, and label it **tip commit age**. Git's ref formatter exposes commit dates, not a portable branch creation or last-use timestamp. A newly created branch pointing to an old commit can immediately meet the age threshold. Checking out a branch also does not change its tip commit. [Git for-each-ref](https://git-scm.com/docs/git-for-each-ref).

Committer dates can be supplied through `GIT_COMMITTER_DATE`, so age is a sorting/filtering hint rather than trusted activity evidence. [Git commit](https://git-scm.com/docs/git-commit#_commit_information). Local reflogs describe ref updates, but can be absent or expired and do not supply a server-wide activity record. [Git reflog](https://git-scm.com/docs/git-reflog).

Offer age thresholds such as 30, 90, and 180 days plus a custom value. Keep age-only deletion separate from integration-based cleanup, with an explicit acknowledgement of unintegrated work. Age must never silently override protections or create a default remote deletion selection.

## Safe cleanup design

1. **Inspect first.** Display the selected target ref and pinned object ID, local versus remote scope, tip age, upstream status, integration evidence, and any protected reason. Scanning must not switch branches or pull changes. Remote-tracking data is a fetched snapshot; offer an explicit refresh.
2. **Protect mainlines and active work.** Exclude the target, known remote default branches, conventional `main`/`master`/`develop` and release branches, and all branches checked out in any worktree. Let users add protections. Worktrees are shared repository state, so inspecting only the current `HEAD` is insufficient. [Git worktree](https://git-scm.com/docs/git-worktree#_list).
3. **Require a concrete selection.** Preselect only strong ancestry evidence if any automatic selection is offered. Require an additional acknowledgement for patch/content heuristics and for age-only deletion. Remote deletions must be clearly identified as changes to the shared repository.
4. **Pin and revalidate.** Carry candidate and target object IDs from preview to execution; reject changed candidates or targets and recheck protections. For local deletion, create a recovery ref and use a compare-and-delete transaction that verifies the expected old object ID. Git `update-ref --stdin` supports creating a backup, verifying the target, and deleting the candidate in one transaction; failed verification aborts the transaction. Plumbing deletion requires explicit worktree checks. Git Gud deliberately retains branch configuration so recreating a deleted branch can recover its upstream settings. [Git update-ref](https://git-scm.com/docs/git-update-ref).
5. **Lease every remote deletion.** Push an explicit deletion refspec `:refs/heads/<branch>` with `--force-with-lease=refs/heads/<branch>:<previewOid>`. Git rejects it if the server's branch moved. An implicit lease can be weakened by background fetches, so use the exact preview ID. Check configured push destinations: a different or multiple push URL means the fetched default-branch identity may not describe every destination. Server permissions and protections remain authoritative. [Git push](https://git-scm.com/docs/git-push).
6. **Retain recovery evidence.** Keep local backup refs and report their names alongside the deleted branches. A reachable backup ref retains its commits; object cleanup normally preserves objects reachable through refs. Do not promise indefinite reflog recovery: native branch deletion deletes its branch reflog. [Git gc](https://git-scm.com/docs/git-gc), [Git branch](https://git-scm.com/docs/git-branch).
7. **Report partial outcomes.** Return a result per selected branch. A remote permission failure must not silently count as success or cause unrelated branches to be deleted. Refresh refs after successful operations and invalidate the old preview.

Git 2.56.0's native `--delete-merged` also skips checked-out branches, missing upstreams, certain branches whose push would update the upstream, local upstreams still needed by other branches, and branches configured with `branch.<name>.deleteMerged=false`. It handles local ancestry-based cleanup, not all of the evidence and remote operations above. The app should honor explicit branch protections and retain its preview workflow even when this command is available. [Git branch options](https://git-scm.com/docs/git-branch#Documentation/git-branch.txt---delete-mergedltpatterngt).

## Prune tracking refs without deleting branches or tags

`git fetch --prune` normally removes local remote-tracking refs for branches already deleted on the server. It does not delete live server branches or their corresponding local branches. Pruning follows refspecs: tag refspecs, mirror configurations, or prune-tags configuration can remove local tags too. A dedicated branch-refresh operation should supply a heads-only source/destination refspec, clear configured ref mappings with `--refmap=`, disable tag following and tag pruning, and validate the remote name. Never expose this operation as deleting live remote branches. [Git fetch pruning and refmap](https://git-scm.com/docs/git-fetch#_pruning).

`git ls-remote --symref <remote> HEAD` can report the server's current default branch; a cached `refs/remotes/<remote>/HEAD` may be missing or stale. Discovering the default is a read, and an explicit target selector remains necessary for repositories with several integration branches. [Git ls-remote](https://git-scm.com/docs/git-ls-remote).

## Follow-up maintenance

Git's `maintenance` command optimizes repository data through tasks such as commit-graph updates, prefetch, packing, and garbage collection; it is separate from branch lifecycle management. A later app feature could expose explicit supported tasks and their progress. Scheduling changes user configuration and OS scheduler state, so it should be a separate opt-in action. [Git maintenance](https://git-scm.com/docs/git-maintenance).

Do not combine branch cleanup with immediate unreachable-object pruning: that would weaken recovery. Likewise, `git clean` removes untracked working-tree files and is a different user action. [Git gc](https://git-scm.com/docs/git-gc), [Git clean](https://git-scm.com/docs/git-clean).

The first implementation should therefore ship a branch cleanup dialog with target/scope/age controls, integration evidence and protected reasons, optional heads-only refresh, reviewed batch deletion, pinned recovery refs for local branches, remote expected-ID leases, and per-branch results. Optional PR-state evidence and background object maintenance can follow without making host authentication or a third-party cleanup executable a dependency.
