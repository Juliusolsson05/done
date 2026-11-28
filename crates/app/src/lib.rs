//! Native task storage and platform integration for the shared done interface.

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
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

struct ReadyRelease {
    version: String,
    // Running the Windows installer exits the app, so keep the verified bytes
    // until the user chooses Restart. macOS can replace its bundle while open.
    #[cfg(windows)]
    installer: (tauri_plugin_updater::Update, Vec<u8>),
}

#[derive(Default)]
struct UpdateReady(Mutex<Option<ReadyRelease>>);

// The browser can return before the webview has mounted its event listener.
// A sign-in has only one outstanding PKCE verifier.
#[derive(Default)]
struct OpenedLink(Mutex<Option<String>>);

#[tauri::command]
fn take_opened_link(link: tauri::State<OpenedLink>) -> Option<String> {
    link.0.lock().unwrap().take()
}

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
    /// What is being worked on, for the Dynamic Island on a phone.
    #[serde(default)]
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    title: Option<String>,
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

/// The window's safe area in points, `[top, right, bottom, left]`, as UIKit
/// knows it. iPhone and iPad only; `None` elsewhere.
///
/// WHY: in this web view `env(safe-area-inset-*)` keeps the portrait values
/// when the iPhone is held sideways, so the Dynamic Island covered the start of
/// every view (#70). The window reports the same portrait values (measured on
/// the iPhone 17 simulator: [62, 0, 34, 0] at 874×402 pt), so the page turns
/// them for landscape itself (ui/src/lib/safe-area.ts `insetsFor`); what this
/// answer gives it is the island's real size on each model.
///
/// UIKit must be touched on the main thread: `with_webview` runs the closure
/// there, and the answer comes back over a channel. The command is async so it
/// runs off the main thread and can wait without blocking the closure it
/// waits for.
#[cfg(target_os = "ios")]
#[tauri::command]
async fn safe_area(window: tauri::WebviewWindow) -> Option<[f64; 4]> {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::AnyObject;

    // UIEdgeInsets, field for field, so UIKit's struct can be returned by value.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct EdgeInsets {
        top: f64,
        left: f64,
        bottom: f64,
        right: f64,
    }
    unsafe impl Encode for EdgeInsets {
        const ENCODING: Encoding =
            Encoding::Struct("UIEdgeInsets", &[f64::ENCODING, f64::ENCODING, f64::ENCODING, f64::ENCODING]);
    }

    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| unsafe {
            let view = webview.inner() as *mut AnyObject;
            // The web view's own window: its insets are the screen's, whatever
            // the web view and its scroll view were told.
            let window: *mut AnyObject = objc2::msg_send![view, window];
            let insets = if window.is_null() {
                None
            } else {
                let i: EdgeInsets = objc2::msg_send![window, safeAreaInsets];
                Some([i.top, i.right, i.bottom, i.left])
            };
            let _ = tx.send(insets);
        })
        .ok()?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten()
}

// Elsewhere WebKit's own env() values are right; the page treats `None` as
// "nothing to add".
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn safe_area() -> Option<[f64; 4]> {
    None
}

// The app's own Swift, linked into the same binary (gen/apple/Sources/done-app/
// DoneNative.swift, `@_cdecl`): the Live Activity and the widgets' data.
// WHY a C call and not a Tauri plugin: this crate is a static library linked
// into that app, so the linker joins the two by name; the only contract is a
// JSON string, copied by Swift before the call returns.
#[cfg(target_os = "ios")]
extern "C" {
    fn done_focus(json: *const std::os::raw::c_char);
    fn done_widget_snapshot(json: *const std::os::raw::c_char);
    fn done_watch_apple_user(user: *const std::os::raw::c_char, id: *const std::os::raw::c_char, ended: extern "C" fn(*const std::os::raw::c_char));
    fn done_apple_sign_in(answer: extern "C" fn(*const std::os::raw::c_char));
    fn done_web_sign_in(url: *const std::os::raw::c_char, answer: extern "C" fn(*const std::os::raw::c_char));
}

#[cfg(target_os = "ios")]
static APPLE_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
extern "C" fn apple_credential_ended(id: *const std::os::raw::c_char) {
    let id = unsafe { std::ffi::CStr::from_ptr(id) }.to_string_lossy();
    if let Some(app) = APPLE_APP.get() {
        let _ = app.emit("apple-credential-ended", id.into_owned());
    }
}

