//! done as an app: on a Mac and on an iPhone. The window shows the same
//! interface as the web app; the commands below are its way to the tasks file
//! on the device.
//!
//! A library, because that is what an iPhone app is built from. On a Mac,
//! `main.rs` starts it. What only a Mac has (the menu bar, updating itself,
//! a window that hides instead of closing) is compiled only there.

use done_core::{Change, Entry, NewEntry, Note, SaveNote, State, Store, Synced, Task};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

/// The version of an update that has been downloaded and installed and now
/// only needs a restart. Empty until that happens.
#[derive(Default)]
struct UpdateReady(Mutex<Option<String>>);

/// The focus session the window is running, as far as the menu bar needs to
/// know it. The window owns the session; it hands over these times whenever
/// they change, and the menu bar counts down from them by itself. That way
/// the countdown stays right while the window is hidden, where a web page's
/// own timers are slowed or stopped.
// A phone has no menu bar, so there the times are kept and not read.
#[cfg_attr(mobile, allow(dead_code))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    /// When the countdown reaches zero, in milliseconds since 1970. Absent
    /// while paused.
    ends_at: Option<f64>,
    /// What is left, in milliseconds, while paused.
    remaining: Option<f64>,
    /// When the next reminder comes, if one does before the end. The window
    /// decides whether a reminder is due; this is only when to wake it.
    reminder_at: Option<f64>,
    /// A reminder is showing in the window, which waits to be dismissed.
    #[serde(default)]
    reminding: bool,
    /// Set once the end has been announced, so it is announced only once.
    #[serde(skip)]
    rang: bool,
    /// Set once the window has been woken for `reminder_at`.
    #[serde(skip)]
    woke: bool,
    /// How often the reminder has rung, and when it rings next.
    #[serde(skip)]
    rings: u32,
    #[serde(skip)]
    next_ring: f64,
}

/// A reminder rings again every few seconds until it is dismissed, because
/// one sound is easy to miss from across the room; and gives up after a
/// minute, because nobody is there.
#[cfg(desktop)]
const RING_EVERY: f64 = 3000.0;
#[cfg(desktop)]
const RINGS: u32 = 20;

#[derive(Default)]
struct Focus(Mutex<Option<Session>>);

#[tauri::command]
fn focus_set(focus: tauri::State<Focus>, session: Option<Session>) {
    *focus.0.lock().unwrap() = session;
}

/// 24:59, or 1:04:59 from an hour up.
#[cfg(desktop)]
fn clock(milliseconds: f64) -> String {
    let seconds = (milliseconds / 1000.0).ceil() as u64;
    let (h, m, s) = (seconds / 3600, seconds % 3600 / 60, seconds % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

/// Plays the sound. On a thread of its own that waits for the player to
/// finish, so a reminder ringing many times leaves no dead processes behind.
#[cfg(desktop)]
fn ring() {
    std::thread::spawn(|| {
        let _ = std::process::Command::new("afplay").arg("/System/Library/Sounds/Glass.aiff").status();
    });
}

#[cfg(desktop)]
fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// On a phone the system brings the app forward when it opens a link for it.
#[cfg(mobile)]
fn show_window(_app: &tauri::AppHandle) {}

/// Puts done in the menu bar and keeps the countdown there up to date. With no
/// session it is just the mark; during one, the time left stands beside it.
#[cfg(desktop)]
fn run_menu_bar(app: &tauri::AppHandle) -> tauri::Result<()> {
    let pause = MenuItem::with_id(app, "pause", "Pause or resume", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open done", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&pause, &stop, &open])?;
    TrayIconBuilder::with_id("focus")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        // A template image is drawn by macOS in the menu bar's own colour.
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            // The window owns the session, so pausing and stopping are passed to it.
            command => {
                let _ = app.emit("focus-command", command);
            }
        })
        .build(app)?;

    let app = app.clone();
    std::thread::spawn(move || {
        let mut shown = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0);
            let mut ended = false;
            let mut reminder_due = false;
            // Some(true) for the first ring of a reminder, Some(false) for a repeat.
            let mut reminder_ring = None;
            let text = match app.state::<Focus>().0.lock().unwrap().as_mut() {
                None => String::new(),
                Some(session) => {
                    if session.reminding && session.rings < RINGS && session.next_ring <= now {
                        reminder_ring = Some(session.rings == 0);
                        session.rings += 1;
                        session.next_ring = now + RING_EVERY;
                    }
                    match (session.ends_at, session.remaining) {
                        (Some(end), _) => {
                            if end <= now && !session.rang {
                                session.rang = true;
                                ended = true;
                            } else if end > now && !session.woke && session.reminder_at.is_some_and(|at| at <= now) {
                                session.woke = true;
                                reminder_due = true;
                            }
                            clock((end - now).max(0.0))
                        }
                        (None, Some(left)) => format!("Paused {}", clock(left)),
                        (None, None) => String::new(),
                    }
                }
            };
            if text != shown {
                if let Some(tray) = app.tray_by_id("focus") {
                    let _ = tray.set_title(if text.is_empty() { None } else { Some(text.as_str()) });
                }
                shown = text;
            }
            if ended {
                // Time is up: say so out loud and bring the window forward,
                // because the point of the timer is to be interrupted by it.
                ring();
                show_window(&app);
                let _ = app.emit("focus-command", "ended");
            }
            if reminder_due {
                // A hidden window's timers may be stopped, so it is told when
                // to look. It answers by handing the session over as reminding.
                // The window is shown first: a hidden WebKit view may also sit
                // on the event itself, and a reminder that waits for the
                // window to be opened by hand has failed at its one job.
                show_window(&app);
                let _ = app.emit("focus-command", "reminder");
            }
            if let Some(first) = reminder_ring {
                ring();
                // Brought forward once; after that only the sound repeats, so
                // the window does not keep taking the keyboard from other work.
                if first {
                    show_window(&app);
                }
            }
        }
    });
    Ok(())
}

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
fn finished(store: tauri::State<Store>) -> Result<Vec<Task>, String> {
    store.finished(FINISHED_LISTED).map_err(|e| e.to_string())
}

