//! Signing Claude (or another MCP client) in to someone's done, so it can use
//! `/mcp` for them: OAuth 2.1 with PKCE, as MCP's authorization spec asks.
//!
//! The person signs in to done as usual (Google), sees which app is asking,
//! and allows it. The app then holds the same kind of token the iPhone and
//! Mac apps hold.
//!
//! WHY nothing is stored: like the session, every artefact here is text
//! signed with the server's key, carrying what it needs. A registered client
//! is its own redirect addresses, signed; a code is the session, the PKCE
//! challenge and the address it may go to, signed, for two minutes. No table,
//! nothing to clean up. The cost: a client cannot be revoked by itself, and a
//! token lasts until it expires (30 days; a refresh token a year). Signing
//! out of done in a browser does not end them.

use axum::{
    extract::{Form, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::cookie::SignedCookieJar;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::auth::{self, Cloud, Session};

const TWO_MINUTES: u64 = 120;
const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;
const A_YEAR: u64 = 365 * 24 * 60 * 60;

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// Signed text, made safe for a URL, a form and a header alike: the signed
// cookie value has quotes and braces in it.
fn wrap(key: &axum_extra::extract::cookie::Key, value: &impl Serialize) -> String {
    let sealed = auth::seal(key, serde_json::to_string(value).expect("plain fields"));
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sealed)
}

fn unwrap<T: for<'de> Deserialize<'de>>(key: &axum_extra::extract::cookie::Key, text: &str) -> Option<T> {
    let sealed = String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(text).ok()?).ok()?;
    serde_json::from_str(&auth::unseal(key, &sealed)?).ok()
}

/// RFC 9728: where `/mcp`'s tokens come from. Claude reads this first.
pub async fn protected_resource(State(cloud): State<Cloud>) -> Response {
    let at = &cloud.config.public_url;
    Json(serde_json::json!({
        "resource": format!("{at}/mcp"),
        "authorization_servers": [at],
        "bearer_methods_supported": ["header"],
        "resource_name": "done",
    }))
    .into_response()
}

