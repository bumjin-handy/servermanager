use crate::models::{AppData, Favorite, InfisicalConfig, Server};
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "servermanager";
const KEYRING_USER: &str = "infisical-client-secret";

pub struct Store {
    path: PathBuf,
    data: AppData,
}

impl Store {
    pub fn load(app_data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&app_data_dir).context("create app data dir")?;
        let path = app_data_dir.join("store.json");
        let data = if path.exists() {
            let raw = fs::read_to_string(&path).context("read store.json")?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            AppData::default()
        };
        Ok(Self { path, data })
    }

    fn persist(&self) -> Result<()> {
        let raw = serde_json::to_string_pretty(&self.data).context("serialize store")?;
        fs::write(&self.path, raw).context("write store.json")?;
        Ok(())
    }

    pub fn list_servers(&self) -> Vec<Server> {
        self.data.servers.clone()
    }

    pub fn upsert_server(&mut self, server: Server) -> Result<Server> {
        if let Some(existing) = self.data.servers.iter_mut().find(|s| s.id == server.id) {
            *existing = server.clone();
        } else {
            self.data.servers.push(server.clone());
        }
        self.persist()?;
        Ok(server)
    }

    pub fn delete_server(&mut self, id: &str) -> Result<()> {
        self.data.servers.retain(|s| s.id != id);
        self.data.favorites.retain(|f| f.server_id != id);
        self.persist()?;
        Ok(())
    }

    pub fn get_server(&self, id: &str) -> Option<Server> {
        self.data.servers.iter().find(|s| s.id == id).cloned()
    }

    pub fn list_favorites(&self, server_id: &str) -> Vec<Favorite> {
        let mut items: Vec<_> = self
            .data
            .favorites
            .iter()
            .filter(|f| f.server_id == server_id)
            .cloned()
            .collect();
        items.sort_by_key(|f| f.sort_order);
        items
    }

    pub fn upsert_favorite(&mut self, favorite: Favorite) -> Result<Favorite> {
        if let Some(existing) = self.data.favorites.iter_mut().find(|f| f.id == favorite.id) {
            *existing = favorite.clone();
        } else {
            self.data.favorites.push(favorite.clone());
        }
        self.persist()?;
        Ok(favorite)
    }

    pub fn delete_favorite(&mut self, id: &str) -> Result<()> {
        self.data.favorites.retain(|f| f.id != id);
        self.persist()?;
        Ok(())
    }

    pub fn get_infisical_config(&self) -> InfisicalConfig {
        self.data.infisical.clone()
    }

    pub fn set_infisical_config(&mut self, config: InfisicalConfig) -> Result<()> {
        self.data.infisical = config;
        self.persist()?;
        Ok(())
    }

    pub fn get_default_env_dir(&self) -> String {
        self.data.default_env_dir.clone()
    }

    pub fn set_default_env_dir(&mut self, path: String) -> Result<()> {
        self.data.default_env_dir = path;
        self.persist()?;
        Ok(())
    }

    /// Directory used when suggesting per-server env files.
    pub fn resolve_default_env_dir(&self) -> PathBuf {
        let configured = self.data.default_env_dir.trim();
        if configured.is_empty() {
            self.path
                .parent()
                .map(|p| p.join("env"))
                .unwrap_or_else(|| PathBuf::from("env"))
        } else {
            PathBuf::from(configured)
        }
    }

    #[allow(dead_code)]
    pub fn suggest_env_file_path(&self, server_name: &str) -> PathBuf {
        self.suggest_env_file_path_with_host(server_name, "")
    }

    /// Prefer ASCII slug from server name; if empty (e.g. Korean-only name), use host.
    pub fn suggest_env_file_path_with_host(&self, server_name: &str, host: &str) -> PathBuf {
        let slug = english_env_slug(server_name, host);
        self.resolve_default_env_dir().join(format!("{slug}.env"))
    }
}

/// Build an English-safe filename stem from server name, falling back to host.
/// Examples: `ProdApi`, `nh-web`, `10-30-9-164`
pub fn english_env_slug(server_name: &str, host: &str) -> String {
    let from_name = sanitize_filename(server_name);
    let name_has_ascii = server_name.chars().any(|c| c.is_ascii_alphanumeric());
    if name_has_ascii {
        return from_name;
    }
    let from_host = sanitize_filename(&host.trim().replace('.', "-").replace(':', "-"));
    if from_host != "server" {
        return from_host;
    }
    from_name
}

fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => c,
            '.' => '-',
            _ => '_',
        })
        .collect();
    let s = s
        .split(|c| c == '_' || c == '-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let s = s.trim_matches(|c| c == '_' || c == '-').to_string();
    if s.is_empty() {
        "server".to_string()
    } else {
        s
    }
}

pub fn save_client_secret(secret: &str) -> Result<()> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).context("create keyring entry")?;
    if secret.is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(secret).context("store client secret")?;
    }
    Ok(())
}

pub fn load_client_secret() -> Result<String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).context("create keyring entry")?;
    match entry.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e).context("read client secret"),
    }
}

pub fn client_secret_configured() -> bool {
    load_client_secret().map(|s| !s.is_empty()).unwrap_or(false)
}
