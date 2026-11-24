//! done's MCP server: lets an AI agent read and change tasks.
//!
//! It speaks MCP over standard input and output, one JSON message per line,
//! and is started as `done mcp` by whichever agent connects to it. It works on
//! the same tasks file as the app, through the same rules, so anything an
//! agent does shows up in the window and the other way round.
//!
//! The protocol is small enough here (five methods) that it is written out
//! rather than pulled in as a framework.

use done_core::{Change, Error, Note, Project, SaveNote, State, Store, Task};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// Versions of the protocol this server can speak; the newest is last.
const VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];

/// How many project colours the interface has to choose from.
const COLOURS: i64 = 8;

pub fn serve(store: &Store, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(store, &message),
            Err(_) => Some(failure(Value::Null, -32700, "That was not JSON.")),
        };
        if let Some(reply) = reply {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn handle(store: &Store, message: &Value) -> Option<Value> {
    // A message without an id is a notification: nothing is sent back.
    let id = message.get("id")?.clone();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match message.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => {
            // Speak the version the agent asked for when it is one we know.
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = if VERSIONS.contains(&asked) { asked } else { VERSIONS[VERSIONS.len() - 1] };
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "done", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "done is the user's personal to-do list. Dates are calendar days written YYYY-MM-DD; list_tasks tells you today's date. Priority 1 is the most urgent and 4 means none. A task with no project is in the Inbox. A task can have subtasks, one level deep: a list to tick off under it. A subtask has its own id and is changed, completed and deleted like any task.",
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            // A tool that fails is still a successful reply; the agent reads
            // the message and can correct itself.
            match call(store, name, &args) {
                Ok(value) => json!({ "content": [{ "type": "text", "text": value.to_string() }] }),
                Err(why) => json!({ "content": [{ "type": "text", "text": why }], "isError": true }),
            }
        }
        _ => return Some(failure(id, -32601, "No such method.")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn tools() -> Value {
    let day = json!({ "type": ["string", "null"], "description": "A day written YYYY-MM-DD, or null for none." });
    let fields = json!({
        "title": { "type": "string" },
        "notes": { "type": "string" },
        "start": day,
        "due": day,
        "priority": { "type": "integer", "minimum": 0, "maximum": 4, "description": "0 (P0) is only for what must happen right away; 1 is the most urgent otherwise, 4 means none." },
        "project": { "type": ["string", "null"], "description": "The name of an existing project, or null for the Inbox." },
    });
    let mut fields = fields;
    fields["goal"] = json!({ "type": "boolean", "description": "true makes this today's goal: the one thing that has to happen today. Only one task can be it." });
    let mut update = fields.clone();
    update["id"] = json!({ "type": "integer" });
    let mut add = fields.clone();
    add["parent"] = json!({ "type": "integer", "description": "The id of an open task: the new task becomes a subtask of it. Not together with subtasks." });
    add["subtasks"] = json!({
        "type": "array", "description": "Subtasks to add under the new task, in order.",
        "items": { "type": "object", "properties": { "title": { "type": "string" }, "notes": { "type": "string" } }, "required": ["title"] },
    });
    update["status"] = json!({ "type": "string", "enum": ["todo", "doing"], "description": "doing means in progress." });
    let people = json!({ "type": "array", "items": { "type": "string" },
        "description": "Who it is assigned to, by name or email, from the members of the workspace the task is in (list_projects says which projects are in one). Replaces whoever is on it; [] takes everyone off. Only for tasks in a workspace." });
    update["assignees"] = people.clone();
    add["assignees"] = people;
    let id_only = json!({ "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] });
    json!([
        { "name": "list_tasks", "description": "List open tasks, with today's date. Finished tasks are not listed. Each task carries its subtasks, including the ones already done.",
          "inputSchema": { "type": "object", "properties": {
              "filter": { "type": "string", "enum": ["all", "today", "upcoming", "inbox", "assigned_to_me", "finished_today"], "description": "today includes overdue tasks; assigned_to_me is the tasks someone in a workspace put you on; finished_today lists what was finished today instead of open tasks. Defaults to all." },
              "project": { "type": "string", "description": "Only tasks in this project." } } } },
        { "name": "add_task", "description": "Add a task, optionally with subtasks, or add one subtask to an existing task.",
          "inputSchema": { "type": "object", "properties": add, "required": ["title"] } },
        { "name": "update_task", "description": "Change a task. Only the fields given are changed.",
          "inputSchema": { "type": "object", "properties": update, "required": ["id"] } },
        { "name": "complete_task", "description": "Mark a task or a subtask as finished. Finishing a task finishes its open subtasks.", "inputSchema": id_only },
        { "name": "reopen_task", "description": "Put back a task that was finished today, for example one finished by mistake, with the subtasks finished along with it.", "inputSchema": id_only },
        { "name": "delete_task", "description": "Delete a task for good, with its subtasks. Prefer complete_task for work that was done.", "inputSchema": id_only },
        { "name": "list_projects", "description": "List the projects. A project in a workspace is shared with the workspace's members, who are listed; its tasks and notes are theirs as much as yours.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "add_project", "description": "Create a project.",
          "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } },
        { "name": "list_notes", "description": "The notes on the Notes page, the most recently changed first, at most 20. A note is free text that is not a task; its first line is its title. Each note lists the tasks it mentions, with whether they are done (found: false means finished a while ago, or deleted).",
          "inputSchema": { "type": "object", "properties": {
              "search": { "type": "string", "description": "Only notes containing every one of these words, case ignored." },
              "folder": { "type": "string", "description": "Only notes in this folder, case ignored." } } } },
        { "name": "add_note", "description": "Add a note. Put a short title on the first line. To put a task in the note, mention it as a Markdown link: [its title](done:task/<id>), with the id from list_tasks; the app shows it as the live task.",
          "inputSchema": { "type": "object", "properties": { "text": { "type": "string" },
              "project": { "type": "string", "description": "The name of an existing project the note belongs to." },
              "folder": { "type": "string", "description": "The folder to file it in. A folder that does not exist yet is made by filing a note in it." } }, "required": ["text"] } },
        { "name": "update_note", "description": "Change a note. text replaces the whole text: to add to it, send its current text with the addition. project moves it to a project, or null takes it out of one; folder likewise. Fields left out stay as they are. Tasks are mentioned as [title](done:task/<id>).",
          "inputSchema": { "type": "object", "properties": { "id": { "type": "integer" }, "text": { "type": "string" },
              "project": { "type": ["string", "null"], "description": "The name of an existing project, or null for none." },
              "folder": { "type": ["string", "null"], "description": "A folder name, or null for none." } }, "required": ["id"] } },
        { "name": "delete_note", "description": "Delete a note for good.", "inputSchema": id_only },
        { "name": "time_sheet", "description": "One day's focus blocks from the time sheet: what was focused on, when, planned against actual minutes, and the totals.",
          "inputSchema": { "type": "object", "properties": {
              "day": { "type": "string", "description": "YYYY-MM-DD. Defaults to today." } } } },
    ])
}

/// The workspace a row is in, if it is in one (not the person's own space).
fn workspace<'a>(team: &'a Option<Value>, space: Option<i64>) -> Option<&'a Value> {
    let space = space?;
    team.as_ref()?["spaces"].as_array()?.iter().find(|s| s["id"].as_i64() == Some(space) && s["kind"] == "workspace")
}

fn member_name(space: &Value, id: &str) -> String {
    space["members"].as_array().into_iter().flatten().find(|m| m["id"] == id).and_then(|m| m["name"].as_str()).unwrap_or(id).to_string()
}

/// The person this device is signed in as, if it is.
fn me(state: &State) -> Option<String> {
    state.team.as_ref()?["me"].as_str().map(String::from)
}

fn describe(task: &Task, state: &State) -> Value {
    let project = task.project_id.and_then(|id| state.projects.iter().find(|p| p.id == id)).map(|p| p.name.clone());
    let mut said = json!({
        "id": task.id, "title": task.title, "notes": task.notes, "project": project,
        "start": task.start, "due": task.due, "priority": task.priority,
        "status": task.status.as_deref().unwrap_or("todo"),
        "goalDay": task.goal_day,
        "parent": task.parent_id,
    });
    // Written by and for other people too: said, so an agent treats it so.
    if let Some(space) = workspace(&state.team, task.space_id) {
        said["workspace"] = space["name"].clone();
        said["assignees"] = task.assignees.iter().map(|a| json!(member_name(space, a))).collect();
    }
    said
}

/// Who an agent named, as account ids in the task's workspace.
fn assignees_named(task: &Task, state: &State, names: &[Value]) -> Result<Vec<String>, String> {
    let space = workspace(&state.team, task.space_id)
        .ok_or("Only a task in a workspace can be assigned. Move its project into a workspace in the app first.")?;
    let members: Vec<&Value> = space["members"].as_array().into_iter().flatten().collect();
    names
        .iter()
        .map(|n| {
            let wanted = n.as_str().unwrap_or("").trim().to_lowercase();
            members
                .iter()
                .find(|m| {
                    let name = m["name"].as_str().unwrap_or("").to_lowercase();
                    m["email"].as_str().unwrap_or("").to_lowercase() == wanted || name == wanted || name.split_whitespace().next() == Some(wanted.as_str())
                })
                .and_then(|m| m["id"].as_str().map(String::from))
                .ok_or_else(|| {
                    let all: Vec<&str> = members.iter().filter_map(|m| m["name"].as_str()).collect();
                    format!("Nobody called \"{wanted}\" is in {}. Its members are: {}.", space["name"].as_str().unwrap_or("the workspace"), all.join(", "))
                })
        })
        .collect()
}

/// The assignment changes that make a task's assignees exactly `ids`.
fn reassign(task: &Task, ids: &[String]) -> Vec<done_core::Assign> {
    let off = task.assignees.iter().filter(|a| !ids.contains(a)).map(|a| done_core::Assign { task_id: task.id, account_id: a.clone(), on: false });
    let on = ids.iter().filter(|a| !task.assignees.contains(a)).map(|a| done_core::Assign { task_id: task.id, account_id: a.clone(), on: true });
    off.chain(on).collect()
}

/// A task as list_tasks gives it: with the subtasks under it, done or not.
fn describe_with_subtasks(task: &Task, state: &State) -> Value {
    let mut said = describe(task, state);
    let subtasks: Vec<Value> = state.tasks.iter()
        .filter(|t| t.parent_id == Some(task.id))
        .map(|t| json!({ "id": t.id, "title": t.title, "notes": t.notes, "done": t.done }))
        .collect();
    said["subtasks"] = json!(subtasks);
    said
}

fn project_named(state: &State, name: &str) -> Result<i64, String> {
    state.projects.iter().find(|p| p.name.eq_ignore_ascii_case(name.trim())).map(|p| p.id).ok_or_else(|| {
        let names: Vec<&str> = state.projects.iter().map(|p| p.name.as_str()).collect();
        format!("There is no project called \"{name}\". The projects are: {}.", if names.is_empty() { "none yet".into() } else { names.join(", ") })
    })
}

fn open_task(state: &State, args: &Value) -> Result<Task, String> {
    let id = args.get("id").and_then(Value::as_i64).ok_or("Give the task's id.")?;
    state.tasks.iter().find(|t| t.id == id && !t.done).cloned().ok_or_else(|| format!("There is no open task with id {id}."))
}

/// Copies the fields an agent gave onto a task. A field left out is left alone;
/// a date or project given as null is cleared.
fn apply(task: &mut Task, args: &Value, state: &State, today: &str) -> Result<(), String> {
    let text = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_string);
    let day = |key: &str| args.get(key).map(|v| v.as_str().map(str::to_string));
    if let Some(title) = text("title") {
        task.title = title;
    }
    if let Some(notes) = text("notes") {
        task.notes = notes;
    }
    if let Some(start) = day("start") {
        task.start = start;
    }
    if let Some(due) = day("due") {
        task.due = due;
    }
    if let Some(priority) = args.get("priority").and_then(Value::as_i64) {
        task.priority = priority;
    }
    if let Some(project) = args.get("project") {
        task.project_id = match project.as_str() {
            Some(name) if !name.eq_ignore_ascii_case("inbox") => Some(project_named(state, name)?),
            _ => None,
        };
    }
    if let Some(status) = text("status") {
        task.status = (status == "doing").then(|| "doing".to_string());
    }
    if let Some(goal) = args.get("goal").and_then(Value::as_bool) {
        task.goal_day = goal.then(|| today.to_string());
        // A goal is one person's: this device's.
        task.goal_by = if goal { me(state) } else { None };
        // As in the app: a goal for today with no date gets today's.
        if goal && task.due.is_none() {
            task.due = Some(today.to_string());
        }
    }
    Ok(())
}

/// Reads the tasks, lets `edit` decide what to change, and saves. If the app
/// saved in between, the whole thing is done again on the fresh state, so an
/// agent never overwrites something it did not see.
fn change(store: &Store, edit: impl Fn(&State, &str) -> Result<(Change, Value), String>) -> Result<Value, String> {
    for _ in 0..5 {
        let today = store.today().map_err(|e| e.to_string())?;
        let state = store.state(&today).map_err(|e| e.to_string())?;
        let (mut change, said) = edit(&state, &today)?;
        change.rev = state.rev;
        match store.sync(change) {
            Ok(_) => return Ok(said),
            Err(Error::Stale) => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("done is being changed elsewhere right now. Try again.".into())
}

/// The first line with something on it, as the Notes page shows it: without
/// the Markdown that makes it a heading ("# Funds" is "Funds").
fn title_of(text: &str) -> String {
    for line in text.lines() {
        let line = line.trim();
        let hashes = line.len() - line.trim_start_matches('#').len();
        let rest = &line[hashes..];
        let title = if (1..=6).contains(&hashes) && (rest.is_empty() || rest.starts_with(char::is_whitespace)) {
            rest.trim().trim_end_matches('#').trim()
        } else {
            line
        };
        if !title.is_empty() {
            return title.to_string();
        }
    }
    "New note".to_string()
}

/// The tasks a note mentions, as the app writes them: [title](done:task/<id>),
/// in order, once each. Code is skipped (inside backticks or a fenced block),
/// as the app shows code as written.
fn mentions_in(text: &str) -> Vec<i64> {
    const MARK: &str = "](done:task/";
    let mut ids = Vec::new();
    let mut fenced = false;
    for line in text.lines() {
        let start = line.trim_start();
        if start.starts_with("```") || start.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        // Every other piece between backticks is inline code.
        for part in line.split('`').step_by(2) {
            let mut rest = part;
            while let Some(at) = rest.find(MARK) {
                let after = &rest[at + MARK.len()..];
                let digits = after.len() - after.trim_start_matches(|c: char| c.is_ascii_digit()).len();
                if digits > 0 && after[digits..].starts_with(')') {
                    if let Ok(id) = after[..digits].parse::<i64>() {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                }
                rest = after;
            }
        }
    }
    ids
}

/// The tasks a note's mentions can point at: open ones and those finished
/// today (the state), and those finished earlier.
fn known_tasks(store: &Store, state: &State) -> Result<Vec<Task>, String> {
    let mut known = state.tasks.clone();
    known.extend(store.finished(500).map_err(|e| e.to_string())?);
    Ok(known)
}

fn describe_note(note: &Note, projects: &[Project], known: &[Task]) -> Value {
    let tasks: Vec<Value> = mentions_in(&note.text)
        .into_iter()
        .map(|id| match known.iter().find(|t| t.id == id) {
            Some(t) => json!({ "id": id, "title": t.title, "done": t.done }),
            // Not open, not finished recently: finished long ago, or deleted.
            // Which one cannot be told, so an agent is not told it was deleted
            // (it might then "fix" the note).
            None => json!({ "id": id, "found": false, "why": "finished a while ago, or deleted" }),
        })
        .collect();
    let project = note.project_id.and_then(|id| projects.iter().find(|p| p.id == id)).map(|p| p.name.clone());
    json!({ "id": note.id, "title": title_of(&note.text), "text": note.text, "project": project, "folder": note.folder.clone().flatten(), "tasks": tasks, "updatedAt": note.updated_at })
}

/// A note, labelled with its workspace when it is in one: other people write there too.
fn describe_note_in(note: &Note, state: &State, known: &[Task]) -> Value {
    let mut said = describe_note(note, &state.projects, known);
    if let Some(space) = workspace(&state.team, note.space_id) {
        said["workspace"] = space["name"].clone();
    }
    said
}

/// The folder an agent named for a note: Some(None) for an explicit null,
/// None when it said nothing. A name that matches an existing folder but for
/// case is that folder, so "fundraising" files into "Fundraising" instead of
/// starting a second one.
fn note_folder(args: &Value, notes: &[Note]) -> Option<Option<String>> {
    match args.get("folder") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => {
            let wanted = done_core::clean_folder(v.as_str());
            Some(wanted.map(|w| notes.iter().filter_map(|n| n.folder.clone().flatten()).find(|f| f.to_lowercase() == w.to_lowercase()).unwrap_or(w)))
        }
    }
}

/// The projects, for naming a note's project and finding one by its name.
fn current_state(store: &Store) -> Result<State, String> {
    let today = store.today().map_err(|e| e.to_string())?;
    store.state(&today).map_err(|e| e.to_string())
}

/// The project an agent named for a note: Some(None) for an explicit null,
/// None when it said nothing about the project.
fn note_project(args: &Value, state: &State) -> Result<Option<Option<i64>>, String> {
    match args.get("project") {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => Ok(Some(Some(project_named(state, v.as_str().unwrap_or(""))?))),
    }
}

fn note_text(args: &Value) -> Result<String, String> {
    let text = args.get("text").and_then(Value::as_str).unwrap_or("");
    if text.trim().is_empty() {
        return Err("A note needs some text.".into());
    }
    Ok(text.to_string())
}

fn existing_note(store: &Store, args: &Value) -> Result<Note, String> {
    let id = args.get("id").and_then(Value::as_i64).ok_or("Give the note's id, from list_notes.")?;
    store.notes().map_err(|e| e.to_string())?.into_iter().find(|n| n.id == id).ok_or_else(|| format!("There is no note {id}. list_notes gives the ids."))
}

/// list_notes gives at most this many, newest first, and says how many it left out.
const NOTES_LISTED: usize = 20;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn call(store: &Store, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "list_tasks" => {
            let today = store.today().map_err(|e| e.to_string())?;
            let state = store.state(&today).map_err(|e| e.to_string())?;
            let mine = me(&state);
            let goal = state.tasks.iter().find(|t| t.goal_day.as_deref() == Some(today.as_str()) && (t.goal_by.is_none() || t.goal_by == mine)).map(|t| t.title.clone());
            let project = match args.get("project").and_then(Value::as_str) {
                Some(name) => Some(project_named(&state, name)?),
                None => None,
            };
            let filter = args.get("filter").and_then(Value::as_str).unwrap_or("all");
            let tasks: Vec<Value> = state.tasks.iter()
                // Subtasks are listed under their task, never on their own.
                .filter(|t| t.parent_id.is_none() && t.done == (filter == "finished_today"))
                .filter(|t| project.is_none() || t.project_id == project)
                .filter(|t| match filter {
                    // Days written YYYY-MM-DD compare correctly as text.
                    "today" => t.due.as_deref().is_some_and(|d| d <= today.as_str()),
                    "upcoming" => t.due.as_deref().is_some_and(|d| d > today.as_str()),
                    "inbox" => t.project_id.is_none() && workspace(&state.team, t.space_id).is_none(),
                    "assigned_to_me" => mine.as_ref().is_some_and(|m| t.assignees.contains(m)),
                    _ => true,
                })
                .map(|t| describe_with_subtasks(t, &state))
                .collect();
            Ok(json!({ "today": today, "todaysGoal": goal, "tasks": tasks }))
        }
        "list_projects" => {
            let today = store.today().map_err(|e| e.to_string())?;
            let state = store.state(&today).map_err(|e| e.to_string())?;
            let projects: Vec<Value> = state.projects.iter().map(|p| {
                let open = state.tasks.iter().filter(|t| !t.done && t.parent_id.is_none() && t.project_id == Some(p.id)).count();
                let mut said = json!({ "name": p.name, "openTasks": open });
                if let Some(space) = workspace(&state.team, p.space_id) {
                    said["workspace"] = space["name"].clone();
                    said["members"] = space["members"].as_array().into_iter().flatten().map(|m| m["name"].clone()).collect();
                }
                said
            }).collect();
            Ok(json!({ "projects": projects }))
        }
        "add_task" => change(store, |state, today| {
            let mut task = Task {
                id: state.next_id, title: String::new(), notes: String::new(), project_id: None,
                start: None, due: None, priority: 4, status: None, done: false, done_day: None, goal_day: None, parent_id: None,
                space_id: None, goal_by: None, assignees: Vec::new(),
            };
            apply(&mut task, args, state, today)?;
            let listed = args.get("subtasks").and_then(Value::as_array).cloned().unwrap_or_default();
            if let Some(parent) = args.get("parent").and_then(Value::as_i64) {
                if !listed.is_empty() {
                    return Err("A subtask cannot have subtasks of its own. Give parent or subtasks, not both.".into());
                }
                let parent = state.tasks.iter().find(|t| t.id == parent && !t.done)
                    .ok_or_else(|| format!("There is no open task with id {parent}."))?;
                if parent.parent_id.is_some() {
                    return Err(format!("Task {} is itself a subtask, and subtasks go one level deep.", parent.id));
                }
                task.parent_id = Some(parent.id);
                // A subtask lives where its task lives, unless told otherwise.
                if args.get("project").is_none() {
                    task.project_id = parent.project_id;
                }
            }
            let mut tasks = vec![task.clone()];
            for (i, sub) in listed.iter().enumerate() {
                tasks.push(Task {
                    // The ids straight after the task's own: nothing else is
                    // handed out in this change.
                    id: task.id + 1 + i as i64,
                    title: sub.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
                    notes: sub.get("notes").and_then(Value::as_str).unwrap_or("").to_string(),
                    project_id: task.project_id,
                    start: None, due: None, priority: 4, status: None, done: false, done_day: None, goal_day: None,
                    parent_id: Some(task.id), space_id: None, goal_by: None, assignees: Vec::new(),
                });
            }
            // Its space is its project's, which assigning needs to know now.
            task.space_id = task.project_id.and_then(|p| state.projects.iter().find(|x| x.id == p)).and_then(|p| p.space_id);
            let assign = match args.get("assignees").and_then(Value::as_array) {
                Some(names) => reassign(&task, &assignees_named(&task, state, names)?),
                None => Vec::new(),
            };
            let mut said = describe(&task, state);
            if !listed.is_empty() {
                said["subtasks"] = tasks[1..].iter().map(|t| json!({ "id": t.id, "title": t.title, "notes": t.notes, "done": false })).collect();
            }
            Ok((Change { tasks, assign, ..Default::default() }, said))
        }),
        "update_task" => change(store, |state, today| {
            let mut task = open_task(state, args)?;
            apply(&mut task, args, state, today)?;
            // Given a new project, it is in that project's space: assignees
            // are looked for there.
            if args.get("project").is_some() {
                task.space_id = task.project_id.and_then(|p| state.projects.iter().find(|x| x.id == p)).and_then(|p| p.space_id).or(task.space_id.filter(|_| task.project_id.is_none()));
            }
            let assign = match args.get("assignees").and_then(Value::as_array) {
                Some(names) => reassign(&task, &assignees_named(&task, state, names)?),
                None => Vec::new(),
            };
            let mut said = describe(&task, state);
            if !assign.is_empty() {
                let ids: Vec<String> = assignees_named(&task, state, args["assignees"].as_array().unwrap())?;
                let space = workspace(&state.team, task.space_id).unwrap();
                said["assignees"] = ids.iter().map(|a| json!(member_name(space, a))).collect();
            }
            Ok((Change { tasks: vec![task], assign, ..Default::default() }, said))
        }),
        "complete_task" => change(store, |state, today| {
            let mut task = open_task(state, args)?;
            task.done = true;
            task.done_day = Some(today.to_string());
            let said = json!({ "completed": task.title });
            // As in the app: a finished task has nothing left open under it.
            let mut tasks: Vec<Task> = state.tasks.iter()
                .filter(|t| t.parent_id == Some(task.id) && !t.done)
                .cloned()
                .map(|mut t| {
                    t.done = true;
                    t.done_day = Some(today.to_string());
                    t
                })
                .collect();
            tasks.push(task);
            Ok((Change { tasks, ..Default::default() }, said))
        }),
        "reopen_task" => change(store, |state, _| {
            let id = args.get("id").and_then(Value::as_i64).ok_or("Give the task's id.")?;
            let task = state.tasks.iter().find(|t| t.id == id).ok_or_else(|| {
                format!("There is no task {id} finished today. Only a task finished today can be put back here; reopen an older one in the app.")
            })?;
            if !task.done {
                return Err(format!("\"{}\" is still open.", task.title));
            }
            // As in the app: its subtasks finished the same day come back with it.
            let tasks: Vec<Task> = state.tasks.iter()
                .filter(|t| t.id == id || (t.parent_id == Some(id) && t.done && t.done_day == task.done_day))
                .cloned()
                .map(|mut t| {
                    t.done = false;
                    t.done_day = None;
                    t
                })
                .collect();
            Ok((Change { tasks, ..Default::default() }, json!({ "reopened": task.title })))
        }),
        "delete_task" => change(store, |state, _| {
            let task = open_task(state, args)?;
            Ok((Change { delete_tasks: vec![task.id], ..Default::default() }, json!({ "deleted": task.title })))
        }),
        "add_project" => change(store, |state, _| {
            let name = args.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
            if state.projects.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
                return Err(format!("There is already a project called \"{name}\"."));
            }
            // The first colour no other project is using, as the app does.
            let color = (0..COLOURS).find(|c| state.projects.iter().all(|p| p.color != *c)).unwrap_or(0);
            let project = Project { id: state.next_id, name: name.clone(), color, space_id: None };
            Ok((Change { projects: vec![project], ..Default::default() }, json!({ "created": name })))
        }),
        "list_notes" => {
            let words: Vec<String> = args.get("search").and_then(Value::as_str).unwrap_or("")
                .split_whitespace().map(str::to_lowercase).collect();
            // Cleaned as stored names are, so "Fund  raising" finds "Fund raising".
            let folder = done_core::clean_folder(args.get("folder").and_then(Value::as_str)).map(|f| f.to_lowercase());
            let found: Vec<Note> = store.notes().map_err(|e| e.to_string())?.into_iter()
                .filter(|n| { let text = n.text.to_lowercase(); words.iter().all(|w| text.contains(w.as_str())) })
                .filter(|n| folder.as_ref().is_none_or(|f| n.folder.clone().flatten().is_some_and(|nf| nf.to_lowercase() == *f)))
                .collect();
            let state = current_state(store)?;
            let known = known_tasks(store, &state)?;
            let notes: Vec<Value> = found.iter().take(NOTES_LISTED).map(|n| describe_note_in(n, &state, &known)).collect();
            let more = found.len().saturating_sub(NOTES_LISTED);
            Ok(if more > 0 { json!({ "notes": notes, "notListed": more }) } else { json!({ "notes": notes }) })
        }
        "time_sheet" => {
            let day = match args.get("day").and_then(Value::as_str) {
                Some(day) => day.to_string(),
                None => store.today().map_err(|e| e.to_string())?,
            };
            let entries = store.entries(&day).map_err(|e| e.to_string())?;
            let minutes = |ms: i64| (ms + 30_000) / 60_000;
            let mut blocks = Vec::new();
            for e in &entries {
                blocks.push(json!({
                    "title": e.title, "taskId": e.task_id,
                    "from": store.clock(e.started_at).map_err(|e| e.to_string())?,
                    "to": store.clock(e.ended_at).map_err(|e| e.to_string())?,
                    "plannedMinutes": minutes(e.planned_ms), "focusedMinutes": minutes(e.focused_ms),
                }));
            }
            let planned: i64 = entries.iter().map(|e| e.planned_ms).sum();
            let focused: i64 = entries.iter().map(|e| e.focused_ms).sum();
            Ok(json!({ "day": day, "blocks": blocks, "plannedMinutes": minutes(planned), "focusedMinutes": minutes(focused) }))
        }
        "add_note" => {
            let text = note_text(args)?;
            let state = current_state(store)?;
            let project_id = note_project(args, &state)?.flatten();
            let folder = note_folder(args, &store.notes().map_err(|e| e.to_string())?);
            let note = store.save_note(SaveNote { id: None, text, updated_at: now_ms(), project_id, folder, space_id: None }).map_err(|e| e.to_string())?;
            Ok(describe_note_in(&note, &state, &known_tasks(store, &state)?))
        }
        "update_note" => {
            let note = existing_note(store, args)?;
            let state = current_state(store)?;
            let text = if args.get("text").is_some() { note_text(args)? } else { note.text.clone() };
            let project_id = note_project(args, &state)?.unwrap_or(note.project_id);
            // Not said: the note keeps its folder.
            let folder = note_folder(args, &store.notes().map_err(|e| e.to_string())?);
            let note = store.save_note(SaveNote { id: Some(note.id), text, updated_at: now_ms(), project_id, folder, space_id: note.space_id }).map_err(|e| e.to_string())?;
            Ok(describe_note_in(&note, &state, &known_tasks(store, &state)?))
        }
        "delete_note" => {
            let note = existing_note(store, args)?;
            store.delete_note(note.id).map_err(|e| e.to_string())?;
            Ok(json!({ "deleted": title_of(&note.text) }))
        }
        _ => Err(format!("There is no tool called \"{name}\".")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Sends the lines as an agent would and returns each reply.
    fn talk(store: &Store, lines: &[Value]) -> Vec<Value> {
        let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
        let mut output = Vec::new();
        serve(store, input.as_bytes(), &mut output).unwrap();
        String::from_utf8(output).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn tool(id: i64, name: &str, arguments: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": arguments } })
    }

    /// What a tool said, parsed back from the text it replied with.
    fn said(reply: &Value) -> Value {
        serde_json::from_str(reply["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn an_agent_can_connect_and_is_told_the_tools() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }),
            // A notification gets no reply, so only two replies come back.
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        ]);
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-03-26");
        let names: Vec<&str> = replies[1]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"add_task") && names.contains(&"complete_task"));
    }

    #[test]
    fn what_an_agent_adds_changes_and_finishes_is_what_the_app_sees() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            tool(1, "add_project", json!({ "name": "Home" })),
            tool(2, "add_task", json!({ "title": "Call the bank", "due": "2026-11-20", "priority": 1, "project": "home" })),
            tool(3, "add_task", json!({ "title": "Second" })),
        ]);
        let id = said(&replies[1])["id"].as_i64().unwrap();
        assert_eq!(said(&replies[1])["project"], "Home");

        let replies = talk(&store, &[
            tool(4, "update_task", json!({ "id": id, "due": null, "status": "doing" })),
            tool(5, "list_tasks", json!({ "project": "Home" })),
            tool(6, "complete_task", json!({ "id": id })),
            tool(7, "list_tasks", json!({})),
        ]);
        let in_home = said(&replies[1]);
        assert_eq!(in_home["tasks"][0]["due"], Value::Null);
        assert_eq!(in_home["tasks"][0]["status"], "doing");
        // Finished: gone from the list, and stored as finished today.
        let left = said(&replies[3]);
        assert_eq!(left["tasks"].as_array().unwrap().len(), 1);
        let today = store.today().unwrap();
        let stored = store.state(&today).unwrap();
        assert!(stored.tasks.iter().any(|t| t.id == id && t.done && t.done_day.as_deref() == Some(today.as_str())));
    }

    #[test]
    fn a_task_added_with_subtasks_is_listed_with_them_until_it_is_finished() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            tool(1, "add_task", json!({ "title": "Reply on WhatsApp", "subtasks": [
                { "title": "Anna", "notes": "Asked about Thursday" }, { "title": "Ben" } ] })),
        ]);
        let added = said(&replies[0]);
        let (parent, anna) = (added["id"].as_i64().unwrap(), added["subtasks"][0]["id"].as_i64().unwrap());

        let replies = talk(&store, &[
            tool(2, "add_task", json!({ "title": "Cleo", "parent": parent })),
            tool(3, "complete_task", json!({ "id": anna })),
            tool(4, "list_tasks", json!({})),
            // One level only, and said in a way an agent can act on.
            tool(5, "add_task", json!({ "title": "Too deep", "parent": anna + 1 })),
            tool(6, "complete_task", json!({ "id": parent })),
            tool(7, "list_tasks", json!({})),
        ]);
        let listed = said(&replies[2]);
        // The subtasks are under their task and nowhere else.
        assert_eq!(listed["tasks"].as_array().unwrap().len(), 1);
        let under: Vec<(&str, bool)> = listed["tasks"][0]["subtasks"].as_array().unwrap().iter()
            .map(|t| (t["title"].as_str().unwrap(), t["done"].as_bool().unwrap())).collect();
        assert_eq!(under, vec![("Anna", true), ("Ben", false), ("Cleo", false)]);
        assert_eq!(listed["tasks"][0]["subtasks"][0]["notes"], "Asked about Thursday");
        assert_eq!(replies[3]["result"]["isError"], true);
        // Finishing the task finished Ben and Cleo with it.
        assert!(said(&replies[5])["tasks"].as_array().unwrap().is_empty());
        let today = store.today().unwrap();
        assert!(store.state(&today).unwrap().tasks.iter().all(|t| t.done));
    }

    #[test]
    fn mistakes_come_back_as_messages_an_agent_can_act_on() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            tool(1, "add_task", json!({ "title": "Pay rent", "project": "Nowhere" })),
            tool(2, "add_task", json!({ "title": "Pay rent", "due": "next friday" })),
            tool(3, "complete_task", json!({ "id": 99 })),
            json!({ "jsonrpc": "2.0", "id": 4, "method": "no/such" }),
        ]);
        for reply in &replies[..3] {
            assert_eq!(reply["result"]["isError"], true);
        }
        assert!(replies[0]["result"]["content"][0]["text"].as_str().unwrap().contains("no project called"));
        assert_eq!(replies[3]["error"]["code"], -32601);
        // Nothing was saved by any of them.
        assert!(store.state(&store.today().unwrap()).unwrap().tasks.is_empty());
    }

    #[test]
    fn an_agent_can_write_down_a_note_the_app_lists() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[tool(1, "add_note", json!({ "text": "# Seed round funds\nAlpha Ventures\nBeta Capital" }))]);
        let added = said(&replies[0]);
        let id = added["id"].as_i64().unwrap();
        assert_eq!(added["title"], "Seed round funds");

        let replies = talk(&store, &[
            tool(2, "update_note", json!({ "id": id, "text": "Seed round funds\nAlpha Ventures\nBeta Capital\nGamma Seed" })),
            tool(3, "list_notes", json!({})),
            tool(4, "add_note", json!({ "text": "  " })),
            tool(5, "update_note", json!({ "id": id + 99, "text": "x" })),
            tool(6, "delete_note", json!({ "id": id })),
        ]);
        let listed = said(&replies[1]);
        assert_eq!(listed["notes"].as_array().unwrap().len(), 1);
        assert_eq!(listed["notes"][0]["text"], "Seed round funds\nAlpha Ventures\nBeta Capital\nGamma Seed");
        // A blank note and an unknown id are refused in words an agent can act on.
        assert_eq!(replies[2]["result"]["isError"], true);
        assert_eq!(replies[3]["result"]["isError"], true);
        assert_eq!(said(&replies[4])["deleted"], "Seed round funds");
        assert!(store.notes().unwrap().is_empty());
    }

    #[test]
    fn an_agent_can_file_notes_in_folders_list_one_and_take_a_note_out() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            tool(1, "add_note", json!({ "text": "Seed round funds", "folder": "Fund raising" })),
            // Another case of the same name is the same folder, not a second one.
            tool(2, "add_note", json!({ "text": "Angel list", "folder": "fund raising " })),
            tool(3, "add_note", json!({ "text": "Groceries" })),
        ]);
        assert_eq!(said(&replies[0])["folder"], "Fund raising");
        assert_eq!(said(&replies[1])["folder"], "Fund raising");
        let first = said(&replies[0])["id"].as_i64().unwrap();
        let replies = talk(&store, &[
            tool(4, "list_notes", json!({ "folder": " FUND  RAISING " })),
            tool(5, "update_note", json!({ "id": first, "folder": null })),
            tool(6, "list_notes", json!({ "folder": "Fund raising" })),
        ]);
        let titles = |v: &Value| v["notes"].as_array().unwrap().iter().map(|n| n["title"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(titles(&said(&replies[0])), vec!["Angel list", "Seed round funds"]);
        assert_eq!(said(&replies[1])["folder"], Value::Null);
        // Taking it out of the folder kept its text.
        assert_eq!(said(&replies[1])["text"], "Seed round funds");
        assert_eq!(titles(&said(&replies[2])), vec!["Angel list"]);
    }

    #[test]
    fn a_note_lists_the_tasks_it_mentions_and_whether_they_are_done() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[tool(1, "add_task", json!({ "title": "Call the bank" })), tool(2, "add_task", json!({ "title": "Ship sync" }))]);
        let (bank, sync) = (said(&replies[0])["id"].as_i64().unwrap(), said(&replies[1])["id"].as_i64().unwrap());
        let text = format!("# Next week\n- [Call the bank](done:task/{bank})\n- [Ship sync](done:task/{sync}) and again [it](done:task/{sync})\n`[x](done:task/{bank})`\n- [Gone](done:task/42)");
        let replies = talk(&store, &[tool(3, "add_note", json!({ "text": text })), tool(4, "complete_task", json!({ "id": sync })), tool(5, "list_notes", json!({}))]);
        assert_eq!(said(&replies[0])["tasks"][0]["title"], "Call the bank");
        let tasks = &said(&replies[2])["notes"][0]["tasks"];
        assert_eq!(tasks.as_array().unwrap().len(), 3);
        assert_eq!((tasks[0]["id"].as_i64(), tasks[0]["done"].as_bool()), (Some(bank), Some(false)));
        assert_eq!((tasks[1]["id"].as_i64(), tasks[1]["done"].as_bool()), (Some(sync), Some(true)));
        assert_eq!(tasks[2]["found"], false);
    }

    #[test]
    fn an_agent_can_search_notes_and_is_told_what_was_left_out() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.save_note(SaveNote { id: None, text: "Seed round funds\nAlpha Ventures".into(), updated_at: 1, project_id: None, folder: None, space_id: None }).unwrap();
        for i in 0..25 {
            store.save_note(SaveNote { id: None, text: format!("Groceries {i}"), updated_at: 10 + i, project_id: None, folder: None, space_id: None }).unwrap();
        }
        let replies = talk(&store, &[tool(1, "list_notes", json!({ "search": "ALPHA seed" })), tool(2, "list_notes", json!({}))]);
        let found = said(&replies[0]);
        assert_eq!(found["notes"].as_array().unwrap().len(), 1);
        assert_eq!(found["notes"][0]["title"], "Seed round funds");
        assert!(found.get("notListed").is_none());
        let all = said(&replies[1]);
        assert_eq!(all["notes"].as_array().unwrap().len(), 20);
        assert_eq!(all["notes"][0]["title"], "Groceries 24");
        assert_eq!(all["notListed"], 6);
    }

    #[test]
    fn a_task_finished_by_mistake_can_be_listed_and_put_back() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[tool(1, "add_task", json!({ "title": "Email Rory", "subtasks": [{ "title": "Draft" }] }))]);
        let id = said(&replies[0])["id"].as_i64().unwrap();
        let replies = talk(&store, &[
            tool(2, "complete_task", json!({ "id": id })),
            tool(3, "list_tasks", json!({ "filter": "finished_today" })),
            tool(4, "reopen_task", json!({ "id": id })),
            tool(5, "reopen_task", json!({ "id": id })),
            tool(6, "list_tasks", json!({})),
        ]);
        let finished = said(&replies[1]);
        assert_eq!(finished["tasks"][0]["title"], "Email Rory");
        assert_eq!(said(&replies[2])["reopened"], "Email Rory");
        // Reopening an open task is refused in words an agent can act on.
        assert_eq!(replies[3]["result"]["isError"], true);
        let open = said(&replies[4]);
        assert_eq!(open["tasks"][0]["title"], "Email Rory");
        assert_eq!(open["tasks"][0]["subtasks"][0]["done"], false);
    }

    #[test]
    fn an_agent_can_read_a_days_time_sheet() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let day = store.today().unwrap();
        let start = 1_795_000_000_000;
        store.record(done_core::NewEntry {
            task_id: None, title: "Deck".into(), day: day.clone(),
            started_at: start, ended_at: start + 30 * 60_000, planned_ms: 25 * 60_000, focused_ms: 28 * 60_000,
        }).unwrap();
        let replies = talk(&store, &[tool(1, "time_sheet", json!({}))]);
        let sheet = said(&replies[0]);
        assert_eq!(sheet["day"], day);
        assert_eq!(sheet["blocks"][0]["title"], "Deck");
        assert_eq!(sheet["blocks"][0]["plannedMinutes"], 25);
        assert_eq!(sheet["focusedMinutes"], 28);
        assert_eq!(sheet["blocks"][0]["from"].as_str().unwrap().len(), 5);
    }

    #[test]
    fn a_note_can_belong_to_a_project_and_be_moved_out_of_it() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let replies = talk(&store, &[
            tool(1, "add_project", json!({ "name": "Hop" })),
            tool(2, "add_note", json!({ "text": "# Seed funds", "project": "hop" })),
        ]);
        let added = said(&replies[1]);
        assert_eq!(added["project"], "Hop");
        let id = added["id"].as_i64().unwrap();
        let replies = talk(&store, &[
            tool(3, "update_note", json!({ "id": id, "text": "# Seed funds\nAlpha" })),
            tool(4, "update_note", json!({ "id": id, "project": null })),
            tool(5, "add_note", json!({ "text": "x", "project": "Nope" })),
        ]);
        // Changing the text keeps the project; null takes it out.
        assert_eq!(said(&replies[0])["project"], "Hop");
        assert_eq!(said(&replies[1])["project"], Value::Null);
        assert_eq!(said(&replies[1])["text"], "# Seed funds\nAlpha");
        assert_eq!(replies[2]["result"]["isError"], true);
    }

    // A device in a workspace, as the server leaves it after a sync: a Hop
    // project with a task, and the team (Julius and Geart) it said.
    fn in_hop() -> Store {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let reply: done_core::Reply = serde_json::from_value(json!({
            "upto": 0,
            "rows": {
                "projects": [{ "id": 5000000000001i64, "name": "Launch", "color": 3, "spaceId": 77, "changed": 1 }],
                "tasks": [{ "id": 5000000000002i64, "title": "Open the bank account", "projectId": 5000000000001i64, "spaceId": 77, "changed": 1 }]
            },
            "spaces": [{ "space": 77, "at": 2 }, { "space": 11, "at": 0 }],
            "team": { "me": "1001", "personal": 11, "spaces": [
                { "id": 11, "kind": "personal", "name": "", "role": "owner", "members": [] },
                { "id": 77, "kind": "workspace", "name": "Hop", "role": "owner", "members": [
                    { "id": "1001", "name": "Julius Olsson", "email": "julius@hop.dev" },
                    { "id": "1002", "name": "Geart", "email": "geart@hop.dev" } ] } ] }
        }))
        .unwrap();
        store.inbox(&reply, 0).unwrap();
        store
    }

    #[test]
    fn an_agent_sees_the_workspace_and_assigns_by_name() {
        let store = in_hop();
        let replies = talk(&store, &[
            tool(1, "update_task", json!({ "id": 5000000000002i64, "assignees": ["geart", "Julius"] })),
            tool(2, "list_tasks", json!({ "filter": "assigned_to_me" })),
            tool(3, "update_task", json!({ "id": 5000000000002i64, "assignees": ["Ana"] })),
            tool(4, "list_projects", json!({})),
        ]);
        let said = |i: usize| -> Value { serde_json::from_str(replies[i]["result"]["content"][0]["text"].as_str().unwrap()).unwrap() };
        assert_eq!(said(0)["workspace"], "Hop");
        assert_eq!(said(0)["assignees"], json!(["Geart", "Julius Olsson"]));
        assert_eq!(said(1)["tasks"][0]["title"], "Open the bank account");
        assert!(replies[2]["result"]["content"][0]["text"].as_str().unwrap().contains("Nobody called \"ana\" is in Hop"));
        assert_eq!(said(3)["projects"][0]["members"], json!(["Julius Olsson", "Geart"]));
        let mut on = store.state(&store.today().unwrap()).unwrap().tasks[0].assignees.clone();
        on.sort();
        assert_eq!(on, vec!["1001", "1002"]);
    }
}
