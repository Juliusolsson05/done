//! Signing in with a Google account, and the session that follows.
//!
//! The session is a signed cookie holding who the person is. There is no
//! table of sessions: nothing to store, nothing to clean up, and a restart of
//! the server signs nobody out.

use axum::{
    extract::{FromRef, FromRequestParts, Query, State},
    http::{header, request::Parts, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::cookie::{Cookie, Key, SameSite, SignedCookieJar};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::pg::{Db, Fail, Me};

pub(crate) mod apple_grants;

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
    /// Signing in without Google, as one of a few made-up people, for trying
    /// workspaces on a laptop. Only ever on with DONE_DEV_SIGNIN=1 and an
    /// address on this machine; see `dev`.
    pub dev: bool,
    /// Where the live notes service is (`done-server collab`), for windows to
    /// connect to: DONE_COLLAB_URL. Without it notes are not written live.
    pub collab_url: Option<String>,
    /// Sign in with Apple: the iPhone app's bundle id, which Apple's tokens
    /// are made out to (DONE_APPLE_AUDIENCE, by default `app.thedone.ios`),
    /// and where Apple publishes the keys it signs them with. A setting so a
    /// test can stand in for Apple.
    pub apple_audience: String,
    pub apple_keys_url: String,
    pub(crate) apple_grants: Option<apple_grants::Client>,
    /// The App Review login's password (DONE_REVIEW_PASSWORD). None: the
    /// login is off and answers as if it did not exist.
    pub review_password: Option<String>,
    /// The zone `/mcp` tells days and times in (DONE_TIME_ZONE, by default
    /// America/Los_Angeles). An MCP client does not say where its person is;
    /// the apps do, per request, and are unaffected.
    pub time_zone: String,
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
        let public_url = need("DONE_PUBLIC_URL").trim_end_matches('/').to_string();
        let local = public_url.starts_with("http://127.0.0.1:") || public_url.starts_with("http://localhost:");
        let dev = std::env::var("DONE_DEV_SIGNIN").as_deref() == Ok("1");
        if dev && !local {
            eprintln!("DONE_DEV_SIGNIN is only for a server on this machine (DONE_PUBLIC_URL http://127.0.0.1:…).");
            std::process::exit(2);
        }
        let collab_url = std::env::var("DONE_COLLAB_URL").ok().map(|u| u.trim().trim_end_matches('/').to_string()).filter(|u| !u.is_empty());
        // WHY a password login at all: App Review must be able to sign in, and
        // its reviewers have no Google account for done. An email login would
        // need an email provider, which done does not have. One fixed account,
        // a long password kept only in the server's settings.
        let review_password = std::env::var("DONE_REVIEW_PASSWORD").ok().map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
        if review_password.as_ref().is_some_and(|p| p.len() < 16) {
            eprintln!("DONE_REVIEW_PASSWORD must be at least 16 characters.");
            std::process::exit(2);
        }
        Self {
            dev,
            collab_url,
            review_password,
            time_zone: std::env::var("DONE_TIME_ZONE").ok().filter(|z| !z.trim().is_empty()).unwrap_or_else(|| "America/Los_Angeles".into()),
            apple_audience: std::env::var("DONE_APPLE_AUDIENCE").ok().filter(|a| !a.trim().is_empty()).unwrap_or_else(|| "app.thedone.ios".into()),
            apple_keys_url: "https://appleid.apple.com/auth/keys".into(),
            apple_grants: apple_grants::Client::from_env(&key),
            public_url,
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
    pub db: Arc<Db>,
    pub config: Arc<Config>,
    pub operator: Arc<crate::pages::Operator>,
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
    #[serde(default)]
    pub generation: Option<i64>,
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

fn live(session: Session) -> Option<Session> {
    (session.exp > now()).then_some(session)
}

fn session_in(jar: &SignedCookieJar) -> Option<Session> {
    live(serde_json::from_str(jar.get(SESSION)?.value()).ok()?)
}

// A text signed with the server's key, to hand to an app and be handed back.
// The cookie crate's own signing, so there is one way of signing here and it
// is the one the session cookie has.
pub(crate) fn seal(key: &Key, text: String) -> String {
    let mut jar = cookie::CookieJar::new();
    jar.signed_mut(key).add(Cookie::new("sealed", text));
    jar.get("sealed").expect("just added").value().to_string()
}

/// The text, if it was signed with this server's key and has not been changed.
pub(crate) fn unseal(key: &Key, sealed: &str) -> Option<String> {
    let mut jar = cookie::CookieJar::new();
    jar.add_original(Cookie::new("sealed", sealed.to_string()));
    jar.signed(key).get("sealed").map(|c| c.value().to_string())
}

/// What an app sends in place of the cookie: the same signed session, as a
/// header. A web view inside an app is not the server's own site, so the
/// cookie is never sent from it.
pub(crate) fn bearer(headers: &HeaderMap, key: &Key) -> Option<Session> {
    let sealed = headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")?;
    live(serde_json::from_str(&unseal(key, sealed)?).ok()?)
}

/// Whoever is signed in, by token or cookie, without turning anyone away:
/// for pages that show something different to each.
pub async fn signed_in(headers: &HeaderMap, jar: &SignedCookieJar, cloud: &Cloud) -> Result<Option<Session>, Fail> {
    let Some(session) = bearer(headers, &cloud.config.key).or_else(|| session_in(jar)) else { return Ok(None) };
    Ok(session.account(cloud).await?.map(|_| session))
}

impl Session {
    pub async fn account(&self, cloud: &Cloud) -> Result<Option<Me>, Fail> {
        cloud.db.session_account(&self.sub, self.generation).await
    }

    async fn start(cloud: &Cloud, sub: String, email: String, name: String, picture: String) -> Result<Self, Fail> {
        let me = cloud.db.me(&sub, &email, &name, &picture).await?;
        Ok(Self { sub, email, name, picture, generation: me.generation, exp: now() + THIRTY_DAYS })
    }
}

fn signed_out() -> Response {
    (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "signed out" }))).into_response()
}

