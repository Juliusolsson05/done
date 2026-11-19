//! Signing in with a Google account, and the session that follows.
//!
//! The session is a signed cookie holding who the person is. There is no
//! table of sessions: nothing to store, nothing to clean up, and a restart of
//! the server signs nobody out.

use axum::{
    extract::{FromRef, FromRequestParts, Query, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::cookie::{Cookie, Key, SameSite, SignedCookieJar};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::accounts::Accounts;

/// What the hosted mode needs to be told. All of it comes from the
/// environment; see `Config::from_env`.
pub struct Config {
    /// Where people reach this server, without a trailing slash. Google sends
    /// them back to an address under it, and it must match what Google was told.
    pub public_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub key: Key,
    /// Google's two addresses. Settings so that a test can stand in for Google.
    pub authorize_url: String,
    pub token_url: String,
}

fn need(name: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        // Stopping here, by name, beats starting and failing at the first sign-in.
        _ => {
            eprintln!("done cannot start in cloud mode without {name}.");
            std::process::exit(2);
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let key = need("DONE_SESSION_KEY");
        if key.len() < 64 {
            eprintln!("DONE_SESSION_KEY must be at least 64 characters of random text.");
            std::process::exit(2);
        }
        Self {
            public_url: need("DONE_PUBLIC_URL").trim_end_matches('/').to_string(),
            client_id: need("DONE_GOOGLE_CLIENT_ID"),
            client_secret: need("DONE_GOOGLE_CLIENT_SECRET"),
            key: Key::from(key.as_bytes()),
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
        }
    }

    fn redirect_uri(&self) -> String {
        format!("{}/auth/google/callback", self.public_url)
    }

    // Cookies marked Secure are not sent over plain http, which is what a
    // laptop running this mode for a try-out uses.
    fn secure(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}

#[derive(Clone)]
pub struct Cloud {
    pub accounts: Arc<Accounts>,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

impl FromRef<Cloud> for Key {
    fn from_ref(cloud: &Cloud) -> Key {
        cloud.config.key.clone()
    }
}

/// Who is signed in. `sub` is Google's id for the account: it never changes,
/// where an email address can.
#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub sub: String,
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub picture: String,
    /// Seconds since 1970. The cookie's own expiry is only a request to the
    /// browser; this is the one the server holds to.
    pub exp: u64,
}

const SESSION: &str = "done_session";
const SIGNING_IN: &str = "done_signing_in";
const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cookie(name: &'static str, value: String, config: &Config, seconds: u64) -> Cookie<'static> {
    Cookie::build((name, value))
        .path("/")
        // Not readable by scripts on the page, so a script injected into it
        // cannot carry the session away.
        .http_only(true)
        .secure(config.secure())
        // Lax: sent when the person follows a link here (Google's way back
        // needs that), never on a request another site makes in the background.
        .same_site(SameSite::Lax)
        .max_age(std::time::Duration::from_secs(seconds).try_into().expect("a short time"))
        .build()
}

fn gone(name: &'static str) -> Cookie<'static> {
    Cookie::build((name, "")).path("/").build()
}

fn session_in(jar: &SignedCookieJar) -> Option<Session> {
    let session: Session = serde_json::from_str(jar.get(SESSION)?.value()).ok()?;
    (session.exp > now()).then_some(session)
}

fn signed_out() -> Response {
    (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "signed out" }))).into_response()
}

// Asking for a Session in a handler is what keeps it to signed-in people:
// without a valid cookie the handler is never run.
impl FromRequestParts<Cloud> for Session {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, cloud: &Cloud) -> Result<Self, Self::Rejection> {
        let jar = SignedCookieJar::<Key>::from_request_parts(parts, cloud).await.map_err(|_| signed_out())?;
        session_in(&jar).ok_or_else(signed_out)
    }
}

/// Sends the person to Google, remembering a random word to recognise them by
/// when they come back.
pub async fn start(State(cloud): State<Cloud>, jar: SignedCookieJar) -> Response {
    let word = format!("{:032x}", rand::random::<u128>());
    let mut to = reqwest::Url::parse(&cloud.config.authorize_url).expect("a valid address");
    to.query_pairs_mut()
        .append_pair("client_id", &cloud.config.client_id)
        .append_pair("redirect_uri", &cloud.config.redirect_uri())
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &word)
        // Always ask which account: someone with two must be able to choose.
        .append_pair("prompt", "select_account");
    (jar.add(cookie(SIGNING_IN, word, &cloud.config, 600)), Redirect::to(to.as_str())).into_response()
}

