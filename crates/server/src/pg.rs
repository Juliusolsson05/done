//! Every account's and every workspace's tasks, in one Postgres database.
//!
//! Rows live in spaces. Each account has its own space, and a workspace is a
//! space several accounts are members of. Whoever asks, the server decides:
//! - which spaces they are in (`spaces_of`, on every request; nothing else
//!   reaches a row),
//! - which space a row they send lives in (`merge`): a project where it was
//!   made, a task in its parent's or its project's space, a note in its
//!   project's or the one it was written in, a time sheet entry always in
//!   its writer's own. What a device says about a row's space is a wish for
//!   a new row and ignored for an existing one,
//! - and that every row a row points at is in the same space.
//!
//! A space has one counter. Every write to a row in it takes the next value
//! as the row's `seq`, and a device asks for each of its spaces "what has a
//! `seq` above the one I last saw". Writers take the counter under the
//! space's row lock, held to commit, so a space's rows become visible in the
//! order of their `seq` and a reader never skips one.
//!
//! The rules about what a valid task is are done-core's, shared with the apps.

use deadpool_postgres::{Client, GenericClient, Manager, ManagerConfig, Pool, RecyclingMethod, Transaction};
use done_core::{
    check, check_entry, check_project, clean_folder, is_day, Assign, Assignee, Change, Cursor, Entry, Gone, NewEntry, Note, Outbox, Project, Refused, Reply, Rows,
    SaveNote, Stamped, State, Task,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_postgres::NoTls;

/// What can go wrong.
#[derive(Debug)]
pub enum Fail {
    /// What was asked breaks a rule; the text says which, for the person.
    Invalid(String),
    TooManyRequests(String),
    /// There is no such thing, or it is not yours to see: the same answer
    /// for both, so an id cannot be probed.
    NotFound,
    /// The database could not be reached or said no.
    Down(String),
}

impl From<tokio_postgres::Error> for Fail {
    fn from(e: tokio_postgres::Error) -> Self {
        Fail::Down(e.to_string())
    }
}

impl From<deadpool_postgres::PoolError> for Fail {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        Fail::Down(e.to_string())
    }
}

fn invalid<T>(why: &str) -> Result<T, Fail> {
    Err(Fail::Invalid(why.into()))
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// An id no device is likely to pick: as done-core's `fresh_id`, the time
/// times 1000 plus a random part.
pub fn fresh_id() -> i64 {
    now_ms() * 1000 + (rand::random::<u32>() % 1000) as i64
}

/// A change stamped further ahead than this is a device with a wrong clock;
/// it is taken as made now, so it cannot win every comparison for years.
const AHEAD: i64 = 24 * 60 * 60 * 1000;

/// Limits that keep one account from filling the database. Not a price plan.
pub const WORKSPACES: i64 = 10;
pub const MEMBERS: i64 = 50;
pub const INVITES_A_DAY: i64 = 20;
pub const PENDING: i64 = 50;
const WEEK: i64 = 7 * 24 * 60 * 60 * 1000;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL);
ALTER TABLE account ADD COLUMN IF NOT EXISTS session_generation BIGINT;
CREATE SEQUENCE IF NOT EXISTS account_generation_seq;
ALTER TABLE account ALTER COLUMN session_generation SET DEFAULT nextval('account_generation_seq');
CREATE INDEX IF NOT EXISTS account_email ON account (lower(email));
CREATE TABLE IF NOT EXISTS apple_refresh_grant (
  account_id TEXT PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  sealed BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bug','idea')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_account_created ON feedback (account_id, created);
CREATE TABLE IF NOT EXISTS space (
  id BIGINT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL,
  created BIGINT NOT NULL, next_seq BIGINT NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_personal_space ON space (owner_id) WHERE kind = 'personal';
CREATE TABLE IF NOT EXISTS member (
  space_id BIGINT NOT NULL REFERENCES space(id) ON DELETE CASCADE, account_id TEXT NOT NULL, role TEXT NOT NULL,
  joined BIGINT NOT NULL, PRIMARY KEY (space_id, account_id));
CREATE INDEX IF NOT EXISTS member_account ON member (account_id);
CREATE TABLE IF NOT EXISTS invite (
  id BIGINT PRIMARY KEY, space_id BIGINT NOT NULL REFERENCES space(id) ON DELETE CASCADE, email TEXT NOT NULL,
  invited_by TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires BIGINT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  created BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS invite_email ON invite (email) WHERE state = 'pending';
CREATE TABLE IF NOT EXISTS notification (
  id BIGINT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, space_id BIGINT, task_id BIGINT,
  by_account TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, read_at BIGINT);
CREATE INDEX IF NOT EXISTS notification_account ON notification (account_id, created DESC);
CREATE TABLE IF NOT EXISTS project (
  id BIGINT PRIMARY KEY, space_id BIGINT NOT NULL, name TEXT NOT NULL, color BIGINT NOT NULL DEFAULT 0,
  changed BIGINT NOT NULL, seq BIGINT NOT NULL);
ALTER TABLE project ADD COLUMN IF NOT EXISTS sprint TEXT;
CREATE TABLE IF NOT EXISTS task (
  id BIGINT PRIMARY KEY, space_id BIGINT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', project_id BIGINT,
  start TEXT, due TEXT, priority BIGINT NOT NULL DEFAULT 4, status TEXT, done_day TEXT, goal_day TEXT, goal_by TEXT,
  parent_id BIGINT, created_by TEXT NOT NULL DEFAULT '', changed BIGINT NOT NULL, seq BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS task_assignee (
  task_id BIGINT NOT NULL, account_id TEXT NOT NULL, space_id BIGINT NOT NULL, is_on BOOLEAN NOT NULL,
  changed BIGINT NOT NULL, seq BIGINT NOT NULL, PRIMARY KEY (task_id, account_id));
CREATE TABLE IF NOT EXISTS note (
  id BIGINT PRIMARY KEY, space_id BIGINT NOT NULL, text TEXT NOT NULL, updated_at BIGINT NOT NULL, project_id BIGINT,
  folder TEXT, ydoc BYTEA, changed BIGINT NOT NULL, seq BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS entry (
  id BIGINT PRIMARY KEY, space_id BIGINT NOT NULL, task_id BIGINT, title TEXT NOT NULL, day TEXT NOT NULL,
  started_at BIGINT NOT NULL, ended_at BIGINT NOT NULL, planned_ms BIGINT NOT NULL, focused_ms BIGINT NOT NULL,
  changed BIGINT NOT NULL, seq BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS tombstone (
  kind TEXT NOT NULL, id BIGINT NOT NULL, space_id BIGINT NOT NULL, changed BIGINT NOT NULL, seq BIGINT NOT NULL,
  PRIMARY KEY (kind, id, space_id));
CREATE INDEX IF NOT EXISTS project_seq ON project (space_id, seq);
CREATE INDEX IF NOT EXISTS task_seq ON task (space_id, seq);
CREATE INDEX IF NOT EXISTS task_parent ON task (parent_id);
CREATE INDEX IF NOT EXISTS task_project ON task (project_id);
CREATE INDEX IF NOT EXISTS task_assignee_seq ON task_assignee (space_id, seq);
CREATE INDEX IF NOT EXISTS note_seq ON note (space_id, seq);
CREATE INDEX IF NOT EXISTS note_project ON note (project_id);
CREATE INDEX IF NOT EXISTS entry_seq ON entry (space_id, seq);
CREATE INDEX IF NOT EXISTS entry_day ON entry (space_id, day);
CREATE INDEX IF NOT EXISTS tombstone_seq ON tombstone (space_id, seq);
";

/// Who is asking, as the database knows them.
#[derive(Clone, Debug)]
pub struct Me {
    pub id: String,
    pub email: String,
    pub personal: i64,
    pub generation: Option<i64>,
}

#[derive(Serialize)]
pub struct Feedback {
    id: i64,
    kind: String,
    message: String,
    created: i64,
}

impl From<tokio_postgres::Row> for Feedback {
    fn from(row: tokio_postgres::Row) -> Self {
        Self { id: row.get("id"), kind: row.get("kind"), message: row.get("message"), created: row.get("created") }
    }
}

/// A space someone is in, and as what.
#[derive(Clone, Debug)]
struct In {
    id: i64,
    kind: String,
    role: String,
}

pub struct Db {
    pool: Pool,
}

const TASK: &str = "id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id, space_id, goal_by, changed";

fn task_of(r: &tokio_postgres::Row) -> (Task, i64) {
    let done_day: Option<String> = r.get(8);
    (
        Task {
            id: r.get(0),
            title: r.get(1),
            notes: r.get(2),
            project_id: r.get(3),
            start: r.get(4),
            due: r.get(5),
            priority: r.get(6),
            status: r.get(7),
            done: done_day.is_some(),
            done_day,
            goal_day: r.get(9),
            parent_id: r.get(10),
            space_id: Some(r.get(11)),
            goal_by: r.get(12),
            assignees: Vec::new(),
        },
        r.get(13),
    )
}

const NOTE: &str = "id, text, updated_at, project_id, folder, space_id, changed";

fn note_of(r: &tokio_postgres::Row) -> (Note, i64) {
    (
        Note { id: r.get(0), text: r.get(1), updated_at: r.get(2), project_id: r.get(3), folder: Some(r.get(4)), space_id: Some(r.get(5)) },
        r.get(6),
    )
}

const ENTRY: &str = "id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms, changed";

fn entry_of(r: &tokio_postgres::Row) -> (Entry, i64) {
    (
        Entry {
            id: r.get(0),
            task_id: r.get(1),
            title: r.get(2),
            day: r.get(3),
            started_at: r.get(4),
            ended_at: r.get(5),
            planned_ms: r.get(6),
            focused_ms: r.get(7),
        },
        r.get(8),
    )
}

/// The next value of a space's counter. Takes the space's row lock until commit.
async fn bump(tx: &Transaction<'_>, space: i64) -> Result<i64, Fail> {
    Ok(tx.query_one("UPDATE space SET next_seq = next_seq + 1 WHERE id = $1 RETURNING next_seq", &[&space]).await?.get(0))
}

// Readers see one account incarnation and its data in the same snapshot.
// Writers hold the account row until commit, so deletion either precedes
// their generation check or follows the entire write.
async fn account_snapshot<'a>(client: &'a mut Client, me: &Me) -> Result<Transaction<'a>, Fail> {
    let tx = client.build_transaction().isolation_level(tokio_postgres::IsolationLevel::RepeatableRead).read_only(true).start().await?;
    tx.query_opt(
        "SELECT 1 FROM account WHERE id = $1 AND session_generation IS NOT DISTINCT FROM $2",
        &[&me.id, &me.generation],
    ).await?.ok_or(Fail::NotFound)?;
    Ok(tx)
}

async fn account_write<'a>(client: &'a mut Client, me: &Me) -> Result<Transaction<'a>, Fail> {
    let tx = client.transaction().await?;
    tx.query_opt(
        "SELECT 1 FROM account WHERE id = $1 AND session_generation IS NOT DISTINCT FROM $2 FOR SHARE",
        &[&me.id, &me.generation],
    ).await?.ok_or(Fail::NotFound)?;
    Ok(tx)
}

async fn spaces_of(tx: &impl GenericClient, account: &str) -> Result<Vec<In>, Fail> {
    let rows = tx
        .query(
            "SELECT s.id, s.kind, m.role FROM member m JOIN space s ON s.id = m.space_id WHERE m.account_id = $1 ORDER BY s.kind DESC, s.created, s.id",
            &[&account],
        )
        .await?;
    Ok(rows.iter().map(|r| In { id: r.get(0), kind: r.get(1), role: r.get(2) }).collect())
}

/// Every space this person is in, locked in one order so two writers never
/// wait on each other in a circle.
async fn lock(tx: &Transaction<'_>, spaces: &[In]) -> Result<(), Fail> {
    let ids: Vec<i64> = spaces.iter().map(|s| s.id).collect();
    tx.query("SELECT id FROM space WHERE id = ANY($1) ORDER BY id FOR UPDATE", &[&ids]).await?;
    Ok(())
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// "g•••@hop.dev": enough to recognise one's own address, not enough to learn someone's.
pub fn mask(email: &str) -> String {
    match email.split_once('@') {
        Some((name, domain)) => format!("{}•••@{domain}", name.chars().next().unwrap_or('•')),
        None => "•••".into(),
    }
}

fn clean_name(name: &str) -> Result<String, Fail> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return invalid("A workspace needs a name.");
    }
    Ok(name.chars().take(60).collect())
}

/// The state of a whole space for one task being moved: rows to write
/// again in the new space, and a tombstone in the old.
async fn leave_behind(tx: &Transaction<'_>, kind: &str, id: i64, from: i64, at: i64) -> Result<(), Fail> {
    let seq = bump(tx, from).await?;
    tx.execute(
        "INSERT INTO tombstone (kind, id, space_id, changed, seq) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (kind, id, space_id) DO UPDATE SET changed = excluded.changed, seq = excluded.seq",
        &[&kind, &id, &from, &at, &seq],
    )
    .await?;
    Ok(())
}

/// Moves a task (and its subtasks, and who is on them) to another space:
/// a tombstone in the old space, a new `seq` in the new one. People not in
/// the new space are taken off it; nobody is on a task in someone's own space.
/// The row is stamped one past its tombstone, so a device that took in the
/// tombstone first still takes the row when it arrives in its new space.
/// Subtasks go into `project`, the project their task is now in: a subtask
/// is in its task's project, and must not point into the space it left.
async fn rehome_task(tx: &Transaction<'_>, id: i64, from: i64, to: i64, at: i64, project: Option<i64>) -> Result<(), Fail> {
    leave_behind(tx, "task", id, from, at).await?;
    let seq = bump(tx, to).await?;
    tx.execute("UPDATE task SET space_id = $2, seq = $3, changed = greatest(changed, $4::BIGINT + 1) WHERE id = $1", &[&id, &to, &seq, &at]).await?;
    tx.execute("DELETE FROM tombstone WHERE kind = 'task' AND id = $1 AND space_id = $2", &[&id, &to]).await?;
    let on = tx.query("SELECT account_id FROM task_assignee WHERE task_id = $1", &[&id]).await?;
    for row in on {
        let account: String = row.get(0);
        let stays: bool = tx
            .query_one(
                "SELECT EXISTS (SELECT 1 FROM member m JOIN space s ON s.id = m.space_id WHERE m.space_id = $1 AND m.account_id = $2 AND s.kind = 'workspace')",
                &[&to, &account],
            )
            .await?
            .get(0);
        let seq = bump(tx, to).await?;
        tx.execute(
            "UPDATE task_assignee SET space_id = $3, is_on = is_on AND $4, changed = greatest(changed + 1, $5), seq = $6 WHERE task_id = $1 AND account_id = $2",
            &[&id, &account, &to, &stays, &at, &seq],
        )
        .await?;
    }
    let children: Vec<i64> = tx.query("SELECT id FROM task WHERE parent_id = $1 AND space_id <> $2", &[&id, &to]).await?.iter().map(|r| r.get(0)).collect();
    for child in children {
        tx.execute("UPDATE task SET project_id = $2 WHERE id = $1", &[&child, &project]).await?;
        Box::pin(rehome_task(tx, child, from, to, at, project)).await?;
    }
    Ok(())
}

async fn rehome_note(tx: &Transaction<'_>, id: i64, from: i64, to: i64, at: i64) -> Result<(), Fail> {
    leave_behind(tx, "note", id, from, at).await?;
    let seq = bump(tx, to).await?;
    tx.execute("UPDATE note SET space_id = $2, seq = $3, changed = greatest(changed, $4::BIGINT + 1) WHERE id = $1", &[&id, &to, &seq, &at]).await?;
    tx.execute("DELETE FROM tombstone WHERE kind = 'note' AND id = $1 AND space_id = $2", &[&id, &to]).await?;
    Ok(())
}

/// Writes rows from a device or a browser window where they are newer than
/// what is here, each in the space the rules give it. A row that breaks a
/// rule, or points into a space the writer is not in, is skipped, not the
/// whole batch: one bad row must not stop a device from ever syncing. The
/// ones skipped for the space are put in `refused`, so the device does not
/// count them as sent (replica.rs `inbox_in`).
async fn merge(tx: &Transaction<'_>, me: &Me, spaces: &[In], rows: &Rows, now: i64, refused: &mut Vec<Refused>) -> Result<usize, Fail> {
    let member: HashMap<i64, &In> = spaces.iter().map(|s| (s.id, s)).collect();
    let is_in = |space: i64| member.contains_key(&space);
    let stamp = |changed: i64| if changed > now + AHEAD { now } else { changed };
    let mut applied = 0;

    let buried = |kind: &'static str, id: i64| async move {
        let row = tx.query_opt("SELECT max(changed) FROM tombstone WHERE kind = $1 AND id = $2", &[&kind, &id]).await?;
        Ok::<Option<i64>, Fail>(row.and_then(|r| r.get(0)))
    };

    let mut refuse = |kind: &str, id: i64| refused.push(Refused { kind: kind.into(), id });
    for Stamped { row: p, changed } in &rows.projects {
        let changed = stamp(*changed);
        if check_project(p).is_err() {
            continue;
        }
        let sprint = p.sprint.as_ref().map(done_core::Sprint::stored);
        let here = tx.query_opt("SELECT space_id, changed FROM project WHERE id = $1", &[&p.id]).await?;
        match here {
            Some(r) => {
                let (space, at): (i64, i64) = (r.get(0), r.get(1));
                if !is_in(space) {
                    refuse("project", p.id);
                    continue;
                }
                if changed <= at {
                    continue;
                }
                let seq = bump(tx, space).await?;
                tx.execute(
                    "UPDATE project SET name = $2, color = $3, changed = $4, seq = $5,
                       sprint = coalesce($6, sprint) WHERE id = $1",
                    &[&p.id, &p.name.trim(), &p.color, &changed, &seq, &sprint],
                )
                .await?;
            }
            None => {
                if buried("project", p.id).await?.is_some_and(|b| b >= changed) {
                    continue;
                }
                let space = match p.space_id {
                    Some(s) if is_in(s) => s,
                    Some(_) => {
                        refuse("project", p.id);
                        continue;
                    }
                    None => me.personal,
                };
                let seq = bump(tx, space).await?;
                tx.execute(
                    "INSERT INTO project (id, space_id, name, color, changed, seq, sprint) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                    &[&p.id, &space, &p.name.trim(), &p.color, &changed, &seq, &sprint],
                )
                .await?;
                tx.execute("DELETE FROM tombstone WHERE kind = 'project' AND id = $1 AND space_id = $2", &[&p.id, &space]).await?;
            }
        }
        applied += 1;
    }

    for Stamped { row: t, changed } in &rows.tasks {
        let changed = stamp(*changed);
        if check(t).is_err() {
            continue;
        }
        let here = tx.query_opt("SELECT space_id, changed, goal_day, goal_by, project_id, parent_id FROM task WHERE id = $1", &[&t.id]).await?;
        let kept: Option<(Option<i64>, Option<i64>)> = here.as_ref().map(|r| (r.get(4), r.get(5)));
        let here: Option<(i64, i64, Option<String>, Option<String>)> = here.map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)));
        if let Some((space, at, _, _)) = &here {
            if !is_in(*space) {
                refuse("task", t.id);
                continue;
            }
            if changed <= *at {
                continue;
            }
        } else if buried("task", t.id).await?.is_some_and(|b| b >= changed) {
            continue;
        }
        // Where it goes: under its parent, else in its project, else where
        // it already is, else the writer's own space.
        let mut project_id = t.project_id;
        let mut parent_id = t.parent_id.filter(|p| *p != t.id);
        let mut target = None;
        if let Some(parent) = parent_id {
            match tx.query_opt("SELECT space_id, project_id FROM task WHERE id = $1", &[&parent]).await? {
                Some(r) => {
                    let space: i64 = r.get(0);
                    if !is_in(space) {
                        refuse("task", t.id);
                        continue;
                    }
                    target = Some(space);
                    let parent_project: Option<i64> = r.get(1);
                    // A subtask is in its task's project, whatever it says.
                    if project_id.is_some() && project_id != parent_project {
                        project_id = parent_project;
                    }
                }
                // Not here (yet, or any more): it is a task of its own.
                None => parent_id = None,
            }
        }
        if let Some(project) = project_id {
            match tx.query_opt("SELECT space_id FROM project WHERE id = $1", &[&project]).await? {
                Some(r) => {
                    let space: i64 = r.get(0);
                    if !is_in(space) {
                        refuse("task", t.id);
                        continue;
                    }
                    match target {
                        Some(t) if t != space => project_id = None,
                        Some(_) => {}
                        None => target = Some(space),
                    }
                }
                None => project_id = None,
            }
        }
        let mut target = target.or(here.as_ref().map(|h| h.0)).unwrap_or(me.personal);
        // Out of a workspace is its owner's call (as for a whole project): a
        // member putting a workspace task under their own project or task
        // leaves it where it is.
        if let (Some((from, ..)), Some((was_project, was_parent))) = (&here, kept) {
            if *from != target && member.get(from).is_some_and(|s| s.kind == "workspace" && s.role != "owner") {
                target = *from;
                project_id = was_project;
                parent_id = was_parent;
            }
        }
        // What is stored differs from what was sent: stamped one later, so
        // the sender takes the server's version instead of keeping its own.
        let moving = here.as_ref().is_some_and(|h| h.0 != target);
        let corrected = project_id != t.project_id || parent_id != t.parent_id;
        let changed = if moving || corrected { changed + 1 } else { changed };
        // A goal is the person's who set it; editing someone else's goal
        // task leaves it theirs.
        let goal_by = match (&t.goal_day, &here) {
            (None, _) => None,
            (Some(day), Some((_, _, Some(was), Some(by)))) if day == was => Some(by.clone()),
            (Some(_), _) => Some(me.id.clone()),
        };
        let done_day = if t.done { t.done_day.clone() } else { None };
        if let Some(day) = &t.goal_day {
            let others: Vec<(i64, i64)> = tx
                .query(
                    "SELECT id, space_id FROM task WHERE goal_day = $1 AND goal_by IS NOT DISTINCT FROM $2 AND id <> $3 AND space_id = ANY($4)",
                    &[day, &goal_by, &t.id, &member.keys().copied().collect::<Vec<_>>()],
                )
                .await?
                .iter()
                .map(|r| (r.get(0), r.get(1)))
                .collect();
            for (other, space) in others {
                let seq = bump(tx, space).await?;
                tx.execute("UPDATE task SET goal_day = NULL, goal_by = NULL, changed = $2, seq = $3 WHERE id = $1", &[&other, &changed, &seq]).await?;
            }
        }
        if let Some((from, _, _, _)) = &here {
            if *from != target {
                rehome_task(tx, t.id, *from, target, changed - 1, project_id).await?;
            }
        }
        let seq = bump(tx, target).await?;
        tx.execute(
            "INSERT INTO task (id, space_id, title, notes, project_id, start, due, priority, status, done_day, goal_day, goal_by, parent_id, created_by, changed, seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO UPDATE SET space_id = excluded.space_id, title = excluded.title, notes = excluded.notes,
               project_id = excluded.project_id, start = excluded.start, due = excluded.due, priority = excluded.priority,
               status = excluded.status, done_day = excluded.done_day, goal_day = excluded.goal_day, goal_by = excluded.goal_by,
               parent_id = excluded.parent_id, changed = excluded.changed, seq = excluded.seq",
            &[
                &t.id,
                &target,
                &t.title.trim(),
                &t.notes,
                &project_id,
                &t.start,
                &t.due,
                &t.priority,
                &t.status,
                &done_day,
                &t.goal_day,
                &goal_by,
                &parent_id,
                &me.id,
                &changed,
                &seq,
            ],
        )
        .await?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'task' AND id = $1 AND space_id = $2", &[&t.id, &target]).await?;
        applied += 1;
    }
    // One level of subtasks, as on the devices: a subtask whose task is
    // itself a subtask is made a task of its own.
    let nested: Vec<(i64, i64)> = tx
        .query(
            "SELECT c.id, c.space_id FROM task c JOIN task p ON c.parent_id = p.id WHERE p.parent_id IS NOT NULL AND c.space_id = ANY($1)",
            &[&member.keys().copied().collect::<Vec<_>>()],
        )
        .await?
        .iter()
        .map(|r| (r.get(0), r.get(1)))
        .collect();
    for (id, space) in nested {
        let seq = bump(tx, space).await?;
        tx.execute("UPDATE task SET parent_id = NULL, changed = changed + 1, seq = $2 WHERE id = $1", &[&id, &seq]).await?;
    }

    for Stamped { row: n, changed } in &rows.notes {
        let changed = stamp(*changed);
        let here = tx.query_opt("SELECT space_id, changed, project_id FROM note WHERE id = $1", &[&n.id]).await?;
        let kept_project: Option<i64> = here.as_ref().and_then(|r| r.get(2));
        let here: Option<(i64, i64)> = here.map(|r| (r.get(0), r.get(1)));
        if let Some((space, at)) = here {
            if !is_in(space) {
                refuse("note", n.id);
                continue;
            }
            if changed <= at {
                continue;
            }
        } else if buried("note", n.id).await?.is_some_and(|b| b >= changed) {
            continue;
        }
        let mut project_id = n.project_id;
        let mut target = None;
        if let Some(project) = project_id {
            match tx.query_opt("SELECT space_id FROM project WHERE id = $1", &[&project]).await? {
                Some(r) => {
                    let space: i64 = r.get(0);
                    if !is_in(space) {
                        refuse("note", n.id);
                        continue;
                    }
                    target = Some(space);
                }
                None => project_id = None,
            }
        }
        let wished = n.space_id.filter(|s| is_in(*s));
        let mut target = target.or(here.map(|h| h.0)).or(wished).unwrap_or(me.personal);
        // Out of a workspace is its owner's call, as for tasks.
        if let Some((from, _)) = here {
            if from != target && member.get(&from).is_some_and(|s| s.kind == "workspace" && s.role != "owner") {
                target = from;
                project_id = kept_project;
            }
        }
        let moving = here.is_some_and(|h| h.0 != target);
        let changed = if moving || project_id != n.project_id { changed + 1 } else { changed };
        if let Some((from, _)) = here {
            if from != target {
                rehome_note(tx, n.id, from, target, changed - 1).await?;
            }
        }
        let seq = bump(tx, target).await?;
        let said = n.folder.is_some();
        let folder = clean_folder(n.folder.clone().flatten().as_deref());
        tx.execute(
            "INSERT INTO note (id, space_id, text, updated_at, project_id, folder, changed, seq) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET space_id = excluded.space_id, text = excluded.text, updated_at = excluded.updated_at,
               project_id = excluded.project_id, changed = excluded.changed, seq = excluded.seq,
               folder = CASE WHEN $9 THEN excluded.folder ELSE note.folder END",
            &[&n.id, &target, &n.text, &n.updated_at, &project_id, &folder, &changed, &seq, &said],
        )
        .await?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'note' AND id = $1 AND space_id = $2", &[&n.id, &target]).await?;
        // A note being written live (it has a live document) hears of this
        // write at once, and takes it in as an edit (collab.rs). Sent when this commits.
        tx.execute("SELECT pg_notify('done_note', id::text) FROM note WHERE id = $1 AND ydoc IS NOT NULL", &[&n.id]).await?;
        applied += 1;
    }

    for Stamped { row: e, changed } in &rows.entries {
        let changed = stamp(*changed);
        let as_new = NewEntry {
            task_id: e.task_id,
            title: e.title.clone(),
            day: e.day.clone(),
            started_at: e.started_at,
            ended_at: e.ended_at,
            planned_ms: e.planned_ms,
            focused_ms: e.focused_ms,
        };
        if check_entry(&as_new).is_err() {
            continue;
        }
        // The time sheet is always one's own.
        let here = tx.query_opt("SELECT space_id, changed FROM entry WHERE id = $1", &[&e.id]).await?;
        if let Some(r) = here {
            let (space, at): (i64, i64) = (r.get(0), r.get(1));
            if space != me.personal {
                refuse("entry", e.id);
                continue;
            }
            if changed <= at {
                continue;
            }
        } else if buried("entry", e.id).await?.is_some_and(|b| b >= changed) {
            continue;
        }
        let seq = bump(tx, me.personal).await?;
        tx.execute(
            "INSERT INTO entry (id, space_id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms, changed, seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE SET task_id = excluded.task_id, title = excluded.title, day = excluded.day,
               started_at = excluded.started_at, ended_at = excluded.ended_at, planned_ms = excluded.planned_ms,
               focused_ms = excluded.focused_ms, changed = excluded.changed, seq = excluded.seq",
            &[&e.id, &me.personal, &e.task_id, &e.title.trim(), &e.day, &e.started_at, &e.ended_at, &e.planned_ms, &e.focused_ms, &changed, &seq],
        )
        .await?;
        applied += 1;
    }

    for Stamped { row: a, changed } in &rows.assignees {
        let changed = stamp(*changed);
        let Some(task) = tx.query_opt("SELECT space_id FROM task WHERE id = $1", &[&a.task_id]).await? else { continue };
        let space: i64 = task.get(0);
        // Only on a workspace's tasks, and only someone in it.
        let Some(inside) = member.get(&space) else { continue };
        if inside.kind != "workspace" {
            continue;
        }
        let theirs: bool =
            tx.query_one("SELECT EXISTS (SELECT 1 FROM member WHERE space_id = $1 AND account_id = $2)", &[&space, &a.account_id]).await?.get(0);
        if a.on && !theirs {
            continue;
        }
        let here = tx.query_opt("SELECT is_on, changed FROM task_assignee WHERE task_id = $1 AND account_id = $2", &[&a.task_id, &a.account_id]).await?;
        let was_on = here.as_ref().is_some_and(|r| r.get::<_, bool>(0));
        if here.is_some_and(|r| changed <= r.get::<_, i64>(1)) {
            continue;
        }
        let seq = bump(tx, space).await?;
        tx.execute(
            "INSERT INTO task_assignee (task_id, account_id, space_id, is_on, changed, seq) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (task_id, account_id) DO UPDATE SET space_id = excluded.space_id, is_on = excluded.is_on,
               changed = excluded.changed, seq = excluded.seq",
            &[&a.task_id, &a.account_id, &space, &a.on, &changed, &seq],
        )
        .await?;
        if a.on && !was_on && a.account_id != me.id {
            tx.execute(
                "INSERT INTO notification (id, account_id, kind, space_id, task_id, by_account, created) VALUES ($1, $2, 'assigned', $3, $4, $5, $6)",
                &[&fresh_id(), &a.account_id, &space, &a.task_id, &me.id, &now],
            )
            .await?;
        }
        applied += 1;
    }

    for gone in &rows.gone {
        let kind = gone.kind.as_str();
        if !["project", "task", "note", "entry"].contains(&kind) {
            continue;
        }
        let Some(here) = tx.query_opt(&format!("SELECT space_id, changed FROM {kind} WHERE id = $1"), &[&gone.id]).await? else { continue };
        let (space, at): (i64, i64) = (here.get(0), here.get(1));
        if !is_in(space) || (kind == "entry" && space != me.personal) || at > gone.changed {
            continue;
        }
        let changed = stamp(gone.changed);
        let mut doomed = vec![gone.id];
        if kind == "task" {
            // Its subtasks go with it, as on the devices.
            doomed.extend(tx.query("SELECT id FROM task WHERE parent_id = $1", &[&gone.id]).await?.iter().map(|r| r.get::<_, i64>(0)));
        }
        for id in doomed {
            tx.execute(&format!("DELETE FROM {kind} WHERE id = $1"), &[&id]).await?;
            if kind == "task" {
                tx.execute("DELETE FROM task_assignee WHERE task_id = $1", &[&id]).await?;
            }
            let seq = bump(tx, space).await?;
            tx.execute(
                "INSERT INTO tombstone (kind, id, space_id, changed, seq) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (kind, id, space_id) DO UPDATE SET changed = excluded.changed, seq = excluded.seq",
                &[&kind, &id, &space, &changed, &seq],
            )
            .await?;
        }
        if kind == "project" {
            // A task outlives its project, and stays where it is.
            for table in ["task", "note"] {
                let left: Vec<(i64, i64)> = tx
                    .query(&format!("SELECT id, space_id FROM {table} WHERE project_id = $1 AND space_id = ANY($2)"), &[&gone.id, &member.keys().copied().collect::<Vec<_>>()])
                    .await?
                    .iter()
                    .map(|r| (r.get(0), r.get(1)))
                    .collect();
                for (id, own) in left {
                    // Counted in the row's own space, which is where it is read.
                    let seq = bump(tx, own).await?;
                    tx.execute(&format!("UPDATE {table} SET project_id = NULL, changed = greatest(changed + 1, $2), seq = $3 WHERE id = $1"), &[&id, &changed, &seq])
                        .await?;
                }
            }
        }
        applied += 1;
    }
    Ok(applied)
}

fn project_of(row: &tokio_postgres::Row) -> Result<Project, Fail> {
    let sprint = row
        .get::<_, Option<String>>(4)
        .map(|encoded| serde_json::from_str(&encoded))
        .transpose()
        .map_err(|e| Fail::Down(format!("Could not read project sprint: {e}")))?;
    Ok(Project { id: row.get(0), name: row.get(1), color: row.get(2), space_id: Some(row.get(3)), sprint })
}

