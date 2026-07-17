mod env_secrets;
mod infisical;
mod local_fs;
mod models;
mod secret_crypto;
mod sftp;
mod ssh;
mod store;

use env_secrets::{ensure_env_file, env_file_exists, get_env_value, upsert_env_value};
use secret_crypto::{delete_server_secret, load_server_secret, save_server_secret};
use infisical::InfisicalClient;
use models::{
    AuthType, CredentialSource, Favorite, FavoriteType, InfisicalConfig, RemoteFileEntry,
    RemoteTextContent, Server,
};
use sftp::SftpManager;
use ssh::SshManager;
use std::path::PathBuf;
use std::sync::Mutex;
use store::{client_secret_configured, save_client_secret, Store};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

struct AppState {
    store: Mutex<Store>,
    ssh: SshManager,
    sftp: SftpManager,
    infisical: InfisicalClient,
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
    /// Optional secret to write into the per-server `.env` (password or private key).
    #[serde(default)]
    secret_value: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpsertServerResult {
    server: Server,
    env_file_created: bool,
    env_file_path: String,
}

#[tauri::command]
fn upsert_server(
    state: State<'_, AppState>,
    input: UpsertServerInput,
) -> Result<UpsertServerResult, String> {
    let is_new = input
        .id
        .as_ref()
        .map(|s| s.is_empty())
        .unwrap_or(true);
    let id = input
        .id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut env_file_path = input.env_file_path.trim().to_string();
    let env_key = if input.env_key.trim().is_empty() {
        match input.auth_type {
            AuthType::Password => "SSH_PASSWORD".to_string(),
            AuthType::PrivateKey => "SSH_PRIVATE_KEY".to_string(),
        }
    } else {
        input.env_key.trim().to_string()
    };

    let mut env_file_created = false;
    if input.credential_source == CredentialSource::Env {
        if env_file_path.is_empty() {
            let store = state.store.lock().map_err(|e| e.to_string())?;
            env_file_path = store
                .suggest_env_file_path_with_host(&input.name, &input.host)
                .display()
                .to_string();
        }
        let path = std::path::Path::new(&env_file_path);
        let secret = input
            .secret_value
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let Some(value) = secret {
            // OS keyring mirror + plaintext .env
            save_server_secret(&id, value).map_err(err_string)?;
            env_file_created = upsert_env_value(path, &env_key, value).map_err(err_string)?;
        } else if is_new {
            return Err("서버 암호(또는 개인키)를 입력하세요. .env 파일에 저장됩니다.".into());
        } else {
            env_file_created = ensure_env_file(path, &env_key).map_err(err_string)?;
        }
    }

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
        env_file_path: env_file_path.clone(),
        env_key,
        infisical_project_id: input.infisical_project_id,
        infisical_env: input.infisical_env,
        infisical_secret_path: input.infisical_secret_path,
        infisical_secret_name: input.infisical_secret_name,
        log_collect_paths,
    };
    let server = store.upsert_server(server).map_err(err_string)?;
    Ok(UpsertServerResult {
        server,
        env_file_created,
        env_file_path,
    })
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
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_server(&id).map_err(err_string)
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
        CredentialSource::Env => {
            // Prefer plaintext .env; fall back to OS keyring.
            let path = server.env_file_path.trim();
            let key = if server.env_key.trim().is_empty() {
                match server.auth_type {
                    AuthType::Password => "SSH_PASSWORD",
                    AuthType::PrivateKey => "SSH_PRIVATE_KEY",
                }
            } else {
                server.env_key.trim()
            };

            if !path.is_empty() {
                match get_env_value(std::path::Path::new(path), key) {
                    Ok(secret) if !secret_crypto::is_encrypted(&secret) => {
                        let _ = save_server_secret(&server.id, &secret);
                        return Ok(secret);
                    }
                    Ok(_) => {
                        return Err(
                            "저장된 암호가 손상되었습니다. 서버 수정에서 실제 SSH 평문 암호를 다시 입력·저장하세요."
                                .into(),
                        );
                    }
                    Err(_) => { /* fall through to keyring */ }
                }
            }

            if let Some(secret) = load_server_secret(&server.id).map_err(err_string)? {
                return Ok(secret);
            }

            Err("자격 증명이 없습니다. 서버를 수정해 평문 SSH 암호를 다시 저장하세요.".into())
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_servers,
            upsert_server,
            delete_server,
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
            local_drives,
            local_list,
            local_parent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
