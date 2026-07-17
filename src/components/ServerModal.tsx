import { FormEvent, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { AuthType, CredentialSource, Server } from "../types";

interface Props {
  initial?: Server | null;
  defaults?: { projectId: string; environment: string };
  onClose: () => void;
  onSaved: (server: Server) => void;
}

export function ServerModal({ initial, defaults, onClose, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [authType, setAuthType] = useState<AuthType>(initial?.authType ?? "password");
  const [credentialSource, setCredentialSource] = useState<CredentialSource>(
    initial?.credentialSource ?? "env",
  );
  const [envFilePath, setEnvFilePath] = useState(initial?.envFilePath ?? "");
  const [envKey, setEnvKey] = useState(
    initial?.envKey ||
      (initial?.authType === "privateKey" ? "SSH_PRIVATE_KEY" : "SSH_PASSWORD"),
  );
  const [projectId, setProjectId] = useState(
    initial?.infisicalProjectId || defaults?.projectId || "",
  );
  const [environment, setEnvironment] = useState(
    initial?.infisicalEnv || defaults?.environment || "dev",
  );
  const [secretPath, setSecretPath] = useState(initial?.infisicalSecretPath || "/");
  const [secretName, setSecretName] = useState(
    initial?.infisicalSecretName || "SSH_PASSWORD",
  );
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestPath = async () => {
    const n = name.trim() || "server";
    try {
      const path = await api.suggestEnvPath(n);
      setEnvFilePath(path);
      setMsg(`추천 경로: ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const pickEnvFile = async () => {
    const selected = await open({
      multiple: false,
      title: "서버 .env 파일 선택",
      filters: [{ name: "Env", extensions: ["env", "*"] }],
    });
    if (typeof selected === "string") {
      setEnvFilePath(selected);
    }
  };

  const testEnv = async () => {
    setError(null);
    setMsg(null);
    try {
      const result = await api.testEnvFile(envFilePath.trim());
      setMsg(result);
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      if (credentialSource === "env" && !envKey.trim()) {
        throw new Error(".env 키 이름을 입력하세요");
      }
      if (credentialSource === "infisical" && !secretName.trim()) {
        throw new Error("Infisical 시크릿 이름을 입력하세요");
      }
      const result = await api.upsertServer({
        id: initial?.id,
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        credentialSource,
        envFilePath: envFilePath.trim(),
        envKey: envKey.trim(),
        infisicalProjectId: projectId.trim(),
        infisicalEnv: environment.trim(),
        infisicalSecretPath: secretPath.trim() || "/",
        infisicalSecretName: secretName.trim(),
      });
      if (result.envFilePath) {
        setEnvFilePath(result.envFilePath);
      }
      if (result.envFileCreated) {
        window.alert(
          `.env 파일을 생성했습니다.\n${result.envFilePath}\n\n파일에 비밀값을 입력한 뒤 연결하세요.`,
        );
      }
      onSaved(result.server);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{initial ? "서버 수정" : "서버 추가"}</h3>
        <div className="form-grid">
          <div className="form-field">
            <label>이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>호스트</label>
            <input value={host} onChange={(e) => setHost(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>포트</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              min={1}
              max={65535}
              required
            />
          </div>
          <div className="form-field">
            <label>사용자명</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label>인증 방식</label>
            <select
              value={authType}
              onChange={(e) => {
                const next = e.target.value as AuthType;
                setAuthType(next);
                if (!initial?.envKey) {
                  setEnvKey(next === "privateKey" ? "SSH_PRIVATE_KEY" : "SSH_PASSWORD");
                }
              }}
            >
              <option value="password">비밀번호</option>
              <option value="privateKey">개인키</option>
            </select>
          </div>
          <div className="form-field">
            <label>자격 증명 소스</label>
            <select
              value={credentialSource}
              onChange={(e) => setCredentialSource(e.target.value as CredentialSource)}
            >
              <option value="env">.env (서버별 파일)</option>
              <option value="infisical">Infisical (선택)</option>
            </select>
          </div>

          {credentialSource === "env" ? (
            <>
              <div className="form-field">
                <label>서버 전용 .env 경로 (없으면 저장 시 자동 생성)</label>
                <input
                  value={envFilePath}
                  onChange={(e) => setEnvFilePath(e.target.value)}
                  placeholder="비우면 이름 기준으로 경로 추천 후 생성"
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => void suggestPath()}>
                    경로 추천
                  </button>
                  <button type="button" className="btn" onClick={() => void pickEnvFile()}>
                    파일 선택
                  </button>
                  <button type="button" className="btn" onClick={() => void testEnv()}>
                    .env 확인
                  </button>
                </div>
              </div>
              <div className="form-field">
                <label>.env 키 이름</label>
                <input
                  value={envKey}
                  onChange={(e) => setEnvKey(e.target.value)}
                  placeholder={
                    authType === "password" ? "SSH_PASSWORD" : "SSH_PRIVATE_KEY"
                  }
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-field">
                <label>Infisical Project ID</label>
                <input value={projectId} onChange={(e) => setProjectId(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Infisical Environment</label>
                <input
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>시크릿 경로</label>
                <input value={secretPath} onChange={(e) => setSecretPath(e.target.value)} />
              </div>
              <div className="form-field">
                <label>시크릿 이름</label>
                <input
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  placeholder={authType === "password" ? "SSH_PASSWORD" : "SSH_PRIVATE_KEY"}
                  required
                />
              </div>
            </>
          )}
        </div>
        {msg && <div className="msg ok">{msg}</div>}
        {error && <div className="msg error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