/// What changed in one space after `from`, up to and including `upto`.
async fn rows_since(tx: &impl GenericClient, space: i64, from: i64, upto: i64, rows: &mut Rows) -> Result<(), Fail> {
    let range: [&(dyn tokio_postgres::types::ToSql + Sync); 3] = [&space, &from, &upto];
    for r in tx.query("SELECT id, name, color, space_id, sprint, changed FROM project WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY id", &range).await? {
        rows.projects.push(Stamped { row: project_of(&r)?, changed: r.get(5) });
    }
    for r in tx.query(&format!("SELECT {TASK} FROM task WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY id"), &range).await? {
        let (row, changed) = task_of(&r);
        rows.tasks.push(Stamped { row, changed });
    }
    for r in tx.query(&format!("SELECT {NOTE} FROM note WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY id"), &range).await? {
        let (row, changed) = note_of(&r);
        rows.notes.push(Stamped { row, changed });
    }
    for r in tx.query(&format!("SELECT {ENTRY} FROM entry WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY id"), &range).await? {
        let (row, changed) = entry_of(&r);
        rows.entries.push(Stamped { row, changed });
    }
    for r in tx
        .query(
            "SELECT task_id, account_id, is_on, space_id, changed FROM task_assignee WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY task_id, account_id",
            &range,
        )
        .await?
    {
        rows.assignees.push(Stamped { row: Assignee { task_id: r.get(0), account_id: r.get(1), on: r.get(2), space_id: Some(r.get(3)) }, changed: r.get(4) });
    }
    for r in tx.query("SELECT kind, id, changed FROM tombstone WHERE space_id = $1 AND seq > $2 AND seq <= $3 ORDER BY kind, id", &range).await? {
        rows.gone.push(Gone { kind: r.get(0), id: r.get(1), changed: r.get(2), space: Some(space) });
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Made {
    pub invite: i64,
    pub link: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePage {
    pub space: String,
    pub by_name: String,
    pub by_picture: String,
    pub members: i64,
    pub email: String,
    pub expires: i64,
    pub state: String,
    /// The whole address, to compare with the signed-in person's. Never shown.
    #[serde(skip)]
    pub to: String,
}

impl Db {
    /// Connects and makes sure every table is there. `config` is a libpq
    /// connection string: "host=/cloudsql/… user=done dbname=done password=…"
    /// or a postgres:// address.
    pub async fn connect(config: &str) -> Result<Self, Fail> {
        let pg: tokio_postgres::Config = config.parse().map_err(|e: tokio_postgres::Error| Fail::Down(e.to_string()))?;
        let manager = Manager::from_config(pg, NoTls, ManagerConfig { recycling_method: RecyclingMethod::Fast });
        // A few connections per server copy: the database is shared by up
        // to ten of them, and it allows about a hundred.
        let pool = Pool::builder(manager).max_size(5).build().map_err(|e| Fail::Down(e.to_string()))?;
        let db = Self { pool };
        let mut client = db.pool.get().await?;
        let tx = client.transaction().await?;
        // Two copies of the server starting at once would race to make the
        // same tables; one waits for the other.
        tx.execute("SELECT pg_advisory_xact_lock(4242)", &[]).await?;
        tx.batch_execute(SCHEMA).await?;
        tx.commit().await?;
        Ok(db)
    }

    /// Today in a time zone (an IANA name), YYYY-MM-DD: `/mcp`'s today.
    pub async fn today_in(&self, zone: &str) -> Result<String, Fail> {
        let client = self.pool.get().await?;
        Ok(client.query_one("SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD')", &[&zone]).await?.get(0))
    }

    /// A moment (ms since 1970) as HH:MM in a time zone.
    pub async fn clock_in(&self, ms: i64, zone: &str) -> Result<String, Fail> {
        let client = self.pool.get().await?;
        let seconds = ms as f64 / 1000.0;
        Ok(client.query_one("SELECT to_char(to_timestamp($1) AT TIME ZONE $2, 'HH24:MI')", &[&seconds, &zone]).await?.get(0))
    }

    /// The name an account is kept under, if it is known.
    pub async fn name_of(&self, id: &str) -> Result<Option<String>, Fail> {
        let client = self.pool.get().await?;
        Ok(client.query_opt("SELECT name FROM account WHERE id = $1", &[&id]).await?.map(|r| r.get::<_, String>(0)).filter(|n| !n.is_empty()))
    }

    /// Provision a personal space only when the identity provider has authenticated the owner.
    pub async fn me(&self, id: &str, email: &str, name: &str, picture: &str) -> Result<Me, Fail> {
        self.me_with_apple_grant(id, email, name, picture, None).await
    }

    /// The same, keeping Apple's newest refresh grant for the account (sealed,
    /// see `auth::apple_grants`) in place of any it had: one per account.
    pub(crate) async fn me_with_apple_grant(&self, id: &str, email: &str, name: &str, picture: &str, grant: Option<&[u8]>) -> Result<Me, Fail> {
        let email = email.trim().to_lowercase();
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        let now = now_ms();
        let generation: Option<i64> = tx.query_one(
            "INSERT INTO account (id, email, name, picture, created) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
             RETURNING session_generation",
            &[&id, &email, &name, &picture, &now],
        ).await?.get(0);
        if let Some(grant) = grant {
            tx.execute("INSERT INTO apple_refresh_grant (account_id, sealed) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET sealed = EXCLUDED.sealed",
                &[&id, &grant]).await?;
        }
        let personal = self.personal_in(&tx, id).await?;
        tx.commit().await?;
        Ok(Me { id: id.into(), email, personal, generation })
    }

    /// Accounts created before generations were introduced have NULL in both
    /// the database and their old sessions. A new account always gets a generation.
    pub async fn session_account(&self, id: &str, generation: Option<i64>) -> Result<Option<Me>, Fail> {
        let client = self.pool.get().await?;
        let row = client.query_opt(
            "SELECT a.email, s.id FROM account a JOIN space s ON s.owner_id = a.id AND s.kind = 'personal'
             WHERE a.id = $1 AND a.session_generation IS NOT DISTINCT FROM $2",
            &[&id, &generation],
        ).await?;
        Ok(row.map(|r| Me { id: id.into(), email: r.get(0), personal: r.get(1), generation }))
    }

    async fn personal_in(&self, tx: &Transaction<'_>, id: &str) -> Result<i64, Fail> {
        let now = now_ms();
        tx.execute(
            "INSERT INTO space (id, kind, name, owner_id, created) VALUES ($1, 'personal', '', $2, $3)
             ON CONFLICT (owner_id) WHERE kind = 'personal' DO NOTHING",
            &[&fresh_id(), &id, &now],
        )
        .await?;
        let personal: i64 = tx.query_one("SELECT id FROM space WHERE owner_id = $1 AND kind = 'personal'", &[&id]).await?.get(0);
        tx.execute(
            "INSERT INTO member (space_id, account_id, role, joined) VALUES ($1, $2, 'owner', $3) ON CONFLICT DO NOTHING",
            &[&personal, &id, &now],
        )
        .await?;
        Ok(personal)
    }

    pub async fn feedback(&self, me: &Me) -> Result<Vec<Feedback>, Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let rows = client.query("SELECT id, kind, message, created FROM feedback ORDER BY id DESC LIMIT 100", &[]).await?;
        Ok(rows.into_iter().map(Feedback::from).collect())
    }

    pub async fn add_feedback(&self, me: &Me, kind: &str, message: &str) -> Result<Feedback, Fail> {
        let message = message.trim();
        if !matches!(kind, "bug" | "idea") {
            return invalid("Choose a problem or an idea.");
        }
        if message.is_empty() || message.contains('\0') || message.chars().count() > 2000 {
            return invalid("Write a message of up to 2,000 characters.");
        }
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        // Serialize submissions by this account so simultaneous requests share its limit.
        if tx.query_opt("SELECT id FROM account WHERE id = $1 AND session_generation IS NOT DISTINCT FROM $2 FOR UPDATE", &[&me.id, &me.generation]).await?.is_none() {
            return Err(Fail::NotFound);
        }
        let now = now_ms();
        let yesterday = now - 24 * 60 * 60 * 1000;
        let recent: i64 = tx.query_one("SELECT count(*) FROM feedback WHERE account_id = $1 AND created >= $2", &[&me.id, &yesterday]).await?.get(0);
        if recent >= 30 {
            return Err(Fail::TooManyRequests("You have posted 30 messages in the last day. Try again later.".into()));
        }
        let row = tx.query_one(
            "INSERT INTO feedback (account_id, kind, message, created) VALUES ($1, $2, $3, $4) RETURNING id, kind, message, created",
            &[&me.id, &kind, &message, &now],
        ).await?;
        tx.commit().await?;
        Ok(row.into())
    }

    /// A device swapping changes: its rows in, everything new in each of its
    /// spaces out. An app from before workspaces (no cursors) is answered
    /// about its own space only, in the shape it knows.
    pub async fn exchange(&self, me: &Me, outbox: &Outbox) -> Result<Reply, Fail> {
        let refused = if outbox.rows.is_empty() { Vec::new() } else { self.write(me, outbox.rows.clone()).await? };
        // Read in one snapshot across every space: a project moved between
        // two of them in the meantime shows up in both or in neither, never
        // as a tombstone in one without the row in the other.
        let mut client = self.pool.get().await?;
        let tx = account_snapshot(&mut client, me).await?;
        let spaces = spaces_of(&tx, &me.id).await?;
        let legacy = outbox.cursors.is_none();
        // An app from before workspaces, or one that has never synced since,
        // says how far it read its own space in `pulled`.
        let first = outbox.cursors.as_ref().is_none_or(|c| c.is_empty());
        let read: HashMap<i64, i64> = outbox.cursors.iter().flatten().map(|c| (c.space, c.at)).collect();
        let mut rows = Rows::default();
        let mut upto = Vec::new();
        let mut own = 0;
        for space in &spaces {
            if legacy && space.id != me.personal {
                continue;
            }
            let from = read.get(&space.id).copied().unwrap_or(if space.id == me.personal && first { outbox.pulled } else { 0 });
            let at: i64 = tx.query_one("SELECT next_seq FROM space WHERE id = $1", &[&space.id]).await?.get(0);
            // Read further than the space has counted: it is not the space
            // the device read (an account deleted and made again). From the start.
            let from = if from > at { 0 } else { from };
            rows_since(&tx, space.id, from, at, &mut rows).await?;
            if space.id == me.personal {
                own = at;
            }
            upto.push(Cursor { space: space.id, at });
        }
        let team = if legacy { None } else { Some(team_in(&tx, me, &spaces).await?) };
        tx.commit().await?;
        Ok(Reply { upto: own, rows, spaces: (!legacy).then_some(upto), team, refused })
    }

    /// Everything a browser window shows, from every space the person is in.
    pub async fn state(&self, me: &Me, today: &str) -> Result<State, Fail> {
        if !is_day(today) {
            return invalid("Today must be a day written YYYY-MM-DD.");
        }
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let spaces = spaces_of(&client, &me.id).await?;
        let ids: Vec<i64> = spaces.iter().map(|s| s.id).collect();
        let projects = client
            .query("SELECT id, name, color, space_id, sprint FROM project WHERE space_id = ANY($1) ORDER BY id", &[&ids])
            .await?
            .iter()
            .map(project_of)
            .collect::<Result<_, _>>()?;
        let mut tasks: Vec<Task> = client
            .query(
                &format!(
                    "SELECT {TASK} FROM task WHERE space_id = ANY($1) AND (done_day IS NULL OR done_day = $2
                       OR parent_id IN (SELECT id FROM task WHERE done_day IS NULL AND space_id = ANY($1))) ORDER BY id"
                ),
                &[&ids, &today],
            )
            .await?
            .iter()
            .map(|r| task_of(r).0)
            .collect();
        let on = client
            .query("SELECT task_id, account_id FROM task_assignee WHERE space_id = ANY($1) AND is_on ORDER BY changed, account_id", &[&ids])
            .await?;
        let at: HashMap<i64, usize> = tasks.iter().enumerate().map(|(i, t)| (t.id, i)).collect();
        for r in on {
            if let Some(i) = at.get(&r.get::<_, i64>(0)) {
                tasks[*i].assignees.push(r.get(1));
            }
        }
        let rev: i64 = client.query_one("SELECT coalesce(sum(next_seq), 0)::BIGINT FROM space WHERE id = ANY($1)", &[&ids]).await?.get(0);
        let team = team_in(&client, me, &spaces).await?;
        Ok(State { rev, next_id: fresh_id(), projects, tasks, team: Some(team), local_only: Vec::new(), withheld: Vec::new() })
    }

    /// Returns the rows refused for their space (see `merge`).
    async fn write(&self, me: &Me, rows: Rows) -> Result<Vec<Refused>, Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let spaces = spaces_of(&tx, &me.id).await?;
        lock(&tx, &spaces).await?;
        // Read again once locked: someone removed while this waited is out.
        let spaces = spaces_of(&tx, &me.id).await?;
        let mut refused = Vec::new();
        merge(&tx, me, &spaces, &rows, now_ms(), &mut refused).await?;
        tx.commit().await?;
        Ok(refused)
    }

    /// A browser window's changes, row by row, last write wins (see the
    /// plan's ruling 4: with several people in a space, refusing a save as
    /// stale would throw edits away every time someone else typed).
    pub async fn sync(&self, me: &Me, change: Change) -> Result<i64, Fail> {
        for project in &change.projects {
            check_project(project).map_err(|e| Fail::Invalid(e.to_string()))?;
        }
        for task in &change.tasks {
            check(task).map_err(|e| Fail::Invalid(e.to_string()))?;
        }
        let now = now_ms();
        let stamp = |row| Stamped { row, changed: now };
        let rows = Rows {
            projects: change.projects.into_iter().map(stamp).collect(),
            tasks: change.tasks.into_iter().map(|row| Stamped { row, changed: now }).collect(),
            assignees: change
                .assign
                .into_iter()
                .map(|Assign { task_id, account_id, on }| Stamped { row: Assignee { task_id, account_id, on, space_id: None }, changed: now })
                .collect(),
            gone: change
                .delete_tasks
                .iter()
                .map(|id| Gone { kind: "task".into(), id: *id, changed: now, space: None })
                .chain(change.delete_projects.iter().map(|id| Gone { kind: "project".into(), id: *id, changed: now, space: None }))
                .collect(),
            ..Default::default()
        };
        self.write(me, rows).await?;
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let ids: Vec<i64> = spaces_of(&client, &me.id).await?.iter().map(|s| s.id).collect();
        Ok(client.query_one("SELECT coalesce(sum(next_seq), 0)::BIGINT FROM space WHERE id = ANY($1)", &[&ids]).await?.get(0))
    }

    pub async fn notes(&self, me: &Me) -> Result<Vec<Note>, Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let ids: Vec<i64> = spaces_of(&client, &me.id).await?.iter().map(|s| s.id).collect();
        Ok(client
            .query(&format!("SELECT {NOTE} FROM note WHERE space_id = ANY($1) ORDER BY updated_at DESC, id DESC"), &[&ids])
            .await?
            .iter()
            .map(|r| note_of(r).0)
            .collect())
    }

    pub async fn save_note(&self, me: &Me, note: SaveNote) -> Result<Note, Fail> {
        let id = note.id.unwrap_or_else(fresh_id);
        let row = Note { id, text: note.text, updated_at: note.updated_at, project_id: note.project_id, folder: note.folder, space_id: note.space_id };
        self.write(me, Rows { notes: vec![Stamped { row, changed: now_ms() }], ..Default::default() }).await?;
        self.notes(me).await?.into_iter().find(|n| n.id == id).ok_or(Fail::NotFound)
    }

    pub async fn delete_note(&self, me: &Me, id: i64) -> Result<(), Fail> {
        self.write(me, Rows { gone: vec![Gone { kind: "note".into(), id, changed: now_ms(), space: None }], ..Default::default() }).await?;
        Ok(())
    }

    pub async fn entries(&self, me: &Me, day: &str) -> Result<Vec<Entry>, Fail> {
        if !is_day(day) {
            return invalid("The day must be written YYYY-MM-DD.");
        }
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        Ok(client
            .query(&format!("SELECT {ENTRY} FROM entry WHERE space_id = $1 AND day = $2 ORDER BY started_at, id"), &[&me.personal, &day])
            .await?
            .iter()
            .map(|r| entry_of(r).0)
            .collect())
    }

    pub async fn record(&self, me: &Me, entry: NewEntry) -> Result<Entry, Fail> {
        check_entry(&entry).map_err(|e| Fail::Invalid(e.to_string()))?;
        let row = Entry {
            id: fresh_id(),
            task_id: entry.task_id,
            title: entry.title.trim().to_string(),
            day: entry.day,
            started_at: entry.started_at,
            ended_at: entry.ended_at,
            planned_ms: entry.planned_ms,
            focused_ms: entry.focused_ms,
        };
        self.write(me, Rows { entries: vec![Stamped { row: row.clone(), changed: now_ms() }], ..Default::default() }).await?;
        Ok(row)
    }

    pub async fn delete_entry(&self, me: &Me, id: i64) -> Result<(), Fail> {
        self.write(me, Rows { gone: vec![Gone { kind: "entry".into(), id, changed: now_ms(), space: None }], ..Default::default() }).await?;
        Ok(())
    }

    pub async fn finished(&self, me: &Me, limit: i64) -> Result<Vec<Task>, Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let ids: Vec<i64> = spaces_of(&client, &me.id).await?.iter().map(|s| s.id).collect();
        Ok(client
            .query(
                &format!("SELECT {TASK} FROM task WHERE space_id = ANY($1) AND done_day IS NOT NULL AND parent_id IS NULL ORDER BY done_day DESC, id DESC LIMIT $2"),
                &[&ids, &limit],
            )
            .await?
            .iter()
            .map(|r| task_of(r).0)
            .collect())
    }

    pub async fn team(&self, me: &Me) -> Result<Value, Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_snapshot(&mut connection, me).await?;
        let spaces = spaces_of(&client, &me.id).await?;
        team_in(&client, me, &spaces).await
    }

    // ---------- Workspaces ----------

    async fn role(tx: &Transaction<'_>, me: &Me, space: i64) -> Result<(String, String), Fail> {
        let row = tx
            .query_opt(
                "SELECT m.role, s.kind FROM member m JOIN space s ON s.id = m.space_id WHERE m.space_id = $1 AND m.account_id = $2",
                &[&space, &me.id],
            )
            .await?
            .ok_or(Fail::NotFound)?;
        Ok((row.get(0), row.get(1)))
    }

    async fn workspace_role(tx: &Transaction<'_>, me: &Me, space: i64) -> Result<String, Fail> {
        // Account deletion may transfer ownership while this writer waits.
        tx.query_opt("SELECT id FROM space WHERE id = $1 FOR UPDATE", &[&space]).await?.ok_or(Fail::NotFound)?;
        let (role, kind) = Self::role(tx, me, space).await?;
        if kind != "workspace" {
            return Err(Fail::NotFound);
        }
        Ok(role)
    }

    pub async fn create_workspace(&self, me: &Me, name: &str) -> Result<i64, Fail> {
        let name = clean_name(name)?;
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let count: i64 = tx
            .query_one("SELECT count(*) FROM member m JOIN space s ON s.id = m.space_id WHERE m.account_id = $1 AND s.kind = 'workspace'", &[&me.id])
            .await?
            .get(0);
        if count >= WORKSPACES {
            return invalid("You are in 10 workspaces, which is as many as one person can be in.");
        }
        let id = fresh_id();
        let now = now_ms();
        tx.execute("INSERT INTO space (id, kind, name, owner_id, created) VALUES ($1, 'workspace', $2, $3, $4)", &[&id, &name, &me.id, &now]).await?;
        tx.execute("INSERT INTO member (space_id, account_id, role, joined) VALUES ($1, $2, 'owner', $3)", &[&id, &me.id, &now]).await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn rename_workspace(&self, me: &Me, space: i64, name: &str) -> Result<(), Fail> {
        let name = clean_name(name)?;
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        if Self::workspace_role(&tx, me, space).await? != "owner" {
            return invalid("Only the workspace's owner can rename it.");
        }
        tx.execute("UPDATE space SET name = $2 WHERE id = $1", &[&space, &name]).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Removes the workspace and everything in it, for every member. Their
    /// devices drop it at their next sync, as it is no longer theirs.
    pub async fn delete_workspace(&self, me: &Me, space: i64) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        if Self::workspace_role(&tx, me, space).await? != "owner" {
            return invalid("Only the workspace's owner can delete it.");
        }
        for table in ["task_assignee", "task", "note", "project", "tombstone", "notification"] {
            tx.execute(&format!("DELETE FROM {table} WHERE space_id = $1"), &[&space]).await?;
        }
        tx.execute("DELETE FROM space WHERE id = $1", &[&space]).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Invites someone by their Google email address. They see it in done
    /// at once if they use it, or the first time they sign in; the link is
    /// for the inviter to send by any other way. Every member may invite.
    pub async fn invite(&self, me: &Me, space: i64, email: &str, public_url: &str) -> Result<Made, Fail> {
        let email = email.trim().to_lowercase();
        if !email.contains('@') || email.starts_with('@') || email.ends_with('@') || email.contains(char::is_whitespace) || email.len() > 200 {
            return invalid("That is not an email address.");
        }
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        Self::workspace_role(&tx, me, space).await?;
        let already: bool = tx
            .query_one("SELECT EXISTS (SELECT 1 FROM member m JOIN account a ON a.id = m.account_id WHERE m.space_id = $1 AND lower(a.email) = $2)", &[&space, &email])
            .await?
            .get(0);
        if already {
            return invalid("They are already in this workspace.");
        }
        let now = now_ms();
        let (today, pending): (i64, i64) = {
            let r = tx
                .query_one(
                    "SELECT count(*) FILTER (WHERE created > $2), count(*) FILTER (WHERE state = 'pending' AND expires > $3) FROM invite WHERE space_id = $1",
                    &[&space, &(now - 24 * 60 * 60 * 1000), &now],
                )
                .await?;
            (r.get(0), r.get(1))
        };
        if today >= INVITES_A_DAY {
            return invalid("That is 20 invites today for this workspace. Try again tomorrow.");
        }
        if pending >= PENDING {
            return invalid("This workspace has 50 invites waiting. Revoke some first.");
        }
        let members: i64 = tx.query_one("SELECT count(*) FROM member WHERE space_id = $1", &[&space]).await?.get(0);
        if members >= MEMBERS {
            return invalid("A workspace can have 50 members.");
        }
        // A new invite to the same address replaces the one waiting.
        tx.execute("UPDATE invite SET state = 'revoked' WHERE space_id = $1 AND email = $2 AND state = 'pending'", &[&space, &email]).await?;
        let token = format!("{:032x}{:032x}", rand::random::<u128>(), rand::random::<u128>());
        let id = fresh_id();
        tx.execute(
            "INSERT INTO invite (id, space_id, email, invited_by, token_hash, expires, created) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[&id, &space, &email, &me.id, &hash(&token), &(now + WEEK), &now],
        )
        .await?;
        tx.commit().await?;
        Ok(Made { invite: id, link: format!("{public_url}/invite/{token}") })
    }

    /// A fresh link for an invite that is waiting. Only a hash of a token is
    /// kept, so the old link stops working and a new one is made.
    pub async fn invite_link(&self, me: &Me, invite: i64, public_url: &str) -> Result<Made, Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let row = tx.query_opt("SELECT space_id FROM invite WHERE id = $1 AND state = 'pending'", &[&invite]).await?.ok_or(Fail::NotFound)?;
        Self::workspace_role(&tx, me, row.get(0)).await?;
        let token = format!("{:032x}{:032x}", rand::random::<u128>(), rand::random::<u128>());
        tx.execute("UPDATE invite SET token_hash = $2, expires = greatest(expires, $3) WHERE id = $1", &[&invite, &hash(&token), &(now_ms() + WEEK)])
            .await?;
        tx.commit().await?;
        Ok(Made { invite, link: format!("{public_url}/invite/{token}") })
    }

    pub async fn revoke(&self, me: &Me, invite: i64) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let row = tx.query_opt("SELECT space_id FROM invite WHERE id = $1 AND state = 'pending'", &[&invite]).await?.ok_or(Fail::NotFound)?;
        Self::workspace_role(&tx, me, row.get(0)).await?;
        tx.execute("UPDATE invite SET state = 'revoked' WHERE id = $1", &[&invite]).await?;
        tx.commit().await?;
        Ok(())
    }

    /// What the page behind an invite link shows. No session needed: it says
    /// only the workspace's name, who invited, and how many are in it.
    pub async fn invite_page(&self, token: &str) -> Result<InvitePage, Fail> {
        let client = self.pool.get().await?;
        let row = client
            .query_opt(
                "SELECT s.name, a.name, a.picture, (SELECT count(*) FROM member WHERE space_id = s.id), i.email, i.expires, i.state
                 FROM invite i JOIN space s ON s.id = i.space_id LEFT JOIN account a ON a.id = i.invited_by WHERE i.token_hash = $1",
                &[&hash(token)],
            )
            .await?
            .ok_or(Fail::NotFound)?;
        let expires: i64 = row.get(5);
        let mut state: String = row.get(6);
        if state == "pending" && expires <= now_ms() {
            state = "expired".into();
        }
        Ok(InvitePage {
            space: row.get(0),
            by_name: row.get::<_, Option<String>>(1).unwrap_or_default(),
            by_picture: row.get::<_, Option<String>>(2).unwrap_or_default(),
            members: row.get(3),
            email: mask(&row.get::<_, String>(4)),
            expires,
            state,
            to: row.get(4),
        })
    }

    /// Joining. By the invite's id (from the bell) or by the token in its
    /// link; either way only the account whose verified address it was sent
    /// to can use it.
    pub async fn accept(&self, me: &Me, invite: Option<i64>, token: Option<&str>) -> Result<i64, Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let row = match (invite, token) {
            (Some(id), _) => tx.query_opt("SELECT id, space_id, email, expires, state, invited_by FROM invite WHERE id = $1 FOR UPDATE", &[&id]).await?,
            (None, Some(token)) => {
                tx.query_opt("SELECT id, space_id, email, expires, state, invited_by FROM invite WHERE token_hash = $1 FOR UPDATE", &[&hash(token)]).await?
            }
            (None, None) => None,
        }
        .ok_or(Fail::NotFound)?;
        let (id, space, email, expires, state, by): (i64, i64, String, i64, String, String) =
            (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4), row.get(5));
        if email != me.email {
            // By id, someone else's invite is simply not theirs to see.
            if invite.is_some() {
                return Err(Fail::NotFound);
            }
            return Err(Fail::Invalid(format!("This invite is for {}. You are signed in as {}.", mask(&email), me.email)));
        }
        if state != "pending" {
            return invalid(if state == "accepted" { "This invite has been used." } else { "This invite was taken back." });
        }
        if expires <= now_ms() {
            return invalid("This invite has expired. Ask for a new one.");
        }
        // Locked, so two people accepting at once cannot both be the 50th.
        tx.execute("SELECT id FROM space WHERE id = $1 FOR UPDATE", &[&space]).await?;
        let members: i64 = tx.query_one("SELECT count(*) FROM member WHERE space_id = $1", &[&space]).await?.get(0);
        if members >= MEMBERS {
            return invalid("This workspace is full.");
        }
        let workspaces: i64 = tx
            .query_one("SELECT count(*) FROM member m JOIN space s ON s.id = m.space_id WHERE m.account_id = $1 AND s.kind = 'workspace'", &[&me.id])
            .await?
            .get(0);
        if workspaces >= WORKSPACES {
            return invalid("You are in 10 workspaces, which is as many as one person can be in.");
        }
        let now = now_ms();
        tx.execute("INSERT INTO member (space_id, account_id, role, joined) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING", &[&space, &me.id, &now])
            .await?;
        tx.execute("UPDATE invite SET state = 'accepted' WHERE id = $1", &[&id]).await?;
        if by != me.id {
            tx.execute(
                "INSERT INTO notification (id, account_id, kind, space_id, by_account, created) VALUES ($1, $2, 'joined', $3, $4, $5)",
                &[&fresh_id(), &by, &space, &me.id, &now],
            )
            .await?;
        }
        tx.commit().await?;
        Ok(space)
    }

    pub async fn decline(&self, me: &Me, invite: i64) -> Result<(), Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_write(&mut connection, me).await?;
        let changed =
            client.execute("UPDATE invite SET state = 'declined' WHERE id = $1 AND email = $2 AND state = 'pending'", &[&invite, &me.email]).await?;
        if changed == 0 {
            return Err(Fail::NotFound);
        }
        client.commit().await?;
        Ok(())
    }

    async fn drop_member(tx: &Transaction<'_>, space: i64, account: &str) -> Result<(), Fail> {
        tx.execute("DELETE FROM member WHERE space_id = $1 AND account_id = $2", &[&space, &account]).await?;
        // Taken off every task there, so nobody waits on someone who has gone.
        let on: Vec<i64> = tx
            .query("SELECT task_id FROM task_assignee WHERE space_id = $1 AND account_id = $2 AND is_on", &[&space, &account])
            .await?
            .iter()
            .map(|r| r.get(0))
            .collect();
        let now = now_ms();
        for task in on {
            let seq = bump(tx, space).await?;
            tx.execute(
                "UPDATE task_assignee SET is_on = false, changed = greatest(changed + 1, $3), seq = $4 WHERE task_id = $1 AND account_id = $2",
                &[&task, &account, &now, &seq],
            )
            .await?;
        }
        tx.execute("DELETE FROM notification WHERE space_id = $1 AND account_id = $2", &[&space, &account]).await?;
        Ok(())
    }

    pub async fn remove_member(&self, me: &Me, space: i64, account: &str) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        if Self::workspace_role(&tx, me, space).await? != "owner" {
            return invalid("Only the workspace's owner can remove people.");
        }
        if account == me.id {
            return invalid("You own this workspace. Delete it instead.");
        }
        let there: bool = tx.query_one("SELECT EXISTS (SELECT 1 FROM member WHERE space_id = $1 AND account_id = $2)", &[&space, &account]).await?.get(0);
        if !there {
            return Err(Fail::NotFound);
        }
        Self::drop_member(&tx, space, account).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn leave(&self, me: &Me, space: i64) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        if Self::workspace_role(&tx, me, space).await? == "owner" {
            return invalid("You own this workspace. Delete it, or ask to be removed once someone else owns it.");
        }
        Self::drop_member(&tx, space, &me.id).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Moves a project, with its tasks, their subtasks and its notes, to
    /// another space the person is in. Out of a workspace is the owner's call.
    pub async fn move_project(&self, me: &Me, project: i64, to: i64) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = account_write(&mut client, me).await?;
        let spaces = spaces_of(&tx, &me.id).await?;
        let from: i64 = tx.query_opt("SELECT space_id FROM project WHERE id = $1", &[&project]).await?.ok_or(Fail::NotFound)?.get(0);
        let source = spaces.iter().find(|s| s.id == from).ok_or(Fail::NotFound)?;
        let target = spaces.iter().find(|s| s.id == to).ok_or(Fail::NotFound)?;
        if from == to {
            return Ok(());
        }
        if target.kind == "personal" && target.id != me.personal {
            return Err(Fail::NotFound);
        }
        if source.kind == "workspace" && source.role != "owner" {
            return invalid("Only the workspace's owner can move a project out of it.");
        }
        lock(&tx, &spaces).await?;
        if !spaces_of(&tx, &me.id).await?.iter().any(|s| s.id == to) {
            return Err(Fail::NotFound);
        }
        let at = now_ms();
        leave_behind(&tx, "project", project, from, at).await?;
        let seq = bump(&tx, to).await?;
        tx.execute("UPDATE project SET space_id = $2, seq = $3, changed = greatest(changed, $4) WHERE id = $1", &[&project, &to, &seq, &at]).await?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'project' AND id = $1 AND space_id = $2", &[&project, &to]).await?;
        let tasks: Vec<i64> = tx
            .query("SELECT id FROM task WHERE project_id = $1 AND parent_id IS NULL AND space_id = $2", &[&project, &from])
            .await?
            .iter()
            .map(|r| r.get(0))
            .collect();
        for task in tasks {
            rehome_task(&tx, task, from, to, at, Some(project)).await?;
        }
        let notes: Vec<i64> =
            tx.query("SELECT id FROM note WHERE project_id = $1 AND space_id = $2", &[&project, &from]).await?.iter().map(|r| r.get(0)).collect();
        for note in notes {
            rehome_note(&tx, note, from, to, at).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn read_notifications(&self, me: &Me) -> Result<(), Fail> {
        let mut connection = self.pool.get().await?;
        let client = account_write(&mut connection, me).await?;
        client.execute("UPDATE notification SET read_at = $2 WHERE account_id = $1 AND read_at IS NULL", &[&me.id, &now_ms()]).await?;
        client.commit().await?;
        Ok(())
    }

    /// The account's kept Apple grant, if it has one, for the session asking:
    /// not found once the account's sessions were ended (as `delete_account`).
    pub async fn apple_grant(&self, me: &Me) -> Result<Option<Vec<u8>>, Fail> {
        let client = self.pool.get().await?;
        let row = client.query_opt(
            "SELECT g.sealed FROM account a LEFT JOIN apple_refresh_grant g ON g.account_id = a.id
             WHERE a.id = $1 AND a.session_generation IS NOT DISTINCT FROM $2",
            &[&me.id, &me.generation],
        ).await?.ok_or(Fail::NotFound)?;
        Ok(row.get(0))
    }

    /// Deletes the account: its own space and everything in it, its places
    /// in workspaces, and the workspaces it owns that nobody else is in. A
    /// workspace others are in passes to the member who joined first.
    pub async fn delete_account(&self, me: &Me) -> Result<(), Fail> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        tx.query_opt(
            "SELECT 1 FROM account WHERE id = $1 AND session_generation IS NOT DISTINCT FROM $2 FOR UPDATE",
            &[&me.id, &me.generation],
        ).await?.ok_or(Fail::NotFound)?;
        let spaces = spaces_of(&tx, &me.id).await?;
        lock(&tx, &spaces).await?;
        // A different member may just have left or handed ownership to us.
        let spaces = spaces_of(&tx, &me.id).await?;
        for space in &spaces {
            let others: Option<String> = tx
                .query_opt("SELECT account_id FROM member WHERE space_id = $1 AND account_id <> $2 ORDER BY joined LIMIT 1", &[&space.id, &me.id])
                .await?
                .map(|r| r.get(0));
            match (space.kind.as_str(), others) {
                ("workspace", Some(heir)) => {
                    Self::drop_member(&tx, space.id, &me.id).await?;
                    if space.role == "owner" {
                        tx.execute("UPDATE member SET role = 'owner' WHERE space_id = $1 AND account_id = $2", &[&space.id, &heir]).await?;
                        tx.execute("UPDATE space SET owner_id = $2 WHERE id = $1", &[&space.id, &heir]).await?;
                    }
                }
                _ => {
                    for table in ["task_assignee", "task", "note", "project", "entry", "tombstone", "notification"] {
                        tx.execute(&format!("DELETE FROM {table} WHERE space_id = $1"), &[&space.id]).await?;
                    }
                    tx.execute("DELETE FROM space WHERE id = $1", &[&space.id]).await?;
                }
            }
        }
        tx.execute("DELETE FROM notification WHERE account_id = $1", &[&me.id]).await?;
        tx.execute("DELETE FROM account WHERE id = $1", &[&me.id]).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Brings an account's tasks file from before Postgres into its own
    /// space: every row with its own `changed` and `seq`, tombstones too, and
    /// the space's counter where the file's was. That way an app that has
    /// not updated goes on asking "what is new since n" and gets the right answer.
    /// Does nothing for an account whose space already has rows.
    pub async fn import(&self, id: &str, file: &done_core::Exported) -> Result<bool, Fail> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        tx.execute("INSERT INTO account (id, created) VALUES ($1, $2) ON CONFLICT DO NOTHING", &[&id, &now_ms()]).await?;
        let personal = self.personal_in(&tx, id).await?;
        let used: i64 = tx.query_one("SELECT next_seq FROM space WHERE id = $1 FOR UPDATE", &[&personal]).await?.get(0);
        if used > 0 {
            return Ok(false);
        }
        let space = personal;
        for (Stamped { row: p, changed }, seq) in file.rows.projects.iter().zip(file.seqs.projects.iter().map(|s| (*s).max(1))) {
            tx.execute(
                "INSERT INTO project (id, space_id, name, color, changed, seq, sprint) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
                &[&p.id, &space, &p.name, &p.color, changed, &seq, &p.sprint.as_ref().map(done_core::Sprint::stored)],
            )
            .await?;
        }
        for (Stamped { row: t, changed }, seq) in file.rows.tasks.iter().zip(file.seqs.tasks.iter().map(|s| (*s).max(1))) {
            let done_day = if t.done { t.done_day.clone() } else { None };
            let goal_by = t.goal_day.as_ref().map(|_| id.to_string());
            tx.execute(
                "INSERT INTO task (id, space_id, title, notes, project_id, start, due, priority, status, done_day, goal_day, goal_by, parent_id, created_by, changed, seq)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT DO NOTHING",
                &[
                    &t.id,
                    &space,
                    &t.title,
                    &t.notes,
                    &t.project_id,
                    &t.start,
                    &t.due,
                    &t.priority,
                    &t.status,
                    &done_day,
                    &t.goal_day,
                    &goal_by,
                    &t.parent_id,
                    &id,
                    changed,
                    &seq,
                ],
            )
            .await?;
        }
        for (Stamped { row: n, changed }, seq) in file.rows.notes.iter().zip(file.seqs.notes.iter().map(|s| (*s).max(1))) {
            tx.execute(
                "INSERT INTO note (id, space_id, text, updated_at, project_id, folder, changed, seq) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING",
                &[&n.id, &space, &n.text, &n.updated_at, &n.project_id, &n.folder.clone().flatten(), changed, &seq],
            )
            .await?;
        }
        for (Stamped { row: e, changed }, seq) in file.rows.entries.iter().zip(file.seqs.entries.iter().map(|s| (*s).max(1))) {
            tx.execute(
                "INSERT INTO entry (id, space_id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms, changed, seq)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING",
                &[&e.id, &space, &e.task_id, &e.title, &e.day, &e.started_at, &e.ended_at, &e.planned_ms, &e.focused_ms, changed, &seq],
            )
            .await?;
        }
        for (g, seq) in file.rows.gone.iter().zip(file.seqs.gone.iter().map(|s| (*s).max(1))) {
            tx.execute(
                "INSERT INTO tombstone (kind, id, space_id, changed, seq) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
                &[&g.kind, &g.id, &space, &g.changed, &seq],
            )
            .await?;
        }
        // A row a device took in from elsewhere has 0 in its own file; it
        // is given 1, so a device that starts from scratch is sent it.
        tx.execute("UPDATE space SET next_seq = greatest(next_seq, $2, 1) WHERE id = $1", &[&space, &file.seq]).await?;
        tx.commit().await?;
        Ok(true)
    }

    /// How many rows an account's own space holds, by kind: for checking an import.
    pub async fn count(&self, id: &str) -> Result<[i64; 5], Fail> {
        let client = self.pool.get().await?;
        let space: i64 = client
            .query_opt("SELECT id FROM space WHERE owner_id = $1 AND kind = 'personal'", &[&id])
            .await?
            .ok_or(Fail::NotFound)?
            .get(0);
        let mut out = [0; 5];
        for (i, table) in ["project", "task", "note", "entry", "tombstone"].iter().enumerate() {
            out[i] = client.query_one(&format!("SELECT count(*) FROM {table} WHERE space_id = $1"), &[&space]).await?.get(0);
        }
        Ok(out)
    }
}

