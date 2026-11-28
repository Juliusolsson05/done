//! Which hosted account a device's file belongs to, and what becomes of the
//! file when that changes: signing out, the session ending, deleting the
//! account, or signing in as someone else on the same device.
//!
//! The rules, in short:
//! - The file remembers the account it last synced with (`kv 'account'`),
//!   and that account's personal space.
//! - It never sends that account's rows to another one. A round for another
//!   account is held, and the person is asked: sign back in, or take the
//!   other account's tasks off this device. Nothing goes without being told.
//! - Leaving takes shared workspaces' rows off the device, with the member
//!   list, invites and notifications. The person's own rows stay. Unsent
//!   workspace changes go only when the person said so (a confirmed sign-out,
//!   or deleting the account); when the session just ended they stay, and go
//!   up when the account signs in again.
//! - Leaving is marked in the file first (`kv 'leaving'`) and done after, so
//!   a crash or a reload in between finishes it on the next load. A window
//!   that loads with no mark changes nothing: the "done next" preview app,
//!   never signed in, runs on the real file.
//!
//! WHY the device holds rather than sends: a row the server has in another
//! account's space is refused (pg.rs `merge`), and a new row cannot be told
//! from an edit of one. Sending would lose them; holding never does.

use crate::replica::{self, meta, set_meta, Outbox, Reply};
use crate::{Error, Store};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A hosted account, as the app knows it from signing in. `id` is the
/// server's; a session from before ids were kept has only the email.
/// `personal` is its own space, as the file last heard it (kept here so it
/// outlives the team, which leaving removes).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Account {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personal: Option<i64>,
}

impl Account {
    fn same(&self, other: &Account) -> bool {
        match (&self.id, &other.id) {
            (Some(a), Some(b)) => a == b,
            _ => !self.email.is_empty() && self.email.eq_ignore_ascii_case(&other.email),
        }
    }
}

/// Why a round was not sent (or what waits on a signed-out device): this
/// file holds another account's tasks. `rows` is how many it holds,
/// `unsent` how many changes of it never reached that account.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Held {
    pub account: Account,
    pub rows: i64,
    pub unsent: i64,
}

/// How the account is leaving the device, weakest first.
/// - `Ended`: the session ran out or was ended by the server. Nobody was
///   asked, so nothing unsent goes.
/// - `SignedOut`: the person signed out, told of anything unsent.
/// - `Deleted`: the account is being (or was) deleted.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Leaving {
    Ended,
    /// Asked the server to delete the account, no answer yet. Finished as
    /// `Ended`: a deletion counts only once the server confirmed it.
    Deleting,
    SignedOut,
    Deleted,
}

/// A leaving mark and the app that wrote it: an id kept in that app's own web
/// storage. Another app on the same file (the "done next" preview) has
/// another id and never finishes it. A mark from before owners (a bare
/// string) has none, and is finished by any app, as it was.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Mark {
    how: Leaving,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    by: Option<String>,
}

/// What leaving did: how, how many rows went, how many changes are still
/// waiting to be sent when the account signs in again.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Left {
    pub how: Leaving,
    pub removed: usize,
    pub kept: i64,
}

fn kv(conn: &Connection, key: &str) -> Result<Option<String>, Error> {
    Ok(conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn set_kv(conn: &Connection, key: &str, value: &str) -> Result<(), Error> {
    conn.execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])?;
    Ok(())
}

fn team(conn: &Connection) -> Result<Option<Value>, Error> {
    Ok(kv(conn, "team")?.and_then(|t| serde_json::from_str(&t).ok()))
}

/// The account this file's synced rows belong to. A file from before this
/// was kept has the team the server last sent, which says who it was for.
pub(crate) fn bound(conn: &Connection) -> Result<Option<Account>, Error> {
    let team = team(conn)?;
    let personal = team.as_ref().and_then(|t| t["personal"].as_i64());
    if let Some(account) = kv(conn, "account")?.and_then(|a| serde_json::from_str::<Account>(&a).ok()) {
        return Ok(Some(Account { personal: account.personal.or(personal), ..account }));
    }
    let Some(team) = team else { return Ok(None) };
    let Some(me) = team["me"].as_str() else { return Ok(None) };
    let email = team["spaces"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|s| s["members"].as_array().into_iter().flatten())
        .find(|m| m["id"].as_str() == Some(me))
        .and_then(|m| m["email"].as_str())
        .unwrap_or_default();
    Ok(Some(Account { id: Some(me.into()), email: email.into(), personal }))
}

