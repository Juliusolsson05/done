//! Apple's grant stays on the hosted server. Done sessions and the Apple
//! identity token are different credentials and cannot revoke Apple's grant.
use super::{now, AppleClaims, AppleKeys, Cloud, Config, Key};
use crate::pg::Fail;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const ISSUER: &str = "https://appleid.apple.com";

pub(crate) struct Client {
    team_id: String,
    key_id: String,
    signing_key: EncodingKey,
    token_url: String,
    revoke_url: String,
    // A redirected POST must never forward a refresh token or client secret.
    http: reqwest::Client,
}

impl Client {
    pub fn from_env() -> Option<Self> {
        let setting = |name: &str| std::env::var(name).ok().filter(|s| !s.trim().is_empty());
        let team = setting("DONE_APPLE_TEAM_ID");
        let kid = setting("DONE_APPLE_KEY_ID");
        let pem = setting("DONE_APPLE_PRIVATE_KEY");
        match (team, kid, pem) {
            (None, None, None) => None,
            (Some(team_id), Some(key_id), Some(pem)) => {
                let signing_key =
                    EncodingKey::from_ec_pem(pem.as_bytes()).expect("DONE_APPLE_PRIVATE_KEY must be a PEM-encoded EC signing key");
                Some(Self::new(team_id, key_id, signing_key, ISSUER))
            }
            _ => panic!("Configure DONE_APPLE_TEAM_ID, DONE_APPLE_KEY_ID and DONE_APPLE_PRIVATE_KEY together"),
        }
    }

    pub fn new(team_id: String, key_id: String, signing_key: EncodingKey, origin: &str) -> Self {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .expect("HTTP client");
        Self {
            team_id,
            key_id,
            signing_key,
            token_url: format!("{origin}/auth/token"),
            revoke_url: format!("{origin}/auth/revoke"),
            http,
        }
    }

    fn client_secret(&self, audience: &str) -> Result<String, &'static str> {
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
        jsonwebtoken::encode(
            &header,
            &Claims {
                iss: &self.team_id,
                sub: audience,
                aud: ISSUER,
                iat,
                exp: iat + 300,
            },
            &self.signing_key,
        )
        .map_err(|_| "Apple client authentication is unavailable")
    }
}

pub(super) fn identity(token: &str, keys: &AppleKeys, audience: &str) -> Result<AppleClaims, &'static str> {
    let header = jsonwebtoken::decode_header(token).map_err(|_| "invalid identity token")?;
    let key = keys
        .keys
        .iter()
        .find(|key| Some(&key.kid) == header.kid.as_ref())
        .ok_or("unknown signing key")?;
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

pub(crate) struct Stored {
    pub fingerprint: Vec<u8>,
    pub encrypted: Vec<u8>,
}

fn cipher(key: &Key) -> LessSafeKey {
    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key.encryption()).expect("cookie encryption key is 256 bits"))
}

pub(super) async fn exchange(
    config: &Config,
    keys: &AppleKeys,
    subject: &str,
    account: &str,
    code: &str,
) -> Result<Stored, &'static str> {
    #[derive(Deserialize)]
    struct Tokens {
        id_token: String,
        refresh_token: String,
    }

    let client = config.apple_grants.as_ref().ok_or("Apple code exchange is not configured")?;
    let secret = client.client_secret(&config.apple_audience)?;
    let response = client
        .http
        .post(&client.token_url)
        .form(&[
            ("client_id", config.apple_audience.as_str()),
            ("client_secret", &secret),
            ("grant_type", "authorization_code"),
            ("code", code),
        ])
        .send()
        .await
        .map_err(|_| "Apple token endpoint unavailable")?;
    if !response.status().is_success() {
        return Err("Apple refused the authorization code");
    }
    let tokens: Tokens = response.json().await.map_err(|_| "incomplete token response")?;
    if identity(&tokens.id_token, keys, &config.apple_audience)?.sub != subject || tokens.refresh_token.is_empty() {
        return Err("Apple grant does not match the signed-in user");
    }

    // Bind ciphertext to the account. A copied database value must never let
    // deleting one account revoke the grant that belongs to another.
    let nonce: [u8; 12] = rand::random();
    let mut body = tokens.refresh_token.into_bytes();
    let fingerprint = Sha256::digest(&body).to_vec();
    cipher(&config.key)
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(account.as_bytes()), &mut body)
        .map_err(|_| "could not protect the Apple grant")?;
    Ok(Stored {
        fingerprint,
        encrypted: [nonce.as_slice(), &body].concat(),
    })
}

pub(super) async fn revoke(cloud: &Cloud, account: &str, grants: Vec<Vec<u8>>) -> Result<(), Fail> {
    if grants.is_empty() {
        return Ok(());
    }
    let failed = || Fail::Down("Apple grant revocation did not finish".into());
    let config = &cloud.config;
    let client = config.apple_grants.as_ref().ok_or_else(failed)?;
    let secret = client.client_secret(&config.apple_audience).map_err(|_| failed())?;
    let cipher = cipher(&config.key);
    for encrypted in grants {
        let (nonce, body) = encrypted.split_at_checked(12).ok_or_else(failed)?;
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| failed())?;
        let mut body = body.to_vec();
        let bytes = cipher
            .open_in_place(nonce, Aad::from(account.as_bytes()), &mut body)
            .map_err(|_| failed())?;
        let token = std::str::from_utf8(bytes).map_err(|_| failed())?;
        let response = client
            .http
            .post(&client.revoke_url)
            .form(&[
                ("client_id", config.apple_audience.as_str()),
                ("client_secret", &secret),
                ("token_type_hint", "refresh_token"),
                ("token", token),
            ])
            .send()
            .await
            .map_err(|_| failed())?;
        if !response.status().is_success() {
            return Err(failed());
        }
    }
    Ok(())
}