/// A note as live editing needs it: where it lives, its text, and its live
/// document as last saved (none until it has been written live).
pub struct LiveNote {
    pub space: i64,
    pub workspace: bool,
    pub text: String,
    pub ydoc: Option<Vec<u8>>,
}

/// What saving a live note found.
#[derive(Debug, PartialEq)]
pub enum Saved {
    Saved,
    /// Something else wrote the note since the room last saved it (a device,
    /// the browser's save, an agent): its text now, and the live document as
    /// the room last saved it, to take the difference in as an edit.
    Changed { text: String, ydoc: Option<Vec<u8>> },
    /// The note was deleted, or moved out of the space.
    Gone,
}

impl Db {
    pub async fn live_note(&self, note: i64) -> Result<Option<LiveNote>, Fail> {
        let client = self.pool.get().await?;
        let row = client
            .query_opt("SELECT n.space_id, s.kind = 'workspace', n.text, n.ydoc FROM note n JOIN space s ON s.id = n.space_id WHERE n.id = $1", &[&note])
            .await?;
        Ok(row.map(|r| LiveNote { space: r.get(0), workspace: r.get(1), text: r.get(2), ydoc: r.get(3) }))
    }

    /// Writes a live note's text and document, only if what is stored is
    /// still what the room last wrote (`expect`): otherwise it says what is
    /// there instead, and writes nothing. A new seq in its space, so devices
    /// fetch the text like any other change.
    pub async fn save_live(&self, note: i64, space: i64, text: &str, ydoc: &[u8], expect: &str) -> Result<Saved, Fail> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        let Some(row) = tx.query_opt("SELECT space_id, text, ydoc FROM note WHERE id = $1 FOR UPDATE", &[&note]).await? else {
            return Ok(Saved::Gone);
        };
        if row.get::<_, i64>(0) != space {
            return Ok(Saved::Gone);
        }
        let stored: String = row.get(1);
        let stored_doc: Option<Vec<u8>> = row.get(2);
        if stored != expect {
            return Ok(Saved::Changed { text: stored, ydoc: stored_doc });
        }
        if stored == text && stored_doc.as_deref() == Some(ydoc) {
            return Ok(Saved::Saved);
        }
        let now = now_ms();
        let seq = bump(&tx, space).await?;
        tx.execute(
            "UPDATE note SET text = $2, ydoc = $3, updated_at = $4, changed = greatest(changed + 1, $4), seq = $5 WHERE id = $1",
            &[&note, &text, &ydoc, &now, &seq],
        )
        .await?;
        tx.commit().await?;
        Ok(Saved::Saved)
    }

    /// Whether the person is in the workspace still: someone removed while a
    /// note is open is taken out of it.
    pub async fn in_workspace(&self, account: &str, generation: Option<i64>, space: i64) -> Result<bool, Fail> {
        let client = self.pool.get().await?;
        Ok(client
            .query_one(
                "SELECT EXISTS (SELECT 1 FROM member m JOIN space s ON s.id = m.space_id JOIN account a ON a.id = m.account_id WHERE m.space_id = $1 AND m.account_id = $2 AND s.kind = 'workspace' AND a.session_generation IS NOT DISTINCT FROM $3)",
                &[&space, &account, &generation],
            )
            .await?
            .get(0))
    }

    /// The workspace a note is in, for someone in it; "not found" for a note
    /// in someone's own space or one they cannot see.
    pub async fn note_workspace(&self, me: &Me, note: i64) -> Result<i64, Fail> {
        let client = self.pool.get().await?;
        let row = client.query_opt(
            "SELECT n.space_id FROM note n JOIN space s ON s.id = n.space_id
             JOIN member m ON m.space_id = s.id JOIN account a ON a.id = m.account_id
             WHERE n.id = $1 AND s.kind = 'workspace' AND a.id = $2 AND a.session_generation IS NOT DISTINCT FROM $3",
            &[&note, &me.id, &me.generation],
        ).await?.ok_or(Fail::NotFound)?;
        Ok(row.get(0))
    }
}