#[tauri::command]
fn watch_apple_user(app: tauri::AppHandle, user: String, id: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let user = std::ffi::CString::new(user).map_err(|_| "Invalid Apple user")?;
        let id = std::ffi::CString::new(id).map_err(|_| "Invalid credential watch")?;
        APPLE_APP.get_or_init(|| app);
        unsafe { done_watch_apple_user(user.as_ptr(), id.as_ptr(), apple_credential_ended) };
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, user, id);
    Ok(())
}

/// Where the one Sign in with Apple under way is waiting for Swift's answer.
#[cfg(target_os = "ios")]
static APPLE_ANSWER: Mutex<Option<std::sync::mpsc::Sender<String>>> = Mutex::new(None);

#[cfg(target_os = "ios")]
extern "C" fn apple_answered(json: *const std::os::raw::c_char) {
    // Copied now: Swift frees the string when this returns.
    let text = unsafe { std::ffi::CStr::from_ptr(json) }.to_string_lossy().into_owned();
    if let Some(waiting) = APPLE_ANSWER.lock().unwrap().take() {
        let _ = waiting.send(text);
    }
}

/// Shows Apple's sign-in sheet and returns what it gave: `{"token", "name"}`
/// or `{"error"}`. The window sends the token on to the server
/// (ui/src/lib/cloud.ts). iPhone and iPad only.
#[cfg(target_os = "ios")]
#[tauri::command]
async fn apple_sign_in() -> serde_json::Value {
    let (tell, answer) = std::sync::mpsc::channel();
    // A second tap while the sheet is up replaces the first; the first then
    // answers nobody, which is what a tap on a sheet already showing should do.
    *APPLE_ANSWER.lock().unwrap() = Some(tell);
    unsafe { done_apple_sign_in(apple_answered) };
    let text = tauri::async_runtime::spawn_blocking(move || answer.recv().unwrap_or_default()).await.unwrap_or_default();
    serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "error": "failed" }))
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn apple_sign_in() -> serde_json::Value {
    serde_json::json!({ "error": "Sign in with Apple is only in the iPhone and iPad app." })
}

/// Where the one sign-in sheet under way is waiting for Swift's answer.
#[cfg(target_os = "ios")]
static WEB_ANSWER: Mutex<Option<std::sync::mpsc::Sender<String>>> = Mutex::new(None);

#[cfg(target_os = "ios")]
extern "C" fn web_answered(json: *const std::os::raw::c_char) {
    // Copied now: Swift frees the string when this returns.
    let text = unsafe { std::ffi::CStr::from_ptr(json) }.to_string_lossy().into_owned();
    if let Some(waiting) = WEB_ANSWER.lock().unwrap().take() {
        let _ = waiting.send(text);
    }
}

/// Shows the hosted sign-in page in a sheet inside the app and returns what
/// came of it: `{"link"}` (the `done://` link the page ended on) or
/// `{"error"}`. iPhone and iPad only.
/// WHY not `open_in_browser` there: it leaves the app for Safari, which App
/// Review rejects (guideline 4.0). The system's sign-in sheet is the one
/// in-app browser Google shows its page in.
#[cfg(target_os = "ios")]
#[tauri::command]
async fn web_sign_in(url: String) -> serde_json::Value {
    // A sign-in page only: a web address (the sheet raises an exception,
    // which would end the app, for any other kind) whose path is the hosted
    // server's sign-in. Which server is not known here: its address is built
    // into the interface (VITE_DONE_CLOUD_URL), not into this crate, so the
    // interface checks that part (`isSignInPage`, ui/src/lib/cloud.ts).
    let sign_in_page = tauri::Url::parse(&url).is_ok_and(|page| matches!(page.scheme(), "https" | "http") && page.path().ends_with("/auth/google"));
    if !sign_in_page {
        return serde_json::json!({ "error": "Only the sign-in page can be opened." });
    }
    let Ok(url) = std::ffi::CString::new(url) else {
        return serde_json::json!({ "error": "failed" });
    };
    let (tell, answer) = std::sync::mpsc::channel();
    // A second start replaces the first, as in `apple_sign_in`; Swift closes
    // the first sheet.
    *WEB_ANSWER.lock().unwrap() = Some(tell);
    unsafe { done_web_sign_in(url.as_ptr(), web_answered) };
    let text = tauri::async_runtime::spawn_blocking(move || answer.recv().unwrap_or_default()).await.unwrap_or_default();
    serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "error": "failed" }))
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn web_sign_in(url: String) -> serde_json::Value {
    let _ = url;
    serde_json::json!({ "error": "Signing in inside the app is only in the iPhone and iPad app." })
}