/// Resolve the identity and its current account once, including for handlers
/// that need both the provider profile and the personal space.
async fn authenticated(parts: &mut Parts, cloud: &Cloud) -> Result<(Session, Me), Response> {
    if let Some(pair) = parts.extensions.get::<(Session, Me)>() {
        return Ok(pair.clone());
    }
    let session = match bearer(&parts.headers, &cloud.config.key) {
        Some(session) => session,
        None => {
            let jar = SignedCookieJar::<Key>::from_request_parts(parts, cloud).await.map_err(|_| signed_out())?;
            session_in(&jar).ok_or_else(signed_out)?
        }
    };
    let me = session.account(cloud).await.map_err(down)?.ok_or_else(signed_out)?;
    let pair = (session, me);
    parts.extensions.insert(pair.clone());
    Ok(pair)
}

impl FromRequestParts<Cloud> for Session {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, cloud: &Cloud) -> Result<Self, Self::Rejection> {
        Ok(authenticated(parts, cloud).await?.0)
    }
}

impl FromRequestParts<Cloud> for Me {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, cloud: &Cloud) -> Result<Self, Self::Rejection> {
        Ok(authenticated(parts, cloud).await?.1)
    }
}

/// The database's answer as an HTTP one.
pub fn down(fail: Fail) -> Response {
    let fail_with = |status, message: &str| (status, Json(serde_json::json!({ "error": message }))).into_response();
    match fail {
        Fail::Invalid(why) => fail_with(StatusCode::BAD_REQUEST, &why),
        Fail::TooManyRequests(why) => fail_with(StatusCode::TOO_MANY_REQUESTS, &why),
        Fail::NotFound => fail_with(StatusCode::NOT_FOUND, "Not found."),
        Fail::Down(why) => {
            eprintln!("{why}");
            fail_with(StatusCode::SERVICE_UNAVAILABLE, "Your tasks could not be reached. Nothing was lost; try again.")
        }
    }
}

#[derive(Deserialize)]
pub struct Start {
    /// Sent by an app signing in: the SHA-256, in hex, of a secret only that
    /// app knows. See `exchange`.
    #[serde(default)]
    app_challenge: Option<String>,
    /// An allowed return path on this server, checked by back_to.
    #[serde(default)]
    then: Option<String>,
}

/// What this browser is remembered by while it is away at Google.
#[derive(Serialize, Deserialize)]
struct SigningIn {
    word: String,
    #[serde(default)]
    challenge: Option<String>,
    #[serde(default)]
    then: Option<String>,
}

/// The local destinations that can send someone through sign-in.
fn back_to(then: Option<String>) -> Option<String> {
    let then = then?;
    if then == "/feedback" || crate::routes::is_app_target(&then) {
        return Some(then);
    }
    // A path on this server, so the redirect cannot leave it.
    if then.starts_with("/oauth/authorize?") && then.len() <= 4096 && !then.contains(['\r', '\n', '\\']) {
        return Some(then);
    }
    let token = then.strip_prefix("/invite/")?;
    (!token.is_empty() && token.len() <= 128 && token.bytes().all(|b| b.is_ascii_alphanumeric())).then_some(then)
}