/// How many finished tasks the Completed page shows.
const FINISHED_LISTED: i64 = 300;

#[tauri::command]
fn entries(store: tauri::State<Store>, day: String) -> Result<Vec<Entry>, String> {
    store.entries(&day).map_err(|e| e.to_string())
}

#[tauri::command]
fn record_entry(store: tauri::State<Store>, entry: NewEntry) -> Result<Entry, String> {
    store.record(entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_entry(store: tauri::State<Store>, id: i64) -> Result<(), String> {
    store.delete_entry(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn notes(store: tauri::State<Store>) -> Result<Vec<Note>, String> {
    store.notes().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_note(store: tauri::State<Store>, note: SaveNote) -> Result<Note, String> {
    store.save_note(note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(store: tauri::State<Store>, id: i64) -> Result<(), String> {
    store.delete_note(id).map_err(|e| e.to_string())
}

// Keeping this device's file in step with a hosted account. The window
// does the network part (it holds the sign-in token); these read what to
// send and take in the answer.
#[tauri::command]
fn outbox(store: tauri::State<Store>) -> Result<done_core::Outbox, String> {
    store.outbox().map_err(|e| e.to_string())
}

#[tauri::command]
fn inbox(store: tauri::State<Store>, reply: done_core::Reply, upto: i64) -> Result<bool, String> {
    store.inbox(&reply, upto).map_err(|e| e.to_string())
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

/// Opens a page in the person's own browser. Signing in to a hosted account
/// starts there: Google does not show its sign-in page inside an app's window.
#[tauri::command]
fn open_in_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Web pages only. The window asks for this, and it must not be a way to
    // open files or other apps.
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only web pages can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.restart();
}

/// Looks for a newer release now and every six hours. A newer one is
/// downloaded, checked against the key built into this app and installed
/// without asking; the window only learns that a restart will finish it.
/// Nothing is interrupted: the running app keeps going until it is restarted.
#[cfg(desktop)]
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

/// Starts the app. On an iPhone this is where the system enters.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Store::open(&done_core::default_path()).expect("open the tasks file");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(store)
        .manage(UpdateReady::default())
        .manage(Focus::default())
        .invoke_handler(tauri::generate_handler![state, sync, entries, record_entry, delete_entry, notes, save_note, delete_note, finished, outbox, inbox, info, restart, focus_set, open_in_browser]);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Closing the window hides it and leaves done running, as Mac apps
        // do: a countdown in the menu bar must outlive its window. Cmd+Q quits.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        });

    builder
        .setup(|app| {
            // A `done://` link is how the browser hands a finished sign-in
            // back. The window does the rest, so the link is passed on as is.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = handle.emit("opened-link", url.to_string());
                    }
                    show_window(&handle);
                });
            }
            #[cfg(desktop)]
            {
                run_menu_bar(app.handle())?;
                // Development builds are not releases and must not replace themselves.
                if !cfg!(debug_assertions) {
                    keep_updated(app.handle().clone());
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build done")
        .run(|_app, _event| {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_window(_app);
            }
        });
}
