//! done's MCP server: lets an AI agent read and change tasks.
//!
//! It speaks MCP over standard input and output, one JSON message per line,
//! and is started as `done mcp` by whichever agent connects to it. It works on
//! the same tasks file as the app, through the same rules, so anything an
//! agent does shows up in the window and the other way round.
//!
//! The protocol is small enough here (five methods) that it is written out
//! rather than pulled in as a framework.

use done_core::{Change, Error, Project, State, Store, Task};
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
                "instructions": "done is the user's personal to-do list. Dates are calendar days written YYYY-MM-DD; list_tasks tells you today's date. Priority 1 is the most urgent and 4 means none. A task with no project is in the Inbox.",
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
        "priority": { "type": "integer", "minimum": 1, "maximum": 4, "description": "1 is the most urgent, 4 means none." },
        "project": { "type": ["string", "null"], "description": "The name of an existing project, or null for the Inbox." },
    });
    let mut fields = fields;
    fields["goal"] = json!({ "type": "boolean", "description": "true makes this today's goal: the one thing that has to happen today. Only one task can be it." });
    let mut update = fields.clone();
    update["id"] = json!({ "type": "integer" });
    update["status"] = json!({ "type": "string", "enum": ["todo", "doing"], "description": "doing means in progress." });
    let id_only = json!({ "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] });
    json!([
        { "name": "list_tasks", "description": "List open tasks, with today's date. Finished tasks are not listed.",
          "inputSchema": { "type": "object", "properties": {
              "filter": { "type": "string", "enum": ["all", "today", "upcoming", "inbox"], "description": "today includes overdue tasks. Defaults to all." },
              "project": { "type": "string", "description": "Only tasks in this project." } } } },
        { "name": "add_task", "description": "Add a task.",
          "inputSchema": { "type": "object", "properties": fields, "required": ["title"] } },
        { "name": "update_task", "description": "Change a task. Only the fields given are changed.",
          "inputSchema": { "type": "object", "properties": update, "required": ["id"] } },
        { "name": "complete_task", "description": "Mark a task as finished.", "inputSchema": id_only },
        { "name": "delete_task", "description": "Delete a task for good. Prefer complete_task for work that was done.", "inputSchema": id_only },
        { "name": "list_projects", "description": "List the projects.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "add_project", "description": "Create a project.",
          "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } },
    ])
}

fn describe(task: &Task, projects: &[Project]) -> Value {
    let project = task.project_id.and_then(|id| projects.iter().find(|p| p.id == id)).map(|p| p.name.clone());
    json!({
        "id": task.id, "title": task.title, "notes": task.notes, "project": project,
        "start": task.start, "due": task.due, "priority": task.priority,
        "status": task.status.as_deref().unwrap_or("todo"),
        "goalDay": task.goal_day,
    })
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

fn call(store: &Store, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "list_tasks" => {
            let today = store.today().map_err(|e| e.to_string())?;
            let state = store.state(&today).map_err(|e| e.to_string())?;
            let goal = state.tasks.iter().find(|t| t.goal_day.as_deref() == Some(today.as_str())).map(|t| t.title.clone());
            let project = match args.get("project").and_then(Value::as_str) {
                Some(name) => Some(project_named(&state, name)?),
                None => None,
            };
            let filter = args.get("filter").and_then(Value::as_str).unwrap_or("all");
            let tasks: Vec<Value> = state.tasks.iter()
                .filter(|t| !t.done)
                .filter(|t| project.is_none() || t.project_id == project)
                .filter(|t| match filter {
                    // Days written YYYY-MM-DD compare correctly as text.
                    "today" => t.due.as_deref().is_some_and(|d| d <= today.as_str()),
                    "upcoming" => t.due.as_deref().is_some_and(|d| d > today.as_str()),
                    "inbox" => t.project_id.is_none(),
                    _ => true,
                })
                .map(|t| describe(t, &state.projects))
                .collect();
            Ok(json!({ "today": today, "todaysGoal": goal, "tasks": tasks }))
        }
        "list_projects" => {
            let today = store.today().map_err(|e| e.to_string())?;
            let state = store.state(&today).map_err(|e| e.to_string())?;
            let projects: Vec<Value> = state.projects.iter().map(|p| {
                let open = state.tasks.iter().filter(|t| !t.done && t.project_id == Some(p.id)).count();
                json!({ "name": p.name, "openTasks": open })
            }).collect();
            Ok(json!({ "projects": projects }))
        }
        "add_task" => change(store, |state, today| {
            let mut task = Task {
                id: state.next_id, title: String::new(), notes: String::new(), project_id: None,
                start: None, due: None, priority: 4, status: None, done: false, done_day: None, goal_day: None,
            };
            apply(&mut task, args, state, today)?;
            let said = describe(&task, &state.projects);
            Ok((Change { tasks: vec![task], ..Default::default() }, said))
        }),
        "update_task" => change(store, |state, today| {
            let mut task = open_task(state, args)?;
            apply(&mut task, args, state, today)?;
            let said = describe(&task, &state.projects);
            Ok((Change { tasks: vec![task], ..Default::default() }, said))
        }),
        "complete_task" => change(store, |state, today| {
            let mut task = open_task(state, args)?;
            task.done = true;
            task.done_day = Some(today.to_string());
            let said = json!({ "completed": task.title });
            Ok((Change { tasks: vec![task], ..Default::default() }, said))
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
            let project = Project { id: state.next_id, name: name.clone(), color };
            Ok((Change { projects: vec![project], ..Default::default() }, json!({ "created": name })))
        }),
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
}