fn bind(conn: &Connection, account: &Account) -> Result<(), Error> {
    set_kv(conn, "account", &serde_json::to_string(account).map_err(|e| Error::Invalid(e.to_string()))?)
}

fn marked(conn: &Connection) -> Result<Option<Mark>, Error> {
    let Some(text) = kv(conn, "leaving")? else { return Ok(None) };
    Ok(serde_json::from_str::<Mark>(&text).ok().or_else(|| serde_json::from_str::<Leaving>(&text).ok().map(|how| Mark { how, by: None })))
}

/// The mark, if `by` wrote it (or nobody is known to have).
fn own(conn: &Connection, by: Option<&str>) -> Result<Option<Mark>, Error> {
    Ok(marked(conn)?.filter(|m| m.by.is_none() || m.by.as_deref() == by))
}

fn count(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<i64, Error> {
    Ok(conn.query_row(sql, p, |r| r.get(0))?)
}

/// Changes written here that have not reached the server: rows, who is on
/// a task, and deletions.
fn unsent(conn: &Connection) -> Result<i64, Error> {
    let pushed = meta(conn, "pushed")?;
    let mut n = 0;
    for table in ["project", "task", "note", "entry", "task_assignee", "tombstone"] {
        n += count(conn, &format!("SELECT COUNT(*) FROM {table} WHERE seq > ?1"), [pushed])?;
    }
    Ok(n)
}

fn rows(conn: &Connection) -> Result<i64, Error> {
    let mut n = 0;
    for table in ["project", "task", "note", "entry"] {
        n += count(conn, &format!("SELECT COUNT(*) FROM {table}"), [])?;
    }
    Ok(n)
}

/// Runs `f` with the triggers told this is not an edit made here: nothing is
/// counted as a change to send, no time is stamped, no tombstone is left.
fn unrecorded(tx: &Transaction, f: impl FnOnce() -> Result<(), Error>) -> Result<(), Error> {
    tx.execute("UPDATE meta SET value = 1 WHERE key IN ('quiet', 'applying')", [])?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    f()?;
    tx.execute("UPDATE meta SET value = 0 WHERE key IN ('quiet', 'applying')", [])?;
    Ok(())
}

/// Empties the file of everything synced, as if it never had been: for
/// another account to start on.
fn clear(tx: &Transaction) -> Result<(), Error> {
    unrecorded(tx, || {
        tx.execute_batch(
            "DELETE FROM task_assignee; DELETE FROM entry; DELETE FROM task; DELETE FROM note; DELETE FROM project;
             DELETE FROM tombstone; DELETE FROM space_cursor; DELETE FROM kv WHERE key IN ('team', 'account', 'leaving', 'refused');",
        )?;
        Ok(())
    })?;
    set_meta(tx, "pulled", 0)?;
    let seq = meta(tx, "seq")?;
    set_meta(tx, "pushed", seq)?;
    tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
    Ok(())
}

/// Rows in `space` become this device's own again: no space, and unsent, so
/// the next round sends them as new (for the account made again, which has
/// a new space and nothing of the old one). The time sheet, always one's
/// own, goes up again too.
fn make_local(tx: &Transaction, space: i64) -> Result<(), Error> {
    unrecorded(tx, || {
        tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'seq'", [])?;
        let now = "(SELECT value FROM meta WHERE key = 'seq')";
        tx.execute(&format!("UPDATE project SET space_id = NULL, seq = {now}, sprint_needs_refresh = 0 WHERE space_id = ?1"), [space])?;
        for table in ["task", "note"] {
            tx.execute(&format!("UPDATE {table} SET space_id = NULL, seq = {now} WHERE space_id = ?1"), [space])?;
        }
        tx.execute(&format!("UPDATE entry SET seq = {now}"), [])?;
        Ok(())
    })?;
    tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
    Ok(())
}

/// Takes the account off the device (see `Leaving`). Returns how many rows went.
fn leave_in(tx: &Transaction, how: Leaving) -> Result<usize, Error> {
    let was = bound(tx)?;
    let personal = was.as_ref().and_then(|a| a.personal);
    if how != Leaving::Deleted {
        // Kept, with its space, past the team: signing in again carries on,
        // and another account is held.
        if let Some(was) = &was {
            bind(tx, was)?;
        }
    }
    // Rows the account refused twice go once more when it signs in again.
    replica::release_local_only(tx)?;
    let pushed = meta(tx, "pushed")?;
    let mut removed = 0;
    let mut forgot = 0;
    unrecorded(tx, || {
        // No personal space known, no workspaces: what the server never said
        // was shared cannot be, and stays.
        if let Some(personal) = personal {
            let shared = "space_id IS NOT NULL AND space_id <> ?1";
            if how == Leaving::Ended {
                // Only what reached the server. A task stays while a subtask
                // of it is unsent, and a project while anything left is in it.
                removed += tx.execute(
                    &format!("DELETE FROM task WHERE {shared} AND seq <= ?2 AND id NOT IN (SELECT parent_id FROM task WHERE parent_id IS NOT NULL AND seq > ?2)"),
                    [personal, pushed],
                )?;
                removed += tx.execute(&format!("DELETE FROM note WHERE {shared} AND seq <= ?2"), [personal, pushed])?;
                removed += tx.execute(
                    &format!(
                        "DELETE FROM project WHERE {shared} AND seq <= ?2
                           AND id NOT IN (SELECT project_id FROM task WHERE project_id IS NOT NULL)
                           AND id NOT IN (SELECT project_id FROM note WHERE project_id IS NOT NULL)"
                    ),
                    [personal, pushed],
                )?;
            } else {
                for table in ["task", "note", "project"] {
                    removed += tx.execute(&format!("DELETE FROM {table} WHERE {shared}"), [personal])?;
                }
            }
            tx.execute_batch(
                "UPDATE task SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);
                 UPDATE note SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);",
            )?;
        }
        removed += if how == Leaving::Ended {
            tx.execute("DELETE FROM task_assignee WHERE seq <= ?1 OR task_id NOT IN (SELECT id FROM task)", [pushed])?
        } else {
            tx.execute("DELETE FROM task_assignee", [])?
        };
        forgot += tx.execute("DELETE FROM kv WHERE key IN ('team', 'refused')", [])?;
        // Read again from the start when signed in again: what went must come back.
        tx.execute("DELETE FROM space_cursor", [])?;
        if how == Leaving::Deleted {
            forgot += tx.execute("DELETE FROM kv WHERE key = 'account'", [])?;
            for table in ["task", "note", "project"] {
                forgot += tx.execute(&format!("UPDATE {table} SET space_id = NULL WHERE space_id IS NOT NULL"), [])?;
            }
            forgot += tx.execute("DELETE FROM tombstone", [])?;
            // Rows taken in from the server are at 0; everything counts
            // as written here and not yet sent.
            for table in ["project", "task", "note", "entry"] {
                forgot += tx.execute(&format!("UPDATE {table} SET seq = 1 WHERE seq < 1"), [])?;
            }
        }
        Ok(())
    })?;
    if how == Leaving::Deleted {
        set_meta(tx, "pushed", 0)?;
        set_meta(tx, "pulled", 0)?;
    }
    if removed + forgot > 0 {
        tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
    }
    Ok(removed)
}

