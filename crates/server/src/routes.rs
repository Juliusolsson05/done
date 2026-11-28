//! The app's own addresses (/today, /project/7, /notes/3?task=...), which a
//! browser may load or reload directly. The same table as ui/src/lib/route.ts.
//! Answered with the app only through the routers' fallback, which runs when
//! no route matched: an address here can never take the place of a route the
//! server has now or gets later. Anything not in the table stays a 404.

use axum::{
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
};

/// The views with a path of one word.
const WORDS: &[&str] = &[
    "today",
    "inbox",
    "upcoming",
    "assigned",
    "timeline",
    "board",
    "focus",
    "time-sheet",
    "completed",
    "notes",
    "settings",
    "lists",
    "notifications",
];

/// An id as an address writes it: digits only, at most 20.
fn is_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
}

/// Whether `path` (no query) is a place in the app. One trailing slash is forgiven.
pub fn is_app_path(path: &str) -> bool {
    let path = if path.len() > 1 { path.strip_suffix('/').unwrap_or(path) } else { path };
    let Some(rest) = path.strip_prefix('/') else { return false };
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.as_slice() {
        [word] => WORDS.contains(word),
        ["project", id] | ["notes", id] => is_id(id),
        ["settings", "workspace", id] => is_id(id),
        _ => false,
    }
}

/// Whether sign-in may send someone back to `then`: a place in the app,
/// with nothing in its query but an open task. Always a path on this server.
pub fn is_app_target(then: &str) -> bool {
    let (path, query) = then.split_once('?').unwrap_or((then, ""));
    let query_ok = query.is_empty() || query.strip_prefix("task=").is_some_and(is_id);
    then.len() <= 200 && path != "/" && is_app_path(path) && query_ok
}

/// The fallback of both routers: the app for a GET of one of its places, on
/// any host but the landing one; otherwise what there was before, a 404.
pub async fn fallback(method: Method, uri: Uri, headers: HeaderMap, app: &'static str) -> Response {
    let landing = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<axum::http::uri::Authority>().ok())
        .is_some_and(|h| h.host().eq_ignore_ascii_case("hi.thedone.app"));
    if (method == Method::GET || method == Method::HEAD) && !landing && is_app_path(uri.path()) {
        Html(app).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_apps_places() {
        for path in [
            "/today",
            "/inbox",
            "/upcoming",
            "/assigned",
            "/timeline",
            "/board",
            "/focus",
            "/time-sheet",
            "/completed",
            "/notes",
            "/notes/1795306779859023",
            "/project/7",
            "/settings",
            "/settings/workspace/12",
            "/lists",
            "/notifications",
            "/upcoming/",
        ] {
            assert!(is_app_path(path), "{path}");
        }
        for path in [
            "/",
            "",
            "today",
            "//today",
            "/Today",
            "/nope",
            "/project",
            "/project/",
            "/project/abc",
            "/project/-1",
            "/project/%31",
            "/project/7/tasks",
            "/project/123456789012345678901",
            "/today/more",
            "/upcoming//",
            "/settings/workspace",
            "/settings/account",
        ] {
            assert!(!is_app_path(path), "{path}");
        }
    }

    /// Every path a route is registered at in main.rs, local and cloud. None
    /// is an app place, so the fallback could not answer for one even if the
    /// router let it.
    #[test]
    fn no_route_of_the_server_is_an_app_place() {
        for path in [
            "/",
            "/feedback",
            "/healthz",
            "/privacy",
            "/support",
            "/terms",
            "/auth/google",
            "/auth/google/callback",
            "/auth/signout",
            "/auth/exchange",
            "/auth/apple",
            "/auth/review",
            "/auth/dev",
            "/mcp",
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-authorization-server",
            "/oauth/register",
            "/oauth/authorize",
            "/oauth/token",
            "/api/me",
            "/api/feedback",
            "/api/account/delete",
            "/api/state",
            "/api/sync",
            "/api/entries",
            "/api/finished",
            "/api/entries/delete",
            "/api/notes",
            "/api/notes/delete",
            "/api/replicate",
            "/api/team",
            "/api/workspaces",
            "/api/live/ticket",
            "/invite/abc",
        ] {
            assert!(!is_app_path(path), "{path}");
        }
    }

    #[test]
    fn sends_back_only_to_the_apps_places() {
        for then in ["/today", "/project/7", "/notes/3", "/upcoming?task=12", "/settings/workspace/2"] {
            assert!(is_app_target(then), "{then}");
        }
        for then in [
            "/",
            "//evil.example",
            "https://evil.example/today",
            "/today?task=abc",
            "/today?task=1&next=//evil",
            "/today?then=https://evil.example",
            "/today\r\nSet-Cookie: x",
            "/today\\..\\",
            "/api/state",
            "/nope",
        ] {
            assert!(!is_app_target(then), "{then}");
        }
    }
}
