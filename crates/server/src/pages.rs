//! The privacy page and the terms page of a hosted server.
//!
//! Every sentence on the privacy page describes what this crate does. If the
//! code changes what is kept, where or for how long, the page changes with it.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
};
use axum_extra::extract::cookie::SignedCookieJar;

use crate::auth::{signed_in, Cloud};
use crate::pg::{now_ms, Fail};

/// Who runs this server, as shown on both pages. Someone else hosting the
/// same code is a different operator, so this is a setting and not a constant.
pub struct Operator {
    pub name: String,
    pub contact: String,
}

impl Operator {
    pub fn from_env() -> Self {
        let read = |name: &str| std::env::var(name).map(|v| v.trim().to_string()).unwrap_or_default();
        Self { name: read("DONE_OPERATOR"), contact: read("DONE_CONTACT") }
    }
}

// The settings are put into a page, so they are made safe for one first.
fn text(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn page(title: &str, operator: &Operator, body: &str) -> Html<String> {
    let who = if operator.name.is_empty() { "the operator of this server".to_string() } else { text(&operator.name) };
    let reach = if operator.contact.is_empty() {
        String::new()
    } else {
        format!("<p>Questions: <a href=\"mailto:{0}\">{0}</a>.</p>", text(&operator.contact))
    };
    Html(format!(
        r#"<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · done</title>
<style>
  body {{ font: 16px/1.6 -apple-system, system-ui, sans-serif; color: #1a1a1e; margin: 0; }}
  main {{ max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }}
  h1 {{ font-size: 1.75rem; margin: 0 0 .25rem; }}
  h2 {{ font-size: 1.05rem; margin: 2rem 0 .25rem; }}
  p, li {{ color: #3a3a40; }}
  .sub {{ color: #63636b; margin: 0 0 2rem; }}
  a {{ color: #2f5fe0; }}
</style>
<main>
<h1>{title}</h1>
<p class="sub">done, as run by {who}. <a href="/">Back to done</a></p>
{body}
{reach}
</main>
</html>"#,
            body = body.replace("WHO", &who),
        ))
}

pub async fn home(State(cloud): State<Cloud>, headers: HeaderMap) -> Response {
    let host = headers.get("host").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<axum::http::uri::Authority>().ok());
    if host.is_some_and(|h| h.host().eq_ignore_ascii_case("hi.thedone.app")) {
        feedback(State(cloud)).await.into_response()
    } else {
        Html(crate::UI).into_response()
    }
}

pub async fn feedback(State(cloud): State<Cloud>) -> Html<String> {
    let app = text(&cloud.config.public_url);
    let sign_in = if cloud.config.dev { "/auth/dev" } else { "/auth/google" };
    Html(include_str!("feedback.html")
        .replace("{{APP_URL}}", &app)
        .replace("{{FEEDBACK_SIGN_IN}}", &format!("{app}{sign_in}?then=%2Ffeedback")))
}

pub async fn privacy(State(cloud): State<Cloud>) -> Html<String> {
    page(
        "Privacy",
        &cloud.operator,
        r#"<h2>On your device</h2>
<p>You can use the iPhone, iPad, Mac and Windows apps without an account. They keep your tasks, projects, notes and time sheet on the device. On iPhone and iPad, done also keeps a local snapshot so its widgets and Live Activity can display tasks and focus sessions.</p>

<h2>When you sign in</h2>
<p>Signing in uploads the device’s task data to your account and syncs changes across your devices. In the web app, the server stores the content you enter. Your personal space and time sheet are private to your account.</p>
<p>Apple supplies an account identifier and may supply a name and email address, including an Apple relay address. Google supplies an account identifier, email, name and profile picture address when available. done uses these details to identify your account, show who belongs to a workspace and match invitations. A signed browser cookie or an app token keeps you signed in. done cannot read your mail, calendar, address book or files.</p>

<h2>Who can see what</h2>
<ul>
  <li>Members of a workspace can see and edit its projects, tasks, notes and assignments. They can see other members’ profile details. An invitation records the email address entered and the person who invited it.</li>
  <li>Signed-in users can read the category, message and date of feedback you post on the wall. The server also records which account posted it.</li>
  <li>If you connect an external assistant, it can read and change the tasks and notes available to it. Information sent to that service is handled under its own privacy policy.</li>
</ul>
<p>done uses no advertising or cross-app tracking and does not sell your data or use it to train models. WHO uses hosting providers to serve requests and store synced data. The database is hosted on Google Cloud. Workspace profile pictures from Google load from Google. Hosting request logs can include the request time, requested address and network address.</p>

<h2>Retention and deletion</h2>
<p>Synced data stays in your account until you delete it or the account. The database is backed up daily and each backup is kept for seven days. The sign-in cookie lasts 30 days.</p>
<p>To delete your account, open Settings, choose “Delete my account” and confirm. This removes your personal space and feedback and ends your workspace memberships. A workspace you own passes to its earliest remaining member or is deleted if nobody else belongs to it. Shared content in a continuing workspace stays there. Deleted data ages out of backups within seven days.</p>
<p>On iPhone, iPad, Mac and Windows, signing out or deleting your hosted account leaves local task data on your devices. To remove the local copy on iPhone or iPad, use Delete App on each device. Done revokes the Apple grants it holds when you delete your account. If you signed in on an older version, you may also need to disconnect done under Sign in with Apple in your Apple Account. <a href="https://support.apple.com/102571">See Apple’s instructions</a>.</p>
<p>For questions about your data, <a href="/support">contact support</a>.</p>"#,
    )
}

pub async fn support(State(cloud): State<Cloud>) -> Html<String> {
    page(
        "Support",
        &cloud.operator,
        r#"<p>For help using done or questions about your account or privacy, contact WHO using the address below. Include your device and what happened. Please leave out passwords and the contents of private tasks.</p>
<p>To report a problem or suggest a change to other users, visit the <a href="/feedback">feedback wall</a>. Signed-in users can read posts there.</p>
<p><a href="/privacy">Privacy policy</a></p>"#,
    )
}

pub async fn terms(State(cloud): State<Cloud>) -> Html<String> {
    page(
        "Terms",
        &cloud.operator,
        r#"<p>done is a to-do list. These are the terms for using this hosted copy of it, run by WHO.</p>

<h2>Your account and your tasks</h2>
<p>You sign in with a Google account. What you write in done is yours. You can delete all of it, and your account, at any time from Settings.</p>

<h2>What to expect</h2>
<p>The service is provided as it is, without a promise that it is always available or free of faults. Keep your own copy of anything you cannot afford to lose. To the extent the law allows, WHO is not liable for loss that follows from using it.</p>

<h2>Fair use</h2>
<p>Do not use the service to break the law, to attack it or other people, or to store material you have no right to store. An account used that way may be closed.</p>

<h2>Changes</h2>
<p>The service and these terms may change. If the service is to be closed, signed-in users are told in the app beforehand so they can take their tasks with them.</p>

<h2>The software</h2>
<p>done itself is open source under the MIT license, and you may run your own copy: <a href="https://github.com/Juliusolsson05/done">github.com/Juliusolsson05/done</a>. See also the <a href="/privacy">privacy page</a>.</p>"#,
    )
}

/// The page behind an invite link: who invited you to what, and one button.
/// Someone who is not signed in is sent to Google and back here; someone
/// signed in as another account is told whose invite it is.
pub async fn invite(State(cloud): State<Cloud>, headers: HeaderMap, jar: SignedCookieJar, Path(token): Path<String>) -> Response {
    let gone = |title: &str, why: &str| (StatusCode::NOT_FOUND, card("", title, why, r#"<a class="quiet" href="/">Open done</a>"#)).into_response();
    if token.is_empty() || token.len() > 128 || !token.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return gone("This invite does not work", "The link may be cut short. Ask for a new one.");
    }
    let invite = match cloud.db.invite_page(&token).await {
        Ok(invite) => invite,
        Err(Fail::NotFound) => return gone("This invite does not work", "The link may be cut short, or a newer one replaced it. Ask for a new one."),
        Err(e) => return crate::auth::down(e),
    };
    let by = if invite.by_name.is_empty() { "Someone".to_string() } else { text(invite.by_name.split_whitespace().next().unwrap_or("")) };
    let space = text(&invite.space);
    match invite.state.as_str() {
        "pending" => {}
        "expired" => return gone("This invite has expired", &format!("Invites last 7 days. Ask {by} to send a new one.")),
        "accepted" => return gone("This invite has been used", "If it was you, Hop is already in done. Open done to see it.".replace("Hop", &space).as_str()),
        _ => return gone("This invite was taken back", &format!("Ask {by} if they meant to.")),
    }
    let picture = if invite.by_picture.starts_with("https://") {
        format!(r#"<img class="face" src="{}" alt="" referrerpolicy="no-referrer">"#, text(&invite.by_picture))
    } else {
        format!(r#"<span class="face">{}</span>"#, by.chars().next().unwrap_or('•'))
    };
    let days = ((invite.expires - now_ms()) / (24 * 60 * 60 * 1000)).max(0);
    let lasts = if days >= 1 { format!("This invite works for {days} more day{}.", if days == 1 { "" } else { "s" }) } else { "This invite runs out today.".into() };
    let people = format!("{space} has {} member{}.", invite.members, if invite.members == 1 { "" } else { "s" });
    let back = format!("/auth/google?then=/invite/{token}");
    let session = match signed_in(&headers, &jar, &cloud).await {
        Ok(session) => session,
        Err(fail) => return crate::auth::down(fail),
    };
    let html = match session {
        None => card(
            &picture,
            &format!("{by} invited you to {space}"),
            &format!("{people} Sign in with {} to join.", text(&invite.email)),
            &format!(r#"<a class="go" href="{back}">Continue with Google</a><p class="small">{lasts}</p>"#),
        ),
        Some(s) if s.email.trim().to_lowercase() == invite.to => card(
            &picture,
            &format!("{by} invited you to {space}"),
            &format!("{people} Its projects show up in done beside your own; your own stay yours."),
            &format!(
                r#"<button class="go" id="join">Join {space}</button><p class="small" id="said">{lasts}</p>
<script>
document.getElementById('join').onclick = async () => {{
  const r = await fetch('/api/invites/accept', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: JSON.stringify({{ token: '{token}' }}) }})
  if (r.ok) location.href = '/'
  else document.getElementById('said').textContent = (await r.json().catch(() => ({{}}))).error || 'That did not work. Try again.'
}}
</script>"#
            ),
        ),
        Some(s) => card(
            "",
            "This invite is for another account",
            &format!("It was sent to {}. You are signed in as {}.", text(&invite.email), text(&s.email)),
            &format!(
                r#"<button class="go" id="switch">Switch account</button> <a class="quiet" href="/">Open done</a>
<script>
document.getElementById('switch').onclick = async () => {{
  await fetch('/auth/signout', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: '{{}}' }})
  location.href = '{back}'
}}
</script>"#
            ),
        ),
    };
    html.into_response()
}

// One small card in the middle of the page, in done's own colours.
fn card(face: &str, title: &str, said: &str, actions: &str) -> Html<String> {
    Html(format!(
        r##"<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>{title} · done</title>
<style>
  body {{ font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1e1f1d; background: #fcfcfa; margin: 0; min-height: 100svh; display: grid; place-items: center; }}
  main {{ max-width: 23rem; padding: 2rem 1.25rem; text-align: center; }}
  .mark {{ display: inline-flex; gap: .5rem; align-items: center; font-weight: 650; font-size: 1.3rem; letter-spacing: -.02em; margin-bottom: 2rem; color: #1e1f1d; text-decoration: none; }}
  .face {{ width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #1e4fbf; color: #fff; font-weight: 600; margin-bottom: .9rem; object-fit: cover; }}
  h1 {{ font-size: 1.4rem; line-height: 1.3; letter-spacing: -.01em; margin: 0 0 .4rem; }}
  p {{ color: #62645f; margin: 0 0 1.4rem; }}
  .go {{ display: inline-block; background: #1e4fbf; color: #fff; text-decoration: none; padding: .7rem 1.1rem; border-radius: .45rem; font: 500 15px -apple-system, system-ui, sans-serif; border: 0; cursor: pointer; }}
  .go:focus-visible, .quiet:focus-visible {{ outline: 3px solid rgb(30 79 191 / .35); outline-offset: 2px; }}
  .quiet {{ color: #62645f; margin-left: .75rem; }}
  .small {{ font-size: 13px; color: #9a9c96; margin-top: 1rem; }}
</style>
<main>
<a class="mark" href="/"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#1e4fbf"/><path d="M5.6 10.3l3 3 5.8-6.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>done</a>
<div>{face}</div>
<h1>{title}</h1>
<p>{said}</p>
{actions}
</main>
</html>"##
    ))
}
