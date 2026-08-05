import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettingsView } from "../types";

interface Props {
  onClose: () => void;
  onSaved: (cfg: AppSettingsView) => void;
}

export function SettingsModal({ onClose, onSaved }: Props) {
  const [defaultEnvDir, setDefaultEnvDir] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const cfg = await api.getAppSettings();
    setDefaultEnvDir(cfg.defaultEnvDir);
  };

  useEffect(() => {
    void reload();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.saveAppSettings({ defaultEnvDir: defaultEnvDir.trim() });
      setMsg("설정을 저장했습니다.");
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
            <label>.env 기본 디렉토리</label>
            <input
              value={defaultEnvDir}
              onChange={(e) => setDefaultEnvDir(e.target.value)}
              placeholder="서버별 .env 파일 경로 추천에 사용"
            />
          </div>
          <div className="form-field">
            <label>자격 증명</label>
            <div className="msg" style={{ marginTop: 6, opacity: 0.9 }}>
              서버 암호와 개인키는 저장하지 않습니다. 서버별 최초 접속 시 한 번만 입력받고,
              현재 앱 실행 중에만 메모리에 보관합니다.
            </div>
          </div>
        </div>
        {msg && <div className="msg ok">{msg}</div>}
        {error && <div className="msg error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </div>
  );
}