/// Sends the person to Google, remembering a random word to recognise them by
/// when they come back.
pub async fn start(State(cloud): State<Cloud>, jar: SignedCookieJar, Query(q): Query<Start>) -> Response {
    // A SHA-256 in hex and nothing else: it ends up in a page.
    if q.app_challenge.as_deref().is_some_and(|c| c.len() != 64 || !c.bytes().all(|b| b.is_ascii_hexdigit())) {
        return (StatusCode::BAD_REQUEST, "That is not a challenge.").into_response();
    }
    let word = format!("{:032x}", rand::random::<u128>());
    let remembered = serde_json::to_string(&SigningIn { word: word.clone(), challenge: q.app_challenge, then: back_to(q.then) }).expect("plain text fields");
    let mut to = reqwest::Url::parse(&cloud.config.authorize_url).expect("a valid address");
    to.query_pairs_mut()
        .append_pair("client_id", &cloud.config.client_id)
        .append_pair("redirect_uri", &cloud.config.redirect_uri())
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &word)
        // Always ask which account: someone with two must be able to choose.
        .append_pair("prompt", "select_account");
    (jar.add(cookie(SIGNING_IN, remembered, &cloud.config, 600)), Redirect::to(to.as_str())).into_response()
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
    let remembered: Option<SigningIn> = jar.get(SIGNING_IN).and_then(|c| serde_json::from_str(c.value()).ok());
    let jar = jar.remove(gone(SIGNING_IN));
    let expected = remembered.as_ref().map(|r| r.word.as_str());
    if q.code.is_empty() || q.state.is_empty() || expected != Some(q.state.as_str()) {
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
    let session = match Session::start(&cloud, claims.sub, claims.email, claims.name, claims.picture).await {
        Ok(session) => session,
        Err(fail) => return down(fail),
    };
    let then = remembered.as_ref().and_then(|r| back_to(r.then.clone())).unwrap_or_else(|| "/".into());
    // An app started this: the browser is only the way to Google and back,
    // so it gets no session. It gets a link that hands the app a code.
    if let Some(challenge) = remembered.and_then(|r| r.challenge) {
        let code = Code { session, challenge, exp: now() + TWO_MINUTES };
        let sealed = seal(&config.key, serde_json::to_string(&code).expect("plain text fields"));
        let mut link = reqwest::Url::parse("done://auth").expect("a valid address");
        link.query_pairs_mut().append_pair("code", &sealed);
        return (jar, Html(BACK_TO_THE_APP.replace("LINK", link.as_str()))).into_response();
    }
    let value = serde_json::to_string(&session).expect("plain text fields");
    (jar.add(cookie(SESSION, value, config, THIRTY_DAYS)), Redirect::to(&then)).into_response()
}

const TWO_MINUTES: u64 = 120;

/// What the browser hands the app. Not a session: it is traded for one, once
/// the app shows it holds the secret behind `challenge`.
#[derive(Serialize, Deserialize)]
struct Code {
    session: Session,
    challenge: String,
    exp: u64,
}

// A page, not a redirect: a browser does not follow a redirect to an app's
// own kind of link without being asked, and some never do. The page tries by
// itself and leaves a button for when that is not allowed. LINK is made of
// letters, digits and percent-escapes only, so it is safe inside the quotes.
const BACK_TO_THE_APP: &str = r#"<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>done</title>
<style>
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; color: #1a1a1e; margin: 0; min-height: 100svh; display: grid; place-items: center; }
  main { max-width: 22rem; padding: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: #63636b; margin: 0 0 1.5rem; }
  a { display: block; text-align: center; background: #2f5fe0; color: #fff; text-decoration: none; padding: .75rem 1rem; border-radius: .5rem; font-weight: 500; }
</style>
<main>
  <h1>You are signed in</h1>
  <p>Go back to done to finish. You can close this page afterwards.</p>
  <a href="LINK">Open done</a>
</main>
<script>location.href = "LINK"</script>
</html>"#;

#[derive(Deserialize)]
pub struct Exchange {
    code: String,
    verifier: String,
}

/// An app trades the code from its link for a token. It has to send the
/// secret whose SHA-256 it gave when it started: any app on a device can
/// claim a `done://` link, and one that did would hold a code and nothing
/// that makes it worth anything.
pub async fn exchange(State(cloud): State<Cloud>, Json(q): Json<Exchange>) -> Response {
    let refused = || (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "That sign-in can no longer be finished. Start it again." }))).into_response();
    let key = &cloud.config.key;
    let Some(code) = unseal(key, &q.code).and_then(|text| serde_json::from_str::<Code>(&text).ok()) else {
        return refused();
    };
    let shown: String = Sha256::digest(q.verifier.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
    if code.exp <= now() || !shown.eq_ignore_ascii_case(&code.challenge) {
        return refused();
    }
    let s = &code.session;
    match s.account(&cloud).await {
        Ok(Some(_)) => (),
        Ok(None) => return refused(),
        Err(fail) => return down(fail),
    }
    let account = serde_json::json!({ "id": s.sub, "email": s.email, "name": s.name, "picture": s.picture });
    let token = seal(key, serde_json::to_string(&code.session).expect("plain text fields"));
    Json(serde_json::json!({ "token": token, "account": account })).into_response()
}

