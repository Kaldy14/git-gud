# git-gud

Personal macOS Git client. Electron + electron-vite, React 19, Tailwind v4, TanStack Router/Query, Zustand, electron-store. Roadmap and hard requirements: `PLAN.md`. UI structure and theme docs: `docs/README.md`.

## Conventions

- Renderer never touches Node/Git; everything goes through the typed IPC map in `src/shared/ipc.ts` → `window.api`.
- Theme tokens are CSS variables in `src/renderer/src/styles/main.css`; use them via Tailwind arbitrary values (`text-[var(--text-2)]`), don't hardcode hex in components (lane/status colors from `sampleGraph.ts` are the exception).
- Components live under `src/renderer/src/components/<area>/` per the PLAN.md directory layout.
- The graph/detail panels currently render preview data from `components/graph/sampleGraph.ts`; replace its consumers with real Git queries in M1/M2, keeping the `RailSegment` row shape.
- Inert controls (pre-M4 operations) are `disabled` with a `title` hint naming the milestone — no fake handlers.
- Verify with `pnpm typecheck`, `pnpm lint`, `pnpm test`; don't launch `pnpm dev` (assume it is running).
