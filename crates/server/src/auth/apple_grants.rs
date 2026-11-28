//! Apple's grant stays on the hosted server. Done sessions and the Apple
//! identity token are different credentials and cannot revoke Apple's grant.
//!
//! The rule throughout: Apple is asked, never waited on. A code exchange that
//! fails leaves the person signed in without a grant kept, and a revocation
//! that fails never stops the person's account from being deleted (Apple's
//! TN3194: the deletion request is fulfilled). Each failure is logged for the
//! operator with Apple's status and `error` code, never a token.
use super::{now, AppleClaims, AppleKeys, Config};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const ISSUER: &str = "https://appleid.apple.com";
/// How long one call to Apple may take, from connecting to the last byte.
const TIMEOUT: Duration = Duration::from_secs(8);

/// The first byte of every stored grant: which key sealed it. A grant whose
/// key this server no longer has cannot be revoked, and goes with the account.
const FROM_SESSION_KEY: u8 = 1;
const FROM_GRANT_KEY: u8 = 2;

/// One line in the server's log about Apple. Kept in tests too, so they can
/// check what reaches the log.
pub(crate) fn note(line: &str) {
    eprintln!("{line}");
    #[cfg(test)]
    LOG.lock().unwrap().push(line.to_owned());
}

#[cfg(test)]
pub(crate) static LOG: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub(crate) struct Client {
    team_id: String,
    key_id: String,
    signing_key: EncodingKey,
    token_url: String,
    revoke_url: String,
    // A redirected POST must never forward a refresh token or client secret.
    http: reqwest::Client,
    /// The key derived from DONE_SESSION_KEY, and DONE_APPLE_GRANT_KEY's
    /// when it is set. Grants are sealed with the second where there is one.
    from_session: [u8; 32],
    from_grant_key: Option<[u8; 32]>,
}

/// A grant key with a label of its own, so it is never the same bytes as a
/// key the session cookies are made with.
fn derive(label: &str, secret: &[u8]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(label.as_bytes());
    hash.update([0]);
    hash.update(secret);
    hash.finalize().into()
}

impl Client {
    /// From the environment. Off (None) unless all of DONE_APPLE_TEAM_ID,
    /// DONE_APPLE_KEY_ID and DONE_APPLE_PRIVATE_KEY are there and work: one
    /// client secret is signed at start-up to check, and the log says which.
    pub fn from_env(session_key: &str) -> Option<Self> {
        let setting = |name: &str| std::env::var(name).ok().filter(|s| !s.trim().is_empty());
        match Self::from_settings(setting, session_key.as_bytes()) {
            Ok(client) => {
                note(&format!(
                    "Apple grant revocation: configured (team {}, key {}, grants sealed with {})",
                    client.team_id,
                    client.key_id,
                    if client.from_grant_key.is_some() { "DONE_APPLE_GRANT_KEY" } else { "a key derived from DONE_SESSION_KEY" }
                ));
                Some(client)
            }
            Err(why) => {
                note(&format!("Apple grant revocation: off ({why})"));
                None
            }
        }
    }

    pub(crate) fn from_settings(setting: impl Fn(&str) -> Option<String>, session_key: &[u8]) -> Result<Self, String> {
        let names = ["DONE_APPLE_TEAM_ID", "DONE_APPLE_KEY_ID", "DONE_APPLE_PRIVATE_KEY"];
        let missing: Vec<&str> = names.into_iter().filter(|name| setting(name).is_none()).collect();
        if missing.len() == names.len() {
            return Err("DONE_APPLE_TEAM_ID, DONE_APPLE_KEY_ID and DONE_APPLE_PRIVATE_KEY are not set".into());
        }
        if !missing.is_empty() {
            return Err(format!("{} not set", missing.join(" and ")));
        }
        let (team_id, key_id, pem) = (setting(names[0]).unwrap(), setting(names[1]).unwrap(), setting(names[2]).unwrap());
        let grant_key = setting("DONE_APPLE_GRANT_KEY");
        if grant_key.as_ref().is_some_and(|k| k.trim().len() < 32) {
            return Err("DONE_APPLE_GRANT_KEY must be at least 32 characters".into());
        }
        let signing_key = EncodingKey::from_ec_pem(pem.as_bytes()).map_err(|_| "DONE_APPLE_PRIVATE_KEY is not a PEM-encoded EC private key".to_string())?;
        let client = Self::new(team_id.trim().into(), key_id.trim().into(), signing_key, ISSUER, session_key, grant_key.as_deref().map(|k| k.trim().as_bytes()), TIMEOUT);
        client.client_secret("start-up check").map_err(|_| "a client secret could not be signed with DONE_APPLE_PRIVATE_KEY".to_string())?;
        Ok(client)
    }

