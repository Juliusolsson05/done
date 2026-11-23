//! Where the hosted server kept one tasks file per account before Postgres:
//! a Cloud Storage bucket (or a folder, for a laptop). Read once, by
//! `done-server import`, to bring every account into the database
//! (see pg.rs `import`); nothing is served from here any more.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The place the files are kept could not be reached, and why.
#[derive(Debug)]
pub struct Failure(pub String);

fn storage<E: std::fmt::Display>(e: E) -> Failure {
    Failure(e.to_string())
}

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

    /// Every account id there is a file for.
    pub async fn ids(&self) -> Result<Vec<String>, Failure> {
        match self {
            Files::Folder(dir) => {
                let mut ids = Vec::new();
                for entry in std::fs::read_dir(dir).map_err(storage)? {
                    let name = entry.map_err(storage)?.file_name().to_string_lossy().to_string();
                    if let Some(id) = name.strip_suffix(".db") {
                        ids.push(id.to_string());
                    }
                }
                ids.sort();
                Ok(ids)
            }
            Files::Bucket(bucket) => bucket.ids().await,
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<(Vec<u8>, i64)>, Failure> {
        match self {
            Files::Folder(dir) => match std::fs::read(dir.join(format!("{id}.db"))) {
                Ok(bytes) => Ok(Some((bytes, folder_generation(dir, id)))),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(storage(e)),
            },
            Files::Bucket(bucket) => bucket.get(id).await,
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

    async fn ids(&self) -> Result<Vec<String>, Failure> {
        #[derive(Deserialize)]
        struct Item {
            name: String,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Page {
            #[serde(default)]
            items: Vec<Item>,
            next_page_token: Option<String>,
        }
        let mut ids = Vec::new();
        let mut next: Option<String> = None;
        loop {
            let mut query = vec![("prefix", "accounts/".to_string()), ("fields", "items(name),nextPageToken".to_string())];
            if let Some(token) = &next {
                query.push(("pageToken", token.clone()));
            }
            let page: Page = self
                .http
                .get(format!("{STORAGE}/storage/v1/b/{}/o", self.name))
                .query(&query)
                .bearer_auth(self.token().await?)
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(storage)?
                .json()
                .await
                .map_err(storage)?;
            ids.extend(page.items.into_iter().filter_map(|i| i.name.strip_prefix("accounts/")?.strip_suffix(".db").map(String::from)));
            match page.next_page_token {
                Some(token) => next = Some(token),
                None => break,
            }
        }
        Ok(ids)
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_folder_lists_its_accounts_and_hands_back_their_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("1001.db"), b"one").unwrap();
        std::fs::write(dir.path().join("1001.gen"), b"3").unwrap();
        std::fs::write(dir.path().join("1002.db"), b"two").unwrap();
        let files = Files::Folder(dir.path().to_path_buf());
        assert_eq!(files.ids().await.unwrap(), vec!["1001", "1002"]);
        assert_eq!(files.get("1001").await.unwrap(), Some((b"one".to_vec(), 3)));
        assert_eq!(files.get("9999").await.unwrap(), None);
    }
}