/// The spaces with their members and waiting invites, and the person's
/// notifications: what the window needs to draw the picker, Settings and
/// the bell. Invites to the person are read from the invites themselves, so
/// one made before they had an account shows up at their first sign-in.
async fn team_in(client: &impl GenericClient, me: &Me, spaces: &[In]) -> Result<Value, Fail> {
    let ids: Vec<i64> = spaces.iter().map(|s| s.id).collect();
    let rows = client.query("SELECT id, kind, name, owner_id FROM space WHERE id = ANY($1)", &[&ids]).await?;
    let info: HashMap<i64, (String, String, String)> = rows.iter().map(|r| (r.get(0), (r.get(1), r.get(2), r.get(3)))).collect();
    let people = client
        .query(
            "SELECT m.space_id, a.id, a.name, a.email, a.picture, m.role FROM member m JOIN account a ON a.id = m.account_id
             WHERE m.space_id = ANY($1) ORDER BY m.joined, a.id",
            &[&ids],
        )
        .await?;
    let now = now_ms();
    let waiting = client
        .query(
            "SELECT id, space_id, email, created, expires FROM invite WHERE space_id = ANY($1) AND state = 'pending' AND expires > $2 ORDER BY created",
            &[&ids, &now],
        )
        .await?;
    let mut list = Vec::new();
    for s in spaces {
        let (kind, name, owner) = info.get(&s.id).cloned().unwrap_or_default();
        let members: Vec<Value> = people
            .iter()
            .filter(|p| p.get::<_, i64>(0) == s.id)
            .map(|p| json!({ "id": p.get::<_, String>(1), "name": p.get::<_, String>(2), "email": p.get::<_, String>(3), "picture": p.get::<_, String>(4), "role": p.get::<_, String>(5) }))
            .collect();
        let invites: Vec<Value> = waiting
            .iter()
            .filter(|i| i.get::<_, i64>(1) == s.id)
            .map(|i| json!({ "id": i.get::<_, i64>(0), "email": i.get::<_, String>(2), "created": i.get::<_, i64>(3), "expires": i.get::<_, i64>(4) }))
            .collect();
        list.push(json!({ "id": s.id, "kind": kind, "name": name, "owner": owner, "role": s.role, "members": members, "invites": invites }));
    }
    let mut notifications = Vec::new();
    for r in client
        .query(
            "SELECT i.id, s.name, a.id, a.name, a.picture, i.created, (SELECT count(*) FROM member WHERE space_id = s.id)
             FROM invite i JOIN space s ON s.id = i.space_id LEFT JOIN account a ON a.id = i.invited_by
             WHERE i.email = $1 AND i.state = 'pending' AND i.expires > $2 AND i.email <> '' ORDER BY i.created DESC",
            &[&me.email, &now],
        )
        .await?
    {
        notifications.push(json!({
            "id": format!("invite-{}", r.get::<_, i64>(0)), "kind": "invite", "invite": r.get::<_, i64>(0),
            "spaceName": r.get::<_, String>(1), "members": r.get::<_, i64>(6),
            "by": { "id": r.get::<_, Option<String>>(2), "name": r.get::<_, Option<String>>(3), "picture": r.get::<_, Option<String>>(4) },
            "created": r.get::<_, i64>(5), "read": false,
        }));
    }
    for r in client
        .query(
            "SELECT n.id, n.kind, n.space_id, s.name, n.task_id, t.title, a.id, a.name, a.picture, n.created, n.read_at IS NOT NULL, t.project_id
             FROM notification n LEFT JOIN space s ON s.id = n.space_id LEFT JOIN task t ON t.id = n.task_id AND t.space_id = ANY($2)
             LEFT JOIN account a ON a.id = n.by_account
             WHERE n.account_id = $1 ORDER BY n.created DESC LIMIT 50",
            // A task that has left the reader's spaces is named by nothing.
            &[&me.id, &ids],
        )
        .await?
    {
        notifications.push(json!({
            "id": r.get::<_, i64>(0).to_string(), "kind": r.get::<_, String>(1), "space": r.get::<_, Option<i64>>(2),
            "spaceName": r.get::<_, Option<String>>(3), "task": r.get::<_, Option<i64>>(4), "taskTitle": r.get::<_, Option<String>>(5),
            "projectId": r.get::<_, Option<i64>>(11),
            "by": { "id": r.get::<_, Option<String>>(6), "name": r.get::<_, Option<String>>(7), "picture": r.get::<_, Option<String>>(8) },
            "created": r.get::<_, i64>(9), "read": r.get::<_, bool>(10),
        }));
    }
    Ok(json!({ "me": me.id, "personal": me.personal, "spaces": list, "notifications": notifications }))
}

/// A fresh, empty database for each test, on the Postgres that DONE_TEST_PG
/// names: a libpq connection string without dbname, such as
/// "host=/tmp port=54329 user=done" (CI sets one; see AGENTS.md).
#[cfg(test)]
pub mod testing {
    use super::*;

    pub async fn database() -> String {
        let base = std::env::var("DONE_TEST_PG")
            .expect("The server's tests need a Postgres to make databases in. Set DONE_TEST_PG, e.g. \"host=/tmp port=54329 user=done\".");
        let name = format!("done_test_{:x}", rand::random::<u64>());
        let (client, connection) = tokio_postgres::connect(&format!("{base} dbname=postgres"), NoTls).await.expect("reach DONE_TEST_PG");
        tokio::spawn(connection);
        client.execute(&format!("CREATE DATABASE {name}"), &[]).await.unwrap();
        format!("{base} dbname={name}")
    }

    pub async fn db() -> Db {
        Db::connect(&database().await).await.unwrap()
    }

    pub async fn stored_apple_grants(db: &Db, account: &str) -> Vec<Vec<u8>> {
        db.pool.get().await.unwrap()
            .query("SELECT sealed FROM apple_refresh_grant WHERE account_id = $1", &[&account]).await.unwrap()
            .into_iter().map(|row| row.get(0)).collect()
    }