/// Hands a JSON value to one of the Swift functions above.
#[cfg(target_os = "ios")]
fn to_swift(call: unsafe extern "C" fn(*const std::os::raw::c_char), value: &serde_json::Value) {
    if let Ok(text) = std::ffi::CString::new(value.to_string()) {
        unsafe { call(text.as_ptr()) }
    }
}

#[tauri::command]
fn focus_set(focus: tauri::State<Focus>, session: Option<Session>) {
    // On a phone the countdown lives in the Dynamic Island and on the Lock
    // Screen (a Live Activity), told every time the window's session changes;
    // the system counts it down by itself while the app is suspended.
    #[cfg(target_os = "ios")]
    to_swift(
        done_focus,
        &match &session {
            Some(s) => serde_json::json!({ "title": s.title, "endsAt": s.ends_at, "remaining": s.remaining }),
            None => serde_json::Value::Null,
        },
    );
    *focus.0.lock().unwrap() = session;
}

/// Today as the widgets show it (ui/src/lib/widget-snapshot.ts), stored where
/// the widget extension can read it. Phones only; elsewhere there are no
/// widgets and it is ignored.
#[tauri::command]
fn widget_snapshot(snapshot: serde_json::Value) {
    #[cfg(target_os = "ios")]
    to_swift(done_widget_snapshot, &snapshot);
    #[cfg(not(target_os = "ios"))]
    let _ = snapshot;
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
#[cfg(target_os = "macos")]
fn ring() {
    std::thread::spawn(|| {
        let _ = std::process::Command::new("afplay").arg("/System/Library/Sounds/Glass.aiff").status();
    });
}

#[cfg(windows)]
fn ring() {
    // Plays the user's configured Windows notification sound asynchronously.
    #[link(name = "user32")]
    extern "system" { fn MessageBeep(kind: u32) -> i32; }
    unsafe { MessageBeep(0x40); } // MB_ICONINFORMATION
}

#[cfg(all(desktop, not(any(windows, target_os = "macos"))))]
fn ring() {}

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
    let tray = TrayIconBuilder::with_id("focus");
    #[cfg(windows)]
    let tray = {
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        menu.append(&MenuItem::with_id(app, "quit", "Quit done", true, None::<&str>)?)?;
        tray.icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
            .tooltip("done")
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                    show_window(tray.app_handle());
                }
            })
    };
    #[cfg(not(windows))]
    let tray = tray.icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?).icon_as_template(true);
    tray.menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            #[cfg(windows)]
            "quit" => app.exit(0),
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
                    #[cfg(windows)]
                    let _ = tray.set_tooltip(Some(if text.is_empty() { "done".to_owned() } else { format!("done · {text}") }));
                    #[cfg(not(windows))]
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
// send and take in the answer, for the account signed in (see
// crates/core/src/account.rs: another account's tasks are held, not sent).
#[tauri::command]
fn outbox(store: tauri::State<Store>, account: done_core::Account) -> Result<done_core::Outbox, String> {
    store.outbox_for(&account).map_err(|e| e.to_string())
}

// The person chose to take another account's tasks off this device.
#[tauri::command]
fn take_over(store: tauri::State<Store>, account: done_core::Account) -> Result<(), String> {
    store.take_over(&account).map_err(|e| e.to_string())
}

#[tauri::command]
fn inbox(store: tauri::State<Store>, reply: done_core::Reply, upto: i64, account: done_core::Account) -> Result<bool, String> {
    store.inbox_for(&reply, upto, &account).map_err(|e| e.to_string())
}

