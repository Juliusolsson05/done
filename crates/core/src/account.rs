//! Which hosted account a device's file belongs to, and what becomes of the
//! file when that changes: signing out, deleting the account, or signing in
//! as someone else on the same device.
//!
//! The rules, in short:
//! - The file remembers the account it last synced with (`kv 'account'`).
//! - It never sends that account's rows to another one. A round for another
//!   account is held, and the person is asked: sign back in, or take the
//!   other account's tasks off this device. Nothing goes without being told.
//! - Leaving takes every shared workspace's rows off the device, with the
//!   member list, invites and notifications. The person's own tasks stay.
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
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Account {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub email: String,
}

impl Account {
    fn same(&self, other: &Account) -> bool {
        match (&self.id, &other.id) {
            (Some(a), Some(b)) => a == b,
            _ => !self.email.is_empty() && self.email.eq_ignore_ascii_case(&other.email),
        }
    }
}

/// Why a round was not sent: this file holds another account's tasks.
/// `rows` is how many it holds, `unsent` how many changes of it never
/// reached that account.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Held {
    pub account: Account,
    pub rows: i64,
    pub unsent: i64,
}

fn kv(conn: &Connection, key: &str) -> Result<Option<String>, Error> {
    Ok(conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn team(conn: &Connection) -> Result<Option<Value>, Error> {
    Ok(kv(conn, "team")?.and_then(|t| serde_json::from_str(&t).ok()))
}

/// The account this file's synced rows belong to. A file from before this
/// was kept has the team the server last sent, which says who it was for.
fn bound(conn: &Connection) -> Result<Option<Account>, Error> {
    if let Some(account) = kv(conn, "account")?.and_then(|a| serde_json::from_str::<Account>(&a).ok()) {
        return Ok(Some(account));
    }
    let Some(team) = team(conn)? else { return Ok(None) };
    let Some(me) = team["me"].as_str() else { return Ok(None) };
    let email = team["spaces"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|s| s["members"].as_array().into_iter().flatten())
        .find(|m| m["id"].as_str() == Some(me))
        .and_then(|m| m["email"].as_str())
        .unwrap_or_default();
    Ok(Some(Account { id: Some(me.into()), email: email.into() }))
}

fn bind(conn: &Connection, account: &Account) -> Result<(), Error> {
    let text = serde_json::to_string(account).map_err(|e| Error::Invalid(e.to_string()))?;
    conn.execute("INSERT INTO kv (key, value) VALUES ('account', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [text])?;
    Ok(())
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
             DELETE FROM tombstone; DELETE FROM space_cursor; DELETE FROM kv WHERE key IN ('team', 'account');",
        )?;
        Ok(())
    })?;
    set_meta(tx, "pulled", 0)?;
    let seq = meta(tx, "seq")?;
    set_meta(tx, "pushed", seq)?;
    tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
    Ok(())
}

impl Store {
    /// On a device: what to send as `account`. When the file holds another
    /// account's tasks, nothing: `held` says whose and how much, and the app
    /// asks. `take_over` is the person's answer to take them off this device;
    /// a file with nothing of the other account's is taken over without asking.
    pub fn outbox_for(&self, account: &Account, take_over: bool) -> Result<Outbox, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(was) = bound(&tx)? {
            if !was.same(account) {
                let (rows, unsent) = (rows(&tx)?, unsent(&tx)?);
                if !take_over && (rows > 0 || unsent > 0) {
                    return Ok(Outbox { held: Some(Held { account: was, rows, unsent }), ..Default::default() });
                }
                clear(&tx)?;
            }
        }
        let out = replica::outbox_in(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// On a device: takes in `account`'s reply, and remembers the file is
    /// that account's. A reply for an account this file is not bound to is
    /// refused whole: `outbox_for` would not have sent for it.
    pub fn inbox_for(&self, reply: &Reply, upto: i64, account: &Account) -> Result<bool, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if bound(&tx)?.is_some_and(|was| !was.same(account)) {
            return Err(Error::Invalid("This device holds another account's tasks.".into()));
        }
        let changed = replica::inbox_in(&tx, reply, upto)?;
        // The server's own word for who this is, where it says.
        let id = reply.team.as_ref().and_then(|t| t["me"].as_str()).map(String::from).or_else(|| account.id.clone());
        bind(&tx, &Account { id, email: account.email.clone() })?;
        tx.commit()?;
        Ok(changed)
    }

