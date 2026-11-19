//! The privacy page and the terms page of a hosted server.
//!
//! Every sentence on the privacy page describes what this crate does. If the
//! code changes what is kept, where or for how long, the page changes with it.

use axum::{extract::State, response::Html};

use crate::auth::Cloud;

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

pub async fn privacy(State(cloud): State<Cloud>) -> Html<String> {
    page(
        "Privacy",
        &cloud.operator,
        r#"<h2>What is kept</h2>
<ul>
  <li><strong>Your tasks.</strong> Your tasks, projects and time sheet are kept in one file that belongs to your account alone.</li>
  <li><strong>Who you are, from Google.</strong> When you sign in, Google tells this server your account's id, name, email address and picture. They are put in a signed cookie in your browser (or a token in the app) so the server knows which tasks are yours, and so the app can show who is signed in. The server keeps no list of users: your tasks file is named after the id, and the rest lives only in that cookie or token.</li>
</ul>
<p>Nothing else is asked of Google. done cannot read your mail, calendar, contacts or files.</p>

<h2>What is not done</h2>
<ul>
  <li>No advertising and no tracking. The pages load nothing from other companies.</li>
  <li>Your tasks are not sold, shared or used to train anything.</li>
  <li>The server's host keeps ordinary request logs (time, address requested, your network address) for a limited time, as every web server does. The content of your tasks is never written to them.</li>
</ul>

<h2>Where it is kept, and for how long</h2>
<p>Your tasks file is stored with Google Cloud by WHO, and is kept until you delete your account. A copy of a replaced or deleted file can be restored for up to 14 days and is then gone for good. The sign-in cookie lasts 30 days.</p>

<h2>Deleting everything</h2>
<p>In done, open Settings and choose "Delete my account". Your tasks file is deleted at once, and its last restorable copy 14 days later. Signing out only removes the cookie.</p>"#,
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
