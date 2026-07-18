import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettingsView } from "../types";

interface Props {
  onClose: () => void;
  onSaved: (cfg: AppSettingsView) => void;
}

export function SettingsModal({ onClose, onSaved }: Props) {
  const [defaultEnvDir, setDefaultEnvDir] = useState("");
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
  const [showSecret, setShowSecret] = useState(false);

  const reload = async () => {
    const cfg = await api.getAppSettings();
    setDefaultEnvDir(cfg.defaultEnvDir);
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
      setClientSecret("");
      setMsg("설정을 저장했습니다.");
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
      setMsg("Infisical 연결 테스트에 성공했습니다.");
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
            <label>기본 자격 증명 방식</label>
            <div className="msg" style={{ marginTop: 6, opacity: 0.9 }}>
              서버 암호와 개인키는 저장하지 않습니다. 서버별 최초 접속 시 한 번만 입력받고,
              현재 앱 실행 중에만 메모리에 보관합니다.
            </div>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => setShowInfisical((v) => !v)}
          >
            {showInfisical ? "Infisical 설정 숨기기" : "Infisical 설정(선택)"}
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
                  Client Secret {secretConfigured ? "(저장됨, 변경 시에만 입력)" : "(미설정)"}
                </label>
                <div className="password-container">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={secretConfigured ? "변경할 때만 입력" : ""}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowSecret((v) => !v)}
                    title={showSecret ? "비밀번호 숨기기" : "비밀번호 보이기"}
                  >
                    {showSecret ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a18.828 18.828 0 0 0-2.79.208l1.07 1.07a7.735 7.735 0 0 1 1.72-.178c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z" />
                        <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 2.943a5.322 5.322 0 0 1-2.284-.507l-.908-.908A3.5 3.5 0 0 0 8 11.5c.073 0 .145-.006.216-.016l.825.825zm-2.14-2.117L4.3 8.093l.209-.209a2.5 2.5 0 0 1 3.2 0l.209.209-1.928 1.928z" />
                        <path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829l.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823z" />
                        <path d="M13.646 14.354l-12-12 .708-.708 12 12-.708.708z" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z" />
                        <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
                      </svg>
                    )}
                  </button>
                </div>
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