pub async fn sign_out(jar: SignedCookieJar, Json(_): Json<serde_json::Value>) -> Response {
    (jar.remove(gone(SESSION)), Json(serde_json::json!({}))).into_response()
}

/// Who the interface is talking to. Answers without a session too: that is
/// how the interface learns it has to show the sign-in screen.
pub async fn me(State(cloud): State<Cloud>, headers: HeaderMap, jar: SignedCookieJar) -> Response {
    let session = match signed_in(&headers, &jar, &cloud).await {
        Ok(session) => session,
        Err(fail) => return down(fail),
    };
    let account = session.map(|s| serde_json::json!({ "id": s.sub, "email": s.email, "name": s.name, "picture": s.picture }));
    Json(serde_json::json!({ "mode": "cloud", "account": account })).into_response()
}

/// Deletes the account's tasks for good and signs out.
///
/// Apple is asked to revoke the kept grant first, outside the deleting
/// transaction, so no row is locked while Apple answers. Whatever Apple says
/// (or does not say within the timeout), the account is deleted: the
/// person's deletion always wins. `apple` tells the app what became of Sign
/// in with Apple: "revoked", "not_revoked", or "none" when no grant was kept
/// (a non-Apple account, too). Older apps ignore it.
pub async fn delete_account(State(cloud): State<Cloud>, me: Me, jar: SignedCookieJar, Json(_): Json<serde_json::Value>) -> Response {
    let failed = |e: Fail| {
        eprintln!("{e:?}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Your account could not be deleted. Please try again." }))).into_response()
    };
    let grant = match cloud.db.apple_grant(&me).await {
        Ok(grant) => grant,
        Err(e) => return failed(e),
    };
    // A grant kept meanwhile (a sign-in on another device) goes with the
    // account unrevoked: the account is being deleted.
    let apple = apple_grants::revoke(&cloud.config, &me.id, grant).await;
    match cloud.db.delete_account(&me).await {
        Ok(()) => (jar.remove(gone(SESSION)), Json(serde_json::json!({ "apple": apple }))).into_response(),
        Err(e) => failed(e),
    }
}

#[derive(Deserialize)]
pub struct DevAs {
    then: Option<String>,
    #[serde(default)]
    r#as: String,
}

/// For a server on a laptop only (see `Config::dev`): signs the browser in
/// as one of three made-up people, so two windows can be two people in one
/// workspace. Answers "not found" everywhere else.
pub async fn dev(State(cloud): State<Cloud>, jar: SignedCookieJar, Query(q): Query<DevAs>) -> Response {
    if !cloud.config.dev {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (sub, email, name) = match q.r#as.as_str() {
        "geart" => ("dev2", "geart@hop.dev", "Geart"),
        "ana" => ("dev3", "ana@studio.se", "Ana Lind"),
        _ => ("dev1", "julius@hop.dev", "Julius Olsson"),
    };
    let session = match Session::start(&cloud, sub.into(), email.into(), name.into(), String::new()).await {
        Ok(session) => session,
        Err(fail) => return down(fail),
    };
    let value = serde_json::to_string(&session).expect("plain text fields");
    (jar.add(cookie(SESSION, value, &cloud.config, THIRTY_DAYS)), Redirect::to(back_to(q.then).as_deref().unwrap_or("/"))).into_response()
}

/// What an app is handed when it signs in: the token it sends from then on,
/// and the account, the same as `exchange` answers.
fn app_session(key: &Key, session: &Session) -> Response {
    let account = serde_json::json!({ "id": session.sub, "email": session.email, "name": session.name, "picture": session.picture });
    let token = seal(key, serde_json::to_string(session).expect("plain text fields"));
    Json(serde_json::json!({ "token": token, "account": account })).into_response()
}

