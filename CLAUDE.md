# git-gud

Personal macOS Git client. Electron + electron-vite, React 19, Tailwind v4, TanStack Router/Query, Zustand, electron-store. Roadmap and hard requirements: `PLAN.md`. UI structure and theme docs: `docs/README.md`.

## Conventions

- Renderer never touches Node/Git; everything goes through the typed IPC map in `src/shared/ipc.ts` → `window.api`.
- Theme tokens are CSS variables in `src/renderer/src/styles/main.css`; use them via Tailwind arbitrary values (`text-[var(--text-2)]`), don't hardcode hex in components (lane/status colors from `src/shared/graph.ts` are the exception).
- Components live under `src/renderer/src/components/<area>/` per the PLAN.md directory layout.
- The graph renders real Git history from the M2 `repo:graph` query. Commit file details, trees, diffs, and write operations are deferred to M3/M4.
- Inert controls (pre-M4 operations) are `disabled` with a `title` hint naming the milestone — no fake handlers.
- Verify with `pnpm typecheck`, `pnpm lint`, `pnpm test`; don't launch `pnpm dev` (assume it is running).