/// RFC 8414: the addresses of the sign-in.
pub async fn authorization_server(State(cloud): State<Cloud>) -> Response {
    let at = &cloud.config.public_url;
    Json(serde_json::json!({
        "issuer": at,
        "authorization_endpoint": format!("{at}/oauth/authorize"),
        "token_endpoint": format!("{at}/oauth/token"),
        "registration_endpoint": format!("{at}/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }))
    .into_response()
}

/// A registered client: the addresses it may be sent back to, and its name.
#[derive(Serialize, Deserialize)]
struct Client {
    redirect_uris: Vec<String>,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
pub struct Register {
    #[serde(default)]
    redirect_uris: Vec<String>,
    #[serde(default)]
    client_name: String,
}

/// An address a code may be sent to: https, or http on this machine (a
/// desktop app listening for its own sign-in).
fn fit_to_return_to(uri: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(uri) else { return false };
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

/// RFC 7591: anyone may register; what they get is their own addresses,
/// signed, as the client id.
pub async fn register(State(cloud): State<Cloud>, Json(q): Json<Register>) -> Response {
    if q.redirect_uris.is_empty() || q.redirect_uris.len() > 10 || !q.redirect_uris.iter().all(|u| fit_to_return_to(u)) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid_redirect_uri" }))).into_response();
    }
    let name: String = q.client_name.chars().take(80).collect();
    let client = Client { redirect_uris: q.redirect_uris.clone(), name: name.clone() };
    let id = wrap(&cloud.config.key, &client);
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "client_id": id,
            "client_id_issued_at": now(),
            "client_name": name,
            "redirect_uris": q.redirect_uris,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })),
    )
        .into_response()
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Ask {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    redirect_uri: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    code_challenge: String,
    #[serde(default)]
    code_challenge_method: String,
    #[serde(default)]
    response_type: String,
}

impl Ask {
    fn pairs(&self) -> [(&'static str, &String); 6] {
        [
            ("client_id", &self.client_id),
            ("redirect_uri", &self.redirect_uri),
            ("state", &self.state),
            ("code_challenge", &self.code_challenge),
            ("code_challenge_method", &self.code_challenge_method),
            ("response_type", &self.response_type),
        ]
    }
}

/// The client, if the ask is one this server answers. Anything wrong here is
/// shown on the page, never sent to the redirect address: an address that is
/// not the client's own must not be sent anything at all.
fn checked(cloud: &Cloud, ask: &Ask) -> Result<Client, &'static str> {
    let client: Client = unwrap(&cloud.config.key, &ask.client_id).ok_or("This app is not known to done. Connect it again.")?;
    if !client.redirect_uris.contains(&ask.redirect_uri) {
        return Err("This app asked to be sent somewhere it did not register.");
    }
    if ask.response_type != "code" || ask.code_challenge_method != "S256" || ask.code_challenge.len() < 43 {
        return Err("This app asked to sign in in a way done does not offer.");
    }
    Ok(client)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn page(title: &str, body: &str) -> Response {
    Html(PAGE.replace("TITLE", title).replace("BODY", body)).into_response()
}

/// Asks the signed-in person whether to let the app in. Someone not signed
/// in goes to Google first and comes back here.
pub async fn authorize(State(cloud): State<Cloud>, jar: SignedCookieJar, Query(ask): Query<Ask>) -> Response {
    let client = match checked(&cloud, &ask) {
        Ok(client) => client,
        Err(why) => return page("Not connected", &format!("<p>{}</p>", escape(why))),
    };
    let Some(session) = auth::signed_in(&Default::default(), &jar, &cloud.config.key) else {
        // Back here once signed in: the same ask, as a path on this server.
        let mut back = reqwest::Url::parse("http://x/oauth/authorize").expect("a valid address");
        back.query_pairs_mut().extend_pairs(ask.pairs());
        let mut to = reqwest::Url::parse("http://x/auth/google").expect("a valid address");
        to.query_pairs_mut().append_pair("then", &format!("/oauth/authorize?{}", back.query().unwrap_or_default()));
        return Redirect::to(&format!("/auth/google?{}", to.query().unwrap_or_default())).into_response();
    };
    let host = reqwest::Url::parse(&ask.redirect_uri).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    let name = if client.name.is_empty() { host.clone() } else { client.name.clone() };
    let hidden: String = ask
        .pairs()
        .iter()
    .map(|(k, v)| format!(r#"<input type="hidden" name="{k}" value="{}">"#, escape(v)))
    .collect();
    page(
        "Connect to done",
        &format!(
            r#"<p><b>{}</b> ({}) wants to use your done as <b>{}</b>: read and change your tasks, projects and notes, and read your time sheet.</p>
<form method="post" action="/oauth/authorize">{hidden}<button name="allow" value="yes">Allow</button><button name="allow" value="no" class="quiet">Cancel</button></form>"#,
            escape(&name),
            escape(&host),
            escape(&session.email),
        ),
    )
}


struct Answer {
    ask: Ask,
    allow: String,
}

/// The code: who allowed it, for which challenge and which address.
#[derive(Serialize, Deserialize)]
struct Code {
    session: Session,
    challenge: String,
    redirect_uri: String,
    client_id: String,
    exp: u64,
}

/// The person's answer. The cookie is SameSite=Lax, so a form another site
/// posts here arrives without it and is turned away.
pub async fn answer(State(cloud): State<Cloud>, jar: SignedCookieJar, Form(form): Form<std::collections::HashMap<String, String>>) -> Response {
    let field = |name: &str| form.get(name).cloned().unwrap_or_default();
    let q = Answer {
        ask: Ask {
            client_id: field("client_id"),
            redirect_uri: field("redirect_uri"),
            state: field("state"),
            code_challenge: field("code_challenge"),
            code_challenge_method: field("code_challenge_method"),
            response_type: field("response_type"),
        },
        allow: field("allow"),
    };
    if let Err(why) = checked(&cloud, &q.ask) {
        return page("Not connected", &format!("<p>{}</p>", escape(why)));
    }
    let Some(session) = auth::signed_in(&Default::default(), &jar, &cloud.config.key) else {
        return page("Not connected", "<p>Sign in to done, then connect the app again.</p>");
    };
    let mut back = reqwest::Url::parse(&q.ask.redirect_uri).expect("checked above");
    if q.allow != "yes" {
        back.query_pairs_mut().append_pair("error", "access_denied").append_pair("state", &q.ask.state);
        return Redirect::to(back.as_str()).into_response();
    }
    let code = Code {
        session: Session { exp: now() + THIRTY_DAYS, ..session },
        challenge: q.ask.code_challenge.clone(),
        redirect_uri: q.ask.redirect_uri.clone(),
        client_id: q.ask.client_id.clone(),
        exp: now() + TWO_MINUTES,
    };
    back.query_pairs_mut().append_pair("code", &wrap(&cloud.config.key, &code)).append_pair("state", &q.ask.state);
    Redirect::to(back.as_str()).into_response()
}

#[derive(Deserialize)]
pub struct TokenAsk {
    #[serde(default)]
    grant_type: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    code_verifier: String,
    #[serde(default)]
    redirect_uri: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    refresh_token: String,
}

/// A refresh token: the session to renew, kept apart from an access token by
/// its shape, so one can never be used as the other.
#[derive(Serialize, Deserialize)]
struct Refresh {
    refresh: Session,
}

fn grant_refused() -> Response {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid_grant" }))).into_response()
}

fn tokens(cloud: &Cloud, session: Session) -> Response {
    let access = Session { exp: now() + THIRTY_DAYS, ..session.clone() };
    let refresh = Refresh { refresh: Session { exp: now() + A_YEAR, ..session } };
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            // The same token the iPhone and Mac apps hold, so `/mcp` checks it
            // the way every other request is checked.
            "access_token": auth::seal(&cloud.config.key, serde_json::to_string(&access).expect("plain fields")),
            "token_type": "Bearer",
            "expires_in": THIRTY_DAYS,
            "refresh_token": wrap(&cloud.config.key, &refresh),
        })),
    )
        .into_response()
}

pub async fn token(State(cloud): State<Cloud>, Form(q): Form<TokenAsk>) -> Response {
    let key = &cloud.config.key;
    match q.grant_type.as_str() {
        "authorization_code" => {
            let Some(code) = unwrap::<Code>(key, &q.code) else { return grant_refused() };
            // PKCE: only the app that started this holds the secret behind the
            // challenge, so a code caught on the way is worth nothing.
            let shown = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(q.code_verifier.as_bytes()));
            if code.exp <= now() || shown != code.challenge || code.redirect_uri != q.redirect_uri || code.client_id != q.client_id {
                return grant_refused();
            }
            tokens(&cloud, code.session)
        }
        "refresh_token" => match unwrap::<Refresh>(key, &q.refresh_token) {
            Some(r) if r.refresh.exp > now() => tokens(&cloud, r.refresh),
            _ => grant_refused(),
        },
        _ => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "unsupported_grant_type" }))).into_response(),
    }
}

const PAGE: &str = r#"<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>done</title>
<style>
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; color: #1a1a1e; margin: 0; min-height: 100svh; display: grid; place-items: center; }
  main { max-width: 24rem; padding: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: #63636b; margin: 0 0 1.5rem; }
  b { color: #1a1a1e; font-weight: 600; }
  form { display: flex; gap: .5rem; }
  button { font: inherit; font-weight: 500; border: 0; border-radius: .5rem; padding: .65rem 1.1rem; background: #2f5fe0; color: #fff; cursor: pointer; }
  button.quiet { background: transparent; color: #63636b; }
</style>
<main>
  <h1>TITLE</h1>
  BODY
</main>
</html>"#;
