//! Notes written together, live: `done-server collab`.
//!
//! A workspace note open in two windows is one document, a Yjs CRDT (the Rust
//! port, `yrs`), whose one text holds the note's Markdown. Each window keeps a
//! copy and they swap changes through a room here, with the y-websocket
//! protocol (sync steps, updates, and awareness for cursors and who is here).
//! All the editors of a note must meet in the same process, so this runs as
//! its own service with exactly one instance; the main server hands out short
//! tickets to it and nothing else.
//!
//! The room is the only writer of a live note's text. Every few seconds while
//! it is being written, and when the last person leaves, it saves the text and
//! the document into the note row (pg.rs `save_live`), with a new seq, so the
//! apps, search, the read view and agents keep using the text as before.
//!
//! A note can still be written another way: a device that synced an edit, an
//! agent through MCP, an app from before live notes. Such a write replaces the
//! text whole. The room takes it in as an edit: the difference between the
//! text of the document it last saved and the new text, made on a copy of that
//! saved document and merged into the live one, so what people typed since
//! that save stays (Postgres tells the room at once with NOTIFY; a save finds
//! it too, since a save only goes ahead when the stored text is still its own).

use crate::pg::{Db, Saved};
use axum::{
    extract::{
        ws::{Message as Frame, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use axum_extra::extract::cookie::Key;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, Mutex};
use yrs::encoding::read::Cursor;
use yrs::sync::{Awareness, Message, MessageReader, SyncMessage};
use yrs::updates::decoder::{Decode, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, OffsetKind, Options, ReadTxn, StateVector, Text, Transact, Update};

/// The name of the one text in a note's document. The window uses the same.
pub const TEXT: &str = "text";

/// How often a room being written saves.
const SAVE_EVERY: Duration = Duration::from_secs(2);
/// How often the people in a room are checked against the workspace's members.
const CHECK_EVERY: u32 = 15;
/// The longest message a window may send: a note is text, and this is a lot of it.
const BIGGEST: usize = 8 * 1024 * 1024;

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// What the main server signs for a window: who it is, and the one note it
/// may join (or, for presence, the one workspace it may look at). Good for
/// two minutes; a window that reconnects asks for a fresh one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Ticket {
    pub account: String,
    pub name: String,
    #[serde(default)]
    pub picture: String,
    pub space: i64,
    #[serde(default)]
    pub note: Option<i64>,
    pub exp: u64,
}

pub const TICKET_LIFE: u64 = 120;

pub fn issue(key: &Key, ticket: &Ticket) -> String {
    crate::auth::seal(key, serde_json::to_string(ticket).expect("plain fields"))
}

/// The ticket, if this server's key signed it and it has not run out.
pub fn check(key: &Key, sealed: &str) -> Option<Ticket> {
    let ticket: Ticket = serde_json::from_str(&crate::auth::unseal(key, sealed)?).ok()?;
    (ticket.exp > now()).then_some(ticket)
}

/// A document that counts text positions as JavaScript does (UTF-16), so a
/// position means the same here as in every window.
pub fn new_doc() -> Doc {
    Doc::with_options(Options { offset_kind: OffsetKind::Utf16, ..Options::default() })
}

pub fn doc_from(saved: Option<&[u8]>) -> Result<Doc, String> {
    let doc = new_doc();
    if let Some(bytes) = saved {
        let update = Update::decode_v1(bytes).map_err(|e| e.to_string())?;
        doc.transact_mut().apply_update(update).map_err(|e| e.to_string())?;
    }
    Ok(doc)
}

pub fn text_of(doc: &Doc) -> String {
    let text = doc.get_or_insert_text(TEXT);
    let txn = doc.transact();
    text.get_string(&txn)
}

pub fn encode(doc: &Doc) -> Vec<u8> {
    doc.transact().encode_state_as_update_v1(&StateVector::default())
}

/// Turns `doc`'s text into `wanted` with the fewest edits: only the parts that
/// differ are touched, so text typed elsewhere around them is left alone when
/// these edits are merged with it.
pub fn edit_to(doc: &Doc, wanted: &str) {
    let text = doc.get_or_insert_text(TEXT);
    let mut txn = doc.transact_mut();
    let was = text.get_string(&txn);
    if was == wanted {
        return;
    }
    // Compared word by word, not letter by letter: a word changed is replaced
    // whole, so text typed elsewhere next to it is never split into it (a
    // letter diff of "tomorrow" to "on Monday" keeps an "o" here and there,
    // and typing at its end lands in the middle of the new word).
    let old = words(&was);
    let new = words(wanted);
    // Where each old word starts, counted in UTF-16 units.
    let mut at = Vec::with_capacity(old.len() + 1);
    let mut units = 0u32;
    for w in &old {
        at.push(units);
        units += w.encode_utf16().count() as u32;
    }
    at.push(units);
    let ops = similar::capture_diff_slices(similar::Algorithm::Myers, &old, &new);
    // From the end back, so the positions of what is still to do stay true.
    for op in ops.iter().rev() {
        let (tag, old_range, new_range) = op.as_tag_tuple();
        if tag == similar::DiffTag::Equal {
            continue;
        }
        let from = at[old_range.start];
        let len = at[old_range.end] - from;
        if len > 0 {
            text.remove_range(&mut txn, from, len);
        }
        if !new_range.is_empty() {
            let insert: String = new[new_range].concat();
            text.insert(&mut txn, from, &insert);
        }
    }
}

/// Text cut into words, runs of spaces, and single other characters
/// (punctuation, line breaks, emoji), which together are the text again.
fn words(text: &str) -> Vec<&str> {
    #[derive(PartialEq)]
    enum Kind {
        Word,
        Space,
        Other,
    }
    let kind = |c: char| if c.is_alphanumeric() { Kind::Word } else if c == ' ' || c == '\t' { Kind::Space } else { Kind::Other };
    let mut out = Vec::new();
    let mut start = 0;
    let mut last: Option<Kind> = None;
    for (i, c) in text.char_indices() {
        let k = kind(c);
        let joins = matches!((&last, &k), (Some(Kind::Word), Kind::Word) | (Some(Kind::Space), Kind::Space));
        if !joins && i > start {
            out.push(&text[start..i]);
            start = i;
        }
        last = Some(k);
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

/// A write made outside the room, as an update for the live document: the
/// edits from the text of the document the room last saved to `text`, made on
/// a copy of that document.
pub fn outside_write(saved: Option<&[u8]>, text: &str) -> Result<Vec<u8>, String> {
    let fork = doc_from(saved)?;
    let before = fork.transact().state_vector();
    edit_to(&fork, text);
    let update = fork.transact().encode_state_as_update_v1(&before);
    Ok(update)
}

fn frame(message: Message) -> Vec<u8> {
    message.encode_v1()
}

enum Out {
    Data(Vec<u8>),
    Close,
}

struct Peer {
    tx: mpsc::UnboundedSender<Out>,
    who: Ticket,
    /// The Yjs client ids this window's awareness spoke for, taken out of
    /// everyone's view when it goes.
    clients: HashSet<u64>,
}

struct Inner {
    awareness: Awareness,
    peers: HashMap<u64, Peer>,
    /// The text as the room last saved it (or found it): a save goes ahead
    /// only if the stored text is still this.
    saved: String,
    dirty: bool,
    closed: bool,
}

struct Room {
    note: i64,
    space: i64,
    inner: Mutex<Inner>,
}

impl Inner {
    fn send(&self, to: u64, data: Vec<u8>) {
        if let Some(peer) = self.peers.get(&to) {
            let _ = peer.tx.send(Out::Data(data));
        }
    }

    fn others(&self, from: u64, data: &[u8]) {
        for (id, peer) in &self.peers {
            if *id != from {
                let _ = peer.tx.send(Out::Data(data.to_vec()));
            }
        }
    }

    fn doc(&self) -> &Doc {
        self.awareness.doc()
    }
}

pub struct Collab {
    db: Arc<Db>,
    key: Key,
    /// Where windows may connect from: the web app, and the Mac and iPhone apps.
    origins: Vec<String>,
    rooms: Mutex<HashMap<i64, Arc<Room>>>,
    next: AtomicU64,
}

impl Collab {
    /// `also`: more addresses the web app is reached at (DONE_COLLAB_ORIGINS).
    pub fn new(db: Arc<Db>, key: Key, public_url: &str, also: &[String]) -> Arc<Self> {
        let mut origins = vec!["tauri://localhost".to_string(), "http://tauri.localhost".into(), "https://tauri.localhost".into()];
        origins.push(public_url.trim_end_matches('/').to_string());
        origins.extend(also.iter().map(|o| o.trim().trim_end_matches('/').to_string()).filter(|o| !o.is_empty()));
        Arc::new(Self { db, key, origins, rooms: Mutex::new(HashMap::new()), next: AtomicU64::new(1) })
    }

    /// The room for a note, opened from the database if nobody is in it.
    async fn room(&self, note: i64, space: i64) -> Result<Arc<Room>, StatusCode> {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get(&note) {
            if room.space == space && !room.inner.lock().await.closed {
                return Ok(room.clone());
            }
            rooms.remove(&note);
        }
        let stored = self.db.live_note(note).await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?.ok_or(StatusCode::NOT_FOUND)?;
        if stored.space != space || !stored.workspace {
            return Err(StatusCode::NOT_FOUND);
        }
        let doc = doc_from(stored.ydoc.as_deref()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        // Written another way while nobody had it open (or never live yet):
        // the document is brought to the stored text, and saved, so from now
        // on there is a saved document to take later writes in against.
        let first = stored.ydoc.is_none() || text_of(&doc) != stored.text;
        edit_to(&doc, &stored.text);
        let inner = Inner { awareness: Awareness::new(doc), peers: HashMap::new(), saved: stored.text, dirty: first, closed: false };
        let room = Arc::new(Room { note, space, inner: Mutex::new(inner) });
        if first {
            let mut held = room.inner.lock().await;
            if let Err(e) = self.save(&room, &mut held).await {
                eprintln!("note {note}: first save failed: {e}");
            }
        }
        rooms.insert(note, room.clone());
        Ok(room)
    }

    /// Saves the room's text and document if it has changed, taking in first
    /// anything written to the note another way since its last save.
    async fn save(&self, room: &Room, inner: &mut Inner) -> Result<(), String> {
        for _ in 0..3 {
            let (text, doc) = (text_of(inner.doc()), encode(inner.doc()));
            match self.db.save_live(room.note, room.space, &text, &doc, &inner.saved).await.map_err(|e| format!("{e:?}"))? {
                Saved::Saved => {
                    inner.saved = text;
                    inner.dirty = false;
                    return Ok(());
                }
                Saved::Changed { text: theirs, ydoc } => {
                    let update = outside_write(ydoc.as_deref(), &theirs)?;
                    let decoded = Update::decode_v1(&update).map_err(|e| e.to_string())?;
                    inner.doc().transact_mut().apply_update(decoded).map_err(|e| e.to_string())?;
                    inner.others(0, &frame(Message::Sync(SyncMessage::Update(update))));
                    inner.saved = theirs;
                    inner.dirty = true;
                }
                Saved::Gone => {
                    inner.closed = true;
                    for peer in inner.peers.values() {
                        let _ = peer.tx.send(Out::Close);
                    }
                    return Ok(());
                }
            }
        }
        Err("the note kept changing under the save".into())
    }

    /// Takes in a window's message; answers it, and passes changes on to the others.
    fn handle(inner: &mut Inner, from: u64, data: &[u8]) -> Result<(), String> {
        let mut decoder = DecoderV1::new(Cursor::new(data));
        let messages: Vec<Message> = MessageReader::new(&mut decoder).collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        for message in messages {
            match message {
                Message::Sync(SyncMessage::SyncStep1(sv)) => {
                    let update = inner.doc().transact().encode_state_as_update_v1(&sv);
                    inner.send(from, frame(Message::Sync(SyncMessage::SyncStep2(update))));
                }
                Message::Sync(SyncMessage::SyncStep2(update)) | Message::Sync(SyncMessage::Update(update)) => {
                    let decoded = Update::decode_v1(&update).map_err(|e| e.to_string())?;
                    inner.doc().transact_mut().apply_update(decoded).map_err(|e| e.to_string())?;
                    inner.dirty = true;
                    inner.others(from, &frame(Message::Sync(SyncMessage::Update(update))));
                }
                Message::Awareness(update) => {
                    if let Some(peer) = inner.peers.get_mut(&from) {
                        peer.clients.extend(update.clients.keys().map(|c| c.get()));
                    }
                    inner.awareness.apply_update(update.clone()).map_err(|e| e.to_string())?;
                    inner.others(from, &frame(Message::Awareness(update)));
                }
                Message::AwarenessQuery => {
                    let update = inner.awareness.update().map_err(|e| e.to_string())?;
                    inner.send(from, frame(Message::Awareness(update)));
                }
                Message::Auth(_) | Message::Custom(..) => {}
            }
        }
        Ok(())
    }

    async fn join(self: &Arc<Self>, socket: WebSocket, who: Ticket, note: i64) {
        let room = match self.room(note, who.space).await {
            Ok(room) => room,
            Err(_) => return,
        };
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
        let (mut sink, mut stream) = socket.split();
        {
            let mut inner = room.inner.lock().await;
            if inner.closed {
                return;
            }
            inner.peers.insert(id, Peer { tx: tx.clone(), who, clients: HashSet::new() });
            // What the room has, and who is here: the window answers with what it has.
            let sv = inner.doc().transact().state_vector();
            inner.send(id, frame(Message::Sync(SyncMessage::SyncStep1(sv))));
            if let Ok(update) = inner.awareness.update() {
                inner.send(id, frame(Message::Awareness(update)));
            }
        }
        let writer = tokio::spawn(async move {
            let mut ping = tokio::time::interval(Duration::from_secs(25));
            loop {
                tokio::select! {
                    out = rx.recv() => match out {
                        Some(Out::Data(data)) => if sink.send(Frame::Binary(data.into())).await.is_err() { break },
                        Some(Out::Close) | None => { let _ = sink.send(Frame::Close(None)).await; break }
                    },
                    // Kept alive through proxies, and a dead connection found.
                    _ = ping.tick() => if sink.send(Frame::Ping(Vec::new().into())).await.is_err() { break },
                }
            }
        });
        while let Some(Ok(frame_in)) = stream.next().await {
            let data = match frame_in {
                Frame::Binary(data) => data,
                Frame::Close(_) => break,
                _ => continue,
            };
            let mut inner = room.inner.lock().await;
            if inner.closed {
                break;
            }
            if let Err(e) = Self::handle(&mut inner, id, &data) {
                eprintln!("note {note}: a message was refused: {e}");
                break;
            }
        }
        writer.abort();
        self.leave(&room, id).await;
    }

    async fn leave(&self, room: &Arc<Room>, id: u64) {
        let mut rooms = self.rooms.lock().await;
        let mut inner = room.inner.lock().await;
        if let Some(peer) = inner.peers.remove(&id) {
            // Their cursors go from everyone's screen.
            let gone: Vec<u64> = peer.clients.into_iter().collect();
            for client in &gone {
                inner.awareness.remove_state(yrs::block::ClientID::new(*client));
            }
            if let Ok(update) = inner.awareness.update_with_clients(gone.iter().map(|c| yrs::block::ClientID::new(*c))) {
                inner.others(id, &frame(Message::Awareness(update)));
            }
        }
        if inner.peers.is_empty() && !inner.closed {
            // The last to leave: saved now, and the room closed.
            if inner.dirty {
                if let Err(e) = self.save(room, &mut inner).await {
                    eprintln!("note {}: last save failed: {e}", room.note);
                    // Kept open, so the next save round tries again.
                    return;
                }
            }
            inner.closed = true;
            if rooms.get(&room.note).is_some_and(|r| Arc::ptr_eq(r, room)) {
                rooms.remove(&room.note);
            }
        }
    }

    /// Every few seconds: rooms being written are saved; now and then, the
    /// people in a room are checked to still be in its workspace.
    pub async fn keep(self: Arc<Self>) {
        let mut tick = tokio::time::interval(SAVE_EVERY);
        let mut round = 0u32;
        loop {
            tick.tick().await;
            round = round.wrapping_add(1);
            let rooms: Vec<Arc<Room>> = self.rooms.lock().await.values().cloned().collect();
            let mut empty = Vec::new();
            for room in rooms {
                let mut inner = room.inner.lock().await;
                if inner.closed {
                    continue;
                }
                if inner.dirty {
                    if let Err(e) = self.save(&room, &mut inner).await {
                        eprintln!("note {}: save failed, will try again: {e}", room.note);
                    }
                }
                // Opened for someone whose connection then never came.
                if inner.peers.is_empty() && !inner.dirty {
                    inner.closed = true;
                    empty.push(room.clone());
                }
                if round % CHECK_EVERY == 0 {
                    let people: Vec<(u64, String)> = inner.peers.iter().map(|(id, p)| (*id, p.who.account.clone())).collect();
                    for (id, account) in people {
                        if let Ok(false) = self.db.in_workspace(&account, room.space).await {
                            if let Some(peer) = inner.peers.get(&id) {
                                let _ = peer.tx.send(Out::Close);
                            }
                        }
                    }
                }
            }
            if !empty.is_empty() {
                let mut map = self.rooms.lock().await;
                for room in empty {
                    if map.get(&room.note).is_some_and(|r| Arc::ptr_eq(r, &room)) {
                        map.remove(&room.note);
                    }
                }
            }
        }
    }

    /// A write to a live note made another way: taken in at once.
    async fn written(&self, note: i64) {
        let room = self.rooms.lock().await.get(&note).cloned();
        if let Some(room) = room {
            let mut inner = room.inner.lock().await;
            if !inner.closed {
                if let Err(e) = self.save(&room, &mut inner).await {
                    eprintln!("note {note}: taking in a write failed: {e}");
                }
            }
        }
    }

    /// Listens for writes to live notes (pg.rs sends NOTIFY done_note), and
    /// connects again if the connection drops.
    pub async fn listen(self: Arc<Self>, config: String) {
        loop {
            if let Err(e) = self.listen_once(&config).await {
                eprintln!("listening for note writes stopped: {e}; again in 5 s");
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }

    async fn listen_once(&self, config: &str) -> Result<(), String> {
        let (client, mut connection) = tokio_postgres::connect(config, tokio_postgres::NoTls).await.map_err(|e| e.to_string())?;
        let (tx, mut rx) = mpsc::unbounded_channel::<i64>();
        let driver = tokio::spawn(async move {
            let mut messages = futures_util::stream::poll_fn(move |cx| connection.poll_message(cx));
            while let Some(message) = messages.next().await {
                match message {
                    Ok(tokio_postgres::AsyncMessage::Notification(n)) => {
                        if let Ok(id) = n.payload().parse() {
                            let _ = tx.send(id);
                        }
                    }
                    Ok(_) => {}
                    Err(e) => return Err(e.to_string()),
                }
            }
            Err("the connection closed".to_string())
        });
        client.batch_execute("LISTEN done_note").await.map_err(|e| e.to_string())?;
        while let Some(note) = rx.recv().await {
            self.written(note).await;
        }
        driver.await.map_err(|e| e.to_string())?
    }

    fn allowed(&self, headers: &HeaderMap) -> bool {
        // A browser always says where it is; a client that is not a browser
        // (a test) says nothing, and the ticket is the guard either way.
        match headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()) {
            Some(origin) => self.origins.iter().any(|o| o == origin),
            None => true,
        }
    }

    /// Who is in which note of a workspace now, for the faces on the notes list.
    async fn presence(&self, space: i64) -> HashMap<String, Vec<Value>> {
        let rooms: Vec<Arc<Room>> = self.rooms.lock().await.values().filter(|r| r.space == space).cloned().collect();
        let mut out = HashMap::new();
        for room in rooms {
            let inner = room.inner.lock().await;
            // One face per person, active if any of their windows is (each
            // window says so in its awareness, see ui/src/lib/presence.ts).
            let mut people: Vec<Value> = Vec::new();
            for peer in inner.peers.values() {
                let mut idle = true;
                let mut since = 0i64;
                for client in &peer.clients {
                    if let Some(state) = inner.awareness.state::<Value>(yrs::block::ClientID::new(*client)) {
                        let activity = &state["activity"];
                        idle &= activity["idle"].as_bool().unwrap_or(false);
                        since = since.max(activity["since"].as_i64().unwrap_or(0));
                    }
                }
                if peer.clients.is_empty() {
                    idle = false;
                }
                match people.iter_mut().find(|p| p["id"] == peer.who.account.as_str()) {
                    Some(p) => {
                        if !idle {
                            p["activity"] = serde_json::json!({ "idle": false, "since": since });
                        }
                    }
                    None => people.push(serde_json::json!({
                        "id": peer.who.account, "name": peer.who.name, "picture": peer.who.picture,
                        "activity": { "idle": idle, "since": since },
                    })),
                }
            }
            if !people.is_empty() {
                out.insert(room.note.to_string(), people);
            }
        }
        out
    }
}

use serde_json::Value;

#[derive(Deserialize)]
pub struct WithTicket {
    #[serde(default)]
    ticket: String,
}

async fn open_note(
    State(collab): State<Arc<Collab>>,
    Path(note): Path<i64>,
    Query(q): Query<WithTicket>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !collab.allowed(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(who) = check(&collab.key, &q.ticket).filter(|t| t.note == Some(note)) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    // Refused before the upgrade when the note is not where the ticket says.
    if let Err(status) = collab.room(note, who.space).await {
        return status.into_response();
    }
    upgrade.max_message_size(BIGGEST).on_upgrade(move |socket| async move { collab.join(socket, who, note).await })
}

async fn presence(State(collab): State<Arc<Collab>>, Query(q): Query<WithTicket>, headers: HeaderMap) -> Response {
    if !collab.allowed(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(who) = check(&collab.key, &q.ticket).filter(|t| t.note.is_none()) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    Json(serde_json::json!({ "notes": collab.presence(who.space).await })).into_response()
}

pub fn router(collab: Arc<Collab>) -> Router {
    let origins: Vec<HeaderValue> = collab.origins.iter().filter_map(|o| o.parse().ok()).collect();
    Router::new()
        .route("/notes/{note}", get(open_note))
        .route("/presence", get(presence))
        .route("/healthz", get(|| async { "ok" }))
        .layer(tower_http::cors::CorsLayer::new().allow_origin(origins).allow_methods([Method::GET]))
        .with_state(collab)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pg::{testing, Me};
    use done_core::SaveNote;
    use tokio_tungstenite::tungstenite::Message as Ws;
    use yrs::updates::encoder::Encode;

    const KEY: [u8; 64] = [7; 64];

    struct Place {
        at: String,
        db: Arc<Db>,
        julius: Me,
        geart: Me,
        space: i64,
        note: i64,
    }

    /// A collab service on a fresh database, with Hop (Julius and Geart in
    /// it) and one Hop note that says `text`.
    async fn place(text: &str) -> Place {
        let config = testing::database().await;
        let db = Arc::new(Db::connect(&config).await.unwrap());
        let julius = db.me("1001", "julius@hop.dev", "Julius", "").await.unwrap();
        let geart = db.me("1002", "geart@hop.dev", "Geart", "").await.unwrap();
        let space = db.create_workspace(&julius, "Hop").await.unwrap();
        let made = db.invite(&julius, space, "geart@hop.dev", "").await.unwrap();
        db.accept(&geart, Some(made.invite), None).await.unwrap();
        let note = db
            .save_note(&julius, SaveNote { id: None, text: text.into(), updated_at: 1, project_id: None, folder: None, space_id: Some(space) })
            .await
            .unwrap()
            .id;
        let live = Collab::new(db.clone(), Key::from(&KEY), "http://127.0.0.1:1", &[]);
        tokio::spawn(live.clone().keep());
        tokio::spawn(live.clone().listen(config));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let at = format!("ws://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router(live)).await.unwrap() });
        Place { at, db, julius, geart, space, note }
    }

    fn ticket(who: &Me, space: i64, note: i64, life: i64) -> String {
        let t = Ticket { account: who.id.clone(), name: "Someone".into(), picture: String::new(), space, note: Some(note), exp: (now() as i64 + life) as u64 };
        issue(&Key::from(&KEY), &t)
    }

    /// The address with the ticket in it, written as an address must be.
    fn with_ticket(base: &str, ticket: &str) -> String {
        let mut url = reqwest::Url::parse(base).unwrap();
        url.query_pairs_mut().append_pair("ticket", ticket);
        url.to_string()
    }

    type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    /// A window, as far as the protocol goes: its own copy of the document.
    struct Window {
        doc: Doc,
        ws: Socket,
    }

    impl Window {
        async fn open(p: &Place, who: &Me) -> Window {
            Self::open_with(p, who, new_doc()).await
        }

        async fn open_with(p: &Place, who: &Me, doc: Doc) -> Window {
            let url = with_ticket(&format!("{}/notes/{}", p.at, p.note), &ticket(who, p.space, p.note, 60));
            let (ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
            let mut w = Window { doc, ws };
            // As a window does on opening: what it has, so the room sends what it lacks.
            let sv = w.doc.transact().state_vector();
            w.send(Message::Sync(SyncMessage::SyncStep1(sv))).await;
            w.settle().await;
            w
        }

        async fn send(&mut self, m: Message) {
            self.ws.send(Ws::Binary(m.encode_v1().into())).await.unwrap();
        }

        /// Takes in what the room sends until it has been quiet a moment.
        async fn settle(&mut self) {
            while let Ok(Some(Ok(frame))) = tokio::time::timeout(Duration::from_millis(250), self.ws.next()).await {
                let Ws::Binary(data) = frame else { continue };
                let mut decoder = DecoderV1::new(Cursor::new(&data));
                let messages: Vec<Message> = MessageReader::new(&mut decoder).collect::<Result<_, _>>().unwrap();
                for m in messages {
                    match m {
                        Message::Sync(SyncMessage::SyncStep1(sv)) => {
                            let update = self.doc.transact().encode_state_as_update_v1(&sv);
                            self.send(Message::Sync(SyncMessage::SyncStep2(update))).await;
                        }
                        Message::Sync(SyncMessage::SyncStep2(u)) | Message::Sync(SyncMessage::Update(u)) => {
                            self.doc.transact_mut().apply_update(Update::decode_v1(&u).unwrap()).unwrap();
                        }
                        _ => {}
                    }
                }
            }
        }

        /// Types at a place, offline or not: the change is made here first,
        /// and sent if `send` (as a window does while connected).
        async fn type_at(&mut self, index: u32, words: &str, send: bool) {
            let before = self.doc.transact().state_vector();
            {
                let text = self.doc.get_or_insert_text(TEXT);
                let mut txn = self.doc.transact_mut();
                text.insert(&mut txn, index, words);
            }
            if send {
                let update = self.doc.transact().encode_state_as_update_v1(&before);
                self.send(Message::Sync(SyncMessage::Update(update))).await;
            }
        }

        fn text(&self) -> String {
            text_of(&self.doc)
        }

        fn end(&self) -> u32 {
            self.text().encode_utf16().count() as u32
        }
    }

    async fn stored(p: &Place) -> String {
        p.db.live_note(p.note).await.unwrap().unwrap().text
    }

    async fn until_stored(p: &Place, wanted: impl Fn(&str) -> bool) -> String {
        for _ in 0..40 {
            let text = stored(p).await;
            if wanted(&text) {
                return text;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        stored(p).await
    }

    #[tokio::test]
    async fn two_people_typing_at_once_both_keep_their_words() {
        let p = place("Week plan\n").await;
        let (mut a, mut b) = (Window::open(&p, &p.julius).await, Window::open(&p, &p.geart).await);
        assert_eq!((a.text(), b.text()), ("Week plan\n".to_string(), "Week plan\n".to_string()));
        // Both type before either hears of the other's.
        let end = a.end();
        a.type_at(end, "Julius: ship the filter\n", true).await;
        b.type_at(end, "Geart: circles all day\n", true).await;
        a.settle().await;
        b.settle().await;
        assert_eq!(a.text(), b.text());
        assert!(a.text().contains("Julius: ship the filter") && a.text().contains("Geart: circles all day"), "{}", a.text());
        // Saved within a few seconds, whole.
        let saved = until_stored(&p, |t| t == a.text()).await;
        assert_eq!(saved, a.text());
    }

    #[tokio::test]
    async fn only_a_good_ticket_for_this_note_and_its_workspace_gets_in() {
        let p = place("Private plans").await;
        let open = |url: String| async move { tokio_tungstenite::connect_async(url).await.map(|_| ()) };
        let refused = |r: Result<(), tokio_tungstenite::tungstenite::Error>| match r {
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => response.status().as_u16(),
            other => panic!("let in: {other:?}"),
        };
        let base = format!("{}/notes/{}", p.at, p.note);
        assert_eq!(refused(open(base.clone()).await), 401, "no ticket");
        assert_eq!(refused(open(with_ticket(&base, "made-up")).await), 401, "forged");
        assert_eq!(refused(open(with_ticket(&base, &ticket(&p.geart, p.space, p.note, -1))).await), 401, "expired");
        let other_key = issue(&Key::from(&[8u8; 64]), &Ticket { account: "1002".into(), name: String::new(), picture: String::new(), space: p.space, note: Some(p.note), exp: now() + 60 });
        assert_eq!(refused(open(with_ticket(&base, &other_key)).await), 401, "signed by another server");
        assert_eq!(refused(open(with_ticket(&format!("{}/notes/{}", p.at, p.note + 1), &ticket(&p.geart, p.space, p.note, 60))).await), 401, "for another note");
        assert_eq!(refused(open(with_ticket(&base, &ticket(&p.geart, p.geart.personal, p.note, 60))).await), 404, "the note is not in that space");
        // A note in someone's own space is never live.
        let own = p.db.save_note(&p.julius, SaveNote { id: None, text: "Mine".into(), updated_at: 1, project_id: None, folder: None, space_id: None }).await.unwrap();
        let url = with_ticket(&format!("{}/notes/{}", p.at, own.id), &ticket(&p.julius, p.julius.personal, own.id, 60));
        assert_eq!(refused(open(url).await), 404);
        // A browser elsewhere on the web is turned away even with a ticket.
        let mut request = tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(with_ticket(&base, &ticket(&p.geart, p.space, p.note, 60))).unwrap();
        request.headers_mut().insert("origin", "https://evil.example.com".parse().unwrap());
        assert!(matches!(tokio_tungstenite::connect_async(request).await, Err(tokio_tungstenite::tungstenite::Error::Http(r)) if r.status() == 403));
    }

    #[tokio::test]
    async fn what_was_written_is_there_after_everyone_leaves_and_comes_back() {
        let p = place("").await;
        let mut a = Window::open(&p, &p.julius).await;
        a.type_at(0, "# Pilot checklist\n- batteries", true).await;
        a.settle().await;
        drop(a);
        let saved = until_stored(&p, |t| t.contains("batteries")).await;
        assert_eq!(saved, "# Pilot checklist\n- batteries");
        assert!(p.db.live_note(p.note).await.unwrap().unwrap().ydoc.is_some());
        let b = Window::open(&p, &p.geart).await;
        assert_eq!(b.text(), "# Pilot checklist\n- batteries");
    }

    #[tokio::test]
    async fn a_write_from_outside_lands_as_an_edit_and_typing_meanwhile_stays() {
        let p = place("Plan\n").await;
        let mut a = Window::open(&p, &p.julius).await;
        let end = a.end();
        a.type_at(end, "Tuesday: Mercury\n", true).await;
        a.settle().await;
        until_stored(&p, |t| t.contains("Mercury")).await;
        // Julius keeps typing; the room has it, the database not yet...
        let end = a.end();
        a.type_at(end, "Wednesday: EF\n", true).await;
        a.settle().await;
        // ...when an agent, through a device, rewrites the note whole: it
        // read it with Mercury and adds a line at the top.
        p.db
            .save_note(&p.geart, SaveNote { id: Some(p.note), text: "Agent: order equipment\nPlan\nTuesday: Mercury\n".into(), updated_at: 2, project_id: None, folder: None, space_id: None })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        a.settle().await;
        let text = a.text();
        assert!(text.starts_with("Agent: order equipment\n"), "{text}");
        assert!(text.contains("Tuesday: Mercury") && text.contains("Wednesday: EF"), "Julius's typing was lost: {text}");
        let saved = until_stored(&p, |t| t == text).await;
        assert_eq!(saved, text);
        // Written while nobody has it open: there when it is next opened, in the document too.
        drop(a);
        until_stored(&p, |t| t == text).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        p.db.save_note(&p.geart, SaveNote { id: Some(p.note), text: format!("{text}Later, from a phone\n"), updated_at: 3, project_id: None, folder: None, space_id: None }).await.unwrap();
        let b = Window::open(&p, &p.geart).await;
        assert_eq!(b.text(), format!("{text}Later, from a phone\n"));
    }

    #[tokio::test]
    async fn typing_while_the_connection_is_down_arrives_when_it_is_back() {
        let p = place("Notes\n").await;
        let a = Window::open(&p, &p.julius).await;
        let mut b = Window::open(&p, &p.geart).await;
        // Julius's connection drops (Cloud Run ends every connection within
        // the hour); he goes on typing into his copy, and Geart types too.
        let Window { doc, ws } = a;
        drop(ws);
        {
            let text = doc.get_or_insert_text(TEXT);
            let mut txn = doc.transact_mut();
            let end = text.get_string(&txn).encode_utf16().count() as u32;
            text.insert(&mut txn, end, "offline line\n");
        }
        let end = b.end();
        b.type_at(end, "Geart's line\n", true).await;
        b.settle().await;
        // Back: a new connection with a new ticket, the same document.
        let mut a = Window::open_with(&p, &p.julius, doc).await;
        b.settle().await;
        a.settle().await;
        assert_eq!(a.text(), b.text());
        assert!(a.text().contains("offline line") && a.text().contains("Geart's line"), "{}", a.text());
    }

    #[test]
    fn an_edit_touches_only_what_differs_even_with_emoji() {
        let doc = new_doc();
        edit_to(&doc, "Pass IC 🎉 tomorrow");
        let saved = encode(&doc);
        // Someone types at the end meanwhile...
        let live = doc_from(Some(&saved)).unwrap();
        {
            let text = live.get_or_insert_text(TEXT);
            let mut txn = live.transact_mut();
            let end = text.get_string(&txn).encode_utf16().count() as u32;
            text.insert(&mut txn, end, " at 10");
        }
        // ...while an outside write changes a word in the middle.
        let update = outside_write(Some(&saved), "Pass IC 🎉 on Monday").unwrap();
        live.transact_mut().apply_update(Update::decode_v1(&update).unwrap()).unwrap();
        // Both edits are kept whole and the rest is untouched. Two inserts at
        // the very same spot are put in an order the document's client ids
        // decide, which differ every run, as in any editor of this kind.
        let text = text_of(&live);
        assert!(text.starts_with("Pass IC 🎉 "), "{text}");
        assert!(text.contains("on Monday") && text.contains(" at 10") && !text.contains("tomorrow"), "{text}");
        assert_eq!(text.chars().count(), "Pass IC 🎉 on Monday at 10".chars().count(), "{text}");
    }

    #[test]
    fn words_are_cut_so_they_join_back_into_the_text() {
        let text = "Pass IC 🎉  on Monday,\n- [ ] ship";
        assert_eq!(words(text).concat(), text);
        assert_eq!(words("on  Monday!"), vec!["on", "  ", "Monday", "!"]);
    }

    #[test]
    fn a_ticket_is_only_good_signed_here_and_in_time() {
        let key = Key::from(&KEY);
        let t = Ticket { account: "1".into(), name: "A".into(), picture: String::new(), space: 2, note: Some(3), exp: now() + 60 };
        assert_eq!(check(&key, &issue(&key, &t)), Some(t.clone()));
        assert_eq!(check(&key, &issue(&key, &Ticket { exp: now() - 1, ..t.clone() })), None);
        assert_eq!(check(&Key::from(&[9u8; 64]), &issue(&key, &t)), None);
        let sealed = issue(&key, &t);
        let tampered = sealed.replacen('A', "B", 1);
        assert!(tampered == sealed || check(&key, &tampered).is_none());
    }
}
