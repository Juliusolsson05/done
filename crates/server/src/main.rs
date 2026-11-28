//! done as a web app. It runs in one of two ways.
//!
//! Local, the default: the same interface and the same tasks file as the
//! desktop app, served to a browser on this Mac only, with no account.
//!
//! Cloud, with DONE_MODE=cloud: reachable from the internet, where each
//! person signs in with a Google account and has a tasks file of their own.

mod accounts;
mod auth;
mod oauth;
mod remote_mcp;
mod collab;
mod pages;
mod pg;

use axum::{
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use accounts::Files;
use auth::Cloud;
use done_core::{Change, Error, NewEntry, Outbox, SaveNote, Store, Synced};
use pg::{Db, Fail, Me};
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

// The same calls as the local ones above, for the signed-in person, over
// every space they are in. Who they are comes from the session and from
// nowhere else: no call takes an account id, so none can be pointed at
// another's (see pg.rs for how spaces are kept apart).
fn done<T: Serialize>(result: Result<T, Fail>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(fail) => auth::down(fail),
    }
}

#[derive(Deserialize)]
struct NewFeedback {
    kind: String,
    message: String,
}

async fn feedback(State(cloud): State<Cloud>, me: Me) -> Response {
    ([(header::CACHE_CONTROL, "private, no-store")], done(cloud.db.feedback(&me).await)).into_response()
}

async fn add_feedback(State(cloud): State<Cloud>, me: Me, Json(q): Json<NewFeedback>) -> Response {
    done(cloud.db.add_feedback(&me, &q.kind, &q.message).await)
}

async fn cloud_state(State(cloud): State<Cloud>, me: Me, Query(q): Query<Today>) -> Response {
    done(cloud.db.state(&me, &q.today).await)
}

async fn cloud_sync(State(cloud): State<Cloud>, me: Me, Json(change): Json<Change>) -> Response {
    done(cloud.db.sync(&me, change).await.map(|rev| Synced { rev }))
}

async fn cloud_finished(State(cloud): State<Cloud>, me: Me) -> Response {
    done(cloud.db.finished(&me, FINISHED_LISTED).await)
}

async fn cloud_entries(State(cloud): State<Cloud>, me: Me, Query(q): Query<Day>) -> Response {
    done(cloud.db.entries(&me, &q.day).await)
}

async fn cloud_record_entry(State(cloud): State<Cloud>, me: Me, Json(entry): Json<NewEntry>) -> Response {
    done(cloud.db.record(&me, entry).await)
}

async fn cloud_delete_entry(State(cloud): State<Cloud>, me: Me, Json(q): Json<Id>) -> Response {
    done(cloud.db.delete_entry(&me, q.id).await.map(|()| serde_json::json!({})))
}

async fn cloud_notes(State(cloud): State<Cloud>, me: Me) -> Response {
    done(cloud.db.notes(&me).await)
}

async fn cloud_save_note(State(cloud): State<Cloud>, me: Me, Json(note): Json<SaveNote>) -> Response {
    done(cloud.db.save_note(&me, note).await)
}

async fn cloud_delete_note(State(cloud): State<Cloud>, me: Me, Json(q): Json<Id>) -> Response {
    done(cloud.db.delete_note(&me, q.id).await.map(|()| serde_json::json!({})))
}

// A device swapping changes with the server: the Mac and iPhone apps keep
// their own file and meet here every few seconds (see
// crates/core/src/replica.rs and pg.rs `exchange`).
async fn cloud_replicate(State(cloud): State<Cloud>, me: Me, Json(outbox): Json<Outbox>) -> Response {
    done(cloud.db.exchange(&me, &outbox).await)
}

