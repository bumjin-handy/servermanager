#[allow(dead_code)]
mod env_secrets;
mod infisical;
mod local_fs;
mod models;
#[allow(dead_code)]
mod secret_crypto;
mod sftp;
mod ssh;
mod store;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use env_secrets::env_file_exists;
use infisical::InfisicalClient;
use models::{
    AuthType, CredentialSource, Favorite, FavoriteType, InfisicalConfig, RemoteFileEntry,
    RemoteTextContent, Server,
};
use secret_crypto::delete_server_secret;
use sftp::SftpManager;
use ssh::SshManager;
use store::{client_secret_configured, save_client_secret, Store};

/// Returned when password/key is not yet in process memory for this server.
pub const SECRET_REQUIRED: &str = "SECRET_REQUIRED";

struct AppState {
    store: Mutex<Store>,
    ssh: SshManager,
    sftp: SftpManager,
    infisical: InfisicalClient,
    /// Per-server secrets kept only in RAM for this app process.
    session_secrets: Mutex<HashMap<String, String>>,
}

fn err_string(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로 오류: {e}"))
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.list_servers())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertServerInput {
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    #[serde(default)]
    credential_source: CredentialSource,
    #[serde(default)]
    env_file_path: String,
    #[serde(default)]
    env_key: String,
    #[serde(default)]
    infisical_project_id: String,
    #[serde(default)]
    infisical_env: String,
    #[serde(default)]
    infisical_secret_path: String,
    #[serde(default)]
    infisical_secret_name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpsertServerResult {
    server: Server,
}

#[tauri::command]
fn upsert_server(
    state: State<'_, AppState>,
    input: UpsertServerInput,
) -> Result<UpsertServerResult, String> {
    let id = input
        .id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let env_key = if input.env_key.trim().is_empty() {
        match input.auth_type {
            AuthType::Password => "SSH_PASSWORD".to_string(),
            AuthType::PrivateKey => "SSH_PRIVATE_KEY".to_string(),
        }
    } else {
        input.env_key.trim().to_string()
    };

    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let log_collect_paths = store
        .get_server(&id)
        .map(|s| s.log_collect_paths)
        .unwrap_or_default();

    let server = Server {
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        auth_type: input.auth_type,
        credential_source: input.credential_source,
        // Default credentials are prompted on first connection and kept only in memory.
        env_file_path: input.env_file_path.trim().to_string(),
        env_key,
        infisical_project_id: input.infisical_project_id,
        infisical_env: input.infisical_env,
        infisical_secret_path: input.infisical_secret_path,
        infisical_secret_name: input.infisical_secret_name,
        log_collect_paths,
    };
    let server = store.upsert_server(server).map_err(err_string)?;
    Ok(UpsertServerResult { server })
}

#[tauri::command]
fn save_log_collect_paths(
    state: State<'_, AppState>,
    server_id: String,
    paths: Vec<String>,
) -> Result<Server, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let mut server = store
        .get_server(&server_id)
        .ok_or_else(|| "서버를 찾을 수 없습니다".to_string())?;
    server.log_collect_paths = paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    store.upsert_server(server).map_err(err_string)
}

#[tauri::command]
fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _ = delete_server_secret(&id);
    if let Ok(mut map) = state.session_secrets.lock() {
        map.remove(&id);
    }
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_server(&id).map_err(err_string)
}

#[tauri::command]
fn set_session_secret(
    state: State<'_, AppState>,
    server_id: String,
    secret: String,
) -> Result<(), String> {
    let secret = secret.trim().to_string();
    if secret.is_empty() {
        return Err("암호(또는 개인키)가 비어 있습니다".into());
    }
    let mut map = state.session_secrets.lock().map_err(|e| e.to_string())?;
    map.insert(server_id, secret);
    Ok(())
}

#[tauri::command]
fn clear_session_secret(state: State<'_, AppState>, server_id: String) -> Result<(), String> {
    let mut map = state.session_secrets.lock().map_err(|e| e.to_string())?;
    map.remove(&server_id);
    Ok(())
}

