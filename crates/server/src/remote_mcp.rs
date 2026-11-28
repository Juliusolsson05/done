//! done's MCP server on the internet: `POST /mcp`, for Claude and any other
//! app that connects to MCP servers by address rather than by starting a
//! program on the Mac.
//!
//! The tools are the same ones `done mcp` serves from the tasks file
//! (crates/mcp); here they work on the signed-in account in Postgres. The
//! person is known by the token from `oauth`, sent as `Authorization: Bearer`.
//!
//! Transport: MCP's Streamable HTTP, in its simplest allowed form. Each POST
//! carries one JSON-RPC message and gets one JSON reply; nothing is streamed
//! and there is no session, because no tool here sends anything unasked.

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use done_core::{Change, Entry, Error, Note, SaveNote, State as Tasks, Synced, Task};
use std::sync::Arc;

use crate::auth::{self, Cloud};
use crate::pg::{Db, Fail, Me};

/// One account, as the MCP tools see it. Its calls block: the tools are
/// plain functions, so a request runs them on a blocking thread and each
/// database call waits there for its answer.
struct Remote {
    db: Arc<Db>,
    me: Me,
    zone: String,
    runtime: tokio::runtime::Handle,
}

fn said(fail: Fail) -> Error {
    match fail {
        Fail::Invalid(why) | Fail::TooManyRequests(why) => Error::Invalid(why),
        Fail::NotFound => Error::Invalid("Not found.".into()),
        Fail::Down(why) => {
            eprintln!("{why}");
            Error::Invalid("done could not be reached. Nothing was lost; try again.".into())
        }
    }
}

impl Remote {
    fn wait<T>(&self, call: impl std::future::Future<Output = Result<T, Fail>>) -> Result<T, Error> {
        self.runtime.block_on(call).map_err(said)
    }
}

impl done_mcp::Tasks for Remote {
    fn today(&self) -> Result<String, Error> {
        self.wait(self.db.today_in(&self.zone))
    }
    fn clock(&self, ms: i64) -> Result<String, Error> {
        self.wait(self.db.clock_in(ms, &self.zone))
    }
    fn state(&self, today: &str) -> Result<Tasks, Error> {
        self.wait(self.db.state(&self.me, today))
    }
    fn sync(&self, change: Change) -> Result<Synced, Error> {
        self.wait(self.db.sync(&self.me, change)).map(|rev| Synced { rev })
    }
    fn finished(&self, limit: i64) -> Result<Vec<Task>, Error> {
        self.wait(self.db.finished(&self.me, limit))
    }
    fn entries(&self, day: &str) -> Result<Vec<Entry>, Error> {
        self.wait(self.db.entries(&self.me, day))
    }
    fn notes(&self) -> Result<Vec<Note>, Error> {
        self.wait(self.db.notes(&self.me))
    }
    fn save_note(&self, note: SaveNote) -> Result<Note, Error> {
        self.wait(self.db.save_note(&self.me, note))
    }
    fn delete_note(&self, id: i64) -> Result<(), Error> {
        self.wait(self.db.delete_note(&self.me, id))
    }
}

/// What a client without a token is told: where to learn how to get one
/// (RFC 9728). Claude follows this to the sign-in in `oauth`.
fn sign_in_first(cloud: &Cloud) -> Response {
    let metadata = format!("{}/.well-known/oauth-protected-resource", cloud.config.public_url);
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, format!("Bearer resource_metadata=\"{metadata}\""))],
        Json(serde_json::json!({ "error": "Sign in to done first." })),
    )
        .into_response()
}

pub async fn post(State(cloud): State<Cloud>, headers: HeaderMap, body: Bytes) -> Response {
    // The token only, never the cookie: a page on another site could make a
    // signed-in browser post here, and the cookie would go with it.
    let Some(session) = auth::bearer(&headers, &cloud.config.key) else {
        return sign_in_first(&cloud);
    };
    let me = match cloud.db.me(&session.sub, &session.email, &session.name, &session.picture).await {
        Ok(me) => me,
        Err(fail) => return auth::down(fail),
    };
    let Ok(message) = serde_json::from_slice::<serde_json::Value>(&body) else {
        let reply = serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "That was not JSON." } });
        return (StatusCode::BAD_REQUEST, Json(reply)).into_response();
    };
    let remote = Remote { db: cloud.db.clone(), me, zone: cloud.config.time_zone.clone(), runtime: tokio::runtime::Handle::current() };
    match tokio::task::spawn_blocking(move || done_mcp::handle(&remote, &message)).await {
        Ok(Some(reply)) => Json(reply).into_response(),
        // A notification (no id): accepted, nothing to say back.
        Ok(None) => StatusCode::ACCEPTED.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Streamable HTTP lets a client open a stream with GET for messages the
/// server sends unasked. There are none, which the spec says to answer so.
pub async fn other() -> Response {
    StatusCode::METHOD_NOT_ALLOWED.into_response()
}
