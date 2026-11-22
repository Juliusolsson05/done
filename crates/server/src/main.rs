//! done as a web app. It runs in one of two ways.
//!
//! Local, the default: the same interface and the same tasks file as the
//! desktop app, served to a browser on this Mac only, with no account.
//!
//! Cloud, with DONE_MODE=cloud: reachable from the internet, where each
//! person signs in with a Google account and has a tasks file of their own.

mod accounts;
mod auth;
mod pages;

use axum::{
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use accounts::{Accounts, Failure, Files};
use auth::{Cloud, Session};
use done_core::{Change, Error, NewEntry, Outbox, SaveNote, Store};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// The built interface, as one file (the build inlines its scripts and styles).
// Built into the binary: one file to run, and it cannot drift from the
// interface the desktop app ships. Build it first: cd ui && npm ci && npm run build
const UI: &str = include_str!("../../../ui/dist/index.html");

/// Only answer requests addressed to this machine. Without this a website
/// could point its own name at 127.0.0.1 and read the tasks (DNS rebinding).
async fn local_only(req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    let name = host.rsplit_once(':').map_or(host, |(name, _port)| name);
    if name != "127.0.0.1" && name != "localhost" {
        return (StatusCode::FORBIDDEN, "Local only.").into_response();
    }
    next.run(req).await
}

fn reply<T: Serialize>(result: Result<T, Error>) -> Response {
    let fail = |status, message: String| (status, Json(serde_json::json!({ "error": message }))).into_response();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(Error::Stale) => fail(StatusCode::CONFLICT, "stale".into()),
        Err(Error::Invalid(why)) => fail(StatusCode::BAD_REQUEST, why),
        Err(e) => {
            eprintln!("{e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong on the server.".into())
        }
    }
}

#[derive(Deserialize)]
struct Today {
    today: String,
}

async fn state(State(store): State<Arc<Store>>, Query(q): Query<Today>) -> Response {
    reply(store.state(&q.today))
}

// The Json extractor refuses anything that is not sent as application/json.
// That is a safety boundary: a web page in the same browser can post a form
// to 127.0.0.1, but it cannot send JSON without a preflight this server never
// answers.
async fn sync(State(store): State<Arc<Store>>, Json(change): Json<Change>) -> Response {
    reply(store.sync(change))
}

#[derive(Deserialize)]
struct Day {
    day: String,
}

/// How many finished tasks the Completed page shows.
const FINISHED_LISTED: i64 = 300;

async fn finished(State(store): State<Arc<Store>>) -> Response {
    reply(store.finished(FINISHED_LISTED))
}

async fn cloud_finished(State(cloud): State<Cloud>, session: Session) -> Response {
    answer(cloud.accounts.read(&session.sub, |s| s.finished(FINISHED_LISTED)).await)
}

async fn entries(State(store): State<Arc<Store>>, Query(q): Query<Day>) -> Response {
    reply(store.entries(&q.day))
}

// JSON only, like /api/sync, for the same reason: a form posted by another
// site cannot reach these.
async fn record_entry(State(store): State<Arc<Store>>, Json(entry): Json<NewEntry>) -> Response {
    reply(store.record(entry))
}

#[derive(Deserialize)]
struct Id {
    id: i64,
}

async fn delete_entry(State(store): State<Arc<Store>>, Json(q): Json<Id>) -> Response {
    reply(store.delete_entry(q.id).map(|()| serde_json::json!({})))
}

async fn notes(State(store): State<Arc<Store>>) -> Response {
    reply(store.notes())
}

async fn save_note(State(store): State<Arc<Store>>, Json(note): Json<SaveNote>) -> Response {
    reply(store.save_note(note))
}

async fn delete_note(State(store): State<Arc<Store>>, Json(q): Json<Id>) -> Response {
    reply(store.delete_note(q.id).map(|()| serde_json::json!({})))
}