#[tauri::command]
fn has_session_secret(state: State<'_, AppState>, server_id: String) -> Result<bool, String> {
    let map = state.session_secrets.lock().map_err(|e| e.to_string())?;
    Ok(map.get(&server_id).map(|s| !s.is_empty()).unwrap_or(false))
}

#[tauri::command]
fn list_favorites(state: State<'_, AppState>, server_id: String) -> Result<Vec<Favorite>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.list_favorites(&server_id))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertFavoriteInput {
    id: Option<String>,
    server_id: String,
    #[serde(rename = "type")]
    favorite_type: FavoriteType,
    label: String,
    value: String,
    sort_order: i32,
}

#[tauri::command]
fn upsert_favorite(
    state: State<'_, AppState>,
    input: UpsertFavoriteInput,
) -> Result<Favorite, String> {
    let favorite = Favorite {
        id: input
            .id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        server_id: input.server_id,
        favorite_type: input.favorite_type,
        label: input.label,
        value: input.value,
        sort_order: input.sort_order,
    };
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.upsert_favorite(favorite).map_err(err_string)
}

#[tauri::command]
fn delete_favorite(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_favorite(&id).map_err(err_string)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsView {
    default_env_dir: String,
    resolved_default_env_dir: String,
    site_url: String,
    client_id: String,
    project_id: String,
    environment: String,
    client_secret_configured: bool,
}

#[tauri::command]
fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettingsView, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let cfg = store.get_infisical_config();
    let resolved = store.resolve_default_env_dir();
    Ok(AppSettingsView {
        default_env_dir: store.get_default_env_dir(),
        resolved_default_env_dir: resolved.display().to_string(),
        site_url: cfg.site_url,
        client_id: cfg.client_id,
        project_id: cfg.project_id,
        environment: cfg.environment,
        client_secret_configured: client_secret_configured(),
    })
}

/// Backward-compatible alias used by older frontend calls.
#[tauri::command]
fn get_infisical_config(state: State<'_, AppState>) -> Result<AppSettingsView, String> {
    get_app_settings(state)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAppSettingsInput {
    default_env_dir: String,
    site_url: String,
    client_id: String,
    project_id: String,
    environment: String,
    client_secret: Option<String>,
}

#[tauri::command]
fn save_app_settings(
    state: State<'_, AppState>,
    input: SaveAppSettingsInput,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        store
            .set_default_env_dir(input.default_env_dir)
            .map_err(err_string)?;
        store
            .set_infisical_config(InfisicalConfig {
                site_url: input.site_url,
                client_id: input.client_id,
                project_id: input.project_id,
                environment: input.environment,
            })
            .map_err(err_string)?;
    }
    if let Some(secret) = input.client_secret {
        save_client_secret(&secret).map_err(err_string)?;
    }
    Ok(())
}

#[tauri::command]
fn save_infisical_config(
    state: State<'_, AppState>,
    input: SaveAppSettingsInput,
) -> Result<(), String> {
    save_app_settings(state, input)
}

#[tauri::command]
fn suggest_env_path(
    state: State<'_, AppState>,
    server_name: String,
    host: Option<String>,
) -> Result<String, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store
        .suggest_env_file_path_with_host(&server_name, host.as_deref().unwrap_or(""))
        .display()
        .to_string())
}

#[tauri::command]
fn test_env_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err(".env 경로가 비어 있습니다".into());
    }
    if !env_file_exists(&path) {
        return Err(format!(".env 파일이 없습니다: {}", path.display()));
    }
    Ok(format!(".env 확인됨: {}", path.display()))
}

#[tauri::command]
async fn test_infisical_connection(state: State<'_, AppState>) -> Result<(), String> {
    let config = {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        store.get_infisical_config()
    };
    state
        .infisical
        .test_connection(&config)
        .await
        .map_err(err_string)
}

