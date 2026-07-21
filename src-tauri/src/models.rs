use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AuthType {
    #[default]
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CredentialSource {
    #[default]
    Env,
    Infisical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_type: AuthType,
    /// Default: read secret from this server's `.env` file (`env_file_path` + `env_key`).
    #[serde(default)]
    pub credential_source: CredentialSource,
    /// Absolute path to this server's dedicated `.env` file.
    #[serde(default)]
    pub env_file_path: String,
    /// Variable name inside that `.env` (default: SSH_PASSWORD / SSH_PRIVATE_KEY).
    #[serde(default)]
    pub env_key: String,
    #[serde(default)]
    pub infisical_project_id: String,
    #[serde(default)]
    pub infisical_env: String,
    #[serde(default)]
    pub infisical_secret_path: String,
    #[serde(default)]
    pub infisical_secret_name: String,
    /// Relative (or absolute) log file paths for remote log collection (`tail -f`).
    #[serde(default)]
    pub log_collect_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteType {
    Command,
    Path,
    /// File manager — local site bookmark (stored under server_id `__local__`).
    LocalPath,
    /// File manager — remote site bookmark for a specific server.
    RemotePath,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub server_id: String,
    #[serde(rename = "type")]
    pub favorite_type: FavoriteType,
    pub label: String,
    pub value: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InfisicalConfig {
    pub site_url: String,
    pub client_id: String,
    pub project_id: String,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub servers: Vec<Server>,
    pub favorites: Vec<Favorite>,
    /// Optional directory for suggesting per-server `.env` paths. Empty = app data `/env`.
    #[serde(default)]
    pub default_env_dir: String,
    /// Remembered local path to HANDY HSO Approval INI xlsx (not committed; user-selected).
    #[serde(default)]
    pub approval_ini_docs_path: String,
    #[serde(default)]
    pub infisical: InfisicalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshClosedEvent {
    pub session_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub transfer_id: String,
    pub bytes: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTextContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}
