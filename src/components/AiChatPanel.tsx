import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuid } from "uuid";
import { api, runWithAiApiKey, runWithSessionSecret } from "../api";
import type { AiAttachment, AiChatChunkEvent, AiChatDoneEvent, AiChatErrorEvent, ChatMessage, Server } from "../types";
import { fileNameFromPath } from "./fileManagerShared";

interface Props {
  server: Server;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onClose: () => void;
}

function buildSystemPrompt(server: Server): string {
  const env = server.envFilePath.trim() || "(none)";
  return [
    `You are assisting with server "${server.name}" (${server.username}@${server.host}:${server.port}).`,
    `Env file: ${env}, key: ${server.envKey}.`,
    "Do not ask for passwords or private keys.",
    "Reply in the same language the user uses when practical.",
  ].join(" ");
}

function tailLines(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(-maxLines).join("\n");
}

function formatAttachments(attachments: AiAttachment[]): string {
  if (attachments.length === 0) return "";
  return attachments
    .map((a) => {
      const header =
        a.kind === "log"
          ? `[Attached log: ${a.path}, last lines]\n`
          : `[Attached file: ${a.path}]\n`;
      return header + a.content;
    })
    .join("\n\n");
}

export function AiChatPanel({ server, messages, onMessagesChange, onClose }: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState(server.logCollectPaths[0] ?? "");
  const [logLines, setLogLines] = useState("200");
  const [filePath, setFilePath] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubsRef = useRef<UnlistenFn[]>([]);

  messagesRef.current = messages;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      unsubsRef.current.forEach((u) => void u());
      unsubsRef.current = [];
    };
  }, []);

  const appendAssistantDelta = useCallback(
    (delta: string) => {
      const current = messagesRef.current;
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { ...last, content: last.content + delta };
      } else {
        next.push({ role: "assistant", content: delta });
      }
      messagesRef.current = next;
      onMessagesChange(next);
    },
    [onMessagesChange],
  );

  const cleanupListeners = useCallback(() => {
    unsubsRef.current.forEach((u) => void u());
    unsubsRef.current = [];
  }, []);

  const attachRemoteFile = async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setAttachBusy(true);
    setError(null);
    try {
      const content = await runWithSessionSecret(
        server.id,
        async () => {
          await api.sftpOpen(server.id);
          return api.sftpReadText(server.id, trimmed);
        },
        "SFTP",
      );
      setAttachments((prev) => [
        ...prev,
        {
          kind: "file",
          path: content.path,
          label: fileNameFromPath(content.path),
          content: content.content,
        },
      ]);
      setFilePath("");
    } catch (e) {
      setError(String(e));
    } finally {
      setAttachBusy(false);
    }
  };

  const attachRemoteLog = async () => {
    const trimmed = logPath.trim();
    if (!trimmed) return;
    const lines = Math.max(1, Math.min(5000, Number.parseInt(logLines, 10) || 200));
    setAttachBusy(true);
    setError(null);
    try {
      const content = await runWithSessionSecret(
        server.id,
        async () => {
          await api.sftpOpen(server.id);
          return api.sftpReadText(server.id, trimmed);
        },
        "SFTP",
      );
      setAttachments((prev) => [
        ...prev,
        {
          kind: "log",
          path: content.path,
          label: `${fileNameFromPath(content.path)} (tail ${lines})`,
          content: tailLines(content.content, lines),
        },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setAttachBusy(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const attachmentBlock = formatAttachments(attachments);
    const userContent = attachmentBlock
      ? `${attachmentBlock}\n\n---\n\n${text}`
      : text;

    const userMessage: ChatMessage = { role: "user", content: userContent };
    const nextMessages = [...messages, userMessage];
    onMessagesChange([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    setError(null);

    const requestId = uuid();
    requestIdRef.current = requestId;

    const apiMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(server) },
      ...nextMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    unsubsRef.current.forEach((u) => void u());
    unsubsRef.current = [];

    const finish = () => {
      setStreaming(false);
      requestIdRef.current = null;
      cleanupListeners();
    };

    const onChunk = await listen<AiChatChunkEvent>("ai-chat-chunk", (event) => {
      if (event.payload.requestId !== requestId) return;
      appendAssistantDelta(event.payload.delta);
    });
    const onDone = await listen<AiChatDoneEvent>("ai-chat-done", (event) => {
      if (event.payload.requestId !== requestId) return;
      finish();
    });
    const onErr = await listen<AiChatErrorEvent>("ai-chat-error", (event) => {
      if (event.payload.requestId !== requestId) return;
      setError(event.payload.message);
      finish();
    });
    unsubsRef.current = [onChunk, onDone, onErr];

    try {
      await runWithAiApiKey(
        () => api.aiChatStream(requestId, apiMessages),
        "AI API 키",
      );
    } catch (e) {
      setError(String(e));
      finish();
      onMessagesChange(nextMessages);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  return (
    <div className="aichat-wrap">
      <div className="aichat-header">
        <span className="aichat-title">AI — {server.name}</span>
        <span className="muted aichat-sub">
          {server.username}@{server.host}:{server.port}
        </span>
        <div className="aichat-header-actions">
          <button type="button" className="btn aichat-btn" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <div className="aichat-notice">
        첨부한 파일·로그와 입력 내용은 AI API 서버로 전송됩니다. API 키는 앱 실행 중 메모리에만 보관됩니다.
      </div>

      <div className="aichat-messages">
        {messages.length === 0 && (
          <div className="aichat-empty">
            서버 관련 질문을 입력하세요. 필요하면 아래에서 원격 파일·로그를 첨부할 수 있습니다.
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`aichat-msg aichat-msg-${msg.role}${msg.role === "assistant" && !msg.content && streaming ? " is-streaming" : ""}`}
          >
            <div className="aichat-msg-role">
              {msg.role === "user" ? "You" : msg.role === "assistant" ? "AI" : "System"}
            </div>
            <pre className="aichat-msg-body">{msg.content || (streaming ? "…" : "")}</pre>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {attachments.length > 0 && (
        <div className="aichat-attachments">
          {attachments.map((a, idx) => (
            <span key={`${a.path}-${idx}`} className="aichat-attach-chip">
              {a.kind === "log" ? "LOG" : "FILE"}: {a.label}
              <button
                type="button"
                className="aichat-attach-remove"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="aichat-attach-bar">
        <div className="aichat-attach-row">
          <input
            className="aichat-attach-input"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="원격 파일 경로"
            spellCheck={false}
            disabled={attachBusy || streaming}
          />
          <button
            type="button"
            className="btn aichat-btn"
            disabled={attachBusy || streaming || !filePath.trim()}
            onClick={() => void attachRemoteFile(filePath)}
          >
            파일 첨부
          </button>
        </div>
        <div className="aichat-attach-row">
          <input
            className="aichat-attach-input"
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="로그 파일 경로"
            spellCheck={false}
            disabled={attachBusy || streaming}
            list="aichat-log-paths"
          />
          <datalist id="aichat-log-paths">
            {server.logCollectPaths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <input
            className="aichat-attach-lines"
            value={logLines}
            onChange={(e) => setLogLines(e.target.value)}
            title="tail 줄 수"
            disabled={attachBusy || streaming}
          />
          <button
            type="button"
            className="btn aichat-btn"
            disabled={attachBusy || streaming || !logPath.trim()}
            onClick={() => void attachRemoteLog()}
          >
            로그 첨부
          </button>
        </div>
      </div>

      <form className="aichat-input-row" onSubmit={onSubmit}>
        <textarea
          className="aichat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={3}
          disabled={streaming}
        />
        <button type="submit" className="btn primary aichat-send" disabled={streaming || !input.trim()}>
          {streaming ? "응답 중…" : "전송"}
        </button>
      </form>

      {error && <div className="aichat-status aichat-status-err">{error}</div>}
    </div>
  );
}