async fn fetch_server_secret(state: &AppState, server: &Server) -> Result<String, String> {
    match server.credential_source {
        // Default: ask once per process, keep in memory only (no .env).
        CredentialSource::Env => {
            let map = state.session_secrets.lock().map_err(|e| e.to_string())?;
            match map.get(&server.id) {
                Some(secret) if !secret.is_empty() => Ok(secret.clone()),
                _ => Err(SECRET_REQUIRED.into()),
            }
        }
        CredentialSource::Infisical => {
            let config = {
                let store = state.store.lock().map_err(|e| e.to_string())?;
                store.get_infisical_config()
            };
            state
                .infisical
                .get_secret(
                    &config,
                    &server.infisical_project_id,
                    &server.infisical_env,
                    &server.infisical_secret_path,
                    &server.infisical_secret_name,
                )
                .await
                .map_err(err_string)
        }
    }
}

#[tauri::command]
async fn ssh_open(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let server = {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        store
            .get_server(&server_id)
            .ok_or_else(|| "서버를 찾을 수 없습니다".to_string())?
    };
    let secret = fetch_server_secret(&state, &server).await?;
    state
        .ssh
        .open_session(app, session_id, server, secret, cols.max(20), rows.max(5))
        .await
        .map_err(err_string)
}

#[tauri::command]
async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .ssh
        .write(&session_id, data.into_bytes())
        .await
        .map_err(err_string)
}

#[tauri::command]
async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    state
        .ssh
        .resize(&session_id, cols.max(20), rows.max(5))
        .await
        .map_err(err_string)
}

#[tauri::command]
async fn ssh_close(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.ssh.close(&session_id).await.map_err(err_string)?;
    state.ssh.remove(&session_id).await;
    Ok(())
}

#[tauri::command]
async fn sftp_open(state: State<'_, AppState>, server_id: String) -> Result<(), String> {
    let server = {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        store
            .get_server(&server_id)
            .ok_or_else(|| "서버를 찾을 수 없습니다".to_string())?
    };
    let secret = fetch_server_secret(&state, &server).await?;
    state
        .sftp
        .open(server_id, server, secret)
        .await
        .map_err(err_string)
}

#[tauri::command]
async fn sftp_close(state: State<'_, AppState>, server_id: String) -> Result<(), String> {
    state.sftp.close(&server_id).await;
    Ok(())
}

#[tauri::command]
async fn sftp_home(state: State<'_, AppState>, server_id: String) -> Result<String, String> {
    state.sftp.home_dir(&server_id).await.map_err(err_string)
}

#[tauri::command]
async fn sftp_list(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
    state.sftp.list(&server_id, &path).await.map_err(err_string)
}

const SFTP_TEXT_MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

#[tauri::command]
async fn sftp_read_text(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<RemoteTextContent, String> {
    let (content, size, truncated) = state
        .sftp
        .read_text(&server_id, &path, SFTP_TEXT_MAX_BYTES)
        .await
        .map_err(err_string)?;
    Ok(RemoteTextContent {
        path,
        content,
        size,
        truncated,
    })
}

#[tauri::command]
async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let transfer_id = Uuid::new_v4().to_string();
    state
        .sftp
        .download(app, &server_id, &remote_path, &local_path, &transfer_id)
        .await
        .map_err(err_string)
}

#[tauri::command]
async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let transfer_id = Uuid::new_v4().to_string();
    state
        .sftp
        .upload(app, &server_id, &local_path, &remote_path, &transfer_id)
        .await
        .map_err(err_string)
}

#[tauri::command]
fn parent_remote_path(path: String) -> String {
    sftp::parent_path(&path)
}

#[tauri::command]
fn local_home() -> Result<String, String> {
    local_fs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(err_string)
}

#[tauri::command]
fn local_mkdir(path: String) -> Result<(), String> {
    local_fs::ensure_dir(std::path::Path::new(&path)).map_err(err_string)
}

#[tauri::command]
fn local_write_text(path: String, content: String) -> Result<(), String> {
    local_fs::write_text(std::path::Path::new(&path), &content).map_err(err_string)
}

