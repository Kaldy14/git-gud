# UI polish validation

Generated screenshots are retained only in the local ignored `artifacts/ui-polish/` directory, at the user’s request. No generated screenshot file is included in the final PR diff. Existing project documentation images are unchanged.

## Final pass

The final pass balances the launcher home vertically, bounds wide dashboard title columns so workflow/run facts stay nearby, and keeps metadata responsive. Review footer navigation scrolls independently of its terminal action, including keyboard traversal at 200% zoom. Block position stays right-aligned when its explanation opens. Machine working-copy rows retain the date label beside their status, with one shared alignment instead of competing auto margins. The grouping disclosure has an explicit inset keyboard focus ring.

The native workbench type, quiet resting graph nodes, hollow merge nodes, grouped settings, compact rails, readable selected-code contrast and draft/context guards remain.

## Commands and results

```sh
pnpm build
pnpm lint
TMPDIR=/private/tmp pnpm test
agent-browser --session git-gud-polish connect 9236
node /tmp/git-gud-polish-final-core-v14.mjs
node /tmp/git-gud-polish-final-broad-v14.mjs
node /tmp/git-gud-polish-final-layout-v14.mjs
node /tmp/git-gud-polish-final-type-v14.mjs
node /tmp/git-gud-polish-final-craft-v14.mjs
node /tmp/git-gud-polish-council-fixes-v14.mjs
```

Build including typecheck and lint pass. The full suite passes 172 files, 1,366 tests, with 4 skipped. Focused review/graph tests pass 26 files and 158 tests. All 72 final actual-app checks pass with no unexpected renderer/console errors. Exact totals and original captures are recorded in `artifacts/ui-polish/round-14/final/verification.json` and its companion reports; the footer keyboard report is in `artifacts/ui-polish/round-14/fixes/report.json`. Retained scripts document assertions and limitations.

Tested Electron renderer: `file:///Volumes/DevSSD/worktrees/git-gud/t3-8b4af8c3/out/renderer/index.html`. Tests use the actual app with an isolated QA profile and disposable local Git fixtures. They stage and unstage a real file, exercise clone failure and form validation, inspect real GitHub PR/workflow data, and type/cancel local comment drafts. No app commit, push, review submission, Guide generation or conflict save is performed.

The fixed eight visual review views are history, diff, compact working copy, launcher, palette, settings, PR Code and dashboard. Their original PNGs, dimensions and hashes are retained locally in `artifacts/ui-polish/fixed-comparison-v14/`. Historical grades remain in the PR description and are not rewritten as the rubric or capture scope changed.

## Limits

Runtime checks are macOS only. Native 200% zoom covers the review footer, not every flow. Settings accessibility names are inspected through Chromium’s accessibility tree; screen-reader traversal and Windows/Linux typography/window chrome remain untested. Machine-WIP date alignment is source-reviewed, without a live remote machine fixture. Browser request capture does not certify Electron IPC/CLI traffic. Bulk selection uses a disclosed Shift-modified DOM click after native automation failed to preserve held Shift. No populated AI Guide or live remote mutations are certified.

The missing local clone source intentionally returns Git exit 128 and is handled by the retryable error notice. Unexpected renderer/console errors are recorded separately from that expected fixture failure. The full test runner warns about a missing dependency source map but completes successfully.

## Final council and corrections

The final round rates the eight-view screenshot set at 8.2/10 from GPT-6.1 Sol, 8.2/10 from Claude Opus 5.5, and 8.9/10 from Gemini 4 Argon through Cursor. All three are satisfied with scoped shipping. These visual scores precede two small post-review corrections and have not been changed afterward. The user requested a stop after this round; no further design review was run.

Claude F-1 is accepted. The final renderer preserves the existing machine-row date marker and label, and gives that label zero additional auto margin. This resolves competing alignment without changing shared date grouping. Claude F-2 is accepted: the grouping summary gets a 2px inset focus ring. Optional dashboard, path and empty-state preferences are deferred.

Final build/typecheck and lint pass. A concurrent full-suite run hit two five-second Git test timeouts. The full suite was rerun with four workers using `TMPDIR=/private/tmp pnpm exec vitest run --maxWorkers=4`; it passes all 172 files, 1,366 tests, with 4 skipped. The result is retained with the final command logs. Post-review actual-app checks rerun the 21 core and 17 integration flows, plus six footer/focus checks on the corrected build, 44 passing app checks in total. Their reports and original captures remain locally in `artifacts/ui-polish/round-14/post-review/`. The summary’s inset ring and each keyboard-focused footer control are inspected at 200% zoom. The prior 72-check matrix remains unchanged as historical evidence.
