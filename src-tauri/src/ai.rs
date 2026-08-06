use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_AI_BASE_URL: &str = "https://api.tokenrouter.com/v1";
pub const DEFAULT_AI_MODEL: &str = "moonshotai/kimi-k3-free";
pub const AI_KEY_REQUIRED: &str = "AI_KEY_REQUIRED";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiChatChunkEvent {
    request_id: String,
    delta: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiChatDoneEvent {
    request_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiChatErrorEvent {
    request_id: String,
    message: String,
}

pub async fn chat_stream(
    app: AppHandle,
    api_key: &str,
    base_url: &str,
    model: &str,
    request_id: &str,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = Client::new();
    let body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI API 연결 실패: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let msg = format!("AI API 오류 ({status}): {text}");
        let _ = app.emit(
            "ai-chat-error",
            AiChatErrorEvent {
                request_id: request_id.to_string(),
                message: msg.clone(),
            },
        );
        return Err(msg);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("AI 스트림 읽기 실패: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data == "[DONE]" {
                let _ = app.emit(
                    "ai-chat-done",
                    AiChatDoneEvent {
                        request_id: request_id.to_string(),
                    },
                );
                return Ok(());
            }
            if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
                if let Some(content) = parsed
                    .choices
                    .first()
                    .and_then(|c| c.delta.content.as_ref())
                    .filter(|s| !s.is_empty())
                {
                    let _ = app.emit(
                        "ai-chat-chunk",
                        AiChatChunkEvent {
                            request_id: request_id.to_string(),
                            delta: content.clone(),
                        },
                    );
                }
            }
        }
    }

    let _ = app.emit(
        "ai-chat-done",
        AiChatDoneEvent {
            request_id: request_id.to_string(),
        },
    );
    Ok(())
}
