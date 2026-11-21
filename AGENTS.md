# Working on done

Notes for agents (and people) changing this repository: how the work is done here, and the traps already found.

## The shape of it

- `crates/core`: the only code that touches SQLite. Every rule about tasks, notes and the time sheet lives here.
- `crates/mcp`: the MCP server, run as `done mcp`. Keep it a small set of task-shaped tools; a new tool needs a real use an agent hits, not a mirror of an endpoint.
- `crates/server`: the web app. Local mode (default) serves this Mac only; `DONE_MODE=cloud` is the hosted service. It embeds `ui/dist/index.html` when compiled, so **build the UI before the server**.
- `crates/app`: the Tauri app (Mac, iPhone). Thin wrappers around core.
- `ui/`: React, Tailwind, shadcn/ui. `ui/src/lib/backend.ts` is the one place that picks the app's commands, the local `/api` or the hosted server.
- `docs/plans/`: one plan per change, kept true until merge.
- Hosting infrastructure (Terraform, project ids, secrets) is **not** in this repository; it lives in a separate private repo. Never add it here.

## How a change is made

1. An issue that says the outcome in plain words.
2. A worktree from `origin/main` under `../done-wt/<name>`, branch `feat/<name>`.
3. The plan, `docs/plans/YYYY-MM-DD-<outcome>.md`, as the first commit. Decisions, evidence, tests, what is verified and what is not.
4. Build it. Record any deviation in the plan in the same commit ("Ruling: ... — why — cost if wrong").
5. Show the owner a preview before merging (below). The owner decides; a PR is never merged without their word.
6. PR, CI green, merge, then cut a release and install it.

Commits end with a `Co-Authored-By:` line for the agent; PR bodies end with the generated-by line.

## Checks

```bash
cd ui && npm run typecheck && npm test && npm run build && cd ..
cargo test -p done-core -p done-mcp -p done-server
cargo check -p done-app
```

- Pure logic goes in `ui/src/lib/*.ts` with a test beside it; components stay thin.
- Format only new files: `npx prettier --no-semi --single-quote --print-width 150 --write <new files>`. Existing files do not pass Prettier as a whole; reformatting them buries the real change.

## Previewing a change

**In a browser**, on a copy of the owner's tasks, never the real file:

```bash
sqlite3 "file:$HOME/Library/Application Support/done/done.db?mode=ro" ".backup '/tmp/preview.db'"
cd ui && npm run build && cd ..
DONE_DB=/tmp/preview.db DONE_PORT=4482 cargo run -p done-server   # http://localhost:4482
```

Restart the server after every UI build: it embeds the UI when it compiles.

**As a Mac app beside the real one**, called "done next" (`dev.done.next`, version 99.0.0, so it never updates itself over the real one). It uses the real tasks file:

```bash
cd crates/app
npx --yes @tauri-apps/cli@2 build --config '{"productName":"done next","identifier":"dev.done.next","version":"99.0.0","build":{"beforeBuildCommand":""}}'
osascript -e 'quit app "done next"'
rm -rf "/Applications/done next.app"
ditto "<target>/release/bundle/macos/done next.app" "/Applications/done next.app"
xattr -dr com.apple.quarantine "/Applications/done next.app"
open "/Applications/done next.app"
```

Build the UI first (`beforeBuildCommand` is emptied so it does not run `npm ci`).

## Releasing

- `gh workflow run release.yml`. The version is `0.1.<commits on main>`; the app updates itself from the latest release.
- To install by hand: download `done.app.tar.gz` from the release, quit done, replace `/Applications/done.app` with `ditto`, remove the quarantine, open it.
- Replacing the running app disconnects any agent session using its MCP server; it reconnects in a new session.

## Traps already hit

- **Never run `tauri build` with `ui/node_modules` as a symlink** to another worktree's: its `npm ci` empties the link's target. Worktrees may symlink it for tests; run `npm ci` for a real folder before any app build, and remove a symlink before `git worktree remove`.
- **Never point a test or preview at `~/Library/Application Support/done/done.db`.** Use `DONE_DB` with a copy.
- Keys with Cmd in the Mac app's web view: listen in the capture phase (`addEventListener('keydown', fn, true)`), or the app's menus may take them first.
- The disk on the owner's Mac is nearly full. Check `df -h ~` before a release build; share one `CARGO_TARGET_DIR` across worktrees.

## Conventions in the interface

- **Every change to tasks and projects goes through `change()` in `ui/src/lib/store.ts`.** That is what makes it saved and undoable with Cmd+Z. Other undoable things (deleting a note) add a step with `recordStep` (`ui/src/lib/undo.ts`).
- **Sounds** come from `ui/src/lib/sounds.ts`: synthesized, in one key, with limits the tests enforce. Rewards (finishing, a focus block run to its end) are the loudest; everything else is quieter. Play a sound for something the user did, never on a timer, and never two at once.
- Keys: `Q`/`N` add a task, `1`–`8` switch views, Cmd+K searches everything, Cmd+F finds on the page, Cmd+Z undoes, Cmd+B hides the sidebar.
- Writing: short, plain words. The app talks like a person ("Task completed"), not like a system.
