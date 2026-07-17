import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettingsView } from "../types";

interface Props {
  onClose: () => void;
  onSaved: (cfg: AppSettingsView) => void;
}

export function SettingsModal({ onClose, onSaved }: Props) {
  const [defaultEnvDir, setDefaultEnvDir] = useState("");
  const [resolvedDir, setResolvedDir] = useState("");
  const [siteUrl, setSiteUrl] = useState("https://app.infisical.com");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState("dev");
  const [clientSecret, setClientSecret] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [showInfisical, setShowInfisical] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const cfg = await api.getAppSettings();
    setDefaultEnvDir(cfg.defaultEnvDir);
    setResolvedDir(cfg.resolvedDefaultEnvDir);
    setSiteUrl(cfg.siteUrl || "https://app.infisical.com");
    setClientId(cfg.clientId);
    setProjectId(cfg.projectId);
    setEnvironment(cfg.environment || "dev");
    setSecretConfigured(cfg.clientSecretConfigured);
    if (cfg.clientId) setShowInfisical(true);
  };

  useEffect(() => {
    void reload();
  }, []);

  const savePayload = () => ({
    defaultEnvDir: defaultEnvDir.trim(),
    siteUrl: siteUrl.trim(),
    clientId: clientId.trim(),
    projectId: projectId.trim(),
    environment: environment.trim(),
    clientSecret: clientSecret.length > 0 ? clientSecret : undefined,
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.saveAppSettings(savePayload());
      const cfg = await api.getAppSettings();
      setSecretConfigured(cfg.clientSecretConfigured);
      setResolvedDir(cfg.resolvedDefaultEnvDir);
      setClientSecret("");
      setMsg("설정이 저장되었습니다.");
      onSaved(cfg);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const testInfisical = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.saveAppSettings(savePayload());
      await api.testInfisicalConnection();
      setMsg("Infisical 연결 테스트 성공");
      const cfg = await api.getAppSettings();
      onSaved(cfg);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>설정</h3>
        <div className="form-grid">
          <div className="form-field">
            <label>서버별 .env 기본 디렉터리 (경로 추천용)</label>
            <input
              value={defaultEnvDir}
              onChange={(e) => setDefaultEnvDir(e.target.value)}
              placeholder="비우면 앱 데이터/env"
            />
            <div className="sub" style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11 }}>
              실제 디렉터리: {resolvedDir || "—"}
              <br />
              각 서버는 이 아래에 <code>서버이름.env</code>처럼 개별 파일을 둡니다.
            </div>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => setShowInfisical((v) => !v)}
          >
            {showInfisical ? "Infisical 설정 숨기기" : "Infisical 설정 (선택)"}
          </button>

          {showInfisical && (
            <>
              <div className="form-field">
                <label>Site URL</label>
                <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Machine Identity Client ID</label>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </div>
              <div className="form-field">
                <label>
                  Client Secret{" "}
                  {secretConfigured ? "(저장됨 — 변경 시에만 입력)" : "(미설정)"}
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={secretConfigured ? "••••••••" : ""}
                  autoComplete="off"
                />
              </div>
              <div className="form-field">
                <label>기본 Project ID</label>
                <input value={projectId} onChange={(e) => setProjectId(e.target.value)} />
              </div>
              <div className="form-field">
                <label>기본 Environment</label>
                <input
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        {msg && <div className="msg ok">{msg}</div>}
        {error && <div className="msg error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {showInfisical && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void testInfisical()}
            >
              Infisical 테스트
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