// The account leaving this device: marked first, done after, and finished
// on the next load if a reload came between (crates/core/src/account.rs).
// `by`: the app writing or finishing the mark, so another app on the same
// file (the "done next" preview) never finishes it.
#[tauri::command]
fn mark_leaving(store: tauri::State<Store>, how: Option<done_core::Leaving>, by: Option<String>) -> Result<(), String> {
    store.mark_leaving(how, by.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn finish_leaving(store: tauri::State<Store>, by: Option<String>) -> Result<Option<done_core::Left>, String> {
    store.finish_leaving(by.as_deref()).map_err(|e| e.to_string())
}

// A signed-in app starting: its own mark left by a crash, to complete.
#[tauri::command]
fn own_mark(store: tauri::State<Store>, by: Option<String>) -> Result<Option<done_core::Leaving>, String> {
    store.own_mark(by.as_deref()).map_err(|e| e.to_string())
}

// Signed out with changes waiting for an account.
#[tauri::command]
fn waiting(store: tauri::State<Store>) -> Result<Option<done_core::Held>, String> {
    store.waiting().map_err(|e| e.to_string())
}

#[tauri::command]
fn info(app: tauri::AppHandle, ready: tauri::State<UpdateReady>) -> Info {
    Info {
        version: app.package_info().version.to_string(),
        mcp_command: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| if cfg!(windows) { "done.exe".into() } else { "done".into() }),
        update_ready: ready.0.lock().unwrap().as_ref().map(|release| release.version.clone()),
    }
}

/// Opens a page in the person's own browser. Signing in to a hosted account
/// starts there on a Mac or PC: Google does not show its sign-in page inside
/// an app's window. (On a phone it is `web_sign_in`, which stays in the app.)
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
fn restart(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(release) = app.state::<UpdateReady>().0.lock().unwrap().as_ref() {
        let (update, bytes) = &release.installer;
        return update.install(bytes).map_err(|e| e.to_string());
    }
    app.restart();
}

/// Check now and every six hours. Never exit a running Windows session to install.
#[cfg(desktop)]
fn keep_updated(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let installed = tauri::async_runtime::block_on(async {
            let Some(update) = app.updater()?.check().await? else {
                return Ok::<_, tauri_plugin_updater::Error>(None);
            };
            let version = update.version.clone();
            #[cfg(windows)]
            let release = {
                let bytes = update.download(|_, _| {}, || {}).await?;
                ReadyRelease { version, installer: (update, bytes) }
            };
            #[cfg(not(windows))]
            let release = {
                update.download_and_install(|_, _| {}, || {}).await?;
                ReadyRelease { version }
            };
            Ok(Some(release))
        });
        match installed {
            Ok(Some(release)) => {
                *app.state::<UpdateReady>().0.lock().unwrap() = Some(release);
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
    let builder = tauri::Builder::default();
    // Windows activates done:// with a new process. Forward it before opening
    // SQLite or creating another window. The standalone MCP bypasses this builder.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| show_window(app)));
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(OpenedLink::default())
        .manage(UpdateReady::default())
        .manage(Focus::default())
        .invoke_handler(tauri::generate_handler![state, sync, entries, record_entry, delete_entry, notes, save_note, delete_note, finished, outbox, inbox, take_over, mark_leaving, finish_leaving, own_mark, waiting, info, restart, focus_set, open_in_browser, take_opened_link, safe_area, widget_snapshot, apple_sign_in, web_sign_in, watch_apple_user]);

    // Haptics on a phone (ui/src/lib/haptics.ts).
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Closing the window hides it and leaves done running, as Mac apps
        // do: a countdown in the menu bar must outlive its window. Cmd+Q quits.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // On Windows, closing an idle window quits. A running focus timer
                // remains accessible from the system tray until stopped or quit.
                #[cfg(windows)]
                if window.state::<Focus>().0.lock().unwrap().is_none() {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        });

    builder
        .setup(|app| {
            app.manage(Store::open(&done_core::default_path()).map_err(|e| std::io::Error::other(e.to_string()))?);
            // A `done://` link is how the browser hands a finished sign-in
            // back. The window does the rest, so the link is passed on as is.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        *handle.state::<OpenedLink>().0.lock().unwrap() = Some(url.to_string());
                        let _ = handle.emit("opened-link", ());
                    }
                    show_window(&handle);
                });
                #[cfg(windows)]
                if let Some(url) = app.deep_link().get_current()?.and_then(|urls| urls.into_iter().last()) {
                    // The initial command line is processed during plugin setup.
                    app.state::<OpenedLink>().0.lock().unwrap().get_or_insert_with(|| url.to_string());
                }
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
