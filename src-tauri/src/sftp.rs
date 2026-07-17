use crate::models::{RemoteFileEntry, Server, TransferProgressEvent};
use crate::ssh::{connect_authenticated, ClientHandler};
use anyhow::{bail, Context, Result};
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

struct SftpConn {
    _handle: Handle<ClientHandler>,
    sftp: SftpSession,
}

pub struct SftpManager {
    connections: Mutex<HashMap<String, SftpConn>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub async fn open(&self, server_id: String, server: Server, secret: String) -> Result<()> {
        self.close(&server_id).await;

        let handle = connect_authenticated(&server, &secret).await?;
        let channel = handle
            .channel_open_session()
            .await
            .context("SFTP 채널 열기 실패")?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .context("SFTP 서브시스템 요청 실패")?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .context("SFTP 세션 생성 실패")?;

        let mut map = self.connections.lock().await;
        map.insert(
            server_id,
            SftpConn {
                _handle: handle,
                sftp,
            },
        );
        Ok(())
    }

    pub async fn close(&self, server_id: &str) {
        let mut map = self.connections.lock().await;
        map.remove(server_id);
    }

    pub async fn home_dir(&self, server_id: &str) -> Result<String> {
        let map = self.connections.lock().await;
        let Some(conn) = map.get(server_id) else {
            bail!("SFTP 연결이 없습니다. 먼저 연결하세요");
        };

        // SFTP REALPATH(".") resolves to the session start directory (usually $HOME).
        let home = match conn.sftp.canonicalize(".").await {
            Ok(path) => path,
            Err(_) => conn
                .sftp
                .canonicalize("")
                .await
                .context("홈 디렉터리 조회 실패")?,
        };

        let home = home.trim().trim_end_matches('/').to_string();
        if home.is_empty() {
            Ok("/".to_string())
        } else {
            Ok(home)
        }
    }

    pub async fn list(&self, server_id: &str, path: &str) -> Result<Vec<RemoteFileEntry>> {
        let map = self.connections.lock().await;
        let Some(conn) = map.get(server_id) else {
            bail!("SFTP 연결이 없습니다. 먼저 연결하세요");
        };

        let remote_path = if path.is_empty() { "/" } else { path };
        let mut entries = Vec::new();
        let dir = conn
            .sftp
            .read_dir(remote_path)
            .await
            .with_context(|| format!("디렉터리 읽기 실패: {remote_path}"))?;

        for entry in dir {
            let name = entry.file_name();
            let meta = entry.metadata();
            let is_dir = meta.file_type().is_dir();
            let size = meta.size.unwrap_or(0);
            let full = entry.path();
            entries.push(RemoteFileEntry {
                name,
                path: full,
                is_dir,
                size,
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    }

    pub async fn download(
        &self,
        app: AppHandle,
        server_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
    ) -> Result<()> {
        let map = self.connections.lock().await;
        let Some(conn) = map.get(server_id) else {
            bail!("SFTP 연결이 없습니다");
        };

        let mut remote = conn
            .sftp
            .open(remote_path)
            .await
            .with_context(|| format!("원격 파일 열기 실패: {remote_path}"))?;

        let meta = conn.sftp.metadata(remote_path).await.ok();
        let total = meta.and_then(|m| m.size).unwrap_or(0);

        let mut local = tokio::fs::File::create(local_path)
            .await
            .with_context(|| format!("로컬 파일 생성 실패: {local_path}"))?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut bytes: u64 = 0;
        loop {
            let n = remote.read(&mut buf).await.context("원격 읽기 실패")?;
            if n == 0 {
                break;
            }
            local.write_all(&buf[..n]).await.context("로컬 쓰기 실패")?;
            bytes += n as u64;
            let _ = app.emit(
                "transfer-progress",
                TransferProgressEvent {
                    transfer_id: transfer_id.to_string(),
                    bytes,
                    total,
                },
            );
        }
        local.flush().await.ok();
        Ok(())
    }

    pub async fn upload(
        &self,
        app: AppHandle,
        server_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
    ) -> Result<()> {
        let map = self.connections.lock().await;
        let Some(conn) = map.get(server_id) else {
            bail!("SFTP 연결이 없습니다");
        };

        let mut local = tokio::fs::File::open(local_path)
            .await
            .with_context(|| format!("로컬 파일 열기 실패: {local_path}"))?;
        let total = local.metadata().await.map(|m| m.len()).unwrap_or(0);

        let mut remote = conn
            .sftp
            .create(remote_path)
            .await
            .with_context(|| format!("원격 파일 생성 실패: {remote_path}"))?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut bytes: u64 = 0;
        loop {
            let n = local.read(&mut buf).await.context("로컬 읽기 실패")?;
            if n == 0 {
                break;
            }
            remote
                .write_all(&buf[..n])
                .await
                .context("원격 쓰기 실패")?;
            bytes += n as u64;
            let _ = app.emit(
                "transfer-progress",
                TransferProgressEvent {
                    transfer_id: transfer_id.to_string(),
                    bytes,
                    total,
                },
            );
        }
        remote.flush().await.ok();
        Ok(())
    }

    /// Read remote file as text (lossy UTF-8). Caps at `max_bytes`.
    pub async fn read_text(
        &self,
        server_id: &str,
        remote_path: &str,
        max_bytes: u64,
    ) -> Result<(String, u64, bool)> {
        let map = self.connections.lock().await;
        let Some(conn) = map.get(server_id) else {
            bail!("SFTP 연결이 없습니다");
        };

        let meta = conn
            .sftp
            .metadata(remote_path)
            .await
            .with_context(|| format!("메타데이터 읽기 실패: {remote_path}"))?;
        if meta.file_type().is_dir() {
            bail!("디렉터리는 텍스트로 열 수 없습니다");
        }
        let size = meta.size.unwrap_or(0);

        let mut remote = conn
            .sftp
            .open(remote_path)
            .await
            .with_context(|| format!("원격 파일 열기 실패: {remote_path}"))?;

        let limit = max_bytes.min(if size > 0 { size } else { max_bytes }) as usize;
        let mut buf = vec![0u8; 64 * 1024];
        let mut data: Vec<u8> = Vec::new();
        let mut truncated = false;
        loop {
            if data.len() >= limit {
                truncated = size as usize > data.len() || size == 0;
                break;
            }
            let want = (limit - data.len()).min(buf.len());
            let n = remote
                .read(&mut buf[..want])
                .await
                .context("원격 읽기 실패")?;
            if n == 0 {
                break;
            }
            data.extend_from_slice(&buf[..n]);
        }
        if size > data.len() as u64 {
            truncated = true;
        }

        let content = String::from_utf8_lossy(&data).into_owned();
        Ok((content, size, truncated))
    }
}

pub fn parent_path(path: &str) -> String {
    if path == "/" || path.is_empty() {
        return "/".to_string();
    }
    let p = Path::new(path);
    p.parent()
        .map(|x| {
            let s = x.to_string_lossy().replace('\\', "/");
            if s.is_empty() {
                "/".to_string()
            } else {
                s
            }
        })
        .unwrap_or_else(|| "/".to_string())
}