#[tauri::command]
fn local_drives() -> Result<Vec<RemoteFileEntry>, String> {
    local_fs::list_drives().map_err(err_string)
}

#[tauri::command]
fn local_list(path: String) -> Result<Vec<RemoteFileEntry>, String> {
    local_fs::list_dir(std::path::Path::new(&path)).map_err(err_string)
}

#[tauri::command]
fn local_parent(path: String) -> String {
    local_fs::parent_path(&path)
}

#[tauri::command]
fn open_local_with_editor(path: String, editor: String) -> Result<(), String> {
    local_fs::open_with_editor(std::path::Path::new(&path), &editor).map_err(err_string)
}

#[tauri::command]
fn get_approval_ini_docs_path(state: State<'_, AppState>) -> Result<String, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.get_approval_ini_docs_path())
}

#[tauri::command]
fn set_approval_ini_docs_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .set_approval_ini_docs_path(path)
        .map_err(err_string)
}

#[tauri::command]
fn read_local_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| format!("파일 읽기 실패: {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_server(id: &str) -> Server {
        Server {
            id: id.to_string(),
            name: "test".to_string(),
            host: "127.0.0.1".to_string(),
            port: 22,
            username: "tester".to_string(),
            auth_type: AuthType::Password,
            credential_source: CredentialSource::Env,
            env_file_path: String::new(),
            env_key: String::new(),
            infisical_project_id: String::new(),
            infisical_env: String::new(),
            infisical_secret_path: String::new(),
            infisical_secret_name: String::new(),
            log_collect_paths: Vec::new(),
        }
    }

    fn test_state() -> AppState {
        let dir = std::env::temp_dir().join(format!("servermanager-test-{}", Uuid::new_v4()));
        AppState {
            store: Mutex::new(Store::load(dir).expect("store")),
            ssh: SshManager::new(),
            sftp: SftpManager::new(),
            infisical: InfisicalClient::new(),
            session_secrets: Mutex::new(HashMap::new()),
        }
    }

    #[tokio::test]
    async fn memory_credentials_require_secret_before_first_connection() {
        let state = test_state();
        let server = memory_server("server-1");

        let err = fetch_server_secret(&state, &server).await.unwrap_err();

        assert_eq!(err, SECRET_REQUIRED);
    }

    #[tokio::test]
    async fn memory_credentials_reuse_secret_for_same_process() {
        let state = test_state();
        let server = memory_server("server-1");
        state
            .session_secrets
            .lock()
            .unwrap()
            .insert(server.id.clone(), "pw".to_string());

        let secret = fetch_server_secret(&state, &server).await.unwrap();

        assert_eq!(secret, "pw");
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app_data_dir(&app.handle().clone()).unwrap_or_else(|_| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("servermanager")
            });
            let store = Store::load(dir).map_err(|e| e.to_string())?;
            app.manage(AppState {
                store: Mutex::new(store),
                ssh: SshManager::new(),
                sftp: SftpManager::new(),
                infisical: InfisicalClient::new(),
                session_secrets: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_servers,
            upsert_server,
            delete_server,
            set_session_secret,
            clear_session_secret,
            has_session_secret,
            save_log_collect_paths,
            list_favorites,
            upsert_favorite,
            delete_favorite,
            get_app_settings,
            get_infisical_config,
            save_app_settings,
            save_infisical_config,
            suggest_env_path,
            test_env_file,
            test_infisical_connection,
            ssh_open,
            ssh_write,
            ssh_resize,
            ssh_close,
            sftp_open,
            sftp_close,
            sftp_home,
            sftp_list,
            sftp_read_text,
            sftp_download,
            sftp_upload,
            parent_remote_path,
            local_home,
            local_mkdir,
            local_write_text,
            local_drives,
            local_list,
            local_parent,
            open_local_with_editor,
            get_approval_ini_docs_path,
            set_approval_ini_docs_path,
            read_local_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
