use crate::models::{AuthType, Server, SshClosedEvent, SshOutputEvent};
use anyhow::{bail, Context, Result};
use russh::client::{self, Handle, Msg};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, Disconnect, Preferred};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};

pub struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }
}

struct LiveSession {
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    close_tx: mpsc::UnboundedSender<()>,
}

pub struct SshManager {
    sessions: Arc<Mutex<HashMap<String, LiveSession>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_session(
        &self,
        app: AppHandle,
        session_id: String,
        server: Server,
        secret: String,
        cols: u32,
        rows: u32,
    ) -> Result<()> {
        let config = client::Config {
            preferred: Preferred::DEFAULT,
            ..Default::default()
        };
        let config = Arc::new(config);

        let mut handle =
            client::connect(config, (server.host.as_str(), server.port), ClientHandler)
                .await
                .context("SSH 연결 실패")?;

        let auth_ok = match server.auth_type {
            AuthType::Password => handle
                .authenticate_password(server.username.clone(), secret)
                .await
                .context("비밀번호 인증 실패")?,
            AuthType::PrivateKey => {
                let key = decode_secret_key(&secret, None).context("개인키 파싱 실패")?;
                let hash_alg = match handle.best_supported_rsa_hash().await {
                    Ok(v) => v.flatten(),
                    Err(_) => None,
                };
                handle
                    .authenticate_publickey(
                        server.username.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                    )
                    .await
                    .context("공개키 인증 실패")?
            }
        };

        if !auth_ok.success() {
            bail!(
                "SSH 인증이 거부되었습니다. 서버 수정에서 평문 암호를 다시 저장한 뒤 재시도하세요."
            );
        }

        let mut channel = handle
            .channel_open_session()
            .await
            .context("세션 채널 열기 실패")?;

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .context("PTY 요청 실패")?;
        channel.request_shell(true).await.context("셸 요청 실패")?;

        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();
        let (close_tx, mut close_rx) = mpsc::unbounded_channel::<()>();

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                session_id.clone(),
                LiveSession {
                    write_tx,
                    resize_tx,
                    close_tx,
                },
            );
        }

        let sid = session_id.clone();
        let app_clone = app.clone();
        let sessions = self.sessions.clone();

        tokio::spawn(async move {
            let result = run_channel_loop(
                &app_clone,
                &sid,
                &mut channel,
                &mut write_rx,
                &mut resize_rx,
                &mut close_rx,
            )
            .await;

            {
                let mut map = sessions.lock().await;
                map.remove(&sid);
            }

            let reason = match result {
                Ok(()) => "closed".to_string(),
                Err(e) => e.to_string(),
            };
            let _ = app_clone.emit(
                "ssh-closed",
                SshClosedEvent {
                    session_id: sid.clone(),
                    reason,
                },
            );
            let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
        });

        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: Vec<u8>) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            bail!("세션을 찾을 수 없습니다");
        };
        session
            .write_tx
            .send(data)
            .context("세션에 데이터 전송 실패")?;
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            bail!("세션을 찾을 수 없습니다");
        };
        session
            .resize_tx
            .send((cols, rows))
            .context("리사이즈 전송 실패")?;
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(session_id) {
            let _ = session.close_tx.send(());
        }
        Ok(())
    }

    pub async fn remove(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(session_id);
    }
}

async fn run_channel_loop(
    app: &AppHandle,
    session_id: &str,
    channel: &mut Channel<Msg>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    resize_rx: &mut mpsc::UnboundedReceiver<(u32, u32)>,
    close_rx: &mut mpsc::UnboundedReceiver<()>,
) -> Result<()> {
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let text = String::from_utf8_lossy(data).to_string();
                        let _ = app.emit(
                            "ssh-output",
                            SshOutputEvent {
                                session_id: session_id.to_string(),
                                data: text,
                            },
                        );
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let text = String::from_utf8_lossy(data).to_string();
                        let _ = app.emit(
                            "ssh-output",
                            SshOutputEvent {
                                session_id: session_id.to_string(),
                                data: text,
                            },
                        );
                    }
                    Some(ChannelMsg::ExitStatus { .. }) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            data = write_rx.recv() => {
                match data {
                    Some(bytes) => {
                        channel.data(&bytes[..]).await.context("stdin 전송 실패")?;
                    }
                    None => break,
                }
            }
            size = resize_rx.recv() => {
                if let Some((cols, rows)) = size {
                    channel
                        .window_change(cols, rows, 0, 0)
                        .await
                        .context("window change 실패")?;
                }
            }
            _ = close_rx.recv() => {
                let _ = channel.close().await;
                break;
            }
        }
    }
    Ok(())
}

/// Open an authenticated russh handle for SFTP reuse.
pub async fn connect_authenticated(server: &Server, secret: &str) -> Result<Handle<ClientHandler>> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (server.host.as_str(), server.port), ClientHandler)
        .await
        .context("SSH 연결 실패")?;

    let auth_ok = match server.auth_type {
        AuthType::Password => handle
            .authenticate_password(server.username.clone(), secret.to_string())
            .await
            .context("비밀번호 인증 실패")?,
        AuthType::PrivateKey => {
            let key = decode_secret_key(secret, None).context("개인키 파싱 실패")?;
            let hash_alg = match handle.best_supported_rsa_hash().await {
                Ok(v) => v.flatten(),
                Err(_) => None,
            };
            handle
                .authenticate_publickey(
                    server.username.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .context("공개키 인증 실패")?
        }
    };

        if !auth_ok.success() {
            bail!(
                "SSH 인증이 거부되었습니다. 서버 수정에서 평문 암호를 다시 저장한 뒤 재시도하세요."
            );
        }

        Ok(handle)
}
