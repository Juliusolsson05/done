//! One tasks file per account, and where those files are kept.
//!
//! The server works on a local copy of an account's file and puts the whole
//! file back after each change. A file is only put back if the stored one is
//! still the one this copy started from, so two copies of the server (there
//! are two for a moment during every release) can never overwrite each other.

use done_core::{Error, Store};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// What can go wrong answering for an account.
#[derive(Debug)]
pub enum Failure {
    /// The tasks file itself said no: a stale window, or a change that breaks a rule.
    Tasks(Error),
    /// The place the files are kept could not be reached.
    Storage(String),
}

impl From<Error> for Failure {
    fn from(e: Error) -> Self {
        Failure::Tasks(e)
    }
}

fn storage<E: std::fmt::Display>(e: E) -> Failure {
    Failure::Storage(e.to_string())
}

/// The stored file was replaced by another copy of the server since this one read it.
pub struct Conflict;

/// Where account files are kept. A generation is a number that changes every
/// time a file is replaced; 0 means there is no file yet.
pub enum Files {
    /// A folder on this machine. For running the hosted mode on a laptop and for tests.
    Folder(PathBuf),
    Bucket(Bucket),
}

impl Files {
    /// `gs://name` is a Cloud Storage bucket, anything else a folder.
    pub fn from_setting(setting: &str) -> Self {
        match setting.strip_prefix("gs://") {
            Some(name) => Files::Bucket(Bucket::new(name.trim_end_matches('/'))),
            None => Files::Folder(PathBuf::from(setting)),
        }
    }

    async fn generation(&self, id: &str) -> Result<i64, Failure> {
        match self {
            Files::Folder(dir) => Ok(folder_generation(dir, id)),
            Files::Bucket(bucket) => bucket.generation(id).await,
        }
    }

    async fn get(&self, id: &str) -> Result<Option<(Vec<u8>, i64)>, Failure> {
        match self {
            Files::Folder(dir) => match std::fs::read(dir.join(format!("{id}.db"))) {
                Ok(bytes) => Ok(Some((bytes, folder_generation(dir, id)))),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(storage(e)),
            },
            Files::Bucket(bucket) => bucket.get(id).await,
        }
    }

    async fn put(&self, id: &str, bytes: Vec<u8>, expect: i64) -> Result<Result<i64, Conflict>, Failure> {
        match self {
            // Not safe between two processes sharing the folder: the check and
            // the write are separate steps. A folder is for one server on one
            // machine; the bucket does the check and the write as one step.
            Files::Folder(dir) => {
                if folder_generation(dir, id) != expect {
                    return Ok(Err(Conflict));
                }
                std::fs::create_dir_all(dir).map_err(storage)?;
                let part = dir.join(format!("{id}.db.part"));
                std::fs::write(&part, bytes).map_err(storage)?;
                std::fs::rename(&part, dir.join(format!("{id}.db"))).map_err(storage)?;
                std::fs::write(dir.join(format!("{id}.gen")), (expect + 1).to_string()).map_err(storage)?;
                Ok(Ok(expect + 1))
            }
            Files::Bucket(bucket) => bucket.put(id, bytes, expect).await,
        }
    }

    async fn delete(&self, id: &str) -> Result<(), Failure> {
        match self {
            Files::Folder(dir) => {
                for name in [format!("{id}.db"), format!("{id}.gen")] {
                    match std::fs::remove_file(dir.join(name)) {
                        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(storage(e)),
                        _ => {}
                    }
                }
                Ok(())
            }
            Files::Bucket(bucket) => bucket.delete(id).await,
        }
    }
}

