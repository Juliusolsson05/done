//! done as a web app: the same interface and the same tasks file as the
//! desktop app, served to a browser on this Mac only.

use axum::{
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use done_core::{Change, Error, Store};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// Built into the binary: one file to run, and it cannot drift from the
// interface the desktop app ships.
const UI: &str = include_str!("../../../ui/index.html");

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

#[tokio::main]
async fn main() {
    let path = done_core::default_path();
    let store = Arc::new(Store::open(&path).expect("open the tasks file"));
    let port: u16 = std::env::var("DONE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4400);
    let app = Router::new()
        .route("/", get(|| async { Html(UI) }))
        .route("/api/state", get(state))
        .route("/api/sync", post(sync))
        .layer(middleware::from_fn(local_only))
        .with_state(store);
    // 127.0.0.1 only: never reachable from the network.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("the port is free");
    println!("done is running at http://127.0.0.1:{port}");
    println!("tasks are stored in {}", path.display());
    axum::serve(listener, app).await.expect("serve");
}