async fn cloud_team(State(cloud): State<Cloud>, me: Me) -> Response {
    done(cloud.db.team(&me).await)
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Space {
    space: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    account: String,
}

#[derive(Deserialize)]
struct InviteId {
    #[serde(default)]
    invite: Option<i64>,
    #[serde(default)]
    token: Option<String>,
}

#[derive(Deserialize)]
struct MoveProject {
    project: i64,
    space: i64,
}

const OK: fn(()) -> serde_json::Value = |()| serde_json::json!({});

async fn create_workspace(State(cloud): State<Cloud>, me: Me, Json(q): Json<Named>) -> Response {
    done(cloud.db.create_workspace(&me, &q.name).await.map(|space| serde_json::json!({ "space": space })))
}

async fn rename_workspace(State(cloud): State<Cloud>, me: Me, Json(q): Json<Space>) -> Response {
    done(cloud.db.rename_workspace(&me, q.space, &q.name).await.map(OK))
}

async fn delete_workspace(State(cloud): State<Cloud>, me: Me, Json(q): Json<Space>) -> Response {
    done(cloud.db.delete_workspace(&me, q.space).await.map(OK))
}

async fn invite(State(cloud): State<Cloud>, me: Me, Json(q): Json<Space>) -> Response {
    done(cloud.db.invite(&me, q.space, &q.email, &cloud.config.public_url).await)
}

async fn invite_link(State(cloud): State<Cloud>, me: Me, Json(q): Json<InviteId>) -> Response {
    let Some(id) = q.invite else { return auth::down(Fail::NotFound) };
    done(cloud.db.invite_link(&me, id, &cloud.config.public_url).await)
}

async fn revoke(State(cloud): State<Cloud>, me: Me, Json(q): Json<InviteId>) -> Response {
    let Some(id) = q.invite else { return auth::down(Fail::NotFound) };
    done(cloud.db.revoke(&me, id).await.map(OK))
}

async fn accept(State(cloud): State<Cloud>, me: Me, Json(q): Json<InviteId>) -> Response {
    done(cloud.db.accept(&me, q.invite, q.token.as_deref()).await.map(|space| serde_json::json!({ "space": space })))
}

async fn decline(State(cloud): State<Cloud>, me: Me, Json(q): Json<InviteId>) -> Response {
    let Some(id) = q.invite else { return auth::down(Fail::NotFound) };
    done(cloud.db.decline(&me, id).await.map(OK))
}

async fn remove_member(State(cloud): State<Cloud>, me: Me, Json(q): Json<Space>) -> Response {
    done(cloud.db.remove_member(&me, q.space, &q.account).await.map(OK))
}

async fn leave(State(cloud): State<Cloud>, me: Me, Json(q): Json<Space>) -> Response {
    done(cloud.db.leave(&me, q.space).await.map(OK))
}

async fn move_project(State(cloud): State<Cloud>, me: Me, Json(q): Json<MoveProject>) -> Response {
    done(cloud.db.move_project(&me, q.project, q.space).await.map(OK))
}

#[derive(Deserialize)]
struct LiveAsk {
    #[serde(default)]
    note: Option<i64>,
    #[serde(default)]
    space: Option<i64>,
}

/// A ticket to the live notes service: for one note of a workspace the
/// person is in (to write it with the others), or for the workspace itself
/// (to see who is in which note). Good for two minutes.
async fn live_ticket(State(cloud): State<Cloud>, me: Me, session: auth::Session, Json(q): Json<LiveAsk>) -> Response {
    let Some(url) = cloud.config.collab_url.clone() else { return auth::down(Fail::NotFound) };
    let space = match (q.note, q.space) {
        (Some(note), _) => cloud.db.note_workspace(&me, note).await,
        (None, Some(space)) => match cloud.db.in_workspace(&me.id, me.generation, space).await {
            Ok(true) => Ok(space),
            Ok(false) => Err(Fail::NotFound),
            Err(e) => Err(e),
        },
        (None, None) => Err(Fail::NotFound),
    };
    let space = match space {
        Ok(space) => space,
        Err(e) => return auth::down(e),
    };
    let ticket = collab::Ticket {
        account: me.id.clone(),
        generation: me.generation,
        name: session.name.clone(),
        picture: session.picture.clone(),
        space,
        note: q.note,
        exp: collab::now() + collab::TICKET_LIFE,
    };
    Json(serde_json::json!({ "ticket": collab::issue(&cloud.config.key, &ticket), "url": url })).into_response()
}

async fn read_notifications(State(cloud): State<Cloud>, me: Me, Json(_): Json<serde_json::Value>) -> Response {
    done(cloud.db.read_notifications(&me).await.map(OK))
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
        .route("/", get(pages::home))
        .route("/feedback", get(pages::feedback))
        .route("/api/feedback", get(feedback).post(add_feedback))
        // For the host to ask whether the server is up. Says nothing else.
        .route("/healthz", get(|| async { "ok" }))
        .route("/privacy", get(pages::privacy))
        .route("/support", get(pages::support))
        .route("/terms", get(pages::terms))
        .route("/auth/google", get(auth::start))
        .route("/auth/google/callback", get(auth::back))
        .route("/auth/signout", post(auth::sign_out))
        .route("/auth/exchange", post(auth::exchange))
        .route("/auth/apple", post(auth::apple))
        .route("/auth/review", post(auth::review))
        // MCP for apps that connect by address (Claude's connectors), and the
        // sign-in they go through first.
        .route("/mcp", post(remote_mcp::post).get(remote_mcp::other).delete(remote_mcp::other))
        .route("/.well-known/oauth-protected-resource", get(oauth::protected_resource))
        .route("/.well-known/oauth-protected-resource/mcp", get(oauth::protected_resource))
        .route("/.well-known/oauth-authorization-server", get(oauth::authorization_server))
        .route("/oauth/register", post(oauth::register))
        .route("/oauth/authorize", get(oauth::authorize).post(oauth::answer))
        .route("/oauth/token", post(oauth::token))
        .route("/auth/dev", get(auth::dev))
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
        .route("/api/team", get(cloud_team))
        .route("/api/workspaces", post(create_workspace))
        .route("/api/workspaces/rename", post(rename_workspace))
        .route("/api/workspaces/delete", post(delete_workspace))
        .route("/api/workspaces/invite", post(invite))
        .route("/api/workspaces/invite-link", post(invite_link))
        .route("/api/workspaces/revoke", post(revoke))
        .route("/api/workspaces/remove", post(remove_member))
        .route("/api/workspaces/leave", post(leave))
        .route("/api/invites/accept", post(accept))
        .route("/api/invites/decline", post(decline))
        .route("/api/projects/move", post(move_project))
        .route("/api/notifications/read", post(read_notifications))
        .route("/api/live/ticket", post(live_ticket))
        .route("/invite/{token}", get(pages::invite))
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

/// Where the database is: a libpq connection string, from DONE_DATABASE.
fn database() -> String {
    match std::env::var("DONE_DATABASE") {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => {
            eprintln!("done cannot start in cloud mode without DONE_DATABASE (a Postgres connection string).");
            std::process::exit(2);
        }
    }
}

fn fail_start(e: Fail) -> ! {
    eprintln!("done could not reach its database: {e:?}");
    std::process::exit(2);
}

/// Every account file, into its own space in the database, each one checked
/// row for row after. True when every account came across whole.
async fn import(db: &Db, files: &Files) -> bool {
    let ids = match files.ids().await {
        Ok(ids) => ids,
        Err(e) => {
            eprintln!("could not list the account files: {}", e.0);
            return false;
        }
    };
    let mut whole = true;
    let work = std::env::temp_dir().join(format!("done-import-{:x}", rand::random::<u64>()));
    let _ = std::fs::create_dir_all(&work);
    for id in ids {
        let outcome = async {
            let (bytes, _) = files.get(&id).await.map_err(|e| e.0)?.ok_or("gone")?;
            let path = work.join(format!("{id}.db"));
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            let file = Store::open(&path).map_err(|e| e.to_string())?.export().map_err(|e| e.to_string())?;
            let fresh = db.import(&id, &file).await.map_err(|e| format!("{e:?}"))?;
            let counted = db.count(&id).await.map_err(|e| format!("{e:?}"))?;
            let expected = [file.rows.projects.len(), file.rows.tasks.len(), file.rows.notes.len(), file.rows.entries.len(), file.rows.gone.len()]
                .map(|n| n as i64);
            Ok::<_, String>((fresh, counted, expected))
        }
        .await;
        match outcome {
            Ok((fresh, counted, expected)) => {
                let ok = counted == expected;
                whole &= ok || !fresh;
                println!(
                    "{id}: {} projects {:?}, tasks {:?}, notes {:?}, entries {:?}, deletions {:?}",
                    if !fresh { "already there;" } else if ok { "ok;" } else { "MISMATCH;" },
                    (counted[0], expected[0]),
                    (counted[1], expected[1]),
                    (counted[2], expected[2]),
                    (counted[3], expected[3]),
                    (counted[4], expected[4]),
                );
            }
            Err(why) => {
                whole = false;
                println!("{id}: FAILED: {why}");
            }
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    whole
}

#[tokio::main]
async fn main() {
    // One-off: bring the account files kept before Postgres into the
    // database. `done-server import gs://bucket` (or a folder), with
    // DONE_DATABASE set. Safe to run again: an account already there is left alone.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("import") {
        let Some(from) = args.get(2) else {
            eprintln!("usage: done-server import <gs://bucket or folder>");
            std::process::exit(2);
        };
        let db = Db::connect(&database()).await.unwrap_or_else(|e| fail_start(e));
        std::process::exit(if import(&db, &Files::from_setting(from)).await { 0 } else { 1 });
    }
    // Notes written together live: its own service, one instance (collab.rs).
    if args.get(1).map(String::as_str) == Some("collab") {
        // Only what it needs: the database, the key the main server signs
        // tickets with, and where the web app is (the one site allowed to connect).
        let read = |name: &str| std::env::var(name).map(|v| v.trim().to_string()).unwrap_or_default();
        let (key, public_url) = (read("DONE_SESSION_KEY"), read("DONE_PUBLIC_URL").trim_end_matches('/').to_string());
        if key.len() < 64 || public_url.is_empty() {
            eprintln!("done collab needs DONE_SESSION_KEY (the main server's) and DONE_PUBLIC_URL.");
            std::process::exit(2);
        }
        let url = database();
        let db = Arc::new(Db::connect(&url).await.unwrap_or_else(|e| fail_start(e)));
        let also: Vec<String> = read("DONE_COLLAB_ORIGINS").split(',').map(String::from).collect();
        let live = collab::Collab::new(db, axum_extra::extract::cookie::Key::from(key.as_bytes()), &public_url, &also);
        tokio::spawn(live.clone().keep());
        tokio::spawn(live.clone().listen(url));
        let local = public_url.starts_with("http://127.0.0.1:") || public_url.starts_with("http://localhost:");
        let address = if local { "127.0.0.1" } else { "0.0.0.0" };
        let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
        let listener = tokio::net::TcpListener::bind((address, port)).await.expect("the port is free");
        println!("done collab is running on {address}:{port}");
        axum::serve(listener, collab::router(live)).await.expect("serve");
        return;
    }
    if std::env::var("DONE_MODE").as_deref() == Ok("cloud") {
        let config = auth::Config::from_env();
        let db = Db::connect(&database()).await.unwrap_or_else(|e| fail_start(e));
        let operator = Arc::new(pages::Operator::from_env());
        let state = Cloud { db: Arc::new(db), config: Arc::new(config), operator, http: reqwest::Client::new() };
        // PORT is what a container host sets. Every address, not only this
        // machine: here, being reachable is the point, and the session is the guard.
        let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
        // With the laptop sign-in on, this machine only: anyone who could
        // reach it could sign in as anyone.
        let address = if state.config.dev { "127.0.0.1" } else { "0.0.0.0" };
        let listener = tokio::net::TcpListener::bind((address, port)).await.expect("the port is free");
        println!("done is running in cloud mode on {address}:{port}");
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
    const REVIEW_PASSWORD: &str = "a-long-review-password";

    // A key made for these tests only (openssl genrsa 2048), standing in for
    // the one Apple signs its tokens with. It signs nothing anywhere else.
    const APPLE_TEST_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCtTWzJthBTEMrX\nKg5wWLGj4c9O6zk61kYZydQuPsmHRMtZIhDviCzQJ1/DXbUCqpuuZ1K3sS0grbFk\nf7Q20z1VqmyDzQoiqWRx4IndjyF3pfs85i6TRx1p78V65Ht7zQJzuqPkFxc/pKhj\nW40PsTMLZW7wZ00+vdBOkgNwfVuxDMXn4Y58hs5IZk6ms2zuRSaM8NL9rtkuVOXW\nPg5mdR6KthfVYB772USFlNXtngkqBPVH9jAyi9l0q2AQ1IEBxvTmIShzZAqLkgTz\nrCXPeGIuC5PSZP3D+Nx3Z7Q0nOX/o4u7lMM7TYKZwchMBO/Qo4FYHM8rObbm3VSZ\n5ocuWMNBAgMBAAECggEAHRfUXYB8+RTmmHxs9BtPpw1vefYvI1t5ZTbmseTEfDrm\nUE5RvYSE0WTqxKdkjdAKVprt3fyWcNf34cE2hcWslEcJ9I5lVzBMtnlVa6ZtneJ1\nbOHPi9XycChaZKkaucvOz5LTlKTzuDFyO0vRQIMk6JLcrusIorHG2InWnfnNfMk7\nN71D4FvuaVIcI3Qv7cZ7/1tDExRwBKm7vK72bG3z6b0ltGysDaQI+jsdu+msdttI\nCZuNfIrVqS5jCSt4k9FCe8W2FAOiDtQ06BvkKx+4JfWziO5tSr9UtnB+j8UQbfSN\nKCzpKs9XdGKp03F0Nyg73lYzswmliOctBswNyLxV4QKBgQDj2n16nk2JLhdepUg+\nvvv+tWZRVRSSXSO5wDIVnj7Simm/Q2WUBaNlptR8ZeDEMbJQkkAp33avwJoia4Nh\nBbXsZbaoc1DrQniokQpE3/UrSTO6Umd+4C/UnZscEFYb0Vai/hEveJK5IkEaAngN\naywbIHss4xMikILqbrZ5BguflQKBgQDCtdf2srdSGp859oV8+QOWjqKCcRhpsb0l\na/ASBO8iQ8CP0dGUQwp71U1bjc2McEEr1SIO4phkeq+lzk3fjCYbguDBBNQEMLUg\nWGApdpDGDJbZZGUJB+IsV1Pydr+wMILpp3QwUU6g/GjZVOAloMplvRkMCBWgbJTR\n/k0IyYyZ/QKBgDGrGRs3ktNKdtGs2djDrQ7S4CDumPNm1jjRiplny239uht1R5lC\nuWGZQkxzsNFTu/kQSGhYS/j31SGXqiXmJsgHTA/gQ01lSgQEyeZFo53x8RK2j9T6\nbbK9QGiXrw2VTnttQrXEZMdyjhprW1whdpXbOL6KKUupkMAlriUnijUZAoGAJfgo\nASegsBYY7siwB0rX9EgkUKOVSycp515BFoJ3z4q+xkz4PZ1FMhjKWQwyBSzuyIlr\ndtOhPBbgoci1Tt6Zn8vJ4Fn8rkSBTaluNyez26sgz4vQWA59gIAXErUtdEJBhSbu\ndW2lk6clGxx+CVhtn6FcfQgmj34dF0Yr54bGMFECgYByla1WkYoL4G54OBi0/Ys8\nK0l90ZcZrIOXP3SJAywoFlh059/BOSv1ue4LVw+k6i/eTmADRbSHgrE+8YHIbgkf\n4YCaivn5P0N4S0TrQHukFYdnTrkBjTYmQ5unO6swe5YtO1hRfWFkaQxpWFpHXrHD\nhzcBJtA359XghW/6UaXt3A==\n-----END PRIVATE KEY-----";
    const APPLE_TEST_N: &str = "rU1sybYQUxDK1yoOcFixo-HPTus5OtZGGcnULj7Jh0TLWSIQ74gs0Cdfw121AqqbrmdSt7EtIK2xZH-0NtM9Vapsg80KIqlkceCJ3Y8hd6X7POYuk0cdae_FeuR7e80Cc7qj5BcXP6SoY1uND7EzC2Vu8GdNPr3QTpIDcH1bsQzF5-GOfIbOSGZOprNs7kUmjPDS_a7ZLlTl1j4OZnUeirYX1WAe-9lEhZTV7Z4JKgT1R_YwMovZdKtgENSBAcb05iEoc2QKi5IE86wlz3hiLguT0mT9w_jcd2e0NJzl_6OLu5TDO02CmcHITATv0KOBWBzPKzm25t1UmeaHLljDQQ";

    /// A token as Apple would give the iPhone app, signed with `kid`.
    fn apple_token(claims: serde_json::Value, kid: &str) -> String {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        header.kid = Some(kid.into());
        jsonwebtoken::encode(&header, &claims, &jsonwebtoken::EncodingKey::from_rsa_pem(APPLE_TEST_KEY.as_bytes()).unwrap()).unwrap()
    }

    fn apple_claims(aud: &str, exp: u64) -> serde_json::Value {
        serde_json::json!({ "iss": "https://appleid.apple.com", "aud": aud, "exp": exp, "iat": 1, "sub": "001234.abcdef0123456789.1234", "email": "x@privaterelay.appleid.com" })
    }

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
            // Apple's published keys, here: the one the tests sign with.
            let keys = || async { Json(serde_json::json!({ "keys": [{ "kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig", "n": APPLE_TEST_N, "e": "AQAB" }] })) };
            let at = serve(Router::new().route("/token", post(token)).route("/keys", get(keys)).with_state(google.clone())).await;
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

    /// A hosted server with a database of its own, and the Google it trusts.
    async fn hosted(key: u8) -> (String, Google, Arc<Db>) {
        hosted_with_apple(key, None).await
    }

    async fn hosted_with_apple(key: u8, apple_grants: Option<auth::apple_grants::Client>) -> (String, Google, Arc<Db>) {
        hosted_on(Arc::new(pg::testing::db().await), key, apple_grants).await
    }

    /// A hosted server on a database another one may be using too: the same
    /// service after a redeploy with different settings.
    async fn hosted_on(db: Arc<Db>, key: u8, apple_grants: Option<auth::apple_grants::Client>) -> (String, Google, Arc<Db>) {
        let (google, google_at) = Google::start().await;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let at = format!("http://{}", listener.local_addr().unwrap());
        let config = auth::Config {
            public_url: at.clone(),
            client_id: CLIENT.into(),
            client_secret: "secret".into(),
            key: axum_extra::extract::cookie::Key::from(&[key; 64]),
            authorize_url: format!("{google_at}/authorize"),
            token_url: format!("{google_at}/token"),
            dev: false,
            collab_url: None,
            apple_audience: "app.thedone.ios".into(),
            apple_keys_url: format!("{google_at}/keys"),
            apple_grants,
            review_password: Some(REVIEW_PASSWORD.into()),
            time_zone: "America/Los_Angeles".into(),
        };
        let operator = Arc::new(pages::Operator { name: "Anna & <Co>".into(), contact: "anna@example.com".into() });
        let state = Cloud { db: db.clone(), config: Arc::new(config), operator, http: reqwest::Client::new() };
        tokio::spawn(async move { axum::serve(listener, cloud(state)).await.unwrap() });
        (at, google, db)
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

        /// Signs in from a sign-in started with `then`, and returns where the
        /// server sent the browser afterwards.
        async fn sign_in_then(&mut self, then: &str) -> String {
            let mut start = reqwest::Url::parse("http://x/auth/google").unwrap();
            start.query_pairs_mut().append_pair("then", then);
            let off = self.get(&format!("/auth/google?{}", start.query().unwrap())).await;
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
        // The laptop-only sign-in does not exist on a real server.
        assert_eq!(b.get("/auth/dev?as=geart").await.status(), 404);
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);
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
    async fn feedback_landing_uses_the_app_host_for_sign_in() {
        let (at, google, _db) = hosted(1).await;
        let mut browser = Browser::new(&at);
        let landing = browser.get("/feedback").await.text().await.unwrap();
        assert!(landing.contains(&format!("{at}/auth/google?then=%2Ffeedback")));
        for path in ["/privacy", "/support"] {
            assert!(landing.contains(&format!("href=\"{at}{path}\"")));
        }
        assert!(!landing.contains("{{APP_URL}}"));
        let hi = browser.http.get(&at).header("host", "Hi.TheDone.App:443").send().await.unwrap();
        assert_eq!(hi.text().await.unwrap(), landing);
        assert_eq!(browser.get("/").await.text().await.unwrap(), UI);
        google.says(person("friend", "friend@example.com"));
        assert_eq!(browser.sign_in_then("/feedback").await, "/feedback");
        assert_eq!(browser.sign_in_then("/feedback/elsewhere").await, "/");
    }

    #[tokio::test]
    async fn friends_can_share_feedback_and_deleting_an_account_removes_its_posts() {
        let (at, google, _db) = hosted(1).await;
        let path = "/api/feedback";
        let write = |kind: &str, message: &str| serde_json::json!({ "kind": kind, "message": message });
        let mut anna = Browser::new(&at);
        let mut bo = Browser::new(&at);
        assert_eq!(anna.get(path).await.status(), 401);
        assert_eq!(anna.post(path, write("idea", "More shortcuts")).await.status(), 401);
        google.says(person("anna", "anna@example.com"));
        anna.sign_in().await;
        for (kind, message) in [("bug", "  "), ("other", "Hello"), ("idea", "a\0b"), ("bug", &"a".repeat(2001))] {
            assert_eq!(anna.post(path, write(kind, message)).await.status(), 400);
        }
        let saved = anna.post(path, write("bug", "  The keyboard hides a list.  ")).await;
        assert_eq!(saved.status(), 200);
        let row: serde_json::Value = saved.json().await.unwrap();
        assert_eq!(row["kind"], "bug");
        assert_eq!(row["message"], "The keyboard hides a list.");
        assert!(row["created"].as_i64().unwrap() > 0);
        assert!(row["id"].as_i64().unwrap() > 0);
        assert_eq!(row.as_object().unwrap().len(), 4, "the public representation omits account data");

        google.says(person("bo", "bo@example.com"));
        bo.sign_in().await;
        let newest: serde_json::Value = bo.post(path, write("idea", "Add a shortcut")).await.json().await.unwrap();
        let wall = bo.get(path).await;
        assert_eq!(wall.headers()["cache-control"], "private, no-store");
        assert_eq!(wall.json::<serde_json::Value>().await.unwrap(), serde_json::json!([newest, row]));
        for _ in 1..30 {
            assert_eq!(anna.post(path, write("idea", "A suggestion")).await.status(), 200);
        }
        assert_eq!(anna.post(path, write("idea", "One more")).await.status(), 429);
        let deleted = anna.post("/api/account/delete", serde_json::json!({})).await;
        assert_eq!(deleted.status(), 200);
        assert_eq!(deleted.json::<serde_json::Value>().await.unwrap(), serde_json::json!({ "apple": "none" }), "a Google account has nothing at Apple");
        assert_eq!(bo.get(path).await.json::<serde_json::Value>().await.unwrap(), serde_json::json!([newest]));
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
        let (at, google, db) = hosted(1).await;
        google.says(person("1001", "anna@example.com"));
        let mut b = Browser::new(&at);
        b.sign_in().await;
        b.post("/api/sync", serde_json::json!({ "rev": 0, "tasks": [{ "id": 1, "title": "Call the bank" }] })).await;
        assert_eq!(b.post("/auth/signout", serde_json::json!({})).await.status(), 200);
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);

        b.sign_in().await;
        assert_eq!(b.titles().await, vec!["Call the bank"]);
        assert_eq!(db.count("1001").await.unwrap()[1], 1);
        let mut other_device = Browser::new(&at);
        other_device.sign_in().await;
        assert_eq!(b.post("/api/account/delete", serde_json::json!({})).await.status(), 200);
        assert_eq!(other_device.get("/api/state?today=2026-11-18").await.status(), 401);
        assert!(matches!(db.count("1001").await, Err(Fail::NotFound)));
        assert_eq!(b.get("/api/state?today=2026-11-18").await.status(), 401);
        b.sign_in().await;
        assert!(b.titles().await.is_empty());
        assert_eq!(other_device.get("/api/state?today=2026-11-18").await.status(), 401);
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
    async fn the_public_help_pages_name_who_runs_the_server() {
        let (at, _google, _kept) = hosted(1).await;
        let http = reqwest::Client::new();
        for path in ["/privacy", "/terms", "/support"] {
            let page = http.get(format!("{at}{path}")).send().await.unwrap();
            assert_eq!(page.status(), 200, "{path}");
            let text = page.text().await.unwrap();
            // The operator's name is a setting and goes into a page: as text, never as markup.
            assert!(text.contains("Anna &amp; &lt;Co&gt;"), "{path}");
            assert!(!text.contains("<Co>"), "{path}");
            assert!(text.contains("mailto:anna@example.com"), "{path}");
            if path == "/privacy" {
                assert!(text.contains("Apple relay address") && text.contains("Delete App") && text.contains("external assistant"));
            }
            if path == "/support" {
                assert!(text.contains("feedback wall") && text.contains("Privacy policy"));
            }
            assert!(!text.contains("WHO"), "{path}: a placeholder was left in");
        }
        // A server on this Mac has no accounts and keeps nothing about anyone.
        let dir = tempfile::tempdir().unwrap();
        let local_at = serve(local(Arc::new(Store::open(&dir.path().join("done.db")).unwrap()))).await;
        assert_eq!(http.get(format!("{local_at}/privacy")).send().await.unwrap().status(), 404);
    }

    #[tokio::test]
    async fn apple_sign_in_holds_apple_to_its_token() {
        let (at, _google, _kept) = hosted(7).await;
        let mut b = Browser::new(&at);
        let sign_in = |token: String, name: &str| serde_json::json!({ "identity_token": token, "name": name });
        // Made out to another app, out of date, or signed with a key Apple
        // does not list: each is refused.
        for (token, why) in [
            (apple_token(apple_claims("com.someone.else", 4102444800), "test"), "another app"),
            (apple_token(apple_claims("app.thedone.ios", 1000), "test"), "expired"),
            (apple_token(apple_claims("app.thedone.ios", 4102444800), "unknown"), "unlisted key"),
        ] {
            assert_eq!(b.post("/auth/apple", sign_in(token, "")).await.status(), 401, "{why}");
        }
        let first: serde_json::Value = b.post("/auth/apple", sign_in(apple_token(apple_claims("app.thedone.ios", 4102444800), "test"), "Ana Lind")).await.json().await.unwrap();
        assert_eq!(first["account"]["name"], "Ana Lind");
        let id = first["account"]["id"].as_str().unwrap();
        assert!(id.starts_with("apple") && id.bytes().all(|b| b.is_ascii_alphanumeric()), "{id}");
        // The token is a working session: the account is written down on its first call.
        let state = b.http.get(format!("{at}/api/state?today=2026-11-18")).bearer_auth(first["token"].as_str().unwrap()).send().await.unwrap();
        assert_eq!(state.status(), 200);
        // Apple sends the name the first time only; the second sign-in keeps it.
        let again: serde_json::Value = b.post("/auth/apple", sign_in(apple_token(apple_claims("app.thedone.ios", 4102444800), "test"), "")).await.json().await.unwrap();
        assert_eq!(again["account"]["id"], first["account"]["id"]);
        assert_eq!(again["account"]["name"], "Ana Lind");
        let deleted = b.http.post(format!("{at}/api/account/delete")).bearer_auth(again["token"].as_str().unwrap())
            .json(&serde_json::json!({})).send().await.unwrap();
        assert_eq!(deleted.status(), StatusCode::OK, "a legacy account without a saved Apple grant can still be deleted");
        assert_eq!(deleted.json::<serde_json::Value>().await.unwrap()["apple"], "none");
    }

    #[tokio::test]
    async fn apple_code_exchange_keeps_the_newest_grant_and_deletion_revokes_it() {
        let apple = apple_stand_in().await;
        let (at, _, db) = hosted_with_apple(7, Some(apple.client())).await;
        let http = reqwest::Client::new();
        let subject = "001234.abcdef0123456789.1234";
        let id = auth::apple_id(subject);
        let other: serde_json::Value = apple_login(&http, &at, "someone-else", "theirs").await.error_for_status().unwrap().json().await.unwrap();
        let mut token = String::new();
        for code in ["one", "two"] {
            let signed: serde_json::Value = apple_login(&http, &at, subject, code).await.error_for_status().unwrap().json().await.unwrap();
            assert!(signed.get("refresh_token").is_none());
            token = signed["token"].as_str().unwrap().to_owned();
        }
        // One grant per account: the newest replaces the one before.
        let stored = pg::testing::stored_apple_grants(&db, &id).await;
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0][0], 1, "sealed with the key derived from DONE_SESSION_KEY: version 1");
        assert!(!stored[0].windows(8).any(|window| window == b"refresh-"), "the database must not contain the refresh token as plaintext");

        let deleted = delete_with(&http, &at, &token).await;
        assert_eq!(deleted.status(), StatusCode::OK);
        assert_eq!(deleted.json::<serde_json::Value>().await.unwrap()["apple"], "revoked");
        assert_eq!(apple.revoked.lock().unwrap().as_slice(), [format!("refresh-{subject}|two")]);
        assert!(pg::testing::stored_apple_grants(&db, &id).await.is_empty());
        assert_eq!(state_with(&http, &at, &token).await, StatusCode::UNAUTHORIZED);
        // The other account's grant was untouched, and is its own to revoke.
        assert_eq!(delete_with(&http, &at, other["token"].as_str().unwrap()).await.json::<serde_json::Value>().await.unwrap()["apple"], "revoked");
        assert_eq!(apple.revoked.lock().unwrap().last().map(String::as_str), Some("refresh-someone-else|theirs"));

        // Every call carried a client secret Apple would take: signed with
        // the key, the team, the app and a five-minute life.
        let public = {
            use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
            let pair = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &apple.pkcs8, &ring::rand::SystemRandom::new()).unwrap();
            jsonwebtoken::DecodingKey::from_ec_der(pair.public_key().as_ref())
        };
        let secrets = apple.secrets.lock().unwrap().clone();
        assert_eq!(secrets.len(), 5, "three exchanges, two revocations");
        for jwt in secrets {
            assert_eq!(jsonwebtoken::decode_header(&jwt).unwrap().kid.as_deref(), Some("test-kid"));
            let mut rules = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::ES256);
            rules.set_audience(&["https://appleid.apple.com"]);
            rules.set_issuer(&["test-team"]);
            let claims = jsonwebtoken::decode::<serde_json::Value>(&jwt, &public, &rules).unwrap().claims;
            assert_eq!(claims["sub"], "app.thedone.ios");
            assert_eq!(claims["exp"].as_u64().unwrap() - claims["iat"].as_u64().unwrap(), 300);
        }
    }

    #[tokio::test]
    async fn no_apple_secret_reaches_the_log_or_an_answer() {
        let apple = apple_stand_in().await;
        let (at, _, db) = hosted_with_apple(7, Some(apple.client())).await;
        let http = reqwest::Client::new();
        let mut said = String::new();
        let mut sent = Vec::new();
        // Exchanges that fail every way, then deletions whose revocation does.
        for (n, code) in ["x-unavailable", "x-invalid-grant", "x-invalid-client", "x-slow", "x-other-subject"].into_iter().enumerate() {
            let subject = format!("0010.{n}");
            sent.push(format!("{subject}|{code}"));
            said += &apple_login(&http, &at, &subject, code).await.text().await.unwrap();
        }
        for (n, code) in ["r-unavailable", "r-invalid-grant", "r-invalid-client", "r-slow", "fine"].into_iter().enumerate() {
            let subject = format!("0011.{n}");
            sent.push(format!("{subject}|{code}"));
            let signed = apple_login(&http, &at, &subject, code).await.text().await.unwrap();
            said += &signed;
            let token: serde_json::Value = serde_json::from_str(&signed).unwrap();
            if code == "r-invalid-grant" {
                pg::testing::garble_apple_grants(&db, &auth::apple_id(&subject)).await;
            }
            said += &delete_with(&http, &at, token["token"].as_str().unwrap()).await.text().await.unwrap();
        }
        let log = auth::apple_grants::LOG.lock().unwrap().join("\n");
        let pkcs8 = base64::engine::general_purpose::STANDARD.encode(&apple.pkcs8);
        let mut secrets: Vec<String> = sent.iter().flat_map(|code| [code.clone(), format!("refresh-{code}")]).collect();
        secrets.extend(apple.secrets.lock().unwrap().iter().cloned());
        secrets.extend([pkcs8[..40].to_string(), pkcs8[pkcs8.len() - 40..].to_string(), "PRIVATE KEY".into()]);
        for secret in &secrets {
            assert!(!log.contains(secret.as_str()), "the log holds {secret}");
            assert!(!said.contains(secret.as_str()), "an answer holds {secret}");
        }
        // What the operator gets instead: the status and Apple's own word.
        for line in [
            "Apple code exchange failed: status 503, error none",
            "Apple code exchange failed: status 400, error invalid_grant",
            "Apple code exchange failed: status 401, error invalid_client",
            "Apple code exchange failed: timed out",
            "Apple grant revocation failed: status 401, error invalid_client",
            "Apple grant revocation failed: the grant could not be decrypted (key version 1)",
            "Apple grant revocation failed: timed out",
        ] {
            assert!(log.contains(line), "{line} in {log}");
        }
    }

    /// Apple's token and revocation endpoints, here. What they answer is
    /// picked by the code the device sent: `x-…` troubles the exchange,
    /// `r-…` the revocation of the refresh token made from it
    /// (`refresh-<code>`). The troubles: `unavailable` (503), `invalid-grant`,
    /// `invalid-client`, `slow` (no answer for 10 s), and `x-other-subject`
    /// (Apple's id_token names someone else). Anything else works.
    struct AppleStandIn {
        origin: String,
        pkcs8: Vec<u8>,
        revoked: Arc<Mutex<Vec<String>>>,
        secrets: Arc<Mutex<Vec<String>>>,
    }

    async fn apple_trouble(what: &str, prefix: &str) -> Option<Response> {
        if what.contains(&format!("{prefix}slow")) {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
        if what.contains(&format!("{prefix}unavailable")) {
            return Some(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
        if what.contains(&format!("{prefix}invalid-grant")) {
            return Some((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid_grant", "error_description": "bad code" }))).into_response());
        }
        if what.contains(&format!("{prefix}invalid-client")) {
            return Some((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "invalid_client" }))).into_response());
        }
        None
    }

    async fn apple_stand_in() -> AppleStandIn {
        use axum::extract::Form;
        use ring::signature::{EcdsaKeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &ring::rand::SystemRandom::new()).unwrap().as_ref().to_vec();
        let revoked = Arc::new(Mutex::new(Vec::new()));
        let secrets = Arc::new(Mutex::new(Vec::new()));
        let token = {
            let secrets = secrets.clone();
            move |Form(form): Form<HashMap<String, String>>| async move {
                secrets.lock().unwrap().push(form["client_secret"].clone());
                let code = form["code"].clone();
                if let Some(trouble) = apple_trouble(&code, "x-").await {
                    return trouble;
                }
                let mut claims = apple_claims("app.thedone.ios", 4102444800);
                claims["sub"] = if code.contains("x-other-subject") { "someone-else".into() } else { form["code"].split('|').next().unwrap().into() };
                Json(serde_json::json!({ "id_token": apple_token(claims, "test"), "refresh_token": format!("refresh-{code}") })).into_response()
            }
        };
        let revoke = {
            let (revoked, secrets) = (revoked.clone(), secrets.clone());
            move |Form(form): Form<HashMap<String, String>>| async move {
                secrets.lock().unwrap().push(form["client_secret"].clone());
                let token = form["token"].clone();
                if let Some(trouble) = apple_trouble(&token, "r-").await {
                    return trouble;
                }
                revoked.lock().unwrap().push(token);
                StatusCode::OK.into_response()
            }
        };
        let origin = serve(Router::new().route("/auth/token", post(token)).route("/auth/revoke", post(revoke))).await;
        AppleStandIn { origin, pkcs8, revoked, secrets }
    }

    impl AppleStandIn {
        fn client(&self) -> auth::apple_grants::Client {
            // Half a second where Apple's is eight, so a test of the bound is quick.
            let timeout = std::time::Duration::from_millis(500);
            auth::apple_grants::Client::new("test-team".into(), "test-kid".into(), jsonwebtoken::EncodingKey::from_ec_der(&self.pkcs8), &self.origin, &[7; 64], None, timeout)
        }
    }

    /// Signs in with Apple as `subject`, sending `code` as the sheet's
    /// one-time code. The stand-in reads the subject back out of the code.
    async fn apple_login(http: &reqwest::Client, at: &str, subject: &str, code: &str) -> reqwest::Response {
        let mut claims = apple_claims("app.thedone.ios", 4102444800);
        claims["sub"] = subject.into();
        let code = if code.is_empty() { String::new() } else { format!("{subject}|{code}") };
        http.post(format!("{at}/auth/apple"))
            .json(&serde_json::json!({ "identity_token": apple_token(claims, "test"), "authorization_code": code, "name": "Synthetic Apple User" }))
            .send().await.unwrap()
    }

    async fn delete_with(http: &reqwest::Client, at: &str, token: &str) -> reqwest::Response {
        http.post(format!("{at}/api/account/delete")).bearer_auth(token).json(&serde_json::json!({})).send().await.unwrap()
    }

    async fn state_with(http: &reqwest::Client, at: &str, token: &str) -> StatusCode {
        http.get(format!("{at}/api/state?today=2026-11-18")).bearer_auth(token).send().await.unwrap().status()
    }

    #[tokio::test]
    async fn a_failed_apple_code_exchange_still_signs_in() {
        let apple = apple_stand_in().await;
        let (at, _, db) = hosted_with_apple(7, Some(apple.client())).await;
        let http = reqwest::Client::new();
        // Apple down, a single-use code sent twice, a wrong team id or a
        // revoked key, and no code at all: signed in, nothing kept.
        for code in ["x-unavailable", "x-invalid-grant", "x-invalid-client", ""] {
            let subject = format!("0001.{code}.fails");
            let signed = apple_login(&http, &at, &subject, code).await;
            assert_eq!(signed.status(), StatusCode::OK, "{code}");
            let signed: serde_json::Value = signed.json().await.unwrap();
            assert_eq!(state_with(&http, &at, signed["token"].as_str().unwrap()).await, StatusCode::OK, "{code}");
            assert!(pg::testing::stored_apple_grants(&db, &auth::apple_id(&subject)).await.is_empty(), "{code}");
        }
        // Apple's own answer names somebody else: the one refusal.
        let subject = "0002.mismatch";
        assert_eq!(apple_login(&http, &at, subject, "x-other-subject").await.status(), StatusCode::UNAUTHORIZED);
        assert!(db.name_of(&auth::apple_id(subject)).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_code_sent_to_a_server_without_apple_settings_still_signs_in() {
        let (at, _, db) = hosted(7).await;
        let http = reqwest::Client::new();
        let subject = "0003.unconfigured";
        assert_eq!(apple_login(&http, &at, subject, "fine").await.status(), StatusCode::OK);
        assert!(pg::testing::stored_apple_grants(&db, &auth::apple_id(subject)).await.is_empty());
    }

    #[tokio::test]
    async fn a_code_exchange_apple_does_not_answer_signs_in_within_the_bound() {
        let apple = apple_stand_in().await;
        let (at, _, db) = hosted_with_apple(7, Some(apple.client())).await;
        let http = reqwest::Client::new();
        let subject = "0004.slow";
        let started = std::time::Instant::now();
        let signed = apple_login(&http, &at, subject, "x-slow").await;
        assert_eq!(signed.status(), StatusCode::OK);
        assert!(started.elapsed() < std::time::Duration::from_secs(3), "took {:?}", started.elapsed());
        assert!(pg::testing::stored_apple_grants(&db, &auth::apple_id(subject)).await.is_empty());
    }

    #[tokio::test]
    async fn deleting_the_account_wins_whatever_apple_says() {
        let apple = apple_stand_in().await;
        let (at, _, db) = hosted_with_apple(7, Some(apple.client())).await;
        let http = reqwest::Client::new();
        let sign_in = |subject: String, code: &'static str| {
            let (http, at, db) = (http.clone(), at.clone(), db.clone());
            async move {
                let signed: serde_json::Value = apple_login(&http, &at, &subject, code).await.error_for_status().unwrap().json().await.unwrap();
                assert_eq!(pg::testing::stored_apple_grants(&db, &auth::apple_id(&subject)).await.len(), 1, "{code}");
                signed["token"].as_str().unwrap().to_owned()
            }
        };
        let deleted = |at: String, token: String, subject: String, expected: &'static str| {
            let (http, db) = (http.clone(), db.clone());
            async move {
                let started = std::time::Instant::now();
                let answer = delete_with(&http, &at, &token).await;
                assert_eq!(answer.status(), StatusCode::OK, "{subject}");
                assert!(started.elapsed() < std::time::Duration::from_secs(3), "{subject} took {:?}", started.elapsed());
                let body: serde_json::Value = answer.json().await.unwrap();
                assert_eq!(body["apple"], expected, "{subject}");
                assert_eq!(state_with(&http, &at, &token).await, StatusCode::UNAUTHORIZED, "{subject}");
                assert!(pg::testing::stored_apple_grants(&db, &auth::apple_id(&subject)).await.is_empty(), "{subject}");
            }
        };
        // Apple down, Apple refusing the client (a revoked or rotated key),
        // Apple not answering at all.
        for code in ["r-unavailable", "r-invalid-client", "r-slow"] {
            let subject = format!("0005.{code}");
            let token = sign_in(subject.clone(), code).await;
            deleted(at.clone(), token, subject, "not_revoked").await;
        }
        // A grant this server cannot read (the key it was sealed with is gone).
        let subject = "0006.garbled".to_string();
        let token = sign_in(subject.clone(), "fine").await;
        pg::testing::garble_apple_grants(&db, &auth::apple_id(&subject)).await;
        deleted(at.clone(), token, subject, "not_revoked").await;
        // The Apple settings removed since the grant was kept.
        let subject = "0007.settings-removed".to_string();
        let token = sign_in(subject.clone(), "fine").await;
        let (off, _, _) = hosted_on(db.clone(), 7, None).await;
        deleted(off, token, subject, "not_revoked").await;
        // And the working case.
        let subject = "0008.works".to_string();
        let token = sign_in(subject.clone(), "fine").await;
        deleted(at.clone(), token, subject, "revoked").await;
        assert_eq!(apple.revoked.lock().unwrap().as_slice(), ["refresh-0008.works|fine"]);
    }

    #[tokio::test]
    async fn the_review_login_needs_its_password() {
        let (at, _google, _kept) = hosted(8).await;
        let mut b = Browser::new(&at);
        for (username, password) in [("review", "wrong"), ("someone", REVIEW_PASSWORD), ("review", "")] {
            assert_eq!(b.post("/auth/review", serde_json::json!({ "username": username, "password": password })).await.status(), 401, "{username}/{password}");
        }
        let signed: serde_json::Value = b.post("/auth/review", serde_json::json!({ "username": "review", "password": REVIEW_PASSWORD })).await.json().await.unwrap();
        assert_eq!(signed["account"]["email"], "review@thedone.app");
        let state = b.http.get(format!("{at}/api/state?today=2026-11-18")).bearer_auth(signed["token"].as_str().unwrap()).send().await.unwrap();
        assert_eq!(state.status(), 200);
    }

    /// Claude's whole way in: register, sign in to done, allow, trade the code
    /// for a token, then use the tools through /mcp as that person.
    #[tokio::test]
    async fn an_mcp_client_signs_in_and_uses_the_tools() {
        let (at, google, _kept) = hosted(9).await;
        let mut b = Browser::new(&at);
        // Without a token, /mcp says where to sign in.
        let bare = b.post("/mcp", serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).await;
        assert_eq!(bare.status(), 401);
        assert!(bare.headers()["www-authenticate"].to_str().unwrap().contains("/.well-known/oauth-protected-resource"));

        let back = "https://claude.ai/api/mcp/auth_callback";
        let client: serde_json::Value = b.post("/oauth/register", serde_json::json!({ "redirect_uris": [back], "client_name": "Claude" })).await.json().await.unwrap();
        let client_id = client["client_id"].as_str().unwrap().to_string();
        let verifier = "a-verifier-long-enough-to-be-a-real-pkce-secret-0123456789";
        let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(<sha2::Sha256 as sha2::Digest>::digest(verifier.as_bytes()));
        let mut ask = reqwest::Url::parse(&format!("{at}/oauth/authorize")).unwrap();
        ask.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", back)
            .append_pair("state", "s1")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("response_type", "code");
        let path = format!("/oauth/authorize?{}", ask.query().unwrap());

        // Signed out: off to Google, and back to the same ask afterwards.
        let off = b.get(&path).await;
        assert!(off.headers()["location"].to_str().unwrap().starts_with("/auth/google?then="));
        google.says(person("2001", "cleo@example.com"));
        assert_eq!(b.sign_in_then(&path).await, path);

        // An address the client did not register is never sent anything.
        let elsewhere = path.replace("claude.ai", "evil.example");
        let page = b.get(&elsewhere).await.text().await.unwrap();
        assert!(page.contains("did not register"), "{page}");

        let page = b.get(&path).await.text().await.unwrap();
        assert!(page.contains("Claude") && page.contains("cleo@example.com"), "{page}");
        let mut form: Vec<(String, String)> = ask.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        form.push(("allow".into(), "yes".into()));
        let request = b.http.post(format!("{at}/oauth/authorize")).form(&form);
        let allowed = b.send(request).await;
        let to = reqwest::Url::parse(allowed.headers()["location"].to_str().unwrap()).unwrap();
        assert!(to.as_str().starts_with(back));
        let code = to.query_pairs().find(|(k, _)| k == "code").unwrap().1.to_string();

        // The code is worth nothing without the verifier.
        let trade = |verifier: &str| vec![("grant_type", "authorization_code".to_string()), ("code", code.clone()), ("code_verifier", verifier.to_string()), ("redirect_uri", back.to_string()), ("client_id", client_id.clone())];
        let wrong = b.http.post(format!("{at}/oauth/token")).form(&trade("not-the-verifier")).send().await.unwrap();
        assert_eq!(wrong.status(), 400);
        let tokens: serde_json::Value = b.http.post(format!("{at}/oauth/token")).form(&trade(verifier)).send().await.unwrap().json().await.unwrap();
        let token = tokens["access_token"].as_str().unwrap().to_string();

        let mcp = |body: serde_json::Value| b.http.post(format!("{at}/mcp")).bearer_auth(&token).json(&body).send();
        let init: serde_json::Value = mcp(serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).await.unwrap().json().await.unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "done");
        let added: serde_json::Value = mcp(serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "add_task", "arguments": { "title": "Book the dentist" } } })).await.unwrap().json().await.unwrap();
        assert!(added["result"]["isError"] != true, "{added}");
        let listed: serde_json::Value = mcp(serde_json::json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "list_tasks", "arguments": {} } })).await.unwrap().json().await.unwrap();
        assert!(listed.to_string().contains("Book the dentist"), "{listed}");
        // A notification gets no reply.
        assert_eq!(mcp(serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await.unwrap().status(), 202);

        // The refresh token renews; it is not itself an access token.
        let refresh = tokens["refresh_token"].as_str().unwrap();
        let renewed = b.http.post(format!("{at}/oauth/token")).form(&[("grant_type", "refresh_token"), ("refresh_token", refresh)]).send().await.unwrap();
        assert_eq!(renewed.status(), 200);
        let as_access = b.http.post(format!("{at}/mcp")).bearer_auth(refresh).json(&serde_json::json!({ "jsonrpc": "2.0", "id": 4, "method": "ping" })).send().await.unwrap();
        assert_eq!(as_access.status(), 401);
        assert_eq!(b.post("/api/account/delete", serde_json::json!({})).await.status(), 200);
        b.sign_in().await;
        let expired = b.http.post(format!("{at}/oauth/token")).form(&[("grant_type", "refresh_token"), ("refresh_token", refresh)]).send().await.unwrap();
        assert_eq!(expired.status(), 400);
        let old = b.http.post(format!("{at}/mcp")).bearer_auth(&token).json(&serde_json::json!({"jsonrpc":"2.0","id":5,"method":"ping"})).send().await.unwrap();
        assert_eq!(old.status(), 401);
    }
}