fn not_signed_in(message: &str) -> Response {
    (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": message }))).into_response()
}

#[derive(Deserialize)]
pub struct AppleSignIn {
    identity_token: String,
    // Older released apps send only their verified identity token.
    authorization_code: Option<String>,
    /// The person's name as the device gave it. Apple hands it over on the
    /// first sign-in only, and never puts it in the token.
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct AppleClaims {
    sub: String,
    #[serde(default)]
    email: String,
}

#[derive(Deserialize)]
struct AppleKeys {
    keys: Vec<AppleKey>,
}

#[derive(Deserialize)]
struct AppleKey {
    kid: String,
    n: String,
    e: String,
}

/// The id an Apple account is kept under. Apple's ids have dots in them and
/// ids become file names (letters and digits only), so it is a hash; the
/// prefix keeps it apart from Google's ids, which are digits.
pub(crate) fn apple_id(sub: &str) -> String {
    let hex: String = Sha256::digest(sub.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
    format!("apple{}", &hex[..40])
}

/// The iPhone app signed in with Apple on the device and sends the token
/// Apple gave it. Unlike Google's, this token reaches the server through the
/// app, not straight from Apple, so its signature is checked against the keys
/// Apple publishes, along with who made it, for which app, and until when.
pub async fn apple(State(cloud): State<Cloud>, Json(q): Json<AppleSignIn>) -> Response {
    let config = &cloud.config;
    let refused = |why: &str| {
        eprintln!("apple sign-in refused: {why}");
        not_signed_in("Signing in with Apple did not work. Try again.")
    };
    if jsonwebtoken::decode_header(&q.identity_token).is_err() {
        return refused("not a token");
    };
    let keys: AppleKeys = match cloud.http.get(&config.apple_keys_url).send().await.and_then(|r| r.error_for_status()) {
        Ok(response) => match response.json().await {
            Ok(keys) => keys,
            Err(_) => return refused("Apple's keys could not be read"),
        },
        Err(e) => return refused(&format!("Apple's keys could not be fetched: {e}")),
    };
    let claims = match apple_grants::identity(&q.identity_token, &keys, &config.apple_audience) {
        Ok(claims) => claims,
        Err(why) => return refused(why),
    };
    let id = apple_id(&claims.sub);
    // The exchange never stands in the way of signing in: a server without
    // Apple's settings, Apple down or slow, a code already used, a wrong team
    // id or a revoked key each sign in without a kept grant (logged in
    // `exchange`). Only Apple naming somebody else refuses.
    let grant = match q.authorization_code.as_deref().map(str::trim) {
        Some(code) if !code.is_empty() => match apple_grants::exchange(config, &keys, &claims.sub, &id, code).await {
            Ok(grant) => grant,
            Err(apple_grants::Mismatch) => return refused("Apple's grant names somebody else"),
        },
        Some(_) => {
            apple_grants::note("Apple code exchange failed: an empty code; signed in without a kept grant");
            None
        }
        None => None,
    };
    let mut name = q.name.trim().to_string();
    // Only the first sign-in comes with a name. Signing in again must not
    // turn a named account into a nameless one.
    if name.is_empty() {
        name = cloud.db.name_of(&id).await.ok().flatten().unwrap_or_default();
    }
    let me = match cloud.db.me_with_apple_grant(&id, &claims.email, &name, "", grant.as_deref()).await {
        Ok(me) => me,
        Err(fail) => return down(fail),
    };
    let session = Session { sub: id, email: claims.email, name, picture: String::new(), generation: me.generation, exp: now() + THIRTY_DAYS };
    app_session(&config.key, &session)
}

#[derive(Deserialize)]
pub struct ReviewSignIn {
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
}

/// The App Review account, with the username and password given to Apple
/// with the submission. Off (not found) unless the server has a password.
pub async fn review(State(cloud): State<Cloud>, jar: SignedCookieJar, Json(q): Json<ReviewSignIn>) -> Response {
    let config = &cloud.config;
    let Some(password) = &config.review_password else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Compared as hashes, so how long the comparison takes says nothing about
    // how much of the password was right.
    let right = Sha256::digest(password.as_bytes()) == Sha256::digest(q.password.trim().as_bytes());
    if q.username.trim() != "review" || !right {
        return not_signed_in("That username and password do not match.");
    }
    let session = match Session::start(&cloud, "review".into(), "review@thedone.app".into(), "App Review".into(), String::new()).await {
        Ok(session) => session,
        Err(fail) => return down(fail),
    };
    // The cookie too, so the same login works on the web app.
    let value = serde_json::to_string(&session).expect("plain text fields");
    (jar.add(cookie(SESSION, value, config, THIRTY_DAYS)), app_session(&config.key, &session)).into_response()
}