    pub fn new(
        team_id: String,
        key_id: String,
        signing_key: EncodingKey,
        origin: &str,
        session_key: &[u8],
        grant_key: Option<&[u8]>,
        timeout: Duration,
    ) -> Self {
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(timeout).build().expect("HTTP client");
        Self {
            team_id,
            key_id,
            signing_key,
            token_url: format!("{origin}/auth/token"),
            revoke_url: format!("{origin}/auth/revoke"),
            http,
            from_session: derive("done apple grant key v1", session_key),
            from_grant_key: grant_key.map(|k| derive("done apple grant key v2", k)),
        }
    }

    fn client_secret(&self, audience: &str) -> Result<String, jsonwebtoken::errors::Error> {
        #[derive(Serialize)]
        struct Claims<'a> {
            iss: &'a str,
            sub: &'a str,
            aud: &'a str,
            iat: u64,
            exp: u64,
        }
        let iat = now();
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        jsonwebtoken::encode(&header, &Claims { iss: &self.team_id, sub: audience, aud: ISSUER, iat, exp: iat + 300 }, &self.signing_key)
    }

    fn key(&self, version: u8) -> Option<LessSafeKey> {
        let bytes = match version {
            FROM_SESSION_KEY => &self.from_session,
            FROM_GRANT_KEY => self.from_grant_key.as_ref()?,
            _ => return None,
        };
        Some(LessSafeKey::new(UnboundKey::new(&AES_256_GCM, bytes).expect("256-bit key")))
    }

    /// The version, the nonce, then the sealed token. Bound to the account
    /// and the version: a value copied to another account's row never opens.
    pub(crate) fn seal(&self, account: &str, token: &str) -> Option<Vec<u8>> {
        let version = if self.from_grant_key.is_some() { FROM_GRANT_KEY } else { FROM_SESSION_KEY };
        let nonce: [u8; 12] = rand::random();
        let mut body = token.as_bytes().to_vec();
        self.key(version)?
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from([&[version], account.as_bytes()].concat()), &mut body)
            .ok()?;
        Some([&[version], nonce.as_slice(), &body].concat())
    }

    pub(crate) fn open(&self, account: &str, sealed: &[u8]) -> Option<String> {
        let (&version, rest) = sealed.split_first()?;
        let (nonce, body) = rest.split_at_checked(12)?;
        let mut body = body.to_vec();
        let token = self
            .key(version)?
            .open_in_place(Nonce::try_assume_unique_for_key(nonce).ok()?, Aad::from([&[version], account.as_bytes()].concat()), &mut body)
            .ok()?;
        String::from_utf8(token.to_vec()).ok()
    }
}

pub(super) fn identity(token: &str, keys: &AppleKeys, audience: &str) -> Result<AppleClaims, &'static str> {
    let header = jsonwebtoken::decode_header(token).map_err(|_| "invalid identity token")?;
    let key = keys.keys.iter().find(|key| Some(&key.kid) == header.kid.as_ref()).ok_or("unknown signing key")?;
    let decoding = jsonwebtoken::DecodingKey::from_rsa_components(&key.n, &key.e).map_err(|_| "invalid signing key")?;
    let mut rules = jsonwebtoken::Validation::new(Algorithm::RS256);
    rules.set_issuer(&[ISSUER]);
    rules.set_audience(&[audience]);
    let data = jsonwebtoken::decode::<AppleClaims>(token, &decoding, &rules).map_err(|_| "identity token did not verify")?;
    if data.claims.sub.is_empty() {
        return Err("empty Apple subject");
    }
    Ok(data.claims)
}

