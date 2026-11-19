# done

A super simple to-do list app I made for myself.

It runs on my Mac, keeps everything in one local SQLite file, and needs no account, no cloud and no tracking. It can also be hosted, with a sign-in, for using the same list on several devices.

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
cd ui && npm ci && npm test && npm run build && cd ..   # the interface
cargo test -p done-core -p done-mcp                     # the rules and the MCP server
cargo run -p done-server                                # the web app, at http://127.0.0.1:4400
cd crates/app && npx @tauri-apps/cli@2 build            # the Mac app, in target/release/bundle/macos
```

## Host it for others

The web app can also run as a hosted service, where each person signs in with a Google account and has a tasks file of their own. Nothing changes for running it on your own Mac.

```bash
docker build -t done .
docker run -p 8080:8080 \
  -e DONE_PUBLIC_URL=https://done.example.com \
  -e DONE_GOOGLE_CLIENT_ID=... -e DONE_GOOGLE_CLIENT_SECRET=... \
  -e DONE_SESSION_KEY="$(openssl rand -hex 48)" \
  -e DONE_ACCOUNTS=/accounts -v done-accounts:/accounts \
  done
```

- `DONE_PUBLIC_URL` is where people reach it. In the Google Cloud console, the sign-in client's redirect address is that plus `/auth/google/callback`.
- `DONE_ACCOUNTS` is where the account files are kept: a folder, or `gs://bucket` for Google Cloud Storage (the server then uses the identity it runs as; there is no key to hand it).
- `DONE_SESSION_KEY` signs the sign-in cookie. Changing it signs everyone out.

Deleting an account in Settings deletes its file.

## How it is put together

- `ui/` is the interface: React, Tailwind and shadcn/ui components, with the whole look defined as theme tokens in `ui/src/index.css`. The desktop app and the web app both show the same build of it.
- `crates/core` owns the SQLite file and the rules for a valid task.
- `crates/app` is the desktop app (Tauri). Started as `done mcp`, the same program is the MCP server.
- `crates/mcp` is the MCP server itself.
- `crates/server` is the web app. By default it is reachable only from the Mac it runs on; with `DONE_MODE=cloud` it is the hosted service described above.

Tasks are stored in `~/Library/Application Support/done/done.db`.

## License

MIT
