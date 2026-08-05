import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { AuthType, Server } from "../types";

interface Props {
  initial?: Server | null;
  onClose: () => void;
  onSaved: (server: Server) => void;
}

export function ServerModal({ initial, onClose, onSaved }: Props) {
  const isEdit = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [authType, setAuthType] = useState<AuthType>(initial?.authType ?? "password");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const envKey = authType === "privateKey" ? "SSH_PRIVATE_KEY" : "SSH_PASSWORD";
      const result = await api.upsertServer({
        id: initial?.id,
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        envFilePath: "",
        envKey,
      });
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
            <label>이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: ProdApi"
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
              }}
            >
              <option value="password">비밀번호</option>
              <option value="privateKey">개인키</option>
            </select>
          </div>
          <div className="form-field">
            <label>자격 증명</label>
            <div className="msg" style={{ marginTop: 6, opacity: 0.9 }}>
              암호 또는 개인키는 저장하지 않습니다. 서버별 최초 접속 시 한 번만 물어보고,
              현재 앱 실행 중에만 메모리에 보관합니다.
            </div>
          </div>
        </div>
        {error && <div className="msg error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "저장 중" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}