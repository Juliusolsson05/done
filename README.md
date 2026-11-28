# done

A super simple to-do list app I made for myself.

It runs on Windows and Mac, keeps everything in one local SQLite file, and needs no account, no cloud and no tracking. It can also be hosted, with a sign-in, for using the same list on several devices.

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

- **Windows 10 or 11, x64** — download [done for Windows](https://github.com/Juliusolsson05/done/releases/latest/download/done-windows-x64-setup.exe) and run the installer. It installs for your Windows account and includes the WebView2 runtime for offline setup. Open **done** from Start.
- **Mac with Apple silicon** — download the [notarized disk image](https://github.com/Juliusolsson05/done/releases/download/mac/Done.dmg) and drag done into Applications.

A new release is built from `main` every night when there is something new.

## Connect an agent

Open **Settings** in the app and copy the line under "Connect an AI agent". On Windows, copy the PowerShell command from Settings so it uses your actual install folder. On macOS the usual command is:

```bash
claude mcp add done -- "/Applications/done.app/Contents/MacOS/done" mcp
```

## Build it yourself

You need Rust and Node. For a Windows source build, also install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```bash
cd ui && npm ci && npm test && npm run build && cd ..   # the interface
cargo test -p done-core -p done-mcp                     # the rules and the MCP server
cargo run -p done-server                                # the web app, at http://127.0.0.1:4400
cd crates/app && npx @tauri-apps/cli@2 build            # the desktop installer or app in target/release/bundle
```

## The iPhone app

The same app builds for an iPhone. It keeps tasks on the phone, and can sign in to a hosted account if it was built knowing one.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cd ui && npm ci && npm run build && cd ../crates/app
npx @tauri-apps/cli@2 ios build --target aarch64-sim --debug   # for the simulator
npx @tauri-apps/cli@2 ios dev                                  # run it on a simulator or a connected phone
```

You need Xcode, `xcodegen` and CocoaPods. Putting it on a real phone needs your own Apple developer team, set in Xcode or with `APPLE_DEVELOPMENT_TEAM`; none is written in this repository.

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
- `DONE_OPERATOR` and `DONE_CONTACT` (optional) are who runs your copy and how to reach them. They are shown on the `/privacy` and `/terms` pages the server answers. Read both pages before opening your copy to others: they describe what the code does, and the terms are a starting point, not legal advice.

Deleting an account in Settings deletes its file.

## How it is put together

- `ui/` is the interface: React, Tailwind and shadcn/ui components, with the whole look defined as theme tokens in `ui/src/index.css`. The desktop app and the web app both show the same build of it.
- `crates/core` owns the SQLite file and the rules for a valid task.
- `crates/app` is the app (Tauri): the Mac app, and the iPhone app from the same code. On a Mac, started as `done mcp`, the same program is the MCP server.
- `crates/mcp` is the MCP server itself.
- `crates/server` is the web app. By default it is reachable only from the Mac it runs on; with `DONE_MODE=cloud` it is the hosted service described above.

Tasks are stored in `~/Library/Application Support/done/done.db`.

## License

MIT