#[derive(Deserialize)]
pub struct Back {
    #[serde(default)]
    code: String,
    #[serde(default)]
    state: String,
}

#[derive(Deserialize)]
struct Tokens {
    id_token: String,
}

/// The part of Google's signed statement about the person that is used here.
#[derive(Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    exp: u64,
    sub: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    email_verified: bool,
    #[serde(default)]
    name: String,
    #[serde(default)]
    picture: String,
}

fn refuse(why: &str) -> Response {
    eprintln!("sign-in refused: {why}");
    // Back to the front page, which shows the sign-in screen again. The
    // reason is for the log: it is of no use to the person, or to an attacker.
    Redirect::to("/?signin=failed").into_response()
}

/// Google sends the person back here with a one-time code, which is traded
/// for a statement of who they are.
pub async fn back(State(cloud): State<Cloud>, jar: SignedCookieJar, Query(q): Query<Back>) -> Response {
    let config = &cloud.config;
    // The word must be the one this browser was sent off with. Without this,
    // a link made by someone else could sign a person in to that someone's account.
    let expected = jar.get(SIGNING_IN).map(|c| c.value().to_string());
    let jar = jar.remove(gone(SIGNING_IN));
    if q.code.is_empty() || q.state.is_empty() || expected.as_deref() != Some(q.state.as_str()) {
        return (jar, refuse("the reply does not belong to a sign-in this browser started")).into_response();
    }
    let form = [
        ("code", q.code.as_str()),
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("redirect_uri", &config.redirect_uri()),
        ("grant_type", "authorization_code"),
    ];
    let tokens: Tokens = match cloud.http.post(&config.token_url).form(&form).send().await.and_then(|r| r.error_for_status()) {
        Ok(response) => match response.json().await {
            Ok(tokens) => tokens,
            Err(_) => return (jar, refuse("Google's answer had no statement in it")).into_response(),
        },
        Err(e) => return (jar, refuse(&format!("Google did not accept the code: {e}"))).into_response(),
    };
    // The statement is three parts joined by dots; the middle one is the
    // content. Its signature is not checked here, and need not be: it came
    // straight from Google over TLS in answer to our own request, which the
    // OpenID Connect standard accepts in place of checking it (Core 3.1.3.7).
    // Everything it says is still checked below.
    let claims: Option<Claims> = tokens
        .id_token
        .split('.')
        .nth(1)
        .and_then(|part| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(part).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let Some(claims) = claims else {
        return (jar, refuse("the statement could not be read")).into_response();
    };
    if claims.iss != "https://accounts.google.com" && claims.iss != "accounts.google.com" {
        return (jar, refuse("the statement is not from Google")).into_response();
    }
    if claims.aud != config.client_id {
        return (jar, refuse("the statement was made for another app")).into_response();
    }
    if claims.exp <= now() {
        return (jar, refuse("the statement has expired")).into_response();
    }
    if !claims.email_verified || claims.sub.is_empty() || !claims.sub.bytes().all(|b| b.is_ascii_alphanumeric()) {
        // The id becomes a file name, so it is held to letters and digits.
        // Google's are digits only.
        return (jar, refuse("the account has no verified email or no usable id")).into_response();
    }
    let session = Session { sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture, exp: now() + THIRTY_DAYS };
    let value = serde_json::to_string(&session).expect("plain text fields");
    (jar.add(cookie(SESSION, value, config, THIRTY_DAYS)), Redirect::to("/")).into_response()
}

pub async fn sign_out(jar: SignedCookieJar, Json(_): Json<serde_json::Value>) -> Response {
    (jar.remove(gone(SESSION)), Json(serde_json::json!({}))).into_response()
}

/// Who the interface is talking to. Answers without a session too: that is
/// how the interface learns it has to show the sign-in screen.
pub async fn me(jar: SignedCookieJar) -> Response {
    let account = session_in(&jar).map(|s| serde_json::json!({ "email": s.email, "name": s.name, "picture": s.picture }));
    Json(serde_json::json!({ "mode": "cloud", "account": account })).into_response()
}

/// Deletes the account's tasks for good and signs out.
pub async fn delete_account(State(cloud): State<Cloud>, session: Session, jar: SignedCookieJar, Json(_): Json<serde_json::Value>) -> Response {
    match cloud.accounts.delete(&session.sub).await {
        Ok(()) => (jar.remove(gone(SESSION)), Json(serde_json::json!({}))).into_response(),
        Err(e) => {
            eprintln!("{e:?}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "The account could not be deleted. Nothing was removed." }))).into_response()
        }
    }
}
