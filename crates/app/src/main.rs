//! done as a desktop app. The window shows the same interface as the web app;
//! the commands below are its only way to the tasks file.
//!
//! The same program is also done's MCP server: started as `done mcp` it opens
//! no window and talks to an AI agent over standard input and output instead.
//! One program, so "connect an agent" is one path with nothing extra to install.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use done_core::{Change, State, Store, Synced};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

/// The version of an update that has been downloaded and installed and now
/// only needs a restart. Empty until that happens.
#[derive(Default)]
struct UpdateReady(Mutex<Option<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: String,
    /// Where this program is, for the "connect an agent" instructions.
    mcp_command: String,
    update_ready: Option<String>,
}

#[tauri::command]
fn state(store: tauri::State<Store>, today: String) -> Result<State, String> {
    store.state(&today).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync(store: tauri::State<Store>, change: Change) -> Result<Synced, String> {
    store.sync(change).map_err(|e| e.to_string())
}

#[tauri::command]
fn info(app: tauri::AppHandle, ready: tauri::State<UpdateReady>) -> Info {
    Info {
        version: app.package_info().version.to_string(),
        mcp_command: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "/Applications/done.app/Contents/MacOS/done".into()),
        update_ready: ready.0.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.restart();
}

/// Looks for a newer release now and every six hours. A newer one is
/// downloaded, checked against the key built into this app and installed
/// without asking; the window only learns that a restart will finish it.
/// Nothing is interrupted: the running app keeps going until it is restarted.
fn keep_updated(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let installed = tauri::async_runtime::block_on(async {
            let Some(update) = app.updater()?.check().await? else {
                return Ok::<_, tauri_plugin_updater::Error>(None);
            };
            let version = update.version.clone();
            update.download_and_install(|_, _| {}, || {}).await?;
            Ok(Some(version))
        });
        match installed {
            Ok(Some(version)) => {
                *app.state::<UpdateReady>().0.lock().unwrap() = Some(version);
                // The files on disk are the new version now; there is nothing
                // further to fetch until the app restarts.
                return;
            }
            Ok(None) => {}
            // Offline, or the release is not there yet. Not worth a message;
            // the next check is in six hours.
            Err(error) => eprintln!("update check failed: {error}"),
        }
        std::thread::sleep(Duration::from_secs(6 * 60 * 60));
    });
}

fn main() {
    let store = Store::open(&done_core::default_path()).expect("open the tasks file");

    if std::env::args().nth(1).as_deref() == Some("mcp") {
        let stdin = std::io::stdin();
        done_mcp::serve(&store, stdin.lock(), std::io::stdout()).expect("serve MCP");
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(store)
        .manage(UpdateReady::default())
        .invoke_handler(tauri::generate_handler![state, sync, info, restart])
        .setup(|app| {
            // Development builds are not releases and must not replace themselves.
            if !cfg!(debug_assertions) {
                keep_updated(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run done");
}