// The same calls as the local ones above, each for the signed-in
// account's own file. The account comes from the session and from nowhere
// else: no call takes an account id, so none can be pointed at another's.
fn answer<T: Serialize>(result: Result<T, Failure>) -> Response {
    match result {
        Ok(value) => reply(Ok(value)),
        Err(Failure::Tasks(e)) => reply::<T>(Err(e)),
        Err(Failure::Storage(why)) => {
            eprintln!("{why}");
            (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "Your tasks could not be reached. Nothing was lost; try again." })))
                .into_response()
        }
    }
}

async fn cloud_state(State(cloud): State<Cloud>, session: Session, Query(q): Query<Today>) -> Response {
    answer(cloud.accounts.read(&session.sub, |s| s.state(&q.today)).await)
}

async fn cloud_sync(State(cloud): State<Cloud>, session: Session, Json(change): Json<Change>) -> Response {
    answer(cloud.accounts.write(&session.sub, |s| s.sync(change)).await)
}

async fn cloud_entries(State(cloud): State<Cloud>, session: Session, Query(q): Query<Day>) -> Response {
    answer(cloud.accounts.read(&session.sub, |s| s.entries(&q.day)).await)
}

async fn cloud_record_entry(State(cloud): State<Cloud>, session: Session, Json(entry): Json<NewEntry>) -> Response {
    answer(cloud.accounts.write(&session.sub, |s| s.record(entry)).await)
}

async fn cloud_delete_entry(State(cloud): State<Cloud>, session: Session, Json(q): Json<Id>) -> Response {
    answer(cloud.accounts.write(&session.sub, |s| s.delete_entry(q.id).map(|()| serde_json::json!({}))).await)
}

async fn cloud_notes(State(cloud): State<Cloud>, session: Session) -> Response {
    answer(cloud.accounts.read(&session.sub, |s| s.notes()).await)
}

async fn cloud_save_note(State(cloud): State<Cloud>, session: Session, Json(note): Json<SaveNote>) -> Response {
    answer(cloud.accounts.write(&session.sub, |s| s.save_note(note)).await)
}

async fn cloud_delete_note(State(cloud): State<Cloud>, session: Session, Json(q): Json<Id>) -> Response {
    answer(cloud.accounts.write(&session.sub, |s| s.delete_note(q.id).map(|()| serde_json::json!({}))).await)
}

// A device swapping changes with this account's copy: the Mac and iPhone
// apps keep their own file and meet here every few seconds (see
// crates/core/src/replica.rs). A round with nothing new to send only reads,
// so a device checking in does not rewrite the stored file each time.
async fn cloud_replicate(State(cloud): State<Cloud>, session: Session, Json(outbox): Json<Outbox>) -> Response {
    if outbox.rows.is_empty() {
        answer(cloud.accounts.read(&session.sub, |s| s.exchange(&outbox)).await)
    } else {
        answer(cloud.accounts.write(&session.sub, |s| s.exchange(&outbox)).await)
    }
}

fn local(store: Arc<Store>) -> Router {
    Router::new()
        .route("/", get(|| async { Html(UI) }))
        // Tells the interface there is no account to ask for here.
        .route("/api/me", get(|| async { Json(serde_json::json!({ "mode": "local" })) }))
        .route("/api/state", get(state))
        .route("/api/sync", post(sync))
        .route("/api/entries", get(entries).post(record_entry))
        .route("/api/finished", get(finished))
        .route("/api/entries/delete", post(delete_entry))
        .route("/api/notes", get(notes).post(save_note))
        .route("/api/notes/delete", post(delete_note))
        .layer(middleware::from_fn(local_only))
        .with_state(store)
}

fn cloud(cloud: Cloud) -> Router {
    Router::new()
        .route("/", get(|| async { Html(UI) }))
        // For the host to ask whether the server is up. Says nothing else.
        .route("/healthz", get(|| async { "ok" }))
        .route("/privacy", get(pages::privacy))
        .route("/terms", get(pages::terms))
        .route("/auth/google", get(auth::start))
        .route("/auth/google/callback", get(auth::back))
        .route("/auth/signout", post(auth::sign_out))
        .route("/auth/exchange", post(auth::exchange))
        .route("/api/me", get(auth::me))
        .route("/api/account/delete", post(auth::delete_account))
        .route("/api/state", get(cloud_state))
        .route("/api/sync", post(cloud_sync))
        .route("/api/entries", get(cloud_entries).post(cloud_record_entry))
        .route("/api/finished", get(cloud_finished))
        .route("/api/entries/delete", post(cloud_delete_entry))
        .route("/api/notes", get(cloud_notes).post(cloud_save_note))
        .route("/api/notes/delete", post(cloud_delete_note))
        .route("/api/replicate", post(cloud_replicate))
        .layer(for_the_apps())
        .with_state(cloud)
}