fn folder_generation(dir: &Path, id: &str) -> i64 {
    std::fs::read_to_string(dir.join(format!("{id}.gen"))).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

/// A Google Cloud Storage bucket, through its JSON API. Four requests, so no
/// client library: that would be a few hundred crates for these.
pub struct Bucket {
    name: String,
    http: reqwest::Client,
    // The server's own short-lived key to the bucket, and when to fetch a new one.
    token: tokio::sync::Mutex<Option<(String, Instant)>>,
}

#[derive(Deserialize)]
struct Token {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct Object {
    // Sent as a string: it is larger than a JSON number can hold exactly.
    generation: String,
}

const STORAGE: &str = "https://storage.googleapis.com";
// Answers only from inside Google's network, and only for the identity the
// server runs as. There is no key to store or leak.
const TOKEN: &str = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

impl Bucket {
    fn new(name: &str) -> Self {
        Self { name: name.into(), http: reqwest::Client::new(), token: tokio::sync::Mutex::new(None) }
    }

    async fn token(&self) -> Result<String, Failure> {
        let mut held = self.token.lock().await;
        if let Some((token, until)) = held.as_ref() {
            if Instant::now() < *until {
                return Ok(token.clone());
            }
        }
        let fresh: Token = self
            .http
            .get(TOKEN)
            .header("Metadata-Flavor", "Google")
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(storage)?
            .json()
            .await
            .map_err(storage)?;
        // A minute early, so a token is never used in its last seconds.
        let until = Instant::now() + Duration::from_secs(fresh.expires_in.saturating_sub(60));
        *held = Some((fresh.access_token.clone(), until));
        Ok(fresh.access_token)
    }

    fn object(&self, id: &str) -> String {
        // The slash is written %2F: in this API an object's name is one path segment.
        format!("{STORAGE}/storage/v1/b/{}/o/accounts%2F{id}.db", self.name)
    }

    async fn generation(&self, id: &str) -> Result<i64, Failure> {
        let response =
            self.http.get(self.object(id)).query(&[("fields", "generation")]).bearer_auth(self.token().await?).send().await.map_err(storage)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(0);
        }
        let object: Object = response.error_for_status().map_err(storage)?.json().await.map_err(storage)?;
        object.generation.parse().map_err(storage)
    }

    async fn get(&self, id: &str) -> Result<Option<(Vec<u8>, i64)>, Failure> {
        let response = self.http.get(self.object(id)).query(&[("alt", "media")]).bearer_auth(self.token().await?).send().await.map_err(storage)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = response.error_for_status().map_err(storage)?;
        let generation = response
            .headers()
            .get("x-goog-generation")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| storage("the bucket did not say which generation it sent"))?;
        Ok(Some((response.bytes().await.map_err(storage)?.to_vec(), generation)))
    }

    async fn put(&self, id: &str, bytes: Vec<u8>, expect: i64) -> Result<Result<i64, Conflict>, Failure> {
        let response = self
            .http
            .post(format!("{STORAGE}/upload/storage/v1/b/{}/o", self.name))
            // ifGenerationMatch is the whole point: the bucket replaces the
            // file only if it is still the one this server read (0: only if
            // there is none), and does the check and the write as one step.
            .query(&[("uploadType", "media"), ("name", &format!("accounts/{id}.db")), ("ifGenerationMatch", &expect.to_string())])
            .header("content-type", "application/octet-stream")
            .bearer_auth(self.token().await?)
            .body(bytes)
            .send()
            .await
            .map_err(storage)?;
        if response.status() == reqwest::StatusCode::PRECONDITION_FAILED {
            return Ok(Err(Conflict));
        }
        let object: Object = response.error_for_status().map_err(storage)?.json().await.map_err(storage)?;
        Ok(Ok(object.generation.parse().map_err(storage)?))
    }

    async fn delete(&self, id: &str) -> Result<(), Failure> {
        let response = self.http.delete(self.object(id)).bearer_auth(self.token().await?).send().await.map_err(storage)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        response.error_for_status().map_err(storage)?;
        Ok(())
    }
}

/// An account's file, open on this machine.
struct Open {
    store: Store,
    path: PathBuf,
    /// The stored generation this copy was read from or last wrote.
    generation: i64,
    /// When the stored generation was last compared with ours.
    checked: Instant,
}

impl Drop for Open {
    fn drop(&mut self) {
        // The working copy and the two files SQLite keeps beside it.
        for end in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{end}", self.path.display()));
        }
    }
}

type Slot = Arc<tokio::sync::Mutex<Option<Open>>>;

pub struct Accounts {
    files: Files,
    /// Working copies live here. Nothing in it needs to outlive the server.
    work: PathBuf,
    open: Mutex<HashMap<String, Slot>>,
    /// How long a read may trust its copy without asking whether the stored
    /// file has changed. A change is always checked, whatever this says.
    trust: Duration,
}

// More than this many accounts open at once and the idle ones are closed.
// Opening one again is a single download of a small file.
const KEEP_OPEN: usize = 500;

