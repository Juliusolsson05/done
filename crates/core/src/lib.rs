//! Where done keeps its tasks: one SQLite file, shared by the desktop app and
//! the web app. Both go through this crate and nothing else touches the file,
//! so there is one set of rules for what a valid task is.

use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    /// Index into the interface's colour list. The colours themselves are a
    /// design matter and live with the interface.
    #[serde(default)]
    pub color: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    /// None is the Inbox.
    #[serde(default)]
    pub project_id: Option<i64>,
    /// Days are calendar days written YYYY-MM-DD, never instants: a task is due
    /// on a day, and a change of time zone must not move it.
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub due: Option<String>,
    /// 1 is the most urgent, 4 means none.
    #[serde(default = "no_priority")]
    pub priority: i64,
    /// "doing" while in progress; otherwise absent.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub done: bool,
    /// The day it was finished. Stored instead of a flag, so "done" and "done
    /// when" cannot disagree.
    #[serde(default)]
    pub done_day: Option<String>,
    /// The day this task is the goal: the one thing that has to happen that
    /// day. A day rather than a flag, so yesterday's goal stops being one by
    /// itself. At most one task holds any given day.
    #[serde(default)]
    pub goal_day: Option<String>,
    /// Set on a subtask: the task it is listed under. One level only, so the
    /// task named here never has a parent of its own.
    #[serde(default)]
    pub parent_id: Option<i64>,
}

fn no_priority() -> i64 {
    4
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub rev: i64,
    pub next_id: i64,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
}

/// What one window changed since it last loaded or saved.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// The revision the window was looking at when it made the change.
    pub rev: i64,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub delete_projects: Vec<i64>,
    #[serde(default)]
    pub delete_tasks: Vec<i64>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Synced {
    pub rev: i64,
}

/// One focus block, written down when it ended: what it was on, and how long
/// it was meant to take against how long it took. The time sheet is a list
/// of these.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    /// The task it was on, if any. Not a foreign key: a block on a task added
    /// seconds ago can be recorded before that task's own save lands, and a
    /// deleted task's rows keep their title and come back linked on Undo.
    pub task_id: Option<i64>,
    /// The title when the block ran, so the row still reads after a rename
    /// or a delete.
    pub title: String,
    /// The local day the block started on, YYYY-MM-DD: the time sheet is read
    /// a day at a time.
    pub day: String,
    /// Milliseconds since 1970. Unlike a task's days, a block is a span of
    /// real time, and the sheet shows the clock times it ran between.
    pub started_at: i64,
    pub ended_at: i64,
    /// The length it was started with. Asking for more time does not change it.
    pub planned_ms: i64,
    /// Time spent focusing: pauses and reminder breaks are left out, extra
    /// time asked for is counted.
    pub focused_ms: i64,
}

/// An entry before it has been given an id.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    #[serde(default)]
    pub task_id: Option<i64>,
    pub title: String,
    pub day: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub planned_ms: i64,
    pub focused_ms: i64,
}

/// A note: free text that is not a task, such as a list jotted down in the
/// middle of a conversation. The first line serves as its title.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub text: String,
    /// Milliseconds since 1970, set by the window that saved it. The list
    /// shows the most recently changed note first.
    pub updated_at: i64,
    /// The project it belongs to, if any. A note outlives its project, like
    /// a task does, and is then simply not in one.
    #[serde(default)]
    pub project_id: Option<i64>,
}

/// A note as a window sends it: without an id it is a new note.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveNote {
    #[serde(default)]
    pub id: Option<i64>,
    pub text: String,
    pub updated_at: i64,
    #[serde(default)]
    pub project_id: Option<i64>,
}

#[derive(Debug)]
pub enum Error {
    /// Someone else (another window, or the other app) saved first. The caller
    /// reloads instead of overwriting what it has not seen.
    Stale,
    Invalid(String),
    Db(rusqlite::Error),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // The interface matches on this exact word.
            Error::Stale => write!(f, "stale"),
            Error::Invalid(why) => write!(f, "{why}"),
            Error::Db(e) => write!(f, "the tasks file could not be read or written: {e}"),
        }
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e)
    }
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

fn check_day(what: &str, day: &Option<String>) -> Result<(), Error> {
    match day {
        Some(d) if !is_day(d) => Err(Error::Invalid(format!("{what} must be a day written YYYY-MM-DD."))),
        _ => Ok(()),
    }
}

