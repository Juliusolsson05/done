//! Keeping copies of one account's tasks in step: the file on a Mac, the file
//! on a phone and the one the hosted server keeps. Each copy works on its own,
//! with or without a connection, and they meet now and then to swap what
//! changed.
//!
//! How, in short:
//! - Every row (project, task, note, time sheet entry) carries `changed`, the
//!   moment it was last edited, and `seq`, a counter local to the file that
//!   says when this file last wrote it. Triggers keep both up to date, so
//!   every way of writing (the app, the MCP server, the web app) is counted
//!   without having to remember to.
//! - A deleted row leaves a tombstone behind, so the deletion travels too.
//! - A device sends the rows it wrote since it last sent (`seq` above
//!   `pushed`) and gets back what the server wrote since it last asked (the
//!   server's `seq` above `pulled`). Where both sides changed the same row,
//!   the later edit wins, row by row.
//! - Ids come from the clock plus a random part (`fresh_id`), so two devices
//!   adding a task offline do not pick the same id. Rows from before that
//!   (small ids, counted up from 1 on each device) are renumbered once, in
//!   their old order, before they are first sent.

use crate::{check, check_entry, Entry, Error, NewEntry, Note, Project, Store, Task};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

/// Ids below this were counted up from 1 on one device and may be used by
/// another device for something else. Ids from `fresh_id` are far above it.
pub(crate) const SMALL: i64 = 1 << 32;

/// Now, in milliseconds since 1970, as SQLite computes it.
const NOW: &str = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

/// The tables that travel and the columns that are their content. A change to
/// one of these columns is a change worth sending; `seq` and `changed` are
/// bookkeeping and writing them must not count as one.
const TABLES: [(&str, &str); 4] = [
    ("project", "name, color"),
    ("task", "title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id"),
    ("note", "text, updated_at, project_id"),
    ("entry", "task_id, title, day, started_at, ended_at, planned_ms, focused_ms"),
];

/// An id no other device is likely to pick: the time in milliseconds times
/// 1000, plus a random part. Time first, so a newer row sorts after an older
/// one (subtasks and lists are shown in the order they were added). Never
/// below an id this file already has, or two rows added within the same
/// millisecond (or on a clock that is behind) could come out of order; the
/// random part stays either way, so two devices behind the same clock still
/// pick different ids. Well below 2^53, so the interface's numbers hold it.
pub(crate) fn fresh_id(conn: &Connection) -> Result<i64, Error> {
    Ok(conn.query_row(
        &format!(
            "SELECT max({NOW} * 1000, coalesce(max(m), 0) + 1) + (abs(random()) % 1000)
             FROM (SELECT max(id) AS m FROM task UNION ALL SELECT max(id) FROM project
                   UNION ALL SELECT max(id) FROM note UNION ALL SELECT max(id) FROM entry)"
        ),
        [],
        |r| r.get(0),
    )?)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, Error> {
    Ok(conn.query_row(&format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"), [column], |r| {
        r.get::<_, i64>(0).map(|n| n > 0)
    })?)
}

