# done

A super simple to-do list app I made for myself.

It runs on my Mac, keeps everything in one local SQLite file, and has no account, no cloud and no tracking.

## What it has

- **Inbox, Today, Upcoming** and projects.
- **Today's goal:** one task can be the one thing that has to happen today.
- **Timeline:** tasks as bars across days. Drag to move, drag an end to stretch.
- **Board:** To do, In progress, Done today. Drag cards between them.
- **Quick add:** press `Q` and type `call the bank tomorrow p1 #home`. The date, priority and project are read out of the line.
- **Right-click** anything for the actions that apply to it.
- **MCP server built in,** so an AI agent can read and change your tasks. Settings shows the one line that connects it.
- **Updates itself** from the releases of this repository.

## Install

Download `done-mac-arm64.zip` from the [latest release](https://github.com/Juliusolsson05/done/releases/latest), unzip it and move `done.app` to Applications. It is for Apple silicon Macs.

The app is not signed with an Apple Developer ID, so macOS will refuse to open a downloaded copy until you run this once:

```bash
xattr -dr com.apple.quarantine /Applications/done.app
```

A new release is built from `main` every night when there is something new.

## Connect an agent

Open **Settings** in the app and copy the line under "Connect an AI agent". For Claude Code it is:

```bash
claude mcp add done -- "/Applications/done.app/Contents/MacOS/done" mcp
```

## Build it yourself

You need Rust and Node.

```bash
cargo test -p done-core -p done-mcp          # the rules and the MCP server
cargo run -p done-server                      # the web app, at http://127.0.0.1:4400
cd crates/app && npx @tauri-apps/cli@2 build  # the Mac app, in target/release/bundle/macos
```

## How it is put together

- `ui/index.html` is the whole interface: one file, no build step. The desktop app and the web app both show it.
- `crates/core` owns the SQLite file and the rules for a valid task.
- `crates/app` is the desktop app (Tauri). Started as `done mcp`, the same program is the MCP server.
- `crates/mcp` is the MCP server itself.
- `crates/server` is the web app, reachable only from the Mac it runs on.

Tasks are stored in `~/Library/Application Support/done/done.db`.

## License

MIT
