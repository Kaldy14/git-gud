# PR Bug finder

Run Bug finder from the bug icon beside AI brief in the PR dashboard. The fixed dot indicates idle, running, ready, failed, or outdated. Hover or focus the button for its status. A scan runs in the background; the ready button opens the findings. The PR header's **Bug finder** button opens the same view at any time.

Select findings to inspect their code and evidence. Bugs have severity; convention findings are separate. **Edit** updates a finding, **Dismiss** records why it is incorrect, **Remove** hides an accidental record, and the status filters let you restore records. Older findings remain visibly outdated after a PR update until revalidated.

## Post selected comments

Select the findings you want, choose **Review selected**, edit the comment text, and choose **Post N comments**. This sends a comment-only GitHub review. It does not approve the PR. Findings that change after selection must be selected again before submission. Posting checks the live head and locations and prevents duplicate publication of the same finding record.

A transport failure can leave publication uncertain. Git Gud preserves that state instead of automatically reposting. **Check submission** searches the PR comments for this submission's unique marker and confirms it when found. A successful review retains its GitHub review ID; confirmed recovery also retains comment IDs. Unconfirmed submissions need inspection on GitHub. Removing or editing a local record never changes a published comment.

## Discuss findings with another agent

**Copy prompt** exports selected findings; **Copy all open** exports current, unpublished open findings. The prompt explains Git Gud, includes the exact PR/account/revision and evidence, and supplies executable CLI commands. Paste it into your agent of choice.

The CLI is a bundled Node.js script installed into Git Gud's application-data directory when copying the first prompt. Commands include its full path and a connection-file path, so there is no package to install or global `git-gud` executable to configure. Node.js 20+ and the running desktop app are required. The connection is available only on this machine. A remote agent must have access to the machine; the app does not expose a remote service.

The CLI reads the connection file itself. The handoff contains its path, never the authentication token. Requests go to an authenticated loopback HTTP endpoint. The app serializes all finding mutations through the same validation path as the UI.

The copied command prefix supplies the profile, repository, PR number, and full head SHA. Append:

```text
list --json
add --input finding.json --json
update FINDING_ID --if-version CURRENT_VERSION --input update.json --json
dismiss FINDING_ID --if-version CURRENT_VERSION --reason "Evidence disproving the claim" --json
restore FINDING_ID --if-version CURRENT_VERSION --json
remove FINDING_ID --if-version CURRENT_VERSION --json
```

`add` requires this content shape. `update` accepts only the fields to change:

```json
{
  "title": "Concrete failure",
  "body": "Trigger, expected vs actual behavior, and consequence.",
  "category": "bug",
  "severity": "major",
  "evidence": { "kind": "code", "detail": "Specific evidence and limitations." },
  "location": { "path": "src/example.ts", "line": 12, "endLine": 12, "side": "right" }
}
```

Categories are `bug` and `convention`. Bugs use `critical`, `major`, or `minor` severity; conventions use `null`. Evidence is `code`, `reproduced`, or `incomplete`. An agent may use `reproduced` only when it actually ran the reproduction and records the command/result. Locations must cover a changed range in one current PR diff hunk. IDs, versions, history, and publication links cannot be edited through the content payload.

`CONFLICT` means another edit won; reread and reconcile. `STALE_HEAD` means the PR changed; request a new scan and revalidation. After any write, `list --json` verifies the saved state. The UI refreshes the shared records automatically. The CLI cannot run scans or post GitHub comments. The generated prompt authorizes investigation and finding-record edits, leaving application-code changes and publication for a separate user request.

## Evidence and limitations

Scanning uses the existing configured AI engine. It supplies up to 200,000 characters of complete diff patches and up to 300,000 characters of complete source/context files at the exact head revision. It examines up to 24 changed source files, ancestor AGENTS.md files and README.md within a 40-file initial fetch, then up to 24 relative-import/test candidates. Missing or oversized content is excluded and coverage is disclosed. This is bounded PR analysis, not a full-repository search. It does not execute repository code or tests.

Source-based findings are hypotheses for review, not reproduced failures. Empty findings are a valid result. Malformed output or invalid locations fail the scan visibly. Rescans retain stable IDs for matching titles/paths and preserve agent/user edits, dismissals, removals, and publication history. Changed wording can produce a separate finding; check duplicates before posting. A finding absent from a later scan is not automatically declared fixed.

Records persist in the app's user-data directory and are scoped by GitHub profile and PR. They are not committed to the repository or shared with other machines. Interrupted scans become retryable failures after restart.

Evidence can link to files using `[source](src/file.ts#L42)` or inline code such as `src/file.ts:42`. Clicking a reference or the code-header filename opens the finding's head revision in the app selected under **Open PR in…**. The repository must be open locally. Cursor and VS Code jump to the line; other supported code editors open the file. Terminal and Finder selections ask you to choose a code editor. Supporting files outside the diff work too. Missing files and references escaping the checkout are rejected. For base-side evidence, use an explicit GitHub permalink; ordinary web links still open in the browser.