    /// What a stored grant looks like to a server whose key changed.
    pub async fn garble_apple_grants(db: &Db, account: &str) {
        db.pool.get().await.unwrap()
            .execute("UPDATE apple_refresh_grant SET sealed = '\\x01deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'::bytea WHERE account_id = $1", &[&account]).await.unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use done_core::{Account, Held, Leaving, Store};
    use std::path::Path;

    const TODAY: &str = "2026-11-23";

    #[tokio::test]
    async fn existing_sessions_survive_migration_until_the_account_is_deleted() {
        let db = testing::db().await;
        let me = db.me("existing", "owner@example.com", "Owner", "").await.unwrap();
        db.pool.get().await.unwrap().execute(
            "UPDATE account SET session_generation = NULL WHERE id = $1", &[&me.id],
        ).await.unwrap();
        let old = db.session_account(&me.id, None).await.unwrap().unwrap();
        db.delete_account(&old).await.unwrap();
        assert!(db.session_account(&old.id, None).await.unwrap().is_none());
        assert!(db.import(&old.id, &device().export().unwrap()).await.unwrap());
        assert!(db.session_account(&old.id, None).await.unwrap().is_none());
        let new = db.me(&old.id, &old.email, "Owner", "").await.unwrap();
        assert!(new.generation.is_some());
        assert!(db.session_account(&new.id, None).await.unwrap().is_none());
        assert!(matches!(db.delete_account(&old).await, Err(Fail::NotFound)));
        assert!(db.session_account(&new.id, new.generation).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn already_authenticated_requests_cannot_use_a_recreated_account() {
        let db = testing::db().await;
        let old = db.me("same-id", "me@example.com", "Me", "").await.unwrap();
        db.delete_account(&old).await.unwrap();
        let new = db.me(&old.id, &old.email, "Me", "").await.unwrap();
        let workspace = db.create_workspace(&new, "New workspace").await.unwrap();

        assert!(matches!(db.create_workspace(&old, "Stale workspace").await, Err(Fail::NotFound)));
        assert!(matches!(db.add_feedback(&old, "bug", "Stale feedback").await, Err(Fail::NotFound)));
        assert!(matches!(db.read_notifications(&old).await, Err(Fail::NotFound)));
        assert!(matches!(db.feedback(&old).await, Err(Fail::NotFound)));
        assert!(matches!(db.state(&old, TODAY).await, Err(Fail::NotFound)));
        assert!(matches!(db.team(&old).await, Err(Fail::NotFound)));
        assert!(!db.in_workspace(&old.id, old.generation, workspace).await.unwrap());
        assert!(db.in_workspace(&new.id, new.generation, workspace).await.unwrap());
        assert!(db.feedback(&new).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn deletion_waits_for_an_authorized_write_but_read_snapshots_stay_on_their_account() {
        let db = testing::db().await;
        let old = db.me("one", "one@example.com", "", "").await.unwrap();
        let mut writer = db.pool.get().await.unwrap();
        let tx = account_write(&mut writer, &old).await.unwrap();
        let other = db.pool.get().await.unwrap();
        // NOWAIT tests the same exclusive row lock deletion needs, without timers.
        let busy = other.query_opt("SELECT id FROM account WHERE id = $1 FOR UPDATE NOWAIT", &[&old.id]).await.unwrap_err();
        assert_eq!(busy.code(), Some(&tokio_postgres::error::SqlState::LOCK_NOT_AVAILABLE));
        tx.commit().await.unwrap();

        let mut reader = db.pool.get().await.unwrap();
        let snapshot = account_snapshot(&mut reader, &old).await.unwrap();
        db.delete_account(&old).await.unwrap();
        let new = db.me(&old.id, &old.email, "", "").await.unwrap();
        assert_ne!(new.personal, old.personal);
        let spaces = spaces_of(&snapshot, &old.id).await.unwrap();
        assert_eq!(spaces.len(), 1);
        assert_eq!(spaces[0].id, old.personal);
    }

    #[tokio::test]
    async fn deleting_both_members_cannot_leave_an_ownerless_workspace() {
        let db = testing::db().await;
        let (owner, member) = people(&db).await;
        let space = hop(&db, &owner, &member).await;
        let (a, b) = tokio::join!(db.delete_account(&owner), db.delete_account(&member));
        a.unwrap();
        b.unwrap();
        assert!(db.pool.get().await.unwrap().query_opt("SELECT id FROM space WHERE id = $1", &[&space]).await.unwrap().is_none());
    }

    fn device() -> Store {
        Store::open(Path::new(":memory:")).unwrap()
    }

    fn task(id: i64, title: &str) -> Task {
        serde_json::from_value(json!({ "id": id, "title": title })).unwrap()
    }

    /// One round, as an app does it every few seconds.
    async fn round(d: &Store, db: &Db, me: &Me) -> Reply {
        let out = d.outbox().unwrap();
        let reply = db.exchange(me, &out).await.unwrap();
        d.inbox(&reply, out.upto).unwrap();
        reply
    }

    fn change(d: &Store, f: impl FnOnce(&mut Change)) {
        let mut c = Change { rev: d.state(TODAY).unwrap().rev, ..Default::default() };
        f(&mut c);
        d.sync(c).unwrap();
    }

    fn next(d: &Store) -> i64 {
        d.state(TODAY).unwrap().next_id
    }

    fn titles(d: &Store) -> Vec<String> {
        let mut t: Vec<String> = d.state(TODAY).unwrap().tasks.into_iter().map(|t| t.title).collect();
        t.sort();
        t
    }

    async fn people(db: &Db) -> (Me, Me) {
        let julius = db.me("1001", "Julius@hop.dev", "Julius Olsson", "https://lh3.googleusercontent.com/j").await.unwrap();
        let geart = db.me("1002", "geart@hop.dev", "Geart", "").await.unwrap();
        (julius, geart)
    }

    /// Julius makes Hop and Geart joins it through the invite in his bell.
    async fn hop(db: &Db, julius: &Me, geart: &Me) -> i64 {
        let space = db.create_workspace(julius, "  Hop ").await.unwrap();
        let made = db.invite(julius, space, "Geart@Hop.dev ", "https://thedone.app").await.unwrap();
        let bell = db.team(geart).await.unwrap();
        assert_eq!(bell["notifications"][0]["kind"], "invite");
        assert_eq!(bell["notifications"][0]["spaceName"], "Hop");
        assert_eq!(db.accept(geart, Some(made.invite), None).await.unwrap(), space);
        space
    }

    #[tokio::test]
    async fn a_sprint_round_trips_and_a_legacy_edit_preserves_it() {
        let db = testing::db().await;
        let (owner, _) = people(&db).await;
        let (mac, phone) = (device(), device());
        let id = next(&mac);
        let mut project = Project { id, name: "Launch".into(), color: 3, space_id: None, sprint: None };
        change(&mac, |c| c.projects.push(project.clone()));
        round(&mac, &db, &owner).await;
        round(&phone, &db, &owner).await;

        project.sprint = Some(done_core::Sprint { enabled: true, deadline: Some("2026-12-04".into()), completed: true });
        change(&mac, |c| c.projects.push(project.clone()));
        round(&mac, &db, &owner).await;
        round(&phone, &db, &owner).await;
        assert_eq!(phone.state(TODAY).unwrap().projects[0].sprint, project.sprint);

        let mut legacy = project.clone();
        legacy.name = "Release".into();
        legacy.sprint = None;
        let rows = Rows { projects: vec![Stamped { row: legacy, changed: now_ms() + 1_000 }], ..Default::default() };
        db.exchange(&owner, &Outbox { rows, ..Default::default() }).await.unwrap();
        let web = db.state(&owner, TODAY).await.unwrap();
        assert_eq!(web.projects[0].name, "Release");
        assert_eq!(web.projects[0].sprint, project.sprint);
        round(&phone, &db, &owner).await;
        assert_eq!(phone.state(TODAY).unwrap().projects[0].sprint, project.sprint);

        project.sprint.as_mut().unwrap().deadline = Some("Friday".into());
        let invalid = db.sync(&owner, Change { projects: vec![project], ..Default::default() }).await;
        assert!(matches!(invalid, Err(Fail::Invalid(message)) if message.contains("sprint deadline")));
    }

    #[tokio::test]
    async fn every_sprint_change_reaches_the_server_and_the_other_device_past_old_style_renames() {
        let db = testing::db().await;
        let (owner, _) = people(&db).await;
        let (mac, phone) = (device(), device());
        let sprint = |enabled, deadline: Option<&str>, completed| Some(done_core::Sprint { enabled, deadline: deadline.map(Into::into), completed });
        let id = next(&mac);
        change(&mac, |c| c.projects.push(Project { id, name: "Launch".into(), color: 3, space_id: None, sprint: None }));
        round(&mac, &db, &owner).await;
        round(&phone, &db, &owner).await;
        for (step, s) in [
            ("set", sprint(true, Some("2026-12-04"), false)),
            ("change the deadline", sprint(true, Some("2026-12-11"), false)),
            ("complete", sprint(true, Some("2026-12-11"), true)),
            ("clear the deadline", sprint(true, None, true)),
            ("turn off", sprint(false, None, false)),
            ("turn on again", sprint(true, Some("2027-01-01"), false)),
        ] {
            let project = Project { sprint: s.clone(), ..mac.state(TODAY).unwrap().projects[0].clone() };
            change(&mac, |c| c.projects.push(project));
            round(&mac, &db, &owner).await;
            assert_eq!(db.state(&owner, TODAY).await.unwrap().projects[0].sprint, s, "server after {step}");
            round(&phone, &db, &owner).await;
            assert_eq!(phone.state(TODAY).unwrap().projects[0].sprint, s, "phone after {step}");

            // An older app renames it, as it sends a project: no sprint key.
            let mut legacy = serde_json::to_value(Stamped { row: phone.state(TODAY).unwrap().projects[0].clone(), changed: now_ms() + 1_000 }).unwrap();
            legacy["name"] = format!("Renamed after {step}").into();
            legacy.as_object_mut().unwrap().remove("sprint");
            let rows = Rows { projects: vec![serde_json::from_value(legacy).unwrap()], ..Default::default() };
            db.exchange(&owner, &Outbox { rows, ..Default::default() }).await.unwrap();
            assert_eq!(db.state(&owner, TODAY).await.unwrap().projects[0].sprint, s, "server after the rename past {step}");
            round(&phone, &db, &owner).await;
            round(&mac, &db, &owner).await;
            for (who, d) in [("phone", &phone), ("mac", &mac)] {
                let p = d.state(TODAY).unwrap().projects[0].clone();
                assert_eq!((p.name.as_str(), &p.sprint), (format!("Renamed after {step}").as_str(), &s), "{who} after the rename past {step}");
            }
        }
    }

    #[tokio::test]
    async fn a_project_moved_into_a_workspace_reaches_the_other_member_whole() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let (mac, phone) = (device(), device());
        let launch = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: launch, name: "Launch".into(), color: 3, space_id: None, sprint: None });
            c.projects.push(Project { id: launch + 1, name: "Home".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(launch), ..task(launch + 2, "Order equipment") });
            c.tasks.push(Task { project_id: Some(launch), parent_id: Some(launch + 2), ..task(launch + 3, "Batteries") });
            c.tasks.push(Task { project_id: Some(launch + 1), ..task(launch + 4, "Call the landlord") });
        });
        mac.save_note(SaveNote { id: None, text: "Pilot checklist".into(), updated_at: 1, project_id: Some(launch), folder: None, space_id: None }).unwrap();
        round(&mac, &db, &julius).await;
        let space = hop(&db, &julius, &geart).await;
        db.move_project(&julius, launch, space).await.unwrap();

        round(&phone, &db, &geart).await;
        assert_eq!(titles(&phone), vec!["Batteries", "Order equipment"], "Geart sees Hop's tasks and none of Julius's own");
        assert_eq!(phone.notes().unwrap().len(), 1);
        let state = phone.state(TODAY).unwrap();
        assert_eq!(state.projects.iter().map(|p| (p.name.as_str(), p.space_id)).collect::<Vec<_>>(), vec![("Launch", Some(space))]);
        assert_eq!(state.team.as_ref().unwrap()["spaces"].as_array().unwrap().len(), 2);
        // Julius's own device keeps everything, now partly in Hop.
        round(&mac, &db, &julius).await;
        let mine = mac.state(TODAY).unwrap();
        assert_eq!(mine.tasks.len(), 3);
        assert_eq!(mine.tasks.iter().filter(|t| t.space_id == Some(space)).count(), 2);
        // An edit by Geart comes back to Julius.
        change(&phone, |c| c.tasks.push(Task { project_id: Some(launch), ..task(launch + 2, "Order equipment for the pilot") }));
        round(&phone, &db, &geart).await;
        round(&mac, &db, &julius).await;
        assert!(titles(&mac).contains(&"Order equipment for the pilot".to_string()));
    }

