# AGENTS.md

## End-of-task screenshots and UI validation

- After every completed task, include screenshots showing the result. Screenshots are mandatory for UI, frontend, and Electron changes.
- Screenshot evidence must come from the real, running Git Gud application and the actual changed flow or state. Never substitute mock HTML, reconstructed screens, style previews, design approximations, or another application, and never present those artifacts as product screenshots.
- For affected UI flows, run focused end-to-end validation with `agent-browser`. Reuse an existing dev server when available, test the main happy path plus one or two meaningful edge or error states, and avoid destructive or production actions.
- In the final response, provide the tested URLs and commands, pass or fail results, screenshots of key UI states, relevant console or network errors, regressions, and residual risks or untested areas.
- If a task has no visual result or screenshots are technically impossible, explicitly state why instead of fabricating evidence.