impl Accounts {
    pub fn new(files: Files, work: PathBuf) -> Self {
        // Thirty seconds: with one copy of the server running, the stored file
        // cannot change behind its back, so asking on every read would be a
        // paid request for nothing. Two copies overlap only during a release.
        Self::trusting(files, work, Duration::from_secs(30))
    }

    pub fn trusting(files: Files, work: PathBuf, trust: Duration) -> Self {
        let _ = std::fs::create_dir_all(&work);
        Self { files, work, open: Mutex::new(HashMap::new()), trust }
    }

    fn slot(&self, id: &str) -> Slot {
        let mut open = self.open.lock().unwrap();
        if open.len() >= KEEP_OPEN {
            // A slot nobody else holds is idle: the map has the only reference.
            open.retain(|_, slot| Arc::strong_count(slot) > 1);
        }
        open.entry(id.to_string()).or_default().clone()
    }

    async fn fetch(&self, id: &str) -> Result<Open, Failure> {
        // A fresh name every time: a file left by an earlier copy of this
        // account must never be opened in place of the one just fetched.
        let path = self.work.join(format!("{id}-{:x}.db", rand::random::<u64>()));
        let generation = match self.files.get(id).await? {
            Some((bytes, generation)) => {
                std::fs::write(&path, bytes).map_err(storage)?;
                generation
            }
            // A new account: Store::open makes the empty file.
            None => 0,
        };
        Ok(Open { store: Store::open(&path)?, path, generation, checked: Instant::now() })
    }

    async fn with<T>(&self, id: &str, changing: bool, f: impl FnOnce(&Store) -> Result<T, Error>) -> Result<T, Failure> {
        let slot = self.slot(id);
        // One request per account at a time: the file is put back whole, so
        // two changes at once would each put back a file without the other's.
        let mut held = slot.lock().await;
        if let Some(open) = held.as_mut() {
            if open.checked.elapsed() >= self.trust {
                if self.files.generation(id).await? == open.generation {
                    open.checked = Instant::now();
                } else {
                    *held = None;
                }
            }
        }
        if held.is_none() {
            *held = Some(self.fetch(id).await?);
        }
        let open = held.as_mut().expect("just opened");
        let answer = f(&open.store)?;
        if !changing {
            return Ok(answer);
        }
        let copy = PathBuf::from(format!("{}.copy", open.path.display()));
        let _ = std::fs::remove_file(&copy);
        let bytes = open.store.snapshot(&copy).map_err(Failure::from).and_then(|()| std::fs::read(&copy).map_err(storage));
        let _ = std::fs::remove_file(&copy);
        let stored = match bytes {
            Ok(bytes) => self.files.put(id, bytes, open.generation).await,
            Err(e) => Err(e),
        };
        match stored {
            Ok(Ok(generation)) => {
                open.generation = generation;
                open.checked = Instant::now();
                Ok(answer)
            }
            // Another copy of the server changed this account first. Our copy
            // now holds a change the stored file does not, so it is thrown
            // away, and the window is told what it is told whenever it saved
            // over something it had not seen: load again.
            Ok(Err(Conflict)) => {
                *held = None;
                Err(Failure::Tasks(Error::Stale))
            }
            // Not stored, so not saved. The copy is thrown away for the same
            // reason: it must never be ahead of what is stored.
            Err(e) => {
                *held = None;
                Err(e)
            }
        }
    }

    pub async fn read<T>(&self, id: &str, f: impl FnOnce(&Store) -> Result<T, Error>) -> Result<T, Failure> {
        self.with(id, false, f).await
    }

    pub async fn write<T>(&self, id: &str, f: impl FnOnce(&Store) -> Result<T, Error>) -> Result<T, Failure> {
        self.with(id, true, f).await
    }