    #[tokio::test]
    async fn nothing_in_a_space_one_is_not_in_can_be_read_written_pointed_at_or_deleted() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let mac = device();
        let home = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: home, name: "Home".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(home), ..task(home + 1, "Renew passport") });
        });
        mac.save_note(SaveNote { id: None, text: "Private".into(), updated_at: 1, project_id: None, folder: None, space_id: None }).unwrap();
        round(&mac, &db, &julius).await;
        let note = mac.notes().unwrap()[0].id;

        // Geart, not in any space with Julius, guesses every id.
        let stranger = Rows {
            projects: vec![Stamped { row: Project { id: home, name: "Mine now".into(), color: 0, space_id: Some(julius.personal), sprint: None }, changed: now_ms() }],
            tasks: vec![
                Stamped { row: task(home + 1, "Overwritten"), changed: now_ms() },
                Stamped { row: Task { project_id: Some(home), ..task(home + 50, "Planted in Julius's project") }, changed: now_ms() },
            ],
            notes: vec![Stamped {
                row: Note { id: fresh_id(), text: "Into Julius's space".into(), updated_at: 1, project_id: None, folder: None, space_id: Some(julius.personal) },
                changed: now_ms(),
            }],
            gone: vec![Gone { kind: "note".into(), id: note, changed: now_ms() + 1000, space: None }],
            ..Default::default()
        };
        let reply = db.exchange(&geart, &Outbox { rows: stranger, cursors: Some(vec![Cursor { space: julius.personal, at: 0 }]), ..Default::default() }).await.unwrap();
        // Nothing of Julius's came back, even when asked for his space by id.
        assert!(reply.rows.projects.iter().all(|p| p.row.id != home));
        assert!(reply.rows.tasks.iter().all(|t| t.row.title != "Renew passport"));
        assert!(reply.spaces.unwrap().iter().all(|c| c.space != julius.personal));
        // What was refused is named back, so a device does not count it as
        // sent; only ids Geart sent himself (which the reply's silence about
        // them already gave away).
        let refused: Vec<(&str, i64)> = reply.refused.iter().map(|r| (r.kind.as_str(), r.id)).collect();
        assert_eq!(refused, vec![("project", home), ("task", home + 1), ("task", home + 50)]);
        // And Julius's things are exactly as they were.
        round(&mac, &db, &julius).await;
        assert_eq!(titles(&mac), vec!["Renew passport"]);
        assert_eq!(mac.notes().unwrap().iter().map(|n| n.text.as_str()).collect::<Vec<_>>(), vec!["Private"]);
        assert_eq!(mac.state(TODAY).unwrap().projects[0].name, "Home");
        // The note Geart aimed at Julius's space landed in Geart's own.
        assert_eq!(db.notes(&geart).await.unwrap().iter().map(|n| (n.text.as_str(), n.space_id)).collect::<Vec<_>>(), vec![("Into Julius's space", Some(geart.personal))]);
        // The workspace calls answer "not found" for a space one is not in.
        let theirs = julius.personal;
        assert!(matches!(db.invite(&geart, theirs, "x@y.z", "").await, Err(Fail::NotFound)));
        assert!(matches!(db.move_project(&geart, home, geart.personal).await, Err(Fail::NotFound)));
        assert!(matches!(db.rename_workspace(&geart, theirs, "Mine").await, Err(Fail::NotFound)));
    }

    #[tokio::test]
    async fn two_people_assigning_at_once_keep_both_and_the_other_is_told() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Open the bank account") });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        // Both, offline, put someone on the same task.
        change(&mac, |c| c.assign.push(Assign { task_id: p + 1, account_id: geart.id.clone(), on: true }));
        change(&phone, |c| c.assign.push(Assign { task_id: p + 1, account_id: geart.id.clone(), on: true }));
        change(&phone, |c| c.assign.push(Assign { task_id: p + 1, account_id: julius.id.clone(), on: true }));
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        round(&mac, &db, &julius).await;
        for d in [&mac, &phone] {
            let mut on = d.state(TODAY).unwrap().tasks[0].assignees.clone();
            on.sort();
            assert_eq!(on, vec!["1001", "1002"]);
        }
        // Julius put Geart on it; Geart put Julius on it. Each hears of the other's, once.
        let told = |team: Value| team["notifications"].as_array().unwrap().iter().filter(|n| n["kind"] == "assigned").count();
        assert_eq!(told(db.team(&geart).await.unwrap()), 1);
        assert_eq!(told(db.team(&julius).await.unwrap()), 1);
        // Nobody can be put on a task in someone's own space, or someone outside the workspace.
        let own = next(&mac);
        change(&mac, |c| c.tasks.push(task(own, "Personal")));
        change(&mac, |c| c.assign.push(Assign { task_id: own, account_id: geart.id.clone(), on: true }));
        change(&mac, |c| c.assign.push(Assign { task_id: p + 1, account_id: "9999".into(), on: true }));
        round(&mac, &db, &julius).await;
        let state = db.state(&julius, TODAY).await.unwrap();
        assert!(state.tasks.iter().find(|t| t.id == own).unwrap().assignees.is_empty());
        assert_eq!(state.tasks.iter().find(|t| t.id == p + 1).unwrap().assignees.len(), 2);
    }

    #[tokio::test]
    async fn someone_removed_loses_the_workspace_on_their_next_sync_and_is_taken_off_its_tasks() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Ship it") });
            c.assign.push(Assign { task_id: p + 1, account_id: geart.id.clone(), on: true });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        assert_eq!(titles(&phone), vec!["Ship it"]);
        // Meanwhile Geart edits offline.
        change(&phone, |c| c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Ship it, by Geart") }));
        assert!(matches!(db.remove_member(&geart, space, &julius.id).await, Err(Fail::Invalid(_))), "only the owner removes");
        db.remove_member(&julius, space, &geart.id).await.unwrap();
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).is_empty(), "the workspace is gone from the removed device");
        assert!(phone.state(TODAY).unwrap().projects.is_empty());
        round(&mac, &db, &julius).await;
        assert_eq!(titles(&mac), vec!["Ship it"], "the removed member's late edit did not land");
        assert!(mac.state(TODAY).unwrap().tasks[0].assignees.is_empty());
    }

    #[tokio::test]
    async fn moving_a_project_back_out_cannot_be_undone_by_a_late_edit() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Ship it") });
            c.tasks.push(Task { project_id: Some(p), parent_id: Some(p + 1), ..task(p + 2, "Part") });
            c.assign.push(Assign { task_id: p + 1, account_id: geart.id.clone(), on: true });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        change(&phone, |c| c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Late edit") }));
        assert!(matches!(db.move_project(&geart, p, geart.personal).await, Err(Fail::Invalid(_))), "only the owner moves out");
        db.move_project(&julius, p, julius.personal).await.unwrap();
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).is_empty());
        round(&mac, &db, &julius).await;
        let state = mac.state(TODAY).unwrap();
        assert_eq!(titles(&mac), vec!["Part", "Ship it"]);
        assert!(state.tasks.iter().all(|t| t.space_id == Some(julius.personal)), "{:?}", state.tasks);
        assert!(state.tasks.iter().all(|t| t.assignees.is_empty()), "nobody is on a task in one's own space");
    }

    #[tokio::test]
    async fn a_task_put_into_another_space_s_project_goes_there_with_its_subtasks() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(task(p + 1, "From my inbox"));
            c.tasks.push(Task { parent_id: Some(p + 1), ..task(p + 2, "Its part") });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).is_empty());
        change(&mac, |c| c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "From my inbox") }));
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        assert_eq!(titles(&phone), vec!["From my inbox", "Its part"]);
        // A task with no project in a workspace stays in it.
        change(&phone, |c| c.tasks.push(task(p + 1, "From my inbox")));
        round(&phone, &db, &geart).await;
        round(&mac, &db, &julius).await;
        assert!(db.state(&geart, TODAY).await.unwrap().tasks.iter().any(|t| t.id == p + 1 && t.project_id.is_none()));
    }

    #[tokio::test]
    async fn a_goal_is_one_person_s() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), goal_day: Some(TODAY.into()), ..task(p + 1, "Julius's goal") });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 2, "Geart's goal") });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        change(&phone, |c| c.tasks.push(Task { project_id: Some(p), goal_day: Some(TODAY.into()), goal_by: Some(geart.id.clone()), ..task(p + 2, "Geart's goal") }));
        round(&phone, &db, &geart).await;
        round(&mac, &db, &julius).await;
        let goals: Vec<(String, Option<String>)> =
            db.state(&julius, TODAY).await.unwrap().tasks.into_iter().filter(|t| t.goal_day.is_some()).map(|t| (t.title, t.goal_by)).collect();
        assert_eq!(goals, vec![("Julius's goal".into(), Some("1001".into())), ("Geart's goal".into(), Some("1002".into()))]);
        // Julius renaming Geart's goal leaves it Geart's.
        change(&mac, |c| c.tasks.push(Task { project_id: Some(p), goal_day: Some(TODAY.into()), goal_by: Some(geart.id.clone()), ..task(p + 2, "Geart's goal, renamed") }));
        round(&mac, &db, &julius).await;
        let t = db.state(&julius, TODAY).await.unwrap().tasks.into_iter().find(|t| t.id == p + 2).unwrap();
        assert_eq!(t.goal_by.as_deref(), Some("1002"));
    }

    #[tokio::test]
    async fn invites_reach_new_people_at_sign_in_and_hold_to_their_address() {
        let db = testing::db().await;
        let julius = db.me("1001", "julius@hop.dev", "Julius", "").await.unwrap();
        let space = db.create_workspace(&julius, "Hop").await.unwrap();
        let made = db.invite(&julius, space, "ana@studio.se", "https://thedone.app").await.unwrap();
        let token = made.link.rsplit('/').next().unwrap().to_string();
        let page = db.invite_page(&token).await.unwrap();
        assert_eq!((page.space.as_str(), page.email.as_str(), page.members, page.state.as_str()), ("Hop", "a•••@studio.se", 1, "pending"));
        // Someone else opening the link cannot use it, and cannot use it by id either.
        let other = db.me("1003", "other@x.com", "Other", "").await.unwrap();
        assert!(matches!(db.accept(&other, None, Some(&token)).await, Err(Fail::Invalid(why)) if why.contains("a•••@studio.se")));
        assert!(matches!(db.accept(&other, Some(made.invite), None).await, Err(Fail::NotFound)));
        assert!(db.team(&other).await.unwrap()["notifications"].as_array().unwrap().is_empty());
        // Ana signs up later: the invite is waiting in her bell.
        let ana = db.me("1004", "Ana@Studio.se", "Ana", "").await.unwrap();
        assert_eq!(db.team(&ana).await.unwrap()["notifications"][0]["invite"], made.invite);
        // A fresh link replaces the old one.
        let again = db.invite_link(&julius, made.invite, "https://thedone.app").await.unwrap();
        assert!(matches!(db.invite_page(&token).await, Err(Fail::NotFound)));
        let token = again.link.rsplit('/').next().unwrap().to_string();
        assert_eq!(db.accept(&ana, None, Some(&token)).await.unwrap(), space);
        assert!(matches!(db.accept(&ana, None, Some(&token)).await, Err(Fail::Invalid(_))), "used once");
        // Julius hears that she joined.
        assert_eq!(db.team(&julius).await.unwrap()["notifications"][0]["kind"], "joined");
        // Declined and revoked invites are gone from the bell.
        let second = db.invite(&julius, space, "bo@x.com", "").await.unwrap();
        let bo = db.me("1005", "bo@x.com", "Bo", "").await.unwrap();
        db.decline(&bo, second.invite).await.unwrap();
        assert!(db.team(&bo).await.unwrap()["notifications"].as_array().unwrap().is_empty());
        let third = db.invite(&julius, space, "cy@x.com", "").await.unwrap();
        db.revoke(&julius, third.invite).await.unwrap();
        let cy = db.me("1006", "cy@x.com", "Cy", "").await.unwrap();
        assert!(matches!(db.accept(&cy, Some(third.invite), None).await, Err(Fail::Invalid(_))));
        // Twenty a day per workspace.
        for i in 0..17 {
            db.invite(&julius, space, &format!("p{i}@x.com"), "").await.unwrap();
        }
        assert!(matches!(db.invite(&julius, space, "one-more@x.com", "").await, Err(Fail::Invalid(why)) if why.contains("20 invites")));
    }

    // The move to Postgres, as it will run on the real accounts: a device
    // that synced with the old server keeps syncing with the new one, from
    // where it was, without fetching or sending everything again.
    #[tokio::test]
    async fn an_app_that_synced_with_the_old_server_carries_on_after_the_import() {
        let (mac, old) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Home".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "One") });
            c.tasks.push(task(p + 2, "Two"));
        });
        mac.record(NewEntry { task_id: None, title: "Focus".into(), day: TODAY.into(), started_at: 1, ended_at: 2, planned_ms: 1, focused_ms: 1 }).unwrap();
        // Rounds with the old server, as an app does before the move.
        for _ in 0..2 {
            let out = mac.outbox().unwrap();
            let mut out_old = out;
            out_old.cursors = None;
            let reply = old.exchange(&out_old).unwrap();
            mac.inbox(&reply, out_old.upto).unwrap();
        }
        let gone = mac.state(TODAY).unwrap().tasks.iter().find(|t| t.title == "Two").unwrap().id;
        change(&mac, |c| c.delete_tasks.push(gone));
        let out = mac.outbox().unwrap();
        let reply = old.exchange(&Outbox { cursors: None, ..out }).unwrap();
        mac.inbox(&reply, mac.outbox().unwrap().upto).unwrap();

        let db = testing::db().await;
        let file = old.export().unwrap();
        assert!(db.import("1001", &file).await.unwrap());
        assert!(!db.import("1001", &file).await.unwrap(), "a second run leaves it alone");
        assert_eq!(db.count("1001").await.unwrap(), [1, 1, 0, 1, 1]);
        let julius = db.me("1001", "julius@hop.dev", "Julius", "").await.unwrap();

        // An app that has not updated: nothing new either way, so nothing comes back.
        let legacy = Outbox { cursors: None, ..mac.outbox().unwrap() };
        assert!(legacy.rows.is_empty());
        let reply = db.exchange(&julius, &legacy).await.unwrap();
        assert!(reply.rows.is_empty(), "the old app was sent things it has: {:?}", reply.rows);
        assert!(reply.spaces.is_none() && reply.team.is_none());
        // It adds a task; only that goes up, and the browser sees it.
        let id = next(&mac);
        change(&mac, |c| c.tasks.push(task(id, "Three")));
        let legacy = Outbox { cursors: None, ..mac.outbox().unwrap() };
        let reply = db.exchange(&julius, &legacy).await.unwrap();
        mac.inbox(&reply, legacy.upto).unwrap();
        let web: Vec<String> = db.state(&julius, TODAY).await.unwrap().tasks.into_iter().map(|t| t.title).collect();
        assert_eq!(web, vec!["One", "Three"]);
        // Updated, the same app goes on from its old position too.
        let reply = round(&mac, &db, &julius).await;
        assert!(reply.rows.tasks.iter().all(|t| t.row.title == "Three"), "{:?}", reply.rows.tasks);
        assert_eq!(titles(&mac), vec!["One", "Three"]);
        assert_eq!(db.entries(&julius, TODAY).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn deleting_a_workspace_takes_it_from_everyone_and_an_account_passes_its_workspaces_on() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let phone = device();
        let p = next(&phone);
        change(&phone, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Ship it") });
        });
        round(&phone, &db, &geart).await;
        assert_eq!(titles(&phone), vec!["Ship it"]);
        assert!(matches!(db.leave(&julius, space).await, Err(Fail::Invalid(_))), "an owner deletes, not leaves");
        // Julius deletes his account: Hop passes to Geart, with its tasks.
        db.delete_account(&julius).await.unwrap();
        let team = db.team(&geart).await.unwrap();
        let hop = team["spaces"].as_array().unwrap().iter().find(|s| s["id"] == space).unwrap().clone();
        assert_eq!((hop["role"].as_str(), hop["members"].as_array().unwrap().len()), (Some("owner"), 1));
        assert_eq!(db.state(&geart, TODAY).await.unwrap().tasks.len(), 1);
        db.delete_workspace(&geart, space).await.unwrap();
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).is_empty());
    }

    // From the review of PR #50: each of these failed before its fix.

    #[tokio::test]
    async fn the_bell_never_names_a_task_that_has_left_one_s_spaces() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let mac = device();
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Shared") });
            c.assign.push(Assign { task_id: p + 1, account_id: geart.id.clone(), on: true });
        });
        round(&mac, &db, &julius).await;
        db.move_project(&julius, p, julius.personal).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        db.sync(&julius, Change { tasks: vec![Task { project_id: Some(p), ..task(p + 1, "Julius private secret") }], ..Default::default() }).await.unwrap();
        let bell = db.team(&geart).await.unwrap();
        assert!(!bell["notifications"].to_string().contains("private secret"), "{}", bell["notifications"]);
        assert!(!bell["notifications"].to_string().contains(&p.to_string()), "the project is named too");
    }

    #[tokio::test]
    async fn a_subtask_moved_with_its_task_goes_into_the_task_s_new_project() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let mac = device();
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Mine".into(), color: 3, space_id: None, sprint: None });
            c.projects.push(Project { id: p + 1, name: "Hop".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 2, "Parent") });
            c.tasks.push(Task { project_id: Some(p), parent_id: Some(p + 2), ..task(p + 3, "Child") });
        });
        round(&mac, &db, &julius).await;
        // Only the task is sent with its new project, as the window does.
        db.sync(&julius, Change { tasks: vec![Task { project_id: Some(p + 1), ..task(p + 2, "Parent") }], ..Default::default() }).await.unwrap();
        let child = db.state(&geart, TODAY).await.unwrap().tasks.into_iter().find(|t| t.id == p + 3).unwrap();
        assert_eq!((child.space_id, child.project_id), (Some(space), Some(p + 1)));
    }

    #[tokio::test]
    async fn an_account_made_again_is_synced_from_the_start_on_a_device_that_knew_the_old_one() {
        let db = testing::db().await;
        let julius = db.me("1001", "julius@hop.dev", "J", "").await.unwrap();
        let mac = device();
        for i in 0..5 {
            let id = next(&mac);
            change(&mac, |c| c.tasks.push(task(id, &format!("t{i}"))));
            round(&mac, &db, &julius).await;
        }
        db.delete_account(&julius).await.unwrap();
        let julius = db.me("1001", "julius@hop.dev", "J", "").await.unwrap();
        db.sync(&julius, Change { tasks: vec![task(fresh_id(), "Made on the web after")], ..Default::default() }).await.unwrap();
        round(&mac, &db, &julius).await;
        assert!(titles(&mac).contains(&"Made on the web after".to_string()), "{:?}", titles(&mac));
    }

    #[tokio::test]
    async fn a_row_that_left_one_space_arrives_in_the_next_even_after_its_tombstone() {
        let mac = device();
        let id = 5_000_000_000_123i64;
        let r1: Reply = serde_json::from_value(json!({ "upto": 0, "rows": { "tasks": [{ "id": id, "title": "Moved", "spaceId": 11, "changed": 100 }] },
            "spaces": [{ "space": 11, "at": 1 }, { "space": 77, "at": 0 }] })).unwrap();
        mac.inbox(&r1, 0).unwrap();
        // The old space's tombstone in one round, the row in its new space the next.
        let r2: Reply = serde_json::from_value(json!({ "upto": 0, "rows": { "gone": [{ "kind": "task", "id": id, "changed": 200, "space": 11 }] },
            "spaces": [{ "space": 11, "at": 2 }, { "space": 77, "at": 0 }] })).unwrap();
        mac.inbox(&r2, 0).unwrap();
        let r3: Reply = serde_json::from_value(json!({ "upto": 0, "rows": { "tasks": [{ "id": id, "title": "Moved", "spaceId": 77, "changed": 200 }] },
            "spaces": [{ "space": 11, "at": 2 }, { "space": 77, "at": 1 }] })).unwrap();
        mac.inbox(&r3, 0).unwrap();
        assert_eq!(titles(&mac), vec!["Moved"]);
    }

    #[tokio::test]
    async fn a_member_cannot_pull_a_workspace_task_into_their_own_space() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None });
            c.tasks.push(Task { project_id: Some(p), ..task(p + 1, "Hop's") });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        // Geart puts it under a project of his own.
        let mine = next(&phone);
        change(&phone, |c| {
            c.projects.push(Project { id: mine, name: "Geart's".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(mine), ..task(p + 1, "Hop's, renamed") });
        });
        round(&phone, &db, &geart).await;
        // It stays in Hop, renamed, and Geart's device is told where it is.
        round(&mac, &db, &julius).await;
        let t = mac.state(TODAY).unwrap().tasks.into_iter().find(|t| t.id == p + 1).unwrap();
        assert_eq!((t.title.as_str(), t.project_id, t.space_id), ("Hop's, renamed", Some(p), Some(space)));
        round(&phone, &db, &geart).await;
        let t = phone.state(TODAY).unwrap().tasks.into_iter().find(|t| t.id == p + 1).unwrap();
        assert_eq!(t.project_id, Some(p), "the sender kept its own version");
        // The owner may.
        change(&mac, |c| c.tasks.push(Task { project_id: None, ..task(p + 1, "Hop's, renamed") }));
        let own = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: own, name: "Julius's".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(own), ..task(p + 1, "Hop's, renamed") });
        });
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).iter().all(|t| !t.starts_with("Hop's")));
    }

    #[tokio::test]
    async fn rows_a_device_made_learn_their_space_so_leaving_drops_them() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let (mac, phone) = (device(), device());
        let p = next(&mac);
        change(&mac, |c| c.projects.push(Project { id: p, name: "Launch".into(), color: 3, space_id: Some(space), sprint: None }));
        round(&mac, &db, &julius).await;
        round(&phone, &db, &geart).await;
        // Geart adds a task to Hop's project on his phone: it has no space there yet.
        let t = next(&phone);
        change(&phone, |c| c.tasks.push(Task { project_id: Some(p), ..task(t, "Geart's in Hop") }));
        round(&phone, &db, &geart).await;
        round(&phone, &db, &geart).await;
        db.leave(&geart, space).await.unwrap();
        round(&phone, &db, &geart).await;
        assert!(titles(&phone).is_empty(), "{:?}", titles(&phone));
    }

    fn account(me: &Me) -> Account {
        Account { id: Some(me.id.clone()), email: me.email.clone(), personal: None }
    }

    /// One round as an app does it now: nothing is sent while the file holds
    /// another account's tasks (the person is asked instead), unless
    /// `take_over` is their answer to take them off this device.
    async fn as_app(d: &Store, db: &Db, me: &Me, take_over: bool) -> Result<Reply, Held> {
        if take_over {
            d.take_over(&account(me)).unwrap();
        }
        let out = d.outbox_for(&account(me)).unwrap();
        if let Some(held) = out.held {
            return Err(held);
        }
        let reply = db.exchange(me, &out).await.unwrap();
        d.inbox_for(&reply, out.upto, &account(me)).unwrap();
        Ok(reply)
    }

    async fn web(db: &Db, me: &Me) -> Vec<String> {
        let mut t: Vec<String> = db.state(me, TODAY).await.unwrap().tasks.into_iter().map(|t| t.title).collect();
        t.sort();
        t
    }

    // Audit F1: signing out of one account and in as another on the same
    // phone lost the first one's unsent changes: they were sent to the
    // second account, refused there, counted as sent and dropped.
    #[tokio::test]
    async fn signing_in_as_another_account_keeps_the_first_account_s_unsent_changes() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let phone = device();
        let home = next(&phone);
        change(&phone, |c| {
            c.projects.push(Project { id: home, name: "Home".into(), color: 1, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(home), ..task(home + 1, "Renew passport") });
            c.tasks.push(task(home + 2, "Inbox thing"));
        });
        as_app(&phone, &db, &julius, false).await.unwrap();
        let (passport, inbox) = {
            let tasks = phone.state(TODAY).unwrap().tasks;
            let id = |title: &str| tasks.iter().find(|t| t.title == title).unwrap().id;
            (id("Renew passport"), id("Inbox thing"))
        };
        // Offline, still signed in: edits that do not reach the server.
        change(&phone, |c| {
            c.tasks.push(Task { project_id: Some(home), ..task(passport, "Renew passport EDITED OFFLINE") });
            c.tasks.push(task(inbox, "Inbox thing EDITED OFFLINE"));
        });
        // The last round fails; the person is told and signs out anyway.
        phone.leave_account(Leaving::SignedOut).unwrap();
        let added = next(&phone);
        change(&phone, |c| c.tasks.push(Task { project_id: Some(home), ..task(added, "Added after sign-out") }));
        let ours = ["Added after sign-out", "Inbox thing EDITED OFFLINE", "Renew passport EDITED OFFLINE"];

        // Geart signs in on the same phone: nothing is sent, he is asked.
        let held = as_app(&phone, &db, &geart, false).await.unwrap_err();
        assert_eq!((held.account.id.as_deref(), held.unsent), (Some("1001"), 3));
        assert_eq!(titles(&phone), ours);
        assert!(web(&db, &geart).await.is_empty());
        assert_eq!(web(&db, &julius).await, ["Inbox thing", "Renew passport"]);

        // Julius signs back in: all of it reaches his account.
        as_app(&phone, &db, &julius, false).await.unwrap();
        assert_eq!(web(&db, &julius).await, ours);
        assert!(phone.outbox().unwrap().rows.is_empty());

        // Signed out again, Geart is told the tasks are Julius's and takes
        // them off the phone: his account gets none of them.
        phone.leave_account(Leaving::SignedOut).unwrap();
        let held = as_app(&phone, &db, &geart, false).await.unwrap_err();
        assert_eq!((held.rows, held.unsent), (4, 0));
        as_app(&phone, &db, &geart, true).await.unwrap();
        assert!(titles(&phone).is_empty());
        assert!(web(&db, &geart).await.is_empty());
        assert_eq!(web(&db, &julius).await, ours);
    }

    // Audit F3: a row the server would not take was counted as sent, so it
    // was never sent again. It now stays unsent until the right account
    // takes it, and keeps its space when edited in the Inbox.
    #[tokio::test]
    async fn a_row_the_server_would_not_take_is_still_unsent() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let phone = device();
        let id = next(&phone);
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing")));
        as_app(&phone, &db, &julius, false).await.unwrap();
        let id = phone.state(TODAY).unwrap().tasks[0].id;
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing EDITED")));
        let space = phone.state(TODAY).unwrap().tasks[0].space_id;
        assert_eq!(space, Some(julius.personal));
        // Another account on this file: held, so still unsent.
        assert!(as_app(&phone, &db, &geart, false).await.is_err());
        assert_eq!(phone.outbox().unwrap().rows.tasks.len(), 1);
        as_app(&phone, &db, &julius, false).await.unwrap();
        assert_eq!(web(&db, &julius).await, ["Inbox thing EDITED"]);
        assert!(web(&db, &geart).await.is_empty());

        // An app from before this change sends to whoever signed in. The
        // server names the row it refused, and a device on this version
        // sends it again rather than count it as sent.
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing EDITED TWICE")));
        let out = phone.outbox().unwrap();
        let reply = db.exchange(&geart, &out).await.unwrap();
        assert_eq!(reply.refused, vec![Refused { kind: "task".into(), id }]);
        phone.inbox(&Reply { spaces: None, ..reply }, out.upto).unwrap();
        assert_eq!(phone.outbox().unwrap().rows.tasks.len(), 1);
        as_app(&phone, &db, &julius, false).await.unwrap();
        assert_eq!(web(&db, &julius).await, ["Inbox thing EDITED TWICE"]);
    }

    // Audit F2: signing out, or deleting the account, left the workspace's
    // tasks and its member list (names, emails) on the device.
    #[tokio::test]
    async fn leaving_takes_the_workspace_off_the_device_and_keeps_one_s_own() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let space = hop(&db, &julius, &geart).await;
        let mac = device();
        let launch = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: launch, name: "Launch".into(), color: 3, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(launch), due: Some(TODAY.into()), ..task(launch + 1, "Julius's private-to-Hop task") });
        });
        as_app(&mac, &db, &julius, false).await.unwrap();
        db.move_project(&julius, launch, space).await.unwrap();
        for deleted in [false, true] {
            let phone = device();
            let own = next(&phone);
            change(&phone, |c| c.tasks.push(task(own, "Geart's own")));
            as_app(&phone, &db, &geart, false).await.unwrap();
            let hop_task = phone.state(TODAY).unwrap().tasks.into_iter().find(|t| t.space_id == Some(space)).unwrap().id;
            change(&phone, |c| c.assign.push(Assign { task_id: hop_task, account_id: geart.id.clone(), on: true }));
            assert!(phone.state(TODAY).unwrap().team.is_some());

            if deleted {
                db.delete_account(&geart).await.unwrap();
            }
            phone.leave_account(if deleted { Leaving::Deleted } else { Leaving::SignedOut }).unwrap();
            let state = phone.state(TODAY).unwrap();
            // Each phone added one; the second has the first's too.
            let mine = if deleted { vec!["Geart's own", "Geart's own"] } else { vec!["Geart's own"] };
            assert_eq!(state.tasks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), mine, "deleted: {deleted}");
            assert!(state.projects.is_empty() && state.team.is_none());
            assert!(state.tasks.iter().all(|t| t.assignees.is_empty()));
            let file = phone.export().unwrap();
            assert!(file.rows.assignees.is_empty());
            assert!(!serde_json::to_string(&file.rows).unwrap().contains("hop.dev"));
            if deleted {
                // What is left is plain local data: the next account to sign
                // in gets it, as at any first sign-in.
                let ana = db.me("1003", "ana@hop.dev", "Ana", "").await.unwrap();
                as_app(&phone, &db, &ana, false).await.unwrap();
                assert_eq!(web(&db, &ana).await, mine);
            }
        }
        // The workspace itself is untouched for those still in it.
        assert_eq!(web(&db, &julius).await, ["Julius's private-to-Hop task"]);
    }

    /// What the app does to its file when a round is answered 401 (the
    /// session ran out or was ended) and the window loads again signed out.
    fn session_ended(d: &Store) {
        d.mark_leaving(Some(Leaving::Ended), Some("app")).unwrap();
        d.finish_leaving(Some("app")).unwrap();
    }

    /// A window that is not signed in loads: the "done next" preview app on
    /// the real tasks file, say.
    fn plain_load(d: &Store) {
        assert_eq!(d.finish_leaving(Some("done next")).unwrap(), None);
    }

    /// Geart's phone in Hop, with Julius's project Launch and two of its tasks.
    async fn geart_in_hop(db: &Db) -> (Me, Me, i64, Store) {
        let (julius, geart) = people(db).await;
        let space = hop(db, &julius, &geart).await;
        let mac = device();
        let launch = next(&mac);
        change(&mac, |c| {
            c.projects.push(Project { id: launch, name: "Launch".into(), color: 3, space_id: None, sprint: None });
            c.tasks.push(Task { project_id: Some(launch), ..task(launch + 1, "Ship the site") });
            c.tasks.push(Task { project_id: Some(launch), ..task(launch + 2, "Write the post") });
        });
        as_app(&mac, db, &julius, false).await.unwrap();
        db.move_project(&julius, launch, space).await.unwrap();
        let phone = device();
        as_app(&phone, db, &geart, false).await.unwrap();
        (julius, geart, space, phone)
    }

    // Review of #112, 1: a session that runs out (tokens last 30 days) must
    // not take unsent workspace edits with it. What was already sent goes.
    #[tokio::test]
    async fn a_session_that_ended_keeps_unsent_workspace_edits() {
        let db = testing::db().await;
        let (julius, geart, space, phone) = geart_in_hop(&db).await;
        let state = phone.state(TODAY).unwrap();
        let ship = state.tasks.iter().find(|t| t.title == "Ship the site").unwrap().clone();
        let added = next(&phone);
        change(&phone, |c| {
            c.tasks.push(Task { title: "Ship the site EDITED OFFLINE".into(), ..ship.clone() });
            c.tasks.push(Task { project_id: ship.project_id, ..task(added, "Added offline") });
        });
        session_ended(&phone);
        assert_eq!(titles(&phone), ["Added offline", "Ship the site EDITED OFFLINE"]);
        assert!(phone.state(TODAY).unwrap().team.is_none());
        // Signed in again: both reach Hop.
        as_app(&phone, &db, &geart, false).await.unwrap();
        assert_eq!(web(&db, &julius).await, ["Added offline", "Ship the site EDITED OFFLINE", "Write the post"]);
        assert!(phone.state(TODAY).unwrap().tasks.iter().all(|t| t.space_id == Some(space)));
    }

    // Review of #112, 1: a window that is not signed in, loading, changes
    // nothing ("done next" runs on the real file and is never signed in).
    #[tokio::test]
    async fn a_window_that_is_not_signed_in_changes_nothing_when_it_loads() {
        let db = testing::db().await;
        let (_, _, _, phone) = geart_in_hop(&db).await;
        let ship = phone.state(TODAY).unwrap().tasks.into_iter().find(|t| t.title == "Ship the site").unwrap();
        change(&phone, |c| c.tasks.push(Task { title: "Ship the site, edited".into(), ..ship }));
        let before = phone.state(TODAY).unwrap();
        plain_load(&phone);
        let after = phone.state(TODAY).unwrap();
        assert_eq!((after.rev, after.tasks.len(), after.team.is_some()), (before.rev, before.tasks.len(), true));
        assert_eq!(phone.outbox().unwrap().rows.tasks.len(), 1);
    }

    // Review of #112, 2: an account deleted elsewhere and made again with the
    // same login has the same id and a new space. The phone's own tasks must
    // not be dropped for being in the old one.
    #[tokio::test]
    async fn an_account_made_again_keeps_the_phone_s_own_tasks() {
        let db = testing::db().await;
        let (_, geart) = people(&db).await;
        let phone = device();
        let own = next(&phone);
        change(&phone, |c| c.tasks.push(task(own, "Geart's own")));
        as_app(&phone, &db, &geart, false).await.unwrap();
        db.delete_account(&geart).await.unwrap();
        session_ended(&phone);
        let again = db.me("1002", "geart@hop.dev", "Geart", "").await.unwrap();
        assert_ne!(again.personal, geart.personal);
        as_app(&phone, &db, &again, false).await.unwrap();
        assert_eq!(titles(&phone), ["Geart's own"]);
        as_app(&phone, &db, &again, false).await.unwrap();
        assert_eq!(web(&db, &again).await, ["Geart's own"]);
        assert!(phone.outbox().unwrap().rows.is_empty());
    }

    // Review of #112, 3: a row refused again after being sent again is not
    // sent (or counted) for ever; it stays on the device as local data.
    #[tokio::test]
    async fn a_row_refused_twice_stays_on_the_device_and_is_not_sent_again() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let phone = device();
        let id = next(&phone);
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing")));
        as_app(&phone, &db, &julius, false).await.unwrap();
        let id = phone.state(TODAY).unwrap().tasks[0].id;
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing EDITED")));
        // Sent, as an app from before this change would, to an account that cannot take it.
        for _ in 0..2 {
            let out = phone.outbox().unwrap();
            let reply = db.exchange(&geart, &out).await.unwrap();
            phone.inbox(&Reply { spaces: None, ..reply }, out.upto).unwrap();
        }
        assert!(phone.outbox().unwrap().rows.is_empty(), "still sent: {:?}", phone.outbox().unwrap().rows.tasks);
        assert_eq!(titles(&phone), ["Inbox thing EDITED"]);
        assert_eq!(phone.state(TODAY).unwrap().tasks[0].space_id, None);
    }

    // Issue #120, A: a row refused twice was kept on the phone only, out of
    // any space, and never sent again, even once the right account signed in.
    #[tokio::test]
    async fn a_row_refused_twice_goes_again_when_the_account_signs_in_again() {
        let db = testing::db().await;
        let (julius, geart) = people(&db).await;
        let phone = device();
        let id = next(&phone);
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing")));
        as_app(&phone, &db, &julius, false).await.unwrap();
        let id = phone.state(TODAY).unwrap().tasks[0].id;
        change(&phone, |c| c.tasks.push(task(id, "Inbox thing EDITED")));
        for _ in 0..2 {
            let out = phone.outbox().unwrap();
            let reply = db.exchange(&geart, &out).await.unwrap();
            phone.inbox(&Reply { spaces: None, ..reply }, out.upto).unwrap();
        }
        assert!(phone.outbox().unwrap().rows.is_empty());
        // Julius's session ends and he signs in again: it goes.
        session_ended(&phone);
        as_app(&phone, &db, &julius, false).await.unwrap();
        assert_eq!(web(&db, &julius).await, ["Inbox thing EDITED"]);
        assert_eq!(phone.state(TODAY).unwrap().tasks[0].space_id, Some(julius.personal));
    }
}