/// Apple's answer, for the log: the status and Apple's `error` code, and
/// nothing else of the body.
async fn refusal(response: reqwest::Response) -> String {
    #[derive(Deserialize)]
    struct Said {
        error: Option<String>,
    }
    let status = response.status().as_u16();
    let error = response
        .json::<Said>()
        .await
        .ok()
        .and_then(|said| said.error)
        .filter(|e| e.len() <= 64 && e.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .unwrap_or_else(|| "none".into());
    format!("status {status}, error {error}")
}

fn unsent(e: &reqwest::Error) -> &'static str {
    if e.is_timeout() { "timed out" } else { "Apple could not be reached" }
}

/// Apple's id_token from the exchange names someone other than the identity
/// token that was verified: the one failure that refuses the sign-in.
pub(super) struct Mismatch;

/// Trades the sheet's one-time code for a refresh grant, sealed for keeping.
/// None, logged, whenever that does not work: the person is signed in all
/// the same, without a grant to revoke.
pub(super) async fn exchange(config: &Config, keys: &AppleKeys, subject: &str, account: &str, code: &str) -> Result<Option<Vec<u8>>, Mismatch> {
    #[derive(Deserialize)]
    struct Tokens {
        id_token: String,
        refresh_token: String,
    }
    let skipped = |why: &str| {
        note(&format!("Apple code exchange failed: {why}; signed in without a kept grant"));
        Ok(None)
    };
    let Some(client) = config.apple_grants.as_ref() else {
        return skipped("not configured");
    };
    let Ok(secret) = client.client_secret(&config.apple_audience) else {
        return skipped("the client secret could not be signed");
    };
    let form = [("client_id", config.apple_audience.as_str()), ("client_secret", &secret), ("grant_type", "authorization_code"), ("code", code)];
    let response = match client.http.post(&client.token_url).form(&form).send().await {
        Ok(response) => response,
        Err(e) => return skipped(unsent(&e)),
    };
    if !response.status().is_success() {
        return skipped(&refusal(response).await);
    }
    let Ok(tokens) = response.json::<Tokens>().await else {
        return skipped("incomplete token response");
    };
    let Ok(claims) = identity(&tokens.id_token, keys, &config.apple_audience) else {
        return skipped("Apple's id_token did not verify");
    };
    if claims.sub != subject {
        note("Apple code exchange refused the sign-in: Apple's id_token names a different subject");
        return Err(Mismatch);
    }
    if tokens.refresh_token.is_empty() {
        return skipped("no refresh token");
    }
    match client.seal(account, &tokens.refresh_token) {
        Some(sealed) => Ok(Some(sealed)),
        None => skipped("the grant could not be sealed"),
    }
}

/// What deleting the account did about Sign in with Apple. The app says it.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Revocation {
    Revoked,
    NotRevoked,
    /// No grant was kept: an account from before codes were exchanged, an
    /// exchange that failed, or an account that is not Apple's.
    None,
}