    /// Removes the account's file for good, here and where it is stored.
    pub async fn delete(&self, id: &str) -> Result<(), Failure> {
        let slot = self.slot(id);
        let mut held = slot.lock().await;
        *held = None;
        self.files.delete(id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use done_core::{Change, Task};

    fn task(id: i64, title: &str) -> Task {
        serde_json::from_value(serde_json::json!({ "id": id, "title": title })).unwrap()
    }

    fn add(rev: i64, id: i64, title: &str) -> impl FnOnce(&Store) -> Result<i64, Error> {
        let change = Change { rev, tasks: vec![task(id, title)], ..Default::default() };
        move |s| s.sync(change).map(|synced| synced.rev)
    }

    fn titles(s: &Store) -> Result<Vec<String>, Error> {
        Ok(s.state("2026-11-18")?.tasks.into_iter().map(|t| t.title).collect())
    }

    // One server, as it runs when hosted: a place the files are kept, and a
    // working folder of its own.
    fn server(kept: &Path, work: &tempfile::TempDir, trust: Duration) -> Accounts {
        Accounts::trusting(Files::Folder(kept.to_path_buf()), work.path().to_path_buf(), trust)
    }

    #[tokio::test]
    async fn one_account_never_sees_the_tasks_of_another() {
        let (kept, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let s = server(kept.path(), &work, Duration::ZERO);
        s.write("anna", add(0, 1, "Call the bank")).await.unwrap();
        s.write("bo", add(0, 1, "Buy milk")).await.unwrap();
        assert_eq!(s.read("anna", titles).await.unwrap(), vec!["Call the bank"]);
        assert_eq!(s.read("bo", titles).await.unwrap(), vec!["Buy milk"]);
    }

    #[tokio::test]
    async fn a_change_is_still_there_after_the_server_restarts() {
        let kept = tempfile::tempdir().unwrap();
        {
            let work = tempfile::tempdir().unwrap();
            server(kept.path(), &work, Duration::ZERO).write("anna", add(0, 1, "Call the bank")).await.unwrap();
        }
        let work = tempfile::tempdir().unwrap();
        assert_eq!(server(kept.path(), &work, Duration::ZERO).read("anna", titles).await.unwrap(), vec!["Call the bank"]);
    }

    // Two copies of the server run side by side during every release. The
    // long trust is the hard case: the second copy does not look before it
    // writes, so only the check made with the write can save the first change.
    #[tokio::test]
    async fn two_servers_never_overwrite_each_other() {
        let kept = tempfile::tempdir().unwrap();
        let (work_a, work_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let a = server(kept.path(), &work_a, Duration::from_secs(3600));
        let b = server(kept.path(), &work_b, Duration::from_secs(3600));
        // Both have the empty account open.
        assert!(a.read("anna", titles).await.unwrap().is_empty());
        assert!(b.read("anna", titles).await.unwrap().is_empty());
        a.write("anna", add(0, 1, "From the first")).await.unwrap();
        // The second still believes the file is empty at revision 0.
        let refused = b.write("anna", add(0, 1, "From the second")).await;
        assert!(matches!(refused, Err(Failure::Tasks(Error::Stale))), "the second server overwrote the first");
        // Having been refused, it loads again and sees what the first wrote.
        assert_eq!(b.read("anna", titles).await.unwrap(), vec!["From the first"]);
        b.write("anna", add(1, 2, "From the second")).await.unwrap();
        assert_eq!(server(kept.path(), &tempfile::tempdir().unwrap(), Duration::ZERO).read("anna", titles).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_read_shows_what_another_server_wrote() {
        let kept = tempfile::tempdir().unwrap();
        let (work_a, work_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let a = server(kept.path(), &work_a, Duration::ZERO);
        let b = server(kept.path(), &work_b, Duration::ZERO);
        assert!(b.read("anna", titles).await.unwrap().is_empty());
        a.write("anna", add(0, 1, "Call the bank")).await.unwrap();
        assert_eq!(b.read("anna", titles).await.unwrap(), vec!["Call the bank"]);
    }

    #[tokio::test]
    async fn a_refused_change_is_not_stored() {
        let (kept, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let s = server(kept.path(), &work, Duration::ZERO);
        assert!(matches!(s.write("anna", add(0, 1, "  ")).await, Err(Failure::Tasks(Error::Invalid(_)))));
        assert!(!kept.path().join("anna.db").exists());
    }

    #[tokio::test]
    async fn deleting_an_account_removes_its_file() {
        let (kept, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let s = server(kept.path(), &work, Duration::ZERO);
        s.write("anna", add(0, 1, "Call the bank")).await.unwrap();
        s.delete("anna").await.unwrap();
        assert!(!kept.path().join("anna.db").exists());
        assert!(s.read("anna", titles).await.unwrap().is_empty());
        // Nothing of the account is left in the working folder either.
        s.delete("anna").await.unwrap();
        assert_eq!(std::fs::read_dir(work.path()).unwrap().count(), 0);
    }
}