/// Adds what keeping in step needs to a file that lacks it. Rows already in
/// the file count as written and not yet sent (`seq` 1, `pushed` 0), so the
/// first time a device signs in, everything it has goes up.
pub(crate) fn prepare(conn: &Connection) -> Result<(), Error> {
    conn.execute_batch(
        "INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', 1), ('pushed', 0), ('pulled', 0), ('quiet', 0), ('applying', 0);
         CREATE TABLE IF NOT EXISTS tombstone (
           kind TEXT NOT NULL,
           id INTEGER NOT NULL,
           changed INTEGER NOT NULL,
           seq INTEGER NOT NULL,
           PRIMARY KEY (kind, id)
         );
         CREATE INDEX IF NOT EXISTS tombstone_seq ON tombstone (seq);",
    )?;
    // A file left mid-merge by a crash would keep these set; the merge is one
    // transaction, so they can only be set inside it.
    conn.execute("UPDATE meta SET value = 0 WHERE key IN ('quiet', 'applying')", [])?;
    let quiet = "(SELECT value FROM meta WHERE key = 'quiet')";
    let applying = "(SELECT value FROM meta WHERE key = 'applying')";
    let counter = "(SELECT value FROM meta WHERE key = 'seq')";
    for (table, columns) in TABLES {
        if !has_column(conn, table, "seq")? {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
                 ALTER TABLE {table} ADD COLUMN changed INTEGER NOT NULL DEFAULT 0;"
            ))?;
        }
        conn.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS {table}_seq ON {table} (seq);
             -- Written here: a new counter value, unless a device is taking in
             -- the server's rows (quiet), which it must not send back; and now
             -- as the time of the edit, unless the row came from elsewhere
             -- (applying) with a time of its own.
             CREATE TRIGGER IF NOT EXISTS {table}_written AFTER INSERT ON {table} BEGIN
               UPDATE meta SET value = value + 1 WHERE key = 'seq' AND {quiet} = 0;
               UPDATE {table} SET
                 seq = CASE WHEN {quiet} = 0 THEN {counter} ELSE NEW.seq END,
                 changed = CASE WHEN {applying} = 0 THEN {NOW} ELSE NEW.changed END
               WHERE id = NEW.id;
               DELETE FROM tombstone WHERE kind = '{table}' AND id = NEW.id AND {applying} = 0;
             END;
             CREATE TRIGGER IF NOT EXISTS {table}_edited AFTER UPDATE OF {columns} ON {table} BEGIN
               UPDATE meta SET value = value + 1 WHERE key = 'seq' AND {quiet} = 0;
               UPDATE {table} SET
                 seq = CASE WHEN {quiet} = 0 THEN {counter} ELSE NEW.seq END,
                 changed = CASE WHEN {applying} = 0 THEN {NOW} ELSE NEW.changed END
               WHERE id = NEW.id;
             END;
             -- Deletions made while taking in rows from elsewhere write their
             -- own tombstone, with the time they came with.
             CREATE TRIGGER IF NOT EXISTS {table}_deleted AFTER DELETE ON {table} WHEN {applying} = 0 BEGIN
               UPDATE meta SET value = value + 1 WHERE key = 'seq';
               INSERT OR REPLACE INTO tombstone (kind, id, changed, seq) VALUES ('{table}', OLD.id, {NOW}, {counter});
             END;"
        ))?;
    }
    Ok(())
}

/// A row and when it was last edited.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stamped<T> {
    #[serde(flatten)]
    pub row: T,
    pub changed: i64,
}

/// A deleted row: which table, which id, and when.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Gone {
    pub kind: String,
    pub id: i64,
    pub changed: i64,
}

/// Rows written in one file after some point in its counter.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rows {
    #[serde(default)]
    pub projects: Vec<Stamped<Project>>,
    #[serde(default)]
    pub tasks: Vec<Stamped<Task>>,
    #[serde(default)]
    pub notes: Vec<Stamped<Note>>,
    #[serde(default)]
    pub entries: Vec<Stamped<Entry>>,
    #[serde(default)]
    pub gone: Vec<Gone>,
}

impl Rows {
    pub fn is_empty(&self) -> bool {
        self.projects.is_empty() && self.tasks.is_empty() && self.notes.is_empty() && self.entries.is_empty() && self.gone.is_empty()
    }
}

/// What a device sends: its own new rows, and how far it has read the server's.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Outbox {
    /// The server's counter as of the device's last exchange.
    pub pulled: i64,
    /// This file's counter when the rows were read. Echoed back to `inbox`.
    pub upto: i64,
    pub rows: Rows,
    /// How many rows were just given new ids. Not sent anywhere useful; the
    /// window reloads when it is above zero, or it would go on with old ids.
    #[serde(default)]
    pub renumbered: usize,
}

/// What the server answers: what it wrote since `pulled`, and its counter now.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub upto: i64,
    pub rows: Rows,
}

fn meta(conn: &Connection, key: &str) -> Result<i64, Error> {
    Ok(conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))?)
}

fn set_meta(conn: &Connection, key: &str, value: i64) -> Result<(), Error> {
    conn.execute("UPDATE meta SET value = ?2 WHERE key = ?1", params![key, value])?;
    Ok(())
}