/// Asks Apple to revoke the account's grant, once, within the timeout.
/// Whatever happens is the answer; it never stops the deletion.
pub(super) async fn revoke(config: &Config, account: &str, sealed: Option<Vec<u8>>) -> Revocation {
    let Some(sealed) = sealed else {
        return Revocation::None;
    };
    let failed = |why: &str| {
        note(&format!("Apple grant revocation failed: {why}; the account is deleted all the same"));
        Revocation::NotRevoked
    };
    let Some(client) = config.apple_grants.as_ref() else {
        return failed("not configured");
    };
    let Some(token) = client.open(account, &sealed) else {
        return failed(&format!("the grant could not be decrypted (key version {})", sealed.first().copied().unwrap_or(0)));
    };
    let Ok(secret) = client.client_secret(&config.apple_audience) else {
        return failed("the client secret could not be signed");
    };
    let form = [("client_id", config.apple_audience.as_str()), ("client_secret", &secret), ("token_type_hint", "refresh_token"), ("token", &token)];
    match client.http.post(&client.revoke_url).form(&form).send().await {
        Err(e) => failed(unsent(&e)),
        Ok(response) if response.status().is_success() => Revocation::Revoked,
        Ok(response) => failed(&refusal(response).await),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A P-256 key made for the test, as the environment would hold one.
    fn pem() -> String {
        use base64::Engine;
        use ring::signature::{EcdsaKeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
        let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &ring::rand::SystemRandom::new()).unwrap();
        format!("-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n", base64::engine::general_purpose::STANDARD.encode(der.as_ref()))
    }

    fn settings<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
    }

    fn client(session: &[u8], grant: Option<&[u8]>) -> Client {
        Client::new("team".into(), "kid".into(), EncodingKey::from_ec_pem(pem().as_bytes()).unwrap(), ISSUER, session, grant, TIMEOUT)
    }

    #[test]
    fn the_start_up_check_says_why_it_is_off() {
        let off = |pairs: &[(&str, &str)]| Client::from_settings(settings(pairs), b"session").err().unwrap();
        assert_eq!(off(&[]), "DONE_APPLE_TEAM_ID, DONE_APPLE_KEY_ID and DONE_APPLE_PRIVATE_KEY are not set");
        assert_eq!(off(&[("DONE_APPLE_TEAM_ID", "99MUK5B6TA")]), "DONE_APPLE_KEY_ID and DONE_APPLE_PRIVATE_KEY not set");
        assert_eq!(off(&[("DONE_APPLE_TEAM_ID", "T"), ("DONE_APPLE_KEY_ID", "K"), ("DONE_APPLE_PRIVATE_KEY", "not a key")]), "DONE_APPLE_PRIVATE_KEY is not a PEM-encoded EC private key");
        let pem = pem();
        let short = [("DONE_APPLE_TEAM_ID", "T"), ("DONE_APPLE_KEY_ID", "K"), ("DONE_APPLE_PRIVATE_KEY", pem.as_str()), ("DONE_APPLE_GRANT_KEY", "short")];
        assert_eq!(off(&short), "DONE_APPLE_GRANT_KEY must be at least 32 characters");
        let on = Client::from_settings(settings(&[("DONE_APPLE_TEAM_ID", " 99MUK5B6TA "), ("DONE_APPLE_KEY_ID", "62RDX77TQX"), ("DONE_APPLE_PRIVATE_KEY", pem.as_str())]), b"session").ok().unwrap();
        assert_eq!((on.team_id.as_str(), on.key_id.as_str(), on.from_grant_key.is_some()), ("99MUK5B6TA", "62RDX77TQX", false));
    }

    #[test]
    fn a_grant_opens_only_for_its_account_and_a_key_it_was_sealed_with() {
        let session_only = client(b"session key one", None);
        let sealed = session_only.seal("apple1", "refresh-token").unwrap();
        assert_eq!(sealed[0], FROM_SESSION_KEY);
        assert!(!sealed.windows(13).any(|w| w == b"refresh-token"));
        assert_eq!(session_only.open("apple1", &sealed).as_deref(), Some("refresh-token"));
        assert_eq!(session_only.open("apple2", &sealed), None, "bound to its account");
        assert_eq!(client(b"session key two", None).open("apple1", &sealed), None, "the session key rotated");

        // With a grant key of its own, grants no longer depend on the
        // session key, and the ones sealed before still open.
        let own = client(b"session key one", Some(b"grant key"));
        let newer = own.seal("apple1", "refresh-token").unwrap();
        assert_eq!(newer[0], FROM_GRANT_KEY);
        assert_eq!(own.open("apple1", &sealed).as_deref(), Some("refresh-token"));
        assert_eq!(client(b"session key two", Some(b"grant key")).open("apple1", &newer).as_deref(), Some("refresh-token"));
        assert_eq!(session_only.open("apple1", &newer), None, "the grant key was removed");
        let mut relabelled = newer.clone();
        relabelled[0] = FROM_SESSION_KEY;
        assert_eq!(own.open("apple1", &relabelled), None, "the version is sealed too");
        assert_eq!(own.open("apple1", &[9, 1, 2]), None);
    }
}
