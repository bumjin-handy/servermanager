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
  const isEdit = Boolean(initial?.id);
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
  const [secretValue, setSecretValue] = useState("");
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

  // Auto-suggest `{englishName}.env` when creating / path empty
  useEffect(() => {
    if (credentialSource !== "env") return;
    if (isEdit && initial?.envFilePath) return;
    const n = name.trim();
    const h = host.trim();
    if (!n && !h) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const path = await api.suggestEnvPath(n || "server", h);
          if (!cancelled) {
            setEnvFilePath(path);
          }
        } catch {
          /* ignore suggest errors while typing */
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [name, host, credentialSource, isEdit, initial?.envFilePath]);

  const suggestPath = async () => {
    const n = name.trim() || "server";
    try {
      const path = await api.suggestEnvPath(n, host.trim());
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
      if (credentialSource === "env" && !isEdit && !secretValue.trim()) {
        throw new Error(
          authType === "password"
            ? "서버 암호를 입력하세요 (.env에 저장됩니다)"
            : "개인키를 입력하세요 (.env에 저장됩니다)",
        );
      }

      let path = envFilePath.trim();
      if (credentialSource === "env" && !path) {
        path = await api.suggestEnvPath(name.trim() || "server", host.trim());
        setEnvFilePath(path);
      }

      const result = await api.upsertServer({
        id: initial?.id,
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        credentialSource,
        envFilePath: path,
        envKey: envKey.trim(),
        infisicalProjectId: projectId.trim(),
        infisicalEnv: environment.trim(),
        infisicalSecretPath: secretPath.trim() || "/",
        infisicalSecretName: secretName.trim(),
        secretValue: secretValue.trim() || undefined,
      });
      if (result.envFilePath) {
        setEnvFilePath(result.envFilePath);
      }
      if (secretValue.trim()) {
        setMsg(`.env에 자격 증명을 저장했습니다: ${result.envFilePath}`);
      } else if (result.envFileCreated) {
        window.alert(
          `.env 파일을 생성했습니다.\n${result.envFilePath}\n\n필요 시 파일을 열어 비밀값을 확인하세요.`,
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
        <h3>{isEdit ? "서버 수정" : "서버 추가"}</h3>
        <div className="form-grid">
          <div className="form-field">
            <label>이름 (영문 권장 — .env 파일명에 사용)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: nh-web, ProdApi"
              required
            />
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
                setSecretValue("");
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
                <label>
                  {authType === "password"
                    ? isEdit
                      ? "서버 암호 (입력 시 .env 갱신, 비우면 유지)"
                      : "서버 암호 (.env에 저장)"
                    : isEdit
                      ? "개인키 (입력 시 .env 갱신, 비우면 유지)"
                      : "개인키 (.env에 저장)"}
                </label>
                {authType === "password" ? (
                  <input
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    autoComplete="new-password"
                    placeholder={isEdit ? "변경할 때만 입력" : "SSH 평문 암호"}
                    required={!isEdit}
                  />
                ) : (
                  <textarea
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder={
                      isEdit
                        ? "변경할 때만 PEM 키를 붙여넣기"
                        : "-----BEGIN OPENSSH PRIVATE KEY-----"
                    }
                    rows={5}
                    required={!isEdit}
                    style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 }}
                  />
                )}
                <div className="msg" style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
                  .env에 평문으로 저장됩니다. 이 파일을 커밋하지 마세요.
                </div>
              </div>
              <div className="form-field">
                <label>서버 전용 .env 경로 (영문서버명.env, 없으면 생성)</label>
                <input
                  value={envFilePath}
                  onChange={(e) => setEnvFilePath(e.target.value)}
                  placeholder="이름·호스트 기준으로 자동 추천"
                  readOnly={!isEdit}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => void suggestPath()}>
                    경로 다시 추천
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