fn check(task: &Task) -> Result<(), Error> {
    if task.title.trim().is_empty() {
        return Err(Error::Invalid("A task needs a title.".into()));
    }
    if !(1..=4).contains(&task.priority) {
        return Err(Error::Invalid("Priority is 1, 2, 3 or 4.".into()));
    }
    check_day("The start date", &task.start)?;
    check_day("The due date", &task.due)?;
    check_day("The finished day", &task.done_day)?;
    check_day("The goal day", &task.goal_day)?;
    if task.done && task.done_day.is_none() {
        return Err(Error::Invalid("A finished task needs the day it was finished.".into()));
    }
    Ok(())
}

fn check_entry(entry: &NewEntry) -> Result<(), Error> {
    if entry.title.trim().is_empty() {
        return Err(Error::Invalid("A time sheet entry needs a title.".into()));
    }
    if !is_day(&entry.day) {
        return Err(Error::Invalid("The day must be written YYYY-MM-DD.".into()));
    }
    if entry.ended_at < entry.started_at {
        return Err(Error::Invalid("A block cannot end before it started.".into()));
    }
    if entry.planned_ms < 0 || entry.focused_ms < 0 {
        return Err(Error::Invalid("Times cannot be negative.".into()));
    }
    Ok(())
}

/// `~/Library/Application Support/done/done.db`, or `DONE_DB` when set. Outside
/// any code folder on purpose: updating the app can never touch the tasks.
pub fn default_path() -> PathBuf {
    if let Some(path) = std::env::var_os("DONE_DB") {
        return PathBuf::from(path);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let dir = home.join("Library").join("Application Support").join("done");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("done.db")
}

pub struct Store {
    // One connection behind a lock. Every call is a few milliseconds on a
    // local file, so waiting in line is simpler than a pool and just as fast.
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 3000;
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
             INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', 0);
             CREATE TABLE IF NOT EXISTS project (
               id INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               color INTEGER NOT NULL DEFAULT 0
             );
             -- ON DELETE SET NULL: a task outlives its project and falls back to
             -- the Inbox. Losing tasks with a project is never what was meant.
             CREATE TABLE IF NOT EXISTS task (
               id INTEGER PRIMARY KEY,
               title TEXT NOT NULL,
               notes TEXT NOT NULL DEFAULT '',
               project_id INTEGER REFERENCES project(id) ON DELETE SET NULL,
               start TEXT,
               due TEXT,
               priority INTEGER NOT NULL DEFAULT 4,
               status TEXT,
               done_day TEXT,
               goal_day TEXT,
               -- ON DELETE CASCADE: a subtask is part of its task and means
               -- nothing without it, unlike a task, which outlives its project.
               parent_id INTEGER REFERENCES task(id) ON DELETE CASCADE
             );",
        )?;
        // Files made before the daily goal existed lack its column. CREATE
        // TABLE IF NOT EXISTS leaves them as they are, so add it here.
        let has_goal: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('task') WHERE name = 'goal_day'",
            [],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if !has_goal {
            conn.execute("ALTER TABLE task ADD COLUMN goal_day TEXT", [])?;
        }
        // The same for subtasks. SQLite allows adding a column that points at
        // another row as long as it starts out empty, which this does.
        let has_parent: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('task') WHERE name = 'parent_id'",
            [],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if !has_parent {
            conn.execute("ALTER TABLE task ADD COLUMN parent_id INTEGER REFERENCES task(id) ON DELETE CASCADE", [])?;
        }
        conn.execute("CREATE INDEX IF NOT EXISTS task_parent ON task (parent_id)", [])?;
        // The time sheet. IF NOT EXISTS, so a tasks file made before it gains
        // the table the first time a newer version opens it.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entry (
               id INTEGER PRIMARY KEY,
               task_id INTEGER,
               title TEXT NOT NULL,
               day TEXT NOT NULL,
               started_at INTEGER NOT NULL,
               ended_at INTEGER NOT NULL,
               planned_ms INTEGER NOT NULL,
               focused_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS entry_day ON entry (day);",
        )?;
        // Notes, gained the same way by a file made before them.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note (id INTEGER PRIMARY KEY, text TEXT NOT NULL, updated_at INTEGER NOT NULL)",
            [],
        )?;
        // A note in a project. Added here for files whose notes came first.
        let has_note_project: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('note') WHERE name = 'project_id'",
            [],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if !has_note_project {
            conn.execute("ALTER TABLE note ADD COLUMN project_id INTEGER REFERENCES project(id) ON DELETE SET NULL", [])?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Writes a complete copy of the tasks file to `to`, which must not exist
    /// yet. Not a plain file copy on purpose: the newest changes sit in the
    /// write-ahead log beside the file, and a copy of the file alone could
    /// miss them. This is what a hosted server stores after each change.
    pub fn snapshot(&self, to: &Path) -> Result<(), Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("VACUUM INTO ?1", [to.to_string_lossy()])?;
        Ok(())
    }

    /// Writes down a block that has ended. Apart from `sync` and its revision
    /// on purpose: entries are only ever added, so there is nothing to
    /// conflict over, and the end of a block must never be lost because
    /// another window happened to save first.
    pub fn record(&self, entry: NewEntry) -> Result<Entry, Error> {
        check_entry(&entry)?;
        let conn = self.conn.lock().unwrap();
        let title = entry.title.trim();
        conn.execute(
            "INSERT INTO entry (task_id, title, day, started_at, ended_at, planned_ms, focused_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![entry.task_id, title, entry.day, entry.started_at, entry.ended_at, entry.planned_ms, entry.focused_ms],
        )?;
        Ok(Entry {
            id: conn.last_insert_rowid(),
            task_id: entry.task_id,
            title: title.to_string(),
            day: entry.day,
            started_at: entry.started_at,
            ended_at: entry.ended_at,
            planned_ms: entry.planned_ms,
            focused_ms: entry.focused_ms,
        })
    }

    /// One day's blocks, in the order they ran.
    pub fn entries(&self, day: &str) -> Result<Vec<Entry>, Error> {
        if !is_day(day) {
            return Err(Error::Invalid("The day must be written YYYY-MM-DD.".into()));
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, title, day, started_at, ended_at, planned_ms, focused_ms
             FROM entry WHERE day = ?1 ORDER BY started_at, id",
        )?;
        let entries = stmt
            .query_map([day], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    day: r.get(3)?,
                    started_at: r.get(4)?,
                    ended_at: r.get(5)?,
                    planned_ms: r.get(6)?,
                    focused_ms: r.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn delete_entry(&self, id: i64) -> Result<(), Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM entry WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Every note, the most recently changed first.
    pub fn notes(&self) -> Result<Vec<Note>, Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, text, updated_at, project_id FROM note ORDER BY updated_at DESC, id DESC")?;
        let notes = stmt
            .query_map([], |r| Ok(Note { id: r.get(0)?, text: r.get(1)?, updated_at: r.get(2)?, project_id: r.get(3)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(notes)
    }

    /// Writes a note, new or not. Apart from `sync` and its revision, like the
    /// time sheet: typing a note must never make a task's save fail as stale.
    /// Two windows editing one note keep whichever saved last. A note saved
    /// with the id of one that was deleted comes back as it was, which is
    /// what Undo does.
    pub fn save_note(&self, note: SaveNote) -> Result<Note, Error> {
        let conn = self.conn.lock().unwrap();
        let id = match note.id {
            Some(id) => {
                conn.execute(
                    "INSERT INTO note (id, text, updated_at, project_id) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, project_id = excluded.project_id",
                    params![id, note.text, note.updated_at, note.project_id],
                )?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO note (text, updated_at, project_id) VALUES (?1, ?2, ?3)",
                    params![note.text, note.updated_at, note.project_id],
                )?;
                conn.last_insert_rowid()
            }
        };
        Ok(Note { id, text: note.text, updated_at: note.updated_at, project_id: note.project_id })
    }

    pub fn delete_note(&self, id: i64) -> Result<(), Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM note WHERE id = ?1", [id])?;
        Ok(())
    }

    /// A moment as the Mac's clock shows it, HH:MM. Asked of SQLite for the
    /// same reason as `today`.
    pub fn clock(&self, ms: i64) -> Result<String, Error> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT strftime('%H:%M', ?1 / 1000, 'unixepoch', 'localtime')", [ms], |r| r.get(0))?)
    }

    /// Finished tasks, the most recently finished first, at most `limit`:
    /// the Completed page. Subtasks are not listed on their own.
    pub fn finished(&self, limit: i64) -> Result<Vec<Task>, Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id
             FROM task WHERE done_day IS NOT NULL AND parent_id IS NULL
             ORDER BY done_day DESC, id DESC LIMIT ?1",
        )?;
        let tasks = stmt
            .query_map([limit], |r| {
                let done_day: Option<String> = r.get(8)?;
                Ok(Task {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    notes: r.get(2)?,
                    project_id: r.get(3)?,
                    start: r.get(4)?,
                    due: r.get(5)?,
                    priority: r.get(6)?,
                    status: r.get(7)?,
                    done: true,
                    done_day,
                    goal_day: r.get(9)?,
                    parent_id: r.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    /// Today as the Mac sees it, YYYY-MM-DD. Asked of SQLite so that nothing
    /// here needs a date library, and so every caller agrees on the day.
    pub fn today(&self) -> Result<String, Error> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?)
    }

    /// Everything a window shows: all projects, every open task, and the tasks
    /// finished on `today` (the caller's local day), which the board's last
    /// column lists. Older finished tasks stay in the file but are not sent,
    /// except the subtasks of an open task: a list being ticked off over
    /// several days has to keep showing what was ticked.
    pub fn state(&self, today: &str) -> Result<State, Error> {
        if !is_day(today) {
            return Err(Error::Invalid("Today must be a day written YYYY-MM-DD.".into()));
        }
        let conn = self.conn.lock().unwrap();
        let rev = conn.query_row("SELECT value FROM meta WHERE key = 'rev'", [], |r| r.get(0))?;
        let mut stmt = conn.prepare("SELECT id, name, color FROM project ORDER BY id")?;
        let projects = stmt
            .query_map([], |r| Ok(Project { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id
             FROM task WHERE done_day IS NULL OR done_day = ?1
                OR parent_id IN (SELECT id FROM task WHERE done_day IS NULL)
             ORDER BY id",
        )?;
        let tasks = stmt
            .query_map([today], |r| {
                let done_day: Option<String> = r.get(8)?;
                Ok(Task {
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
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        // Ids are handed out by the window, so it needs one that no row has,
        // including the finished tasks it was not sent.
        let highest: Option<i64> = conn.query_row(
            "SELECT MAX(m) FROM (SELECT MAX(id) AS m FROM task UNION ALL SELECT MAX(id) FROM project)",
            [],
            |r| r.get(0),
        )?;
        Ok(State { rev, next_id: highest.unwrap_or(0) + 1, projects, tasks })
    }

    /// Applies one window's changes, all or nothing. Refused as `Stale` when
    /// the file has moved on since that window last looked: two windows open
    /// at once must not silently undo each other.
    pub fn sync(&self, change: Change) -> Result<Synced, Error> {
        for project in &change.projects {
            if project.name.trim().is_empty() {
                return Err(Error::Invalid("A project needs a name.".into()));
            }
        }
        for task in &change.tasks {
            check(task)?;
        }
        let mut conn = self.conn.lock().unwrap();
        // Immediate: take the write lock before reading the revision, so the
        // desktop app and the web app cannot both pass the check.
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let rev: i64 = tx.query_row("SELECT value FROM meta WHERE key = 'rev'", [], |r| r.get(0))?;
        if rev != change.rev {
            return Err(Error::Stale);
        }
        // Checked when the change is committed rather than row by row: a task
        // and its subtasks arrive together in whatever order the window listed
        // them, and a subtask may be written before the task it belongs to.
        tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
        // Projects first: the tasks below may point at a project made in this
        // same change.
        for p in &change.projects {
            tx.execute(
                "INSERT INTO project (id, name, color) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
                params![p.id, p.name.trim(), p.color],
            )?;
        }
        for t in &change.tasks {
            let done_day = if t.done { t.done_day.as_deref() } else { None };
            // One goal per day, whoever is writing: naming a new goal for a
            // day takes the title from whichever task held it.
            if let Some(day) = &t.goal_day {
                tx.execute("UPDATE task SET goal_day = NULL WHERE goal_day = ?1 AND id != ?2", params![day, t.id])?;
            }
            tx.execute(
                "INSERT INTO task (id, title, notes, project_id, start, due, priority, status, done_day, goal_day, parent_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes,
                   project_id = excluded.project_id, start = excluded.start, due = excluded.due,
                   priority = excluded.priority, status = excluded.status, done_day = excluded.done_day,
                   goal_day = excluded.goal_day, parent_id = excluded.parent_id",
                params![t.id, t.title.trim(), t.notes, t.project_id, t.start, t.due, t.priority, t.status, done_day, t.goal_day, t.parent_id],
            )?;
        }
        for id in &change.delete_tasks {
            tx.execute("DELETE FROM task WHERE id = ?1", [id])?;
        }
        for id in &change.delete_projects {
            tx.execute("DELETE FROM project WHERE id = ?1", [id])?;
        }
        // One level only, checked on the result rather than on what was sent:
        // the rule can be broken from either end (giving a subtask a subtask,
        // or putting a task that has subtasks under another), and only one of
        // the two rows need be in this change. A task that is its own parent
        // is caught by the same test.
        let nested: i64 = tx.query_row(
            "SELECT COUNT(*) FROM task c JOIN task p ON c.parent_id = p.id WHERE p.parent_id IS NOT NULL",
            [],
            |r| r.get(0),
        )?;
        if nested > 0 {
            return Err(Error::Invalid("A subtask cannot have subtasks of its own.".into()));
        }
        tx.execute("UPDATE meta SET value = ?1 WHERE key = 'rev'", [rev + 1])?;
        // A subtask naming a task that does not exist is refused here, when
        // the deferred check runs.
        tx.commit().map_err(|e| match e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
                Error::Invalid("A subtask has to belong to a task that exists.".into())
            }
            e => Error::Db(e),
        })?;
        Ok(Synced { rev: rev + 1 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn subtask(id: i64, parent: i64, title: &str) -> Task {
        Task { parent_id: Some(parent), ..task(id, title) }
    }

    fn done_on(mut t: Task, day: &str) -> Task {
        t.done = true;
        t.done_day = Some(day.into());
        t
    }

    // Why state() sends more than open tasks: a list ticked off over several
    // days must keep showing what was ticked, until the task itself is done.
    #[test]
    fn a_subtask_ticked_days_ago_stays_under_its_open_task() {
        let s = store();
        // Child first, as a window may list them: the check waits for the commit.
        s.sync(Change { rev: 0, tasks: vec![done_on(subtask(2, 1, "Anna"), "2026-11-10"), subtask(3, 1, "Ben"), task(1, "Reply on WhatsApp")], ..Default::default() })
            .unwrap();
        let ids = |day: &str| s.state(day).unwrap().tasks.iter().map(|t| (t.id, t.done)).collect::<Vec<_>>();
        assert_eq!(ids("2026-11-13"), vec![(1, false), (2, true), (3, false)]);
        // The task is finished on the 13th; the day after, none of it is sent.
        s.sync(Change { rev: 1, tasks: vec![done_on(task(1, "Reply on WhatsApp"), "2026-11-13"), done_on(subtask(3, 1, "Ben"), "2026-11-13")], ..Default::default() })
            .unwrap();
        assert!(s.state("2026-11-14").unwrap().tasks.is_empty());
    }

    #[test]
    fn subtasks_go_one_level_deep_whichever_end_breaks_it() {
        let s = store();
        s.sync(Change { rev: 0, tasks: vec![task(1, "Parent"), subtask(2, 1, "Child"), task(4, "Other")], ..Default::default() }).unwrap();
        // A subtask under a subtask.
        let deeper = s.sync(Change { rev: 1, tasks: vec![subtask(3, 2, "Grandchild")], ..Default::default() });
        assert!(matches!(deeper, Err(Error::Invalid(_))));
        // A task that has subtasks put under another task: only the parent's row is sent.
        let moved = s.sync(Change { rev: 1, tasks: vec![subtask(1, 4, "Parent")], ..Default::default() });
        assert!(matches!(moved, Err(Error::Invalid(_))));
        let unknown = s.sync(Change { rev: 1, tasks: vec![subtask(5, 99, "Nobody's")], ..Default::default() });
        assert!(matches!(unknown, Err(Error::Invalid(_))));
        // Nothing of the three was kept, and the file is still usable.
        let state = s.state("2026-11-13").unwrap();
        assert_eq!((state.rev, state.tasks.len()), (1, 3));
        assert_eq!(state.tasks[0].parent_id, None);
    }

    #[test]
    fn deleting_a_task_deletes_its_subtasks() {
        let s = store();
        s.sync(Change { rev: 0, tasks: vec![task(1, "Parent"), subtask(2, 1, "Child"), task(3, "Stays")], ..Default::default() }).unwrap();
        s.sync(Change { rev: 1, delete_tasks: vec![1], ..Default::default() }).unwrap();
        let left: Vec<i64> = s.state("2026-11-13").unwrap().tasks.iter().map(|t| t.id).collect();
        assert_eq!(left, vec![3]);
    }

    // A tasks file as the released app made it, before subtasks existed.
    #[test]
    fn a_file_from_before_subtasks_gains_them_on_open() {
        let dir = std::env::temp_dir().join(format!("done-subtasks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("old.db");
        let _ = std::fs::remove_file(&path);
        {
            let old = Connection::open(&path).unwrap();
            // The task table exactly as origin/main @ 1fc3741 creates it.
            old.execute_batch(
                "CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
                 INSERT INTO meta (key, value) VALUES ('rev', 4);
                 CREATE TABLE project (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE task (
                   id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
                   project_id INTEGER REFERENCES project(id) ON DELETE SET NULL,
                   start TEXT, due TEXT, priority INTEGER NOT NULL DEFAULT 4, status TEXT, done_day TEXT, goal_day TEXT
                 );
                 INSERT INTO task (id, title) VALUES (1, 'Already here');",
            )
            .unwrap();
        }
        let s = Store::open(&path).unwrap();
        s.sync(Change { rev: 4, tasks: vec![subtask(2, 1, "New under old")], ..Default::default() }).unwrap();
        let state = s.state("2026-11-13").unwrap();
        assert_eq!(state.tasks.iter().map(|t| (t.id, t.parent_id)).collect::<Vec<_>>(), vec![(1, None), (2, Some(1))]);
        drop(s);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_is_saved_comes_back() {
        let s = store();
        let project = Project { id: 1, name: "Work".into(), color: 2 };
        let mut t = task(2, "  Send the invoice  ");
        t.project_id = Some(1);
        t.due = Some("2026-11-20".into());
        let synced = s
            .sync(Change { rev: 0, projects: vec![project.clone()], tasks: vec![t], ..Default::default() })
            .unwrap();
        assert_eq!(synced.rev, 1);
        let state = s.state("2026-11-13").unwrap();
        assert_eq!(state.projects, vec![project]);
        assert_eq!(state.tasks[0].title, "Send the invoice");
        assert_eq!(state.tasks[0].project_id, Some(1));
        assert_eq!(state.next_id, 3);
    }

    #[test]
    fn a_window_that_has_not_seen_the_latest_cannot_overwrite_it() {
        let s = store();
        s.sync(Change { rev: 0, tasks: vec![task(1, "First")], ..Default::default() }).unwrap();
        // A second window still at revision 0 tries to save.
        let late = s.sync(Change { rev: 0, tasks: vec![task(1, "Overwritten")], delete_tasks: vec![1], ..Default::default() });
        assert!(matches!(late, Err(Error::Stale)));
        let state = s.state("2026-11-13").unwrap();
        assert_eq!(state.tasks[0].title, "First");
        assert_eq!(state.rev, 1);
    }

    #[test]
    fn finished_tasks_show_on_their_day_only_but_keep_their_id() {
        let s = store();
        let mut t = task(1, "Done yesterday");
        t.done = true;
        t.done_day = Some("2026-11-12".into());
        s.sync(Change { rev: 0, tasks: vec![t], ..Default::default() }).unwrap();
        assert_eq!(s.state("2026-11-12").unwrap().tasks.len(), 1);
        let next_day = s.state("2026-11-13").unwrap();
        assert!(next_day.tasks.is_empty());
        // The hidden task still owns id 1.
        assert_eq!(next_day.next_id, 2);
    }

    #[test]
    fn deleting_a_project_leaves_its_tasks_in_the_inbox() {
        let s = store();
        let mut t = task(2, "Keep me");
        t.project_id = Some(1);
        s.sync(Change { rev: 0, projects: vec![Project { id: 1, name: "Home".into(), color: 0 }], tasks: vec![t], ..Default::default() })
            .unwrap();
        s.sync(Change { rev: 1, delete_projects: vec![1], ..Default::default() }).unwrap();
        let state = s.state("2026-11-13").unwrap();
        assert!(state.projects.is_empty());
        assert_eq!(state.tasks[0].project_id, None);
    }

    #[test]
    fn a_day_has_one_goal_and_the_newest_wins() {
        let s = store();
        let mut first = task(1, "Ship the release");
        first.goal_day = Some("2026-11-13".into());
        s.sync(Change { rev: 0, tasks: vec![first, task(2, "Write the talk")], ..Default::default() }).unwrap();
        // Someone names the second task as the goal without touching the first.
        let mut second = task(2, "Write the talk");
        second.goal_day = Some("2026-11-13".into());
        s.sync(Change { rev: 1, tasks: vec![second], ..Default::default() }).unwrap();
        let goals: Vec<i64> = s.state("2026-11-13").unwrap().tasks.iter().filter(|t| t.goal_day.is_some()).map(|t| t.id).collect();
        assert_eq!(goals, vec![2]);
    }

    #[test]
    fn a_bad_task_stops_the_whole_change() {
        let s = store();
        let mut bad = task(2, "Fine title");
        bad.due = Some("next friday".into());
        let result = s.sync(Change { rev: 0, tasks: vec![task(1, "Good"), bad], ..Default::default() });
        assert!(matches!(result, Err(Error::Invalid(_))));
        assert!(s.state("2026-11-13").unwrap().tasks.is_empty());
    }

    // 09:00 on 16 Nov 2026 (UTC); the values are what the Focus view sends.
    const NINE: i64 = 1_794_819_600_000;
    const MINUTE: i64 = 60_000;

    fn block(task_id: Option<i64>, title: &str, day: &str) -> NewEntry {
        NewEntry {
            task_id,
            title: title.into(),
            day: day.into(),
            started_at: NINE,
            ended_at: NINE + 47 * MINUTE,
            planned_ms: 25 * MINUTE,
            focused_ms: 45 * MINUTE,
        }
    }

    #[test]
    fn a_recorded_block_is_on_its_own_day_only() {
        let s = store();
        let kept = s.record(block(Some(3), "  Write the report ", "2026-11-16")).unwrap();
        s.record(block(None, "Focus", "2026-11-17")).unwrap();
        let day = s.entries("2026-11-16").unwrap();
        assert_eq!(day, vec![kept]);
        assert_eq!(day[0].title, "Write the report");
        assert_eq!((day[0].planned_ms, day[0].focused_ms), (25 * MINUTE, 45 * MINUTE));
    }

    // The reason recording has its own call: a block that ends while another
    // window has saved must still be written down.
    #[test]
    fn recording_a_block_does_not_wait_for_the_tasks_revision() {
        let s = store();
        s.sync(Change { rev: 0, tasks: vec![task(1, "First")], ..Default::default() }).unwrap();
        s.record(block(Some(1), "First", "2026-11-16")).unwrap();
        assert_eq!(s.entries("2026-11-16").unwrap().len(), 1);
        // Nor does it move the revision, which would make every open window stale.
        assert_eq!(s.state("2026-11-16").unwrap().rev, 1);
    }

    #[test]
    fn a_block_outlives_its_task_and_can_name_one_not_saved_yet() {
        let s = store();
        s.sync(Change { rev: 0, tasks: vec![task(1, "Call the bank")], ..Default::default() }).unwrap();
        s.record(block(Some(1), "Call the bank", "2026-11-16")).unwrap();
        s.sync(Change { rev: 1, delete_tasks: vec![1], ..Default::default() }).unwrap();
        // Task 9 was added in the window a moment ago and is not saved yet.
        s.record(block(Some(9), "Brand new", "2026-11-16")).unwrap();
        let day = s.entries("2026-11-16").unwrap();
        assert_eq!(day.iter().map(|e| (e.task_id, e.title.as_str())).collect::<Vec<_>>(), vec![(Some(1), "Call the bank"), (Some(9), "Brand new")]);
    }

    #[test]
    fn a_bad_block_is_refused_and_a_deleted_one_is_gone() {
        let s = store();
        let mut backwards = block(None, "Focus", "2026-11-16");
        backwards.ended_at = NINE - 1;
        assert!(matches!(s.record(backwards), Err(Error::Invalid(_))));
        assert!(matches!(s.record(block(None, "  ", "2026-11-16")), Err(Error::Invalid(_))));
        assert!(matches!(s.record(block(None, "Focus", "16/11/2026")), Err(Error::Invalid(_))));
        let e = s.record(block(None, "Focus", "2026-11-16")).unwrap();
        s.delete_entry(e.id).unwrap();
        assert!(s.entries("2026-11-16").unwrap().is_empty());
    }

    // Why a snapshot and not a copy of the file: the change below is still in
    // the write-ahead log when the copy is taken.
    #[test]
    fn a_snapshot_holds_the_change_made_just_before_it() {
        let dir = std::env::temp_dir().join(format!("done-snapshot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir.join("live.db")).unwrap();
        s.sync(Change { rev: 0, tasks: vec![task(1, "Call the bank")], ..Default::default() }).unwrap();
        let copy = dir.join("copy.db");
        s.snapshot(&copy).unwrap();
        let again = Store::open(&copy).unwrap().state("2026-11-18").unwrap();
        assert_eq!(again.rev, 1);
        assert_eq!(again.tasks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), vec!["Call the bank"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn note(id: Option<i64>, text: &str, at: i64) -> SaveNote {
        SaveNote { id, text: text.into(), updated_at: at, project_id: None }
    }

    #[test]
    fn a_note_is_kept_and_the_last_changed_comes_first() {
        let s = store();
        let funds = s.save_note(note(None, "Seed funds\nAlpha\nBeta", 1)).unwrap();
        let other = s.save_note(note(None, "Gift ideas", 2)).unwrap();
        assert_eq!(s.notes().unwrap().iter().map(|n| n.id).collect::<Vec<_>>(), vec![other.id, funds.id]);
        s.save_note(note(Some(funds.id), "Seed funds\nAlpha\nBeta\nGamma", 3)).unwrap();
        let notes = s.notes().unwrap();
        assert_eq!(notes[0].id, funds.id);
        assert_eq!(notes[0].text, "Seed funds\nAlpha\nBeta\nGamma");
        assert_eq!(notes.len(), 2);
    }

    #[test]
    fn a_deleted_note_comes_back_when_saved_with_its_id() {
        let s = store();
        let n = s.save_note(note(None, "Funds", 1)).unwrap();
        s.delete_note(n.id).unwrap();
        assert!(s.notes().unwrap().is_empty());
        s.save_note(note(Some(n.id), "Funds", 1)).unwrap();
        assert_eq!(s.notes().unwrap(), vec![Note { id: n.id, text: "Funds".into(), updated_at: 1, project_id: None }]);
    }

    #[test]
    fn saving_a_note_does_not_move_the_tasks_revision() {
        let s = store();
        s.save_note(note(None, "Funds", 1)).unwrap();
        assert_eq!(s.state("2026-11-20").unwrap().rev, 0);
    }

    #[test]
    fn a_note_keeps_its_project_and_outlives_it() {
        let s = store();
        s.sync(Change { rev: 0, projects: vec![Project { id: 1, name: "Hop".into(), color: 0 }], ..Default::default() }).unwrap();
        let n = s.save_note(SaveNote { id: None, text: "Funds".into(), updated_at: 1, project_id: Some(1) }).unwrap();
        assert_eq!(s.notes().unwrap()[0].project_id, Some(1));
        s.sync(Change { rev: 1, delete_projects: vec![1], ..Default::default() }).unwrap();
        assert_eq!(s.notes().unwrap(), vec![Note { id: n.id, text: "Funds".into(), updated_at: 1, project_id: None }]);
    }

    #[test]
    fn finished_tasks_are_listed_newest_first_without_subtasks() {
        let s = store();
        let tasks = vec![
            done_on(task(1, "Old"), "2026-11-01"),
            done_on(task(2, "New"), "2026-11-20"),
            task(3, "Open"),
            done_on(subtask(4, 2, "Part"), "2026-11-20"),
        ];
        s.sync(Change { rev: 0, tasks, ..Default::default() }).unwrap();
        let titles: Vec<String> = s.finished(10).unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, vec!["New", "Old"]);
        assert_eq!(s.finished(1).unwrap().len(), 1);
    }
}