fn rows_since(conn: &Connection, after: i64) -> Result<Rows, Error> {
    let mut rows = Rows::default();
    let mut stmt = conn.prepare("SELECT id, name, color, changed FROM project WHERE seq > ?1 ORDER BY id")?;
    rows.projects = stmt
        .query_map([after], |r| Ok(Stamped { row: Project { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }, changed: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id, changed
         FROM task WHERE seq > ?1 ORDER BY id",
    )?;
    rows.tasks = stmt
        .query_map([after], |r| {
            let done_day: Option<String> = r.get(8)?;
            Ok(Stamped {
                row: Task {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    notes: r.get(2)?,
                    project_id: r.get(3)?,
                    start: r.get(4)?,
                    due: r.get(5)?,
                    priority: r.get(6)?,
                    status: r.get(7)?,
                    done: done_day.is_some(),
                    done_day,
                    goal_day: r.get(9)?,
                    parent_id: r.get(10)?,
                },
                changed: r.get(11)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare("SELECT id, text, updated_at, project_id, changed FROM note WHERE seq > ?1 ORDER BY id")?;
    rows.notes = stmt
        .query_map([after], |r| {
            Ok(Stamped { row: Note { id: r.get(0)?, text: r.get(1)?, updated_at: r.get(2)?, project_id: r.get(3)? }, changed: r.get(4)? })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms, changed FROM entry WHERE seq > ?1 ORDER BY id",
    )?;
    rows.entries = stmt
        .query_map([after], |r| {
            Ok(Stamped {
                row: Entry {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    day: r.get(3)?,
                    started_at: r.get(4)?,
                    ended_at: r.get(5)?,
                    planned_ms: r.get(6)?,
                    focused_ms: r.get(7)?,
                },
                changed: r.get(8)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare("SELECT kind, id, changed FROM tombstone WHERE seq > ?1 ORDER BY kind, id")?;
    rows.gone = stmt.query_map([after], |r| Ok(Gone { kind: r.get(0)?, id: r.get(1)?, changed: r.get(2)? }))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Whether a row from elsewhere, edited at `changed`, is newer than what this
/// file has for that id, alive or deleted. Ties keep what is here: the same
/// edit coming back must not be written (and counted, and sent) again.
fn newer(tx: &Transaction, kind: &str, id: i64, changed: i64) -> Result<bool, Error> {
    let here: Option<i64> = tx.query_row(&format!("SELECT changed FROM {kind} WHERE id = ?1"), [id], |r| r.get(0)).optional()?;
    let buried: Option<i64> =
        tx.query_row("SELECT changed FROM tombstone WHERE kind = ?1 AND id = ?2", params![kind, id], |r| r.get(0)).optional()?;
    Ok(here.is_none_or(|h| changed > h) && buried.is_none_or(|b| changed > b))
}

/// Writes rows from elsewhere where they are newer. `quiet` for a device
/// taking in the server's rows (they are not to be sent back); not quiet on
/// the server, whose counter must move so other devices fetch them. Returns
/// how many rows changed here. A row that fails the usual checks is skipped,
/// not the whole batch: one bad row must not stop a device from ever syncing.
fn merge(tx: &Transaction, rows: &Rows, quiet: bool) -> Result<usize, Error> {
    let q = i64::from(quiet);
    tx.execute("UPDATE meta SET value = ?1 WHERE key = 'quiet'", [q])?;
    tx.execute("UPDATE meta SET value = 1 WHERE key = 'applying'", [])?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    let mut applied = 0;
    for Stamped { row: p, changed } in &rows.projects {
        if p.name.trim().is_empty() || !newer(tx, "project", p.id, *changed)? {
            continue;
        }
        tx.execute(
            "INSERT INTO project (id, name, color, changed, seq) VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, changed = excluded.changed, seq = excluded.seq",
            params![p.id, p.name.trim(), p.color, changed],
        )?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'project' AND id = ?1", [p.id])?;
        applied += 1;
    }
    for Stamped { row: t, changed } in &rows.tasks {
        if check(t).is_err() || !newer(tx, "task", t.id, *changed)? {
            continue;
        }
        if let Some(day) = &t.goal_day {
            tx.execute("UPDATE task SET goal_day = NULL WHERE goal_day = ?1 AND id != ?2", params![day, t.id])?;
        }
        let done_day = if t.done { t.done_day.as_deref() } else { None };
        tx.execute(
            "INSERT INTO task (id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id, changed, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes,
               project_id = excluded.project_id, start = excluded.start, due = excluded.due,
               priority = excluded.priority, status = excluded.status, done_day = excluded.done_day,
               goal_day = excluded.goal_day, parent_id = excluded.parent_id, changed = excluded.changed, seq = excluded.seq",
            params![t.id, t.title.trim(), t.notes, t.project_id, t.start, t.due, t.priority, t.status, done_day, t.goal_day, t.parent_id, changed],
        )?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'task' AND id = ?1", [t.id])?;
        applied += 1;
    }
    for Stamped { row: n, changed } in &rows.notes {
        if !newer(tx, "note", n.id, *changed)? {
            continue;
        }
        tx.execute(
            "INSERT INTO note (id, text, updated_at, project_id, changed, seq) VALUES (?1, ?2, ?3, ?4, ?5, 0)
             ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at,
               project_id = excluded.project_id, changed = excluded.changed, seq = excluded.seq",
            params![n.id, n.text, n.updated_at, n.project_id, changed],
        )?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'note' AND id = ?1", [n.id])?;
        applied += 1;
    }
    for Stamped { row: e, changed } in &rows.entries {
        let as_new = NewEntry {
            task_id: e.task_id,
            title: e.title.clone(),
            day: e.day.clone(),
            started_at: e.started_at,
            ended_at: e.ended_at,
            planned_ms: e.planned_ms,
            focused_ms: e.focused_ms,
        };
        if check_entry(&as_new).is_err() || !newer(tx, "entry", e.id, *changed)? {
            continue;
        }
        tx.execute(
            "INSERT INTO entry (id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms, changed, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
             ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, title = excluded.title, day = excluded.day,
               started_at = excluded.started_at, ended_at = excluded.ended_at, planned_ms = excluded.planned_ms,
               focused_ms = excluded.focused_ms, changed = excluded.changed, seq = excluded.seq",
            params![e.id, e.task_id, e.title.trim(), e.day, e.started_at, e.ended_at, e.planned_ms, e.focused_ms, changed],
        )?;
        tx.execute("DELETE FROM tombstone WHERE kind = 'entry' AND id = ?1", [e.id])?;
        applied += 1;
    }
    for gone in &rows.gone {
        if !TABLES.iter().any(|(t, _)| *t == gone.kind) {
            continue;
        }
        let here: Option<i64> =
            tx.query_row(&format!("SELECT changed FROM {} WHERE id = ?1", gone.kind), [gone.id], |r| r.get(0)).optional()?;
        let buried: Option<i64> = tx
            .query_row("SELECT changed FROM tombstone WHERE kind = ?1 AND id = ?2", params![gone.kind, gone.id], |r| r.get(0))
            .optional()?;
        // A row edited after it was deleted elsewhere stays: the edit is the
        // later wish. A deletion already known is not written again.
        if here.is_some_and(|h| h > gone.changed) || buried.is_some_and(|b| b >= gone.changed) {
            continue;
        }
        tx.execute(&format!("DELETE FROM {} WHERE id = ?1", gone.kind), [gone.id])?;
        let seq = if quiet {
            0
        } else {
            tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'seq'", [])?;
            meta(tx, "seq")?
        };
        tx.execute(
            "INSERT OR REPLACE INTO tombstone (kind, id, changed, seq) VALUES (?1, ?2, ?3, ?4)",
            params![gone.kind, gone.id, gone.changed, seq],
        )?;
        applied += 1;
    }
    // What two devices did apart can disagree once put together: a task in a
    // project deleted on the other device, a subtask whose task is gone, two
    // goals for one day. Settled here so the file always keeps its rules.
    tx.execute_batch(
        "UPDATE task SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);
         UPDATE note SET project_id = NULL WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM project);
         UPDATE task SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM task);
         UPDATE task SET parent_id = NULL WHERE id IN
           (SELECT c.id FROM task c JOIN task p ON c.parent_id = p.id WHERE p.parent_id IS NOT NULL);",
    )?;
    tx.execute("UPDATE meta SET value = 0 WHERE key IN ('quiet', 'applying')", [])?;
    Ok(applied)
}

/// Gives every row with a small id a fresh one, and points everything that
/// referred to it at the new id. Done once on a device, before its rows are
/// first sent: small ids were counted up on each device by itself, so
/// another device may already have sent a different task with the same id.
fn rekey(tx: &Transaction) -> Result<usize, Error> {
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    let mut moved = 0;
    // (table, [(other table, column that points at this table)])
    let links: [(&str, &[(&str, &str)]); 4] = [
        ("project", &[("task", "project_id"), ("note", "project_id")]),
        ("task", &[("task", "parent_id"), ("entry", "task_id")]),
        ("note", &[]),
        ("entry", &[]),
    ];
    for (table, pointers) in links {
        let ids: Vec<i64> = tx
            .prepare(&format!("SELECT id FROM {table} WHERE id < ?1 ORDER BY id"))?
            .query_map([SMALL], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        // One fresh start, counted up from: the rows keep the order they had.
        let base = fresh_id(tx)?;
        for (i, old) in ids.into_iter().enumerate() {
            let new = base + i as i64;
            // The id is not content, so this is not counted by the triggers.
            // The row is still waiting to be sent, by its new id.
            tx.execute(&format!("UPDATE {table} SET id = ?2 WHERE id = ?1"), params![old, new])?;
            for (other, column) in pointers {
                tx.execute(&format!("UPDATE {other} SET {column} = ?2 WHERE {column} = ?1"), params![old, new])?;
            }
            moved += 1;
        }
    }
    // Deletions of rows by their small ids never need to travel: those rows
    // were never sent.
    tx.execute("DELETE FROM tombstone WHERE id < ?1", [SMALL])?;
    Ok(moved)
}

impl Store {
    /// On a device: what to send. Rows with small ids are first given fresh
    /// ones (see `rekey`); when that happens the revision moves, so open
    /// windows load the new ids.
    pub fn outbox(&self) -> Result<Outbox, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let renumbered = rekey(&tx)?;
        if renumbered > 0 {
            tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
        }
        let pushed = meta(&tx, "pushed")?;
        let out = Outbox { pulled: meta(&tx, "pulled")?, upto: meta(&tx, "seq")?, rows: rows_since(&tx, pushed)?, renumbered };
        tx.commit()?;
        Ok(out)
    }

    /// On a device: takes in the server's reply to an `outbox` read at
    /// `upto`. True when something here changed, so the window reloads.
    pub fn inbox(&self, reply: &Reply, upto: i64) -> Result<bool, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let applied = merge(&tx, &reply.rows, true)?;
        // Everything written up to `upto` reached the server. Anything
        // written since (while the request was out) has a higher counter and
        // goes next time.
        if upto > meta(&tx, "pushed")? {
            set_meta(&tx, "pushed", upto)?;
        }
        set_meta(&tx, "pulled", reply.upto)?;
        if applied > 0 {
            tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
        }
        tx.commit().map_err(|e| Error::Db(e))?;
        Ok(applied > 0)
    }

    /// On the server: takes in a device's rows and answers with everything
    /// written here since the device last asked (its own rows included; it
    /// skips those, having them already).
    pub fn exchange(&self, outbox: &Outbox) -> Result<Reply, Error> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if merge(&tx, &outbox.rows, false)? > 0 {
            // Windows of the web app open on this account load the new rows.
            tx.execute("UPDATE meta SET value = value + 1 WHERE key = 'rev'", [])?;
        }
        let reply = Reply { upto: meta(&tx, "seq")?, rows: rows_since(&tx, outbox.pulled)? };
        tx.commit()?;
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Change, SaveNote};
    use std::path::Path;

    fn store() -> Store {
        Store::open(Path::new(":memory:")).unwrap()
    }

    fn task(id: i64, title: &str) -> Task {
        Task {
            id,
            title: title.into(),
            notes: String::new(),
            project_id: None,
            start: None,
            due: None,
            priority: 4,
            status: None,
            done: false,
            done_day: None,
            goal_day: None,
            parent_id: None,
        }
    }

    fn add(s: &Store, tasks: Vec<Task>) {
        let rev = s.state("2026-11-21").unwrap().rev;
        s.sync(Change { rev, tasks, ..Default::default() }).unwrap();
    }

    fn titles(s: &Store) -> Vec<String> {
        let mut t: Vec<String> = s.state("2026-11-21").unwrap().tasks.into_iter().map(|t| t.title).collect();
        t.sort();
        t
    }

    /// One round: the device sends, the server answers, the device takes it in.
    fn round(device: &Store, server: &Store) -> bool {
        let out = device.outbox().unwrap();
        let reply = server.exchange(&out).unwrap();
        device.inbox(&reply, out.upto).unwrap()
    }

    #[test]
    fn a_task_added_on_one_device_reaches_the_other() {
        let (mac, phone, cloud) = (store(), store(), store());
        add(&mac, vec![task(1, "Email the five funds")]);
        add(&phone, vec![task(1, "Buy milk")]);
        round(&mac, &cloud);
        round(&phone, &cloud);
        round(&mac, &cloud);
        // Both had a task 1 of their own; neither replaced the other.
        assert_eq!(titles(&mac), vec!["Buy milk", "Email the five funds"]);
        assert_eq!(titles(&phone), titles(&mac));
        assert_eq!(titles(&cloud), titles(&mac));
        // Every id is now a fresh one.
        assert!(cloud.state("2026-11-21").unwrap().tasks.iter().all(|t| t.id >= SMALL));
    }

    // Why fresh ids never go below one the file has: subtasks are listed by
    // id, and two added within one millisecond came out in the wrong order.
    #[test]
    fn fresh_ids_keep_the_order_things_were_added_in() {
        let s = store();
        let mut last = 0;
        for i in 0..200 {
            let id = s.state("2026-11-21").unwrap().next_id;
            assert!(id > last, "id {i} went backwards");
            add(&s, vec![task(id, "One more")]);
            last = id;
        }
    }

    #[test]
    fn nothing_new_means_nothing_sent_and_nothing_reloaded() {
        let (mac, cloud) = (store(), store());
        add(&mac, vec![task(1, "One")]);
        round(&mac, &cloud);
        round(&mac, &cloud);
        let out = mac.outbox().unwrap();
        assert!(out.rows.is_empty(), "sent again: {out:?}");
        assert!(!round(&mac, &cloud));
    }

    #[test]
    fn the_later_edit_wins_and_a_deletion_travels() {
        let (mac, phone, cloud) = (store(), store(), store());
        add(&mac, vec![task(1, "Draft")]);
        round(&mac, &cloud);
        round(&phone, &cloud);
        let id = phone.state("2026-11-21").unwrap().tasks[0].id;
        // Edited on the phone, then a little later on the Mac.
        add(&phone, vec![task(id, "Phone's title")]);
        std::thread::sleep(std::time::Duration::from_millis(5));
        add(&mac, vec![task(id, "Mac's title")]);
        round(&phone, &cloud);
        round(&mac, &cloud);
        round(&phone, &cloud);
        assert_eq!(titles(&phone), vec!["Mac's title"]);
        assert_eq!(titles(&cloud), vec!["Mac's title"]);
        // Deleted on the phone: gone everywhere.
        let rev = phone.state("2026-11-21").unwrap().rev;
        phone.sync(Change { rev, delete_tasks: vec![id], ..Default::default() }).unwrap();
        round(&phone, &cloud);
        round(&mac, &cloud);
        assert!(titles(&mac).is_empty());
    }

    #[test]
    fn notes_and_the_time_sheet_travel_too() {
        let (mac, phone, cloud) = (store(), store(), store());
        let note = mac.save_note(SaveNote { id: None, text: "Funds\n- A\n- B".into(), updated_at: 1, project_id: None }).unwrap();
        assert!(note.id >= SMALL);
        mac.record(NewEntry {
            task_id: None,
            title: "Deep work".into(),
            day: "2026-11-21".into(),
            started_at: 1,
            ended_at: 2,
            planned_ms: 1,
            focused_ms: 1,
        })
        .unwrap();
        round(&mac, &cloud);
        round(&phone, &cloud);
        assert_eq!(phone.notes().unwrap()[0].text, "Funds\n- A\n- B");
        assert_eq!(phone.entries("2026-11-21").unwrap().len(), 1);
        phone.delete_note(note.id).unwrap();
        round(&phone, &cloud);
        round(&mac, &cloud);
        assert!(mac.notes().unwrap().is_empty());
    }

    #[test]
    fn a_task_in_a_project_deleted_elsewhere_falls_back_to_the_inbox() {
        let (mac, phone, cloud) = (store(), store(), store());
        mac.sync(Change { rev: 0, projects: vec![Project { id: 1, name: "Hop".into(), color: 0 }], ..Default::default() }).unwrap();
        round(&mac, &cloud);
        round(&phone, &cloud);
        let project = phone.state("2026-11-21").unwrap().projects[0].id;
        // The Mac deletes the project while the phone, offline, adds a task to it.
        let rev = mac.state("2026-11-21").unwrap().rev;
        mac.sync(Change { rev, delete_projects: vec![project], ..Default::default() }).unwrap();
        let id = fresh_id(&phone.conn.lock().unwrap()).unwrap();
        add(&phone, vec![Task { project_id: Some(project), ..task(id, "Ship it") }]);
        round(&mac, &cloud);
        round(&phone, &cloud);
        round(&mac, &cloud);
        let tasks = mac.state("2026-11-21").unwrap().tasks;
        assert_eq!((tasks.len(), tasks[0].project_id), (1, None));
    }

    #[test]
    fn an_edit_made_while_a_round_is_out_is_sent_next_time() {
        let (mac, cloud) = (store(), store());
        add(&mac, vec![task(1, "First")]);
        let out = mac.outbox().unwrap();
        let reply = cloud.exchange(&out).unwrap();
        // Written after the outbox was read, before the reply came in.
        let id = mac.state("2026-11-21").unwrap().tasks[0].id;
        add(&mac, vec![task(id, "First, renamed")]);
        mac.inbox(&reply, out.upto).unwrap();
        assert_eq!(titles(&mac), vec!["First, renamed"]);
        round(&mac, &cloud);
        assert_eq!(titles(&cloud), vec!["First, renamed"]);
    }
}

#[cfg(test)]
mod on_a_copy {
    use super::*;
    use std::path::Path;

    // Run by hand on a copy of a real tasks file (never the file itself):
    //   DONE_SYNC_COPY=/path/to/copy.db cargo test -p done-core on_a_copy -- --nocapture
    #[test]
    fn a_real_file_goes_up_whole_and_comes_down_whole() {
        let Some(path) = std::env::var_os("DONE_SYNC_COPY") else { return };
        let mac = Store::open(Path::new(&path)).unwrap();
        let (cloud, phone) = (Store::open(Path::new(":memory:")).unwrap(), Store::open(Path::new(":memory:")).unwrap());
        let before = mac.state("2026-11-21").unwrap();
        let out = mac.outbox().unwrap();
        let reply = cloud.exchange(&out).unwrap();
        mac.inbox(&reply, out.upto).unwrap();
        let ph = phone.outbox().unwrap();
        let down = cloud.exchange(&ph).unwrap();
        phone.inbox(&down, ph.upto).unwrap();
        let (m, p) = (mac.state("2026-11-21").unwrap(), phone.state("2026-11-21").unwrap());
        println!(
            "sent {} projects, {} tasks, {} notes, {} entries",
            out.rows.projects.len(),
            out.rows.tasks.len(),
            out.rows.notes.len(),
            out.rows.entries.len()
        );
        assert_eq!((m.tasks.len(), m.projects.len()), (before.tasks.len(), before.projects.len()));
        let strip = |s: &crate::State| {
            let mut v: Vec<_> = s.tasks.iter().map(|t| (t.title.clone(), t.project_id, t.parent_id, t.due.clone(), t.done)).collect();
            v.sort();
            v
        };
        assert_eq!(strip(&m), strip(&p));
        assert_eq!(mac.notes().unwrap(), phone.notes().unwrap());
        assert_eq!(mac.finished(10_000).unwrap().len(), phone.finished(10_000).unwrap().len());
        assert!(mac.outbox().unwrap().rows.is_empty());
    }
}