// The Mac and iPhone apps show the interface in a web view of their own,
// which to a server is another site. These are the addresses such a web view
// has, on every system Tauri runs on; a call from one of them is answered,
// and from any other site it is not. Credentials are not allowed on such a
// call, so it is only ever answered on a token the app sends itself, never
// on a cookie the browser happens to hold.
fn for_the_apps() -> tower_http::cors::CorsLayer {
    use axum::http::{header, HeaderValue, Method};
    tower_http::cors::CorsLayer::new()
        .allow_origin(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"].map(HeaderValue::from_static))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

#[tokio::main]
async fn main() {
    if std::env::var("DONE_MODE").as_deref() == Ok("cloud") {
        let config = auth::Config::from_env();
        let kept = std::env::var("DONE_ACCOUNTS").unwrap_or_default();
        if kept.trim().is_empty() {
            eprintln!("done cannot start in cloud mode without DONE_ACCOUNTS (a folder, or gs://bucket).");
            std::process::exit(2);
        }
        let accounts = Accounts::new(Files::from_setting(kept.trim()), std::env::temp_dir().join("done-accounts"));
        let operator = Arc::new(pages::Operator::from_env());
        let state = Cloud { accounts: Arc::new(accounts), config: Arc::new(config), operator, http: reqwest::Client::new() };
        // PORT is what a container host sets. Every address, not only this
        // machine: here, being reachable is the point, and the session is the guard.
        let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("the port is free");
        println!("done is running in cloud mode on port {port}");
        axum::serve(listener, cloud(state)).await.expect("serve");
        return;
    }
    let path = done_core::default_path();
    let store = Arc::new(Store::open(&path).expect("open the tasks file"));
    let port: u16 = std::env::var("DONE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4400);
    // 127.0.0.1 only: never reachable from the network.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("the port is free");
    println!("done is running at http://127.0.0.1:{port}");
    println!("tasks are stored in {}", path.display());
    axum::serve(listener, local(store)).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::collections::HashMap;
    use std::sync::Mutex;

    const CLIENT: &str = "done-test-client";

    async fn serve(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let at = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        at
    }

    /// Stands in for Google: hands out whatever statement the test last set.
    #[derive(Clone, Default)]
    struct Google(Arc<Mutex<serde_json::Value>>);

    impl Google {
        async fn start() -> (Self, String) {
            let google = Google::default();
            let token = |State(g): State<Google>| async move {
                let claims = g.0.lock().unwrap().clone();
                let body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
                Json(serde_json::json!({ "id_token": format!("header.{body}.signature") }))
            };
            let at = serve(Router::new().route("/token", post(token)).with_state(google.clone())).await;
            (google, at)
        }

        fn says(&self, claims: serde_json::Value) {
            *self.0.lock().unwrap() = claims;
        }
    }

    fn person(sub: &str, email: &str) -> serde_json::Value {
        serde_json::json!({
            "iss": "https://accounts.google.com", "aud": CLIENT, "exp": 4102444800u64,
            "sub": sub, "email": email, "email_verified": true, "name": "A Person",
        })
    }

    /// A hosted server with its own folder of accounts, and the Google it trusts.
    async fn hosted(key: u8) -> (String, Google, tempfile::TempDir) {
        let (google, google_at) = Google::start().await;
        let kept = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let at = format!("http://{}", listener.local_addr().unwrap());
        let config = auth::Config {
            public_url: at.clone(),
            client_id: CLIENT.into(),
            client_secret: "secret".into(),
            key: axum_extra::extract::cookie::Key::from(&[key; 64]),
            authorize_url: format!("{google_at}/authorize"),
            token_url: format!("{google_at}/token"),
        };
        let accounts = Accounts::new(Files::Folder(kept.path().join("kept")), kept.path().join("work"));
        let operator = Arc::new(pages::Operator { name: "Anna & <Co>".into(), contact: "anna@example.com".into() });
        let state = Cloud { accounts: Arc::new(accounts), config: Arc::new(config), operator, http: reqwest::Client::new() };
        tokio::spawn(async move { axum::serve(listener, cloud(state)).await.unwrap() });
        (at, google, kept)
    }

    /// A browser, as far as these tests need one: it keeps cookies and does
    /// not follow redirects by itself, so each step can be looked at.
    struct Browser {
        at: String,
        http: reqwest::Client,
        cookies: HashMap<String, String>,
    }

    impl Browser {
        fn new(at: &str) -> Self {
            let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
            Self { at: at.into(), http, cookies: HashMap::new() }
        }

        async fn send(&mut self, request: reqwest::RequestBuilder) -> reqwest::Response {
            let sent = self.cookies.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ");
            let response = request.header("cookie", sent).send().await.unwrap();
            for set in response.headers().get_all("set-cookie") {
                let pair = set.to_str().unwrap().split(';').next().unwrap();
                let (name, value) = pair.split_once('=').unwrap();
                if value.is_empty() {
                    self.cookies.remove(name);
                } else {
                    self.cookies.insert(name.into(), value.into());
                }
            }
            response
        }

        async fn get(&mut self, path: &str) -> reqwest::Response {
            let request = self.http.get(format!("{}{path}", self.at));
            self.send(request).await
        }

        async fn post(&mut self, path: &str, body: serde_json::Value) -> reqwest::Response {
            let request = self.http.post(format!("{}{path}", self.at)).json(&body);
            self.send(request).await
        }

        /// Goes to Google and comes back, as the person Google currently says.
        /// Returns where the server sent the browser afterwards.
        async fn sign_in(&mut self) -> String {
            let off = self.get("/auth/google").await;
            let to = reqwest::Url::parse(off.headers()["location"].to_str().unwrap()).unwrap();
            let word = to.query_pairs().find(|(k, _)| k == "state").unwrap().1.to_string();
            let back = self.get(&format!("/auth/google/callback?code=abc&state={word}")).await;
            back.headers()["location"].to_str().unwrap().to_string()
        }

        async fn titles(&mut self) -> Vec<String> {
            let state: serde_json::Value = self.get("/api/state?today=2026-11-18").await.json().await.unwrap();
            state["tasks"].as_array().unwrap().iter().map(|t| t["title"].as_str().unwrap().to_string()).collect()
        }
    }

    #[tokio::test]
    async fn nothing_is_answered_without_signing_in() {
        let (at, _google, _kept) = hosted(1).await;
        let mut b = Browser::new(&at);
        for path in ["/api/state?today=2026-11-18", "/api/entries?day=2026-11-18"] {
            assert_eq!(b.get(path).await.status(), 401, "{path}");
        }
        let task = serde_json::json!({ "rev": 0, "tasks": [{ "id": 1, "title": "Call the bank" }] });
        for (path, body) in [
            ("/api/sync", task),
            ("/api/entries/delete", serde_json::json!({ "id": 1 })),
            ("/api/account/delete", serde_json::json!({})),
        ] {
            assert_eq!(b.post(path, body).await.status(), 401, "{path}");
        }
        // The one call that answers: it is how the interface learns to show the sign-in screen.
        let me: serde_json::Value = b.get("/api/me").await.json().await.unwrap();
        assert_eq!(me, serde_json::json!({ "mode": "cloud", "account": null }));
    }

    #[tokio::test]
    async fn two_people_sign_in_and_each_has_their_own_tasks() {
        let (at, google, _kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let mut anna = Browser::new(&at);
        assert_eq!(anna.sign_in().await, "/");
        let me: serde_json::Value = anna.get("/api/me").await.json().await.unwrap();
        assert_eq!(me["account"]["email"], "anna@example.com");
        let saved = anna.post("/api/sync", serde_json::json!({ "rev": 0, "tasks": [{ "id": 1, "title": "Call the bank" }] })).await;
        assert_eq!(saved.status(), 200);

        google.says(person("1002", "bo@example.com"));
        let mut bo = Browser::new(&at);
        assert_eq!(bo.sign_in().await, "/");
        assert!(bo.titles().await.is_empty(), "the second person was shown the first person's tasks");
        assert_eq!(anna.titles().await, vec!["Call the bank"]);
    }

    #[tokio::test]
    async fn a_reply_from_google_this_browser_did_not_ask_for_is_refused() {
        let (at, google, _kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let mut b = Browser::new(&at);
        b.get("/auth/google").await;
        let back = b.get("/auth/google/callback?code=abc&state=someone-elses-word").await;
        assert_eq!(back.headers()["location"], "/?signin=failed");
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);
        // And with no sign-in started at all.
        let mut cold = Browser::new(&at);
        let back = cold.get("/auth/google/callback?code=abc&state=").await;
        assert_eq!(back.headers()["location"], "/?signin=failed");
    }

    #[tokio::test]
    async fn a_statement_that_does_not_hold_up_signs_nobody_in() {
        let (at, google, _kept) = hosted(1).await;
        let mut for_another_app = person("1001", "anna@example.com");
        for_another_app["aud"] = "some-other-app".into();
        let mut expired = person("1001", "anna@example.com");
        expired["exp"] = 1000.into();
        let mut unverified = person("1001", "anna@example.com");
        unverified["email_verified"] = false.into();
        let mut not_google = person("1001", "anna@example.com");
        not_google["iss"] = "https://accounts.example.com".into();
        // The id becomes a file name.
        let reaching_out = person("../1002", "anna@example.com");
        for claims in [for_another_app, expired, unverified, not_google, reaching_out] {
            google.says(claims.clone());
            let mut b = Browser::new(&at);
            assert_eq!(b.sign_in().await, "/?signin=failed", "{claims}");
            assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401, "{claims}");
        }
    }

    #[tokio::test]
    async fn a_session_made_with_another_key_is_refused() {
        let (ours, _google, _kept) = hosted(1).await;
        let (theirs, their_google, _their_kept) = hosted(2).await;
        their_google.says(person("1001", "anna@example.com"));
        let mut b = Browser::new(&theirs);
        assert_eq!(b.sign_in().await, "/");
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 200);
        // The same cookie, shown to a server that signs with a different key.
        b.at = ours;
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);
    }

    #[tokio::test]
    async fn signing_out_ends_the_session_and_deleting_the_account_removes_its_tasks() {
        let (at, google, kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let mut b = Browser::new(&at);
        b.sign_in().await;
        b.post("/api/sync", serde_json::json!({ "rev": 0, "tasks": [{ "id": 1, "title": "Call the bank" }] })).await;
        assert_eq!(b.post("/auth/signout", serde_json::json!({})).await.status(), 200);
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);

        b.sign_in().await;
        assert_eq!(b.titles().await, vec!["Call the bank"]);
        assert!(kept.path().join("kept/1001.db").exists());
        assert_eq!(b.post("/api/account/delete", serde_json::json!({})).await.status(), 200);
        assert!(!kept.path().join("kept/1001.db").exists());
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);
        b.sign_in().await;
        assert!(b.titles().await.is_empty());
    }

    #[tokio::test]
    async fn the_local_server_asks_for_no_account_and_answers_only_this_machine() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("done.db")).unwrap());
        let at = serve(local(store)).await;
        let http = reqwest::Client::new();
        let me: serde_json::Value = http.get(format!("{at}/api/me")).send().await.unwrap().json().await.unwrap();
        assert_eq!(me, serde_json::json!({ "mode": "local" }));
        assert_eq!(http.get(format!("{at}/api/state?today=2026-11-18")).send().await.unwrap().status(), 200);
        // A website that pointed its own name at this machine.
        let other = http.get(format!("{at}/api/state?today=2026-11-18")).header("host", "evil.example.com").send().await.unwrap();
        assert_eq!(other.status(), 403);
        assert_eq!(http.get(format!("{at}/auth/google")).send().await.unwrap().status(), 404);
    }

    // What the Mac or iPhone app does: it never sees the cookie, only a link
    // with a code, which it trades for a token by showing its secret.
    fn challenge_of(secret: &str) -> String {
        use sha2::Digest;
        sha2::Sha256::digest(secret.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Runs the browser's part for an app and returns the code from the link.
    async fn code_for_app(at: &str, secret: &str) -> String {
        let mut browser = Browser::new(at);
        let off = browser.get(&format!("/auth/google?app_challenge={}", challenge_of(secret))).await;
        let to = reqwest::Url::parse(off.headers()["location"].to_str().unwrap()).unwrap();
        let word = to.query_pairs().find(|(k, _)| k == "state").unwrap().1.to_string();
        let back = browser.get(&format!("/auth/google/callback?code=abc&state={word}")).await;
        assert_eq!(back.status(), 200);
        // The browser is given a page with the link, and no session of its own.
        assert!(!browser.cookies.contains_key("done_session"), "the browser was signed in as well");
        let page = back.text().await.unwrap();
        let link = page.split("href=\"").nth(1).unwrap().split('"').next().unwrap();
        let link = reqwest::Url::parse(link).unwrap();
        assert_eq!(link.scheme(), "done");
        link.query_pairs().find(|(k, _)| k == "code").unwrap().1.to_string()
    }

    async fn exchange(at: &str, code: &str, secret: &str) -> reqwest::Response {
        reqwest::Client::new().post(format!("{at}/auth/exchange")).json(&serde_json::json!({ "code": code, "verifier": secret })).send().await.unwrap()
    }

    // What the Mac app does every few seconds once signed in: its own file
    // goes up, and the web app shows the same tasks.
    #[tokio::test]
    async fn a_device_swaps_changes_with_its_account() {
        let (at, google, _kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let code = code_for_app(&at, "a secret only the app knows").await;
        let answer: serde_json::Value = exchange(&at, &code, "a secret only the app knows").await.json().await.unwrap();
        let token = answer["token"].as_str().unwrap();

        let mac = done_core::Store::open(std::path::Path::new(":memory:")).unwrap();
        mac.sync(Change { rev: 0, tasks: vec![serde_json::from_value(serde_json::json!({ "id": 1, "title": "Email the funds" })).unwrap()], ..Default::default() })
            .unwrap();
        let http = reqwest::Client::new();
        let out = mac.outbox().unwrap();
        let reply: done_core::Reply =
            http.post(format!("{at}/api/replicate")).bearer_auth(token).json(&out).send().await.unwrap().json().await.unwrap();
        mac.inbox(&reply, out.upto).unwrap();
        let mut web = Browser::new(&at);
        web.sign_in().await;
        assert_eq!(web.titles().await, vec!["Email the funds"]);
        // Nothing new: nothing sent, nothing comes back.
        let out = mac.outbox().unwrap();
        assert!(out.rows.is_empty());
        let reply: done_core::Reply =
            http.post(format!("{at}/api/replicate")).bearer_auth(token).json(&out).send().await.unwrap().json().await.unwrap();
        assert!(!mac.inbox(&reply, out.upto).unwrap());
        // Without a sign-in, no account is reached.
        let anonymous = http.post(format!("{at}/api/replicate")).json(&out).send().await.unwrap();
        assert_eq!(anonymous.status(), 401);
    }

    #[tokio::test]
    async fn an_app_signs_in_through_the_browser_and_uses_a_token() {
        let (at, google, _kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let code = code_for_app(&at, "a secret only the app knows").await;
        let answer: serde_json::Value = exchange(&at, &code, "a secret only the app knows").await.json().await.unwrap();
        assert_eq!(answer["account"]["email"], "anna@example.com");
        let token = answer["token"].as_str().unwrap();

        let http = reqwest::Client::new();
        let saved = http
            .post(format!("{at}/api/sync"))
            .bearer_auth(token)
            .json(&serde_json::json!({ "rev": 0, "tasks": [{ "id": 1, "title": "Call the bank" }] }))
            .send()
            .await
            .unwrap();
        assert_eq!(saved.status(), 200);
        // The same account the web app shows: signed in there, the task is there.
        let mut web = Browser::new(&at);
        web.sign_in().await;
        assert_eq!(web.titles().await, vec!["Call the bank"]);
        let me: serde_json::Value = http.get(format!("{at}/api/me")).bearer_auth(token).send().await.unwrap().json().await.unwrap();
        assert_eq!(me["account"]["email"], "anna@example.com");
    }

    #[tokio::test]
    async fn a_code_is_worth_nothing_without_the_secret_and_is_never_a_token() {
        let (at, google, _kept) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let code = code_for_app(&at, "the secret").await;
        // Another app that claimed the link has the code and not the secret.
        assert_eq!(exchange(&at, &code, "a guess").await.status(), 400);
        assert_eq!(exchange(&at, "not a code", "the secret").await.status(), 400);
        // A code is not a token.
        let http = reqwest::Client::new();
        let as_token = http.get(format!("{at}/api/state?today=2026-11-18")).bearer_auth(&code).send().await.unwrap();
        assert_eq!(as_token.status(), 401);
        // And a token is not a code.
        let answer: serde_json::Value = exchange(&at, &code, "the secret").await.json().await.unwrap();
        let token = answer["token"].as_str().unwrap();
        assert_eq!(exchange(&at, token, "the secret").await.status(), 400);
        // A token signed by another server is refused.
        let (other, other_google, _other_kept) = hosted(2).await;
        other_google.says(person("1001", "anna@example.com"));
        let theirs: serde_json::Value = exchange(&other, &code_for_app(&other, "s").await, "s").await.json().await.unwrap();
        let refused = http.get(format!("{at}/api/state?today=2026-11-18")).bearer_auth(theirs["token"].as_str().unwrap()).send().await.unwrap();
        assert_eq!(refused.status(), 401);
        // Something that is not a challenge never reaches a page.
        assert_eq!(Browser::new(&at).get("/auth/google?app_challenge=%22%3E%3Cscript%3E").await.status(), 400);
    }

    #[tokio::test]
    async fn only_the_apps_are_answered_from_another_origin() {
        let (at, _google, _kept) = hosted(1).await;
        let http = reqwest::Client::new();
        let ask = |origin: &'static str| {
            http.request(reqwest::Method::OPTIONS, format!("{at}/api/sync"))
                .header("origin", origin)
                .header("access-control-request-method", "POST")
                .header("access-control-request-headers", "authorization,content-type")
                .send()
        };
        let app = ask("tauri://localhost").await.unwrap();
        assert_eq!(app.headers().get("access-control-allow-origin").unwrap(), "tauri://localhost");
        // Never with credentials: a call from another origin is answered on a token only.
        assert!(app.headers().get("access-control-allow-credentials").is_none());
        let site = ask("https://evil.example.com").await.unwrap();
        assert!(site.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn the_privacy_and_terms_pages_are_open_to_everyone_and_name_who_runs_the_server() {
        let (at, _google, _kept) = hosted(1).await;
        let http = reqwest::Client::new();
        for path in ["/privacy", "/terms"] {
            let page = http.get(format!("{at}{path}")).send().await.unwrap();
            assert_eq!(page.status(), 200, "{path}");
            let text = page.text().await.unwrap();
            // The operator's name is a setting and goes into a page: as text, never as markup.
            assert!(text.contains("Anna &amp; &lt;Co&gt;"), "{path}");
            assert!(!text.contains("<Co>"), "{path}");
            assert!(text.contains("mailto:anna@example.com"), "{path}");
            assert!(!text.contains("WHO"), "{path}: a placeholder was left in");
        }
        // A server on this Mac has no accounts and keeps nothing about anyone.
        let dir = tempfile::tempdir().unwrap();
        let local_at = serve(local(Arc::new(Store::open(&dir.path().join("done.db")).unwrap()))).await;
        assert_eq!(http.get(format!("{local_at}/privacy")).send().await.unwrap().status(), 404);
    }
}