    /// On a device, when its account signs out (`deleted` false) or is
    /// deleted: takes every shared workspace's tasks, notes and projects off
    /// it, with who is on them, the member list, invites and notifications.
    /// The person's own rows stay.
    /// - Signed out: they stay the account's, unsent changes included, and go
    ///   up when it signs in again here.
    /// - Deleted: there is no account left. They become plain local data,
    ///   all unsent, as on a device that never signed in.
    ///
    /// Returns how many rows went. Doing it again does nothing, so a window
    /// that is not signed in runs it each time it loads.
    pub fn leave_account(&self, deleted: bool) -> Result<usize, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let team = team(&tx)?;
        if !deleted && kv(&tx, "account")?.is_none() {
            // A file from before the account was kept: written now, while
            // the team that says whose it is still here.
            if let Some(was) = bound(&tx)? {
                bind(&tx, &was)?;
            }
        }
        let mut removed = 0;
        let mut forgot = 0;
        unrecorded(&tx, || {
            removed += tx.execute("DELETE FROM task_assignee", [])?;
            // No team, no workspaces: what the server never said was shared
            // cannot be, and stays.
            if let Some(personal) = team.as_ref().and_then(|t| t["personal"].as_i64()) {
                for table in ["task", "note", "project"] {
                    removed += tx.execute(&format!("DELETE FROM {table} WHERE space_id IS NOT NULL AND space_id <> ?1"), [personal])?;
                }
                tx.execute_batch(
                    "UPDATE task SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);
                     UPDATE note SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);",
                )?;
            }
            forgot += tx.execute("DELETE FROM kv WHERE key = 'team'", [])?;
            tx.execute("DELETE FROM space_cursor", [])?;
            if deleted {
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
        if deleted {
            set_meta(&tx, "pushed", 0)?;
            set_meta(&tx, "pulled", 0)?;
        }
        if removed + forgot > 0 {
            tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
        }
        tx.commit()?;
        Ok(removed)
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
        Account { id: Some(id.into()), email: format!("{id}@hop.dev") }
    }

    /// A device as a server in another account's personal space (7) and a
    /// workspace (9) left it: one task in each, someone on the shared one,
    /// and the team.
    fn synced(s: &Store) -> (i64, i64) {
        let (mine, shared) = (s.state(TODAY).unwrap().next_id, s.state(TODAY).unwrap().next_id + 1);
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into() };
        let out = s.outbox_for(&a, false).unwrap();
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
        assert_eq!(s.leave_account(false).unwrap(), 3);
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
        s.leave_account(false).unwrap();
        let rev = s.state(TODAY).unwrap().rev;
        assert_eq!(s.leave_account(false).unwrap(), 0);
        assert_eq!(s.state(TODAY).unwrap().rev, rev);
        // And a file that never signed in has nothing to leave.
        let fresh = store();
        change(&fresh, |c| c.tasks.push(task(1, "Buy milk")));
        let rev = fresh.state(TODAY).unwrap().rev;
        assert_eq!(fresh.leave_account(false).unwrap(), 0);
        assert_eq!((fresh.state(TODAY).unwrap().rev, titles(&fresh)), (rev, vec!["Buy milk".to_string()]));
    }

    #[test]
    fn another_account_is_held_until_the_person_says() {
        let s = store();
        let (mine, _) = synced(&s);
        s.leave_account(false).unwrap();
        // Edited while signed out: not sent anywhere yet.
        change(&s, |c| c.tasks.push(task(mine, "Renew passport, edited")));
        let out = s.outbox_for(&who("1002"), false).unwrap();
        assert_eq!(out.held, Some(Held { account: Account { id: Some("1001".into()), email: "julius@hop.dev".into() }, rows: 1, unsent: 1 }));
        assert!(out.rows.is_empty());
        // A reply for the other account is not taken in either.
        assert!(s.inbox_for(&Reply::default(), 0, &who("1002")).is_err());
        assert_eq!(titles(&s), vec!["Renew passport, edited"]);
        // The same account again sends it.
        let a = Account { id: Some("1001".into()), email: "julius@hop.dev".into() };
        assert_eq!(s.outbox_for(&a, false).unwrap().rows.tasks.len(), 1);
        // Told, the person takes it off this device: an empty file for the new account.
        let out = s.outbox_for(&who("1002"), true).unwrap();
        assert!(out.held.is_none() && out.rows.is_empty());
        assert!(titles(&s).is_empty());
        s.inbox_for(&Reply::default(), out.upto, &who("1002")).unwrap();
        assert!(s.outbox_for(&who("1002"), false).unwrap().held.is_none());
    }

    #[test]
    fn a_file_from_before_the_account_was_kept_knows_it_from_the_team() {
        let s = store();
        synced(&s);
        s.conn.lock().unwrap().execute("DELETE FROM kv WHERE key = 'account'", []).unwrap();
        // The same person, from a session that kept only the email.
        assert!(s.outbox_for(&Account { id: None, email: "Julius@hop.dev".into() }, false).unwrap().held.is_none());
        assert!(s.outbox_for(&who("1002"), false).unwrap().held.is_some());
    }

    #[test]
    fn a_deleted_account_leaves_plain_local_data_that_goes_up_whole() {
        let s = store();
        synced(&s);
        s.leave_account(true).unwrap();
        let state = s.state(TODAY).unwrap();
        assert_eq!(titles(&s), vec!["Renew passport"]);
        assert!(state.tasks.iter().all(|t| t.space_id.is_none()) && state.team.is_none());
        // Signing in afterwards, as anyone, sends it as a first sign-in would.
        let out = s.outbox_for(&who("1003"), false).unwrap();
        assert!(out.held.is_none());
        assert_eq!(out.rows.tasks.iter().map(|t| t.row.title.as_str()).collect::<Vec<_>>(), vec!["Renew passport"]);
        assert_eq!(out.cursors, Some(vec![]));
    }

    #[test]
    fn a_refused_row_is_sent_again() {
        let s = store();
        let a = who("1001");
        change(&s, |c| c.tasks.push(task(1, "Inbox thing")));
        let out = s.outbox_for(&a, false).unwrap();
        let id = out.rows.tasks[0].row.id;
        let reply = Reply { refused: vec![crate::Refused { kind: "task".into(), id }], ..Default::default() };
        s.inbox_for(&reply, out.upto, &a).unwrap();
        assert_eq!(s.outbox_for(&a, false).unwrap().rows.tasks.len(), 1);
        // Taken this time: sent, and not again.
        let out = s.outbox_for(&a, false).unwrap();
        s.inbox_for(&Reply::default(), out.upto, &a).unwrap();
        assert!(s.outbox_for(&a, false).unwrap().rows.is_empty());
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
            c.projects.push(Project { id: p, name: "Home".into(), color: 0, space_id: Some(9) });
            c.tasks.push(Task { project_id: Some(p), ..task(mine, "Renew passport, edited") });
        });
        assert_eq!(s.state(TODAY).unwrap().tasks.iter().find(|t| t.id == mine).unwrap().space_id, Some(9));
    }
}