impl Store {
    /// On a device: what to send as `account`. When the file holds another
    /// account's tasks, nothing: `held` says whose and how much, and the app
    /// asks (see `take_over`). A file with nothing of the other account's is
    /// taken over without asking.
    pub fn outbox_for(&self, account: &Account) -> Result<Outbox, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(was) = bound(&tx)? {
            if !was.same(account) {
                let (rows, unsent) = (rows(&tx)?, unsent(&tx)?);
                if rows > 0 || unsent > 0 {
                    return Ok(Outbox { held: Some(Held { account: was, rows, unsent }), ..Default::default() });
                }
                clear(&tx)?;
            }
        }
        let out = replica::outbox_in(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// The person's answer to a held round: take the other account's tasks
    /// off this device and make it `account`'s. Done, and the file bound to
    /// `account`, in one step before anything is sent, so the answer holds
    /// whatever becomes of the round after it.
    pub fn take_over(&self, account: &Account) -> Result<(), Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        clear(&tx)?;
        bind(&tx, &Account { personal: None, ..account.clone() })?;
        tx.commit()?;
        Ok(())
    }

    /// On a device: takes in `account`'s reply, and remembers the file is
    /// that account's. A reply for an account this file is not bound to is
    /// refused whole: `outbox_for` would not have sent for it.
    pub fn inbox_for(&self, reply: &Reply, upto: i64, account: &Account) -> Result<bool, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let was = bound(&tx)?;
        if was.as_ref().is_some_and(|was| !was.same(account)) {
            return Err(Error::Invalid("This device holds another account's tasks.".into()));
        }
        let personal = reply.team.as_ref().and_then(|t| t["personal"].as_i64());
        // The same account with a new own space: it was deleted and made
        // again with the same sign-in. The old space is gone from the server
        // and is not listed, so its rows would be dropped as a space one has
        // left; they are this device's own and go up again instead.
        let mut moved = false;
        if let (Some(old), Some(new)) = (was.as_ref().and_then(|a| a.personal), personal) {
            if old != new {
                make_local(&tx, old)?;
                moved = true;
            }
        }
        let changed = replica::inbox_in(&tx, reply, upto)?;
        // The server's own word for who this is, where it says.
        let id = reply.team.as_ref().and_then(|t| t["me"].as_str()).map(String::from).or_else(|| account.id.clone());
        bind(&tx, &Account { id, email: account.email.clone(), personal: personal.or(was.and_then(|a| a.personal)) })?;
        // Signed in and answered: whatever leaving was marked did not happen
        // (a deletion that never reached the server, say).
        tx.execute("DELETE FROM kv WHERE key = 'leaving'", [])?;
        tx.commit()?;
        Ok(changed || moved)
    }

    /// Marks that the account is leaving this device, before the steps that
    /// take it away (forgetting the session, the server's deletion), so a
    /// reload or a crash in between ends in `finish_leaving` on the next
    /// load. A weaker mark never replaces a stronger one: a session ending
    /// during a deletion is still a deletion. `None` takes the mark away (a
    /// deletion the server refused).
    /// `by` is the app writing it (see `Mark`).
    pub fn mark_leaving(&self, how: Option<Leaving>, by: Option<&str>) -> Result<(), Error> {
        let conn = self.conn.lock().unwrap();
        match how {
            None => {
                conn.execute("DELETE FROM kv WHERE key = 'leaving'", [])?;
            }
            Some(how) => {
                if marked(&conn)?.is_none_or(|was| how > was.how) {
                    let mark = Mark { how, by: by.map(String::from) };
                    set_kv(&conn, "leaving", &serde_json::to_string(&mark).map_err(|e| Error::Invalid(e.to_string()))?)?;
                }
            }
        }
        Ok(())
    }

    /// Does what `by` marked, and takes the mark away, in one step. With no
    /// mark of its own, nothing: a window that loads signed out changes
    /// nothing, and one app never finishes another's mark.
    pub fn finish_leaving(&self, by: Option<&str>) -> Result<Option<Left>, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(mark) = own(&tx, by)? else { return Ok(None) };
        // Not confirmed by the server: a session that ended.
        let how = if mark.how == Leaving::Deleting { Leaving::Ended } else { mark.how };
        let removed = leave_in(&tx, how)?;
        tx.execute("DELETE FROM kv WHERE key = 'leaving'", [])?;
        let kept = if how == Leaving::Deleted { 0 } else { unsent(&tx)? };
        tx.commit()?;
        Ok(Some(Left { how, removed, kept }))
    }

    /// A signed-in app starting: its own mark, left by a crash or a reload
    /// before leaving was done, for it to complete (sign out, finish). A
    /// deletion the server never confirmed is taken back instead, and so
    /// gives nothing: the account may well be there.
    pub fn own_mark(&self, by: Option<&str>) -> Result<Option<Leaving>, Error> {
        let conn = self.conn.lock().unwrap();
        Ok(match own(&conn, by)? {
            Some(mark) if mark.how == Leaving::Deleting => {
                conn.execute("DELETE FROM kv WHERE key = 'leaving'", [])?;
                None
            }
            mark => mark.map(|m| m.how),
        })
    }

    /// `mark_leaving` and `finish_leaving` at once, by no app in particular.
    pub fn leave_account(&self, how: Leaving) -> Result<Left, Error> {
        self.mark_leaving(Some(how), None)?;
        Ok(self.finish_leaving(None)?.expect("just marked"))
    }

    /// On a device that is not signed in: the account its changes wait for,
    /// when some are unsent. Shown so the person knows to sign in again.
    pub fn waiting(&self) -> Result<Option<Held>, Error> {
        let conn = self.conn.lock().unwrap();
        let unsent = unsent(&conn)?;
        Ok(match bound(&conn)? {
            Some(account) if unsent > 0 => Some(Held { account, rows: rows(&conn)?, unsent }),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Change, Project, Task};
    use serde_json::json;
    use std::path::Path;

    const TODAY: &str = "2026-11-27";

    fn store() -> Store {
        Store::open(Path::new(":memory:")).unwrap()
    }

    fn task(id: i64, title: &str) -> Task {
        serde_json::from_value(json!({ "id": id, "title": title })).unwrap()
    }

    fn change(s: &Store, f: impl FnOnce(&mut Change)) {
        let mut c = Change { rev: s.state(TODAY).unwrap().rev, ..Default::default() };
        f(&mut c);
        s.sync(c).unwrap();
    }

    fn titles(s: &Store) -> Vec<String> {
        let mut t: Vec<String> = s.state(TODAY).unwrap().tasks.into_iter().map(|t| t.title).collect();
        t.sort();
        t
    }

    fn who(id: &str) -> Account {
        Account { id: Some(id.into()), email: format!("{id}@hop.dev"), personal: None }
    }

    /// A device as a server in another account's personal space (7) and a
    /// workspace (9) left it: one task in each, someone on the shared one,
    /// and the team.
    fn synced(s: &Store) -> (i64, i64) {
        let (mine, shared) = (s.state(TODAY).unwrap().next_id, s.state(TODAY).unwrap().next_id + 1);
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into(), personal: None };
        let out = s.outbox_for(&a).unwrap();
        let reply: Reply = serde_json::from_value(json!({
            "upto": 3,
            "rows": {
                "projects": [{ "id": shared + 10, "name": "Launch", "color": 1, "spaceId": 9, "changed": 1 }],
                "tasks": [
                    { "id": mine, "title": "Renew passport", "spaceId": 7, "changed": 1 },
                    { "id": shared, "title": "Ship the site", "projectId": shared + 10, "spaceId": 9, "changed": 1 }
                ],
                "assignees": [{ "taskId": shared, "accountId": "1002", "on": true, "spaceId": 9, "changed": 1 }]
            },
            "spaces": [{ "space": 7, "at": 3 }, { "space": 9, "at": 2 }],
            "team": { "me": "1001", "personal": 7, "spaces": [
                { "id": 7, "kind": "personal", "members": [{ "id": "1001", "email": "julius@hop.dev", "name": "Julius" }] },
                { "id": 9, "kind": "workspace", "name": "Hop", "members": [{ "id": "1002", "email": "geart@hop.dev", "name": "Geart" }] }
            ], "notifications": [] }
        }))
        .unwrap();
        s.inbox_for(&reply, out.upto, &a).unwrap();
        (mine, shared)
    }

    #[test]
    fn signing_out_takes_the_workspace_off_and_keeps_one_s_own() {
        let s = store();
        synced(&s);
        let rev = s.state(TODAY).unwrap().rev;
        assert_eq!(s.leave_account(Leaving::SignedOut).unwrap().removed, 3);
        let state = s.state(TODAY).unwrap();
        assert_eq!(titles(&s), vec!["Renew passport"]);
        assert!(state.projects.is_empty() && state.team.is_none() && state.rev > rev);
        let conn = s.conn.lock().unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM task_assignee", []).unwrap(), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM space_cursor", []).unwrap(), 0);
        // Still the account's: signing in as it again carries on.
        assert_eq!(bound(&conn).unwrap().and_then(|a| a.id).as_deref(), Some("1001"));
    }

    #[test]
    fn leaving_again_changes_nothing() {
        let s = store();
        synced(&s);
        s.leave_account(Leaving::SignedOut).unwrap();
        let rev = s.state(TODAY).unwrap().rev;
        assert_eq!(s.leave_account(Leaving::SignedOut).unwrap().removed, 0);
        assert_eq!(s.state(TODAY).unwrap().rev, rev);
        // And a file that never signed in has nothing to leave.
        let fresh = store();
        change(&fresh, |c| c.tasks.push(task(1, "Buy milk")));
        let rev = fresh.state(TODAY).unwrap().rev;
        assert_eq!(fresh.finish_leaving(None).unwrap(), None);
        assert_eq!((fresh.state(TODAY).unwrap().rev, titles(&fresh)), (rev, vec!["Buy milk".to_string()]));
    }

    #[test]
    fn another_account_is_held_until_the_person_says() {
        let s = store();
        let (mine, _) = synced(&s);
        s.leave_account(Leaving::SignedOut).unwrap();
        // Edited while signed out: not sent anywhere yet.
        change(&s, |c| c.tasks.push(task(mine, "Renew passport, edited")));
        let out = s.outbox_for(&who("1002")).unwrap();
        assert_eq!(out.held, Some(Held { account: Account { id: Some("1001".into()), email: "julius@hop.dev".into(), personal: Some(7) }, rows: 1, unsent: 1 }));
        assert!(out.rows.is_empty());
        // A reply for the other account is not taken in either.
        assert!(s.inbox_for(&Reply::default(), 0, &who("1002")).is_err());
        assert_eq!(titles(&s), vec!["Renew passport, edited"]);
        // The same account again sends it.
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into(), personal: None };
        assert_eq!(s.outbox_for(&a).unwrap().rows.tasks.len(), 1);
        // Told, the person takes it off this device: an empty file for the new account.
        s.take_over(&who("1002")).unwrap();
        let out = s.outbox_for(&who("1002")).unwrap();
        assert!(out.held.is_none() && out.rows.is_empty());
        assert!(titles(&s).is_empty());
        s.inbox_for(&Reply::default(), out.upto, &who("1002")).unwrap();
        assert!(s.outbox_for(&who("1002")).unwrap().held.is_none());
    }

    #[test]
    fn a_file_from_before_the_account_was_kept_knows_it_from_the_team() {
        let s = store();
        synced(&s);
        s.conn.lock().unwrap().execute("DELETE FROM kv WHERE key = 'account'", []).unwrap();
        // The same person, from a session that kept only the email.
        assert!(s.outbox_for(&Account { id: None, email: "Julius@hop.dev".into(), personal: None }).unwrap().held.is_none());
        assert!(s.outbox_for(&who("1002")).unwrap().held.is_some());
    }

    #[test]
    fn a_deleted_account_leaves_plain_local_data_that_goes_up_whole() {
        let s = store();
        synced(&s);
        s.leave_account(Leaving::Deleted).unwrap();
        let state = s.state(TODAY).unwrap();
        assert_eq!(titles(&s), vec!["Renew passport"]);
        assert!(state.tasks.iter().all(|t| t.space_id.is_none()) && state.team.is_none());
        // Signing in afterwards, as anyone, sends it as a first sign-in would.
        let out = s.outbox_for(&who("1003")).unwrap();
        assert!(out.held.is_none());
        assert_eq!(out.rows.tasks.iter().map(|t| t.row.title.as_str()).collect::<Vec<_>>(), vec!["Renew passport"]);
        assert_eq!(out.cursors, Some(vec![]));
    }

    // Review of #112, 1: the session ended (401): nobody was asked, so what
    // is unsent stays, with what it needs (its project), and the rest goes.
    #[test]
    fn a_session_that_ended_takes_only_what_was_sent() {
        let s = store();
        let (_, shared) = synced(&s);
        change(&s, |c| c.tasks.push(Task { project_id: Some(shared + 10), ..task(shared, "Ship the site, edited") }));
        s.mark_leaving(Some(Leaving::Ended), None).unwrap();
        let left = s.finish_leaving(None).unwrap().unwrap();
        assert_eq!((left.how, left.kept), (Leaving::Ended, 1));
        assert_eq!(titles(&s), vec!["Renew passport", "Ship the site, edited"]);
        let state = s.state(TODAY).unwrap();
        assert_eq!(state.projects.len(), 1);
        assert!(state.team.is_none());
        // Waiting for the account, and nobody else gets it.
        assert_eq!(s.waiting().unwrap().map(|h| (h.account.id, h.unsent)), Some((Some("1001".into()), 1)));
        assert!(s.outbox_for(&who("1002")).unwrap().held.is_some());
        // The account signs in again: it goes.
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into(), personal: None };
        assert_eq!(s.outbox_for(&a).unwrap().rows.tasks.len(), 1);
    }

    // Review of #112, 1 and 5: only a mark leads to leaving, a weaker mark
    // never replaces a stronger one, and the mark goes once done.
    #[test]
    fn leaving_happens_only_where_it_was_marked() {
        let s = store();
        synced(&s);
        // A window that loads signed out, with no mark ("done next"): nothing.
        let rev = s.state(TODAY).unwrap().rev;
        assert_eq!(s.finish_leaving(None).unwrap(), None);
        assert_eq!(s.state(TODAY).unwrap().rev, rev);
        assert!(s.state(TODAY).unwrap().team.is_some());
        // Deleting, then the session ends before the clean-up: still a deletion.
        s.mark_leaving(Some(Leaving::Deleted), None).unwrap();
        s.mark_leaving(Some(Leaving::Ended), None).unwrap();
        assert_eq!(s.finish_leaving(None).unwrap().map(|l| l.how), Some(Leaving::Deleted));
        assert_eq!(s.finish_leaving(None).unwrap(), None);
        // A deletion the server refused takes its mark back.
        s.mark_leaving(Some(Leaving::Deleted), None).unwrap();
        s.mark_leaving(None, None).unwrap();
        assert_eq!(s.finish_leaving(None).unwrap(), None);
    }

    #[test]
    fn a_round_that_was_answered_takes_a_stale_mark_away() {
        let s = store();
        let a = who("1001");
        s.mark_leaving(Some(Leaving::Deleted), None).unwrap();
        let out = s.outbox_for(&a).unwrap();
        s.inbox_for(&Reply::default(), out.upto, &a).unwrap();
        assert_eq!(s.finish_leaving(None).unwrap(), None);
    }

    // Review of #112, 3.
    #[test]
    fn a_row_refused_twice_is_kept_here_only() {
        let s = store();
        let (mine, _) = synced(&s);
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into(), personal: None };
        change(&s, |c| c.tasks.push(task(mine, "Renew passport, edited")));
        let refused = Reply { refused: vec![crate::Refused { kind: "task".into(), id: mine }], ..Default::default() };
        for _ in 0..2 {
            let out = s.outbox_for(&a).unwrap();
            assert_eq!(out.rows.tasks.len(), 1);
            s.inbox_for(&refused, out.upto, &a).unwrap();
        }
        assert!(s.outbox_for(&a).unwrap().rows.is_empty());
        assert!(s.waiting().unwrap().is_none());
        let t = s.state(TODAY).unwrap().tasks.into_iter().find(|t| t.id == mine).unwrap();
        assert_eq!((t.title.as_str(), t.space_id), ("Renew passport, edited", None));
        // The window is told it is only here (issue #120, A).
        assert_eq!(s.state(TODAY).unwrap().local_only, vec![mine]);
        // The session ends and the account signs in again: it goes once more,
        // and twice at most.
        s.leave_account(Leaving::Ended).unwrap();
        for _ in 0..2 {
            let out = s.outbox_for(&a).unwrap();
            assert_eq!(out.rows.tasks.len(), 1);
            s.inbox_for(&refused, out.upto, &a).unwrap();
        }
        assert!(s.outbox_for(&a).unwrap().rows.is_empty());
        assert_eq!(s.state(TODAY).unwrap().local_only, vec![mine]);
        // Taken this time: no longer only here.
        s.leave_account(Leaving::Ended).unwrap();
        let out = s.outbox_for(&a).unwrap();
        s.inbox_for(&Reply::default(), out.upto, &a).unwrap();
        assert!(s.state(TODAY).unwrap().local_only.is_empty());
        assert!(s.outbox_for(&a).unwrap().rows.is_empty());
    }

    // Issue #120, E: kept to be sent, but not for the Home Screen.
    #[test]
    fn workspace_tasks_kept_after_a_session_ended_are_withheld_from_widgets() {
        let s = store();
        let (mine, shared) = synced(&s);
        assert!(s.state(TODAY).unwrap().withheld.is_empty());
        change(&s, |c| c.tasks.push(Task { project_id: Some(shared + 10), ..task(shared, "Ship the site, edited") }));
        s.leave_account(Leaving::Ended).unwrap();
        let state = s.state(TODAY).unwrap();
        assert_eq!(state.withheld, vec![shared]);
        assert!(state.tasks.iter().any(|t| t.id == mine) && state.tasks.iter().any(|t| t.id == shared));
    }

    // Issue #120, B: a signed-in app completes its own mark when it starts,
    // and takes back a deletion that was never confirmed.
    #[test]
    fn a_signed_in_app_finds_its_own_mark_only() {
        let s = store();
        mark_by(&s, Leaving::SignedOut, "real");
        assert_eq!(s.own_mark(Some("next")).unwrap(), None);
        assert_eq!(s.own_mark(Some("real")).unwrap(), Some(Leaving::SignedOut));
        s.mark_leaving(None, None).unwrap();
        mark_by(&s, Leaving::Deleting, "real");
        assert_eq!(s.own_mark(Some("real")).unwrap(), None);
        assert_eq!(load_by(&s, "real"), None);
        // A mark from before owners: anyone's.
        s.conn.lock().unwrap().execute("INSERT INTO kv (key, value) VALUES ('leaving', '\"signed-out\"')", []).unwrap();
        assert_eq!(load_by(&s, "next").map(|l| l.how), Some(Leaving::SignedOut));
    }

    #[test]
    fn a_refused_row_is_sent_again() {
        let s = store();
        let a = who("1001");
        change(&s, |c| c.tasks.push(task(1, "Inbox thing")));
        let out = s.outbox_for(&a).unwrap();
        let id = out.rows.tasks[0].row.id;
        let reply = Reply { refused: vec![crate::Refused { kind: "task".into(), id }], ..Default::default() };
        s.inbox_for(&reply, out.upto, &a).unwrap();
        assert_eq!(s.outbox_for(&a).unwrap().rows.tasks.len(), 1);
        // Taken this time: sent, and not again.
        let out = s.outbox_for(&a).unwrap();
        s.inbox_for(&Reply::default(), out.upto, &a).unwrap();
        assert!(s.outbox_for(&a).unwrap().rows.is_empty());
    }

    // Editing a task with no project took away the space the server gave it,
    // so the edit could never be placed (audit F1).
    #[test]
    fn an_inbox_task_keeps_its_space_when_edited() {
        let s = store();
        let (mine, _) = synced(&s);
        change(&s, |c| c.tasks.push(task(mine, "Renew passport, edited")));
        assert_eq!(s.state(TODAY).unwrap().tasks.iter().find(|t| t.id == mine).unwrap().space_id, Some(7));
        // Into a project of another space it follows the project, as on the server.
        let p = s.state(TODAY).unwrap().next_id;
        change(&s, |c| {
            c.projects.push(Project { id: p, name: "Home".into(), color: 0, space_id: Some(9), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(mine, "Renew passport, edited") });
        });
        assert_eq!(s.state(TODAY).unwrap().tasks.iter().find(|t| t.id == mine).unwrap().space_id, Some(9));
    }

    /// The app with this window's storage writes a mark (issue #120, B).
    fn mark_by(s: &Store, how: Leaving, by: &str) {
        s.mark_leaving(Some(how), Some(by)).unwrap();
    }

    /// A window that is not signed in loads, with this storage.
    fn load_by(s: &Store, by: &str) -> Option<Left> {
        s.finish_leaving(Some(by)).unwrap()
    }

    /// Asked to delete, before the server answered (issue #120, C).
    fn before_deleting(s: &Store, by: &str) {
        mark_by(s, Leaving::Deleting, by);
    }

    // Issue #120, B: the real app writes a mark and crashes before it signs
    // out; the "done next" preview, never signed in, opens the same file.
    #[test]
    fn a_mark_is_finished_only_by_the_app_that_wrote_it() {
        let s = store();
        synced(&s);
        mark_by(&s, Leaving::SignedOut, "real");
        assert_eq!(load_by(&s, "next"), None);
        assert!(s.state(TODAY).unwrap().team.is_some());
        assert_eq!(load_by(&s, "real").map(|l| l.how), Some(Leaving::SignedOut));
        assert!(s.state(TODAY).unwrap().team.is_none());
    }

    // Issue #120, C: a deletion the server never confirmed is not finished as
    // one: the session ended meanwhile, so nothing unsent goes and the file
    // stays the account's.
    #[test]
    fn a_deletion_not_confirmed_is_never_finished_as_one() {
        let s = store();
        let (_, shared) = synced(&s);
        change(&s, |c| c.tasks.push(Task { project_id: Some(shared + 10), ..task(shared, "Ship the site, edited") }));
        before_deleting(&s, "real");
        mark_by(&s, Leaving::Ended, "real");
        load_by(&s, "real").unwrap();
        assert_eq!(titles(&s), vec!["Renew passport", "Ship the site, edited"]);
        let conn = s.conn.lock().unwrap();
        assert_eq!(bound(&conn).unwrap().and_then(|a| a.id).as_deref(), Some("1001"));
    }
}
