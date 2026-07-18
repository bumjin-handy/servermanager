import { FormEvent, useEffect, useState, useRef } from "react";

interface Props {
  label: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function SecretPromptModal({ label, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ width: "400px" }}
      >
        <h3>인증 정보 입력</h3>
        <div className="form-grid">
          <div className="form-field">
            <label>{label}</label>
            <div className="password-container">
              <input
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="입력하세요"
                required
                autoComplete="off"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? "비밀번호 숨기기" : "비밀번호 보이기"}
              >
                {showPassword ? (
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
            <div className="msg" style={{ marginTop: 6, opacity: 0.9 }}>
              입력값은 현재 앱 실행 중 메모리에만 저장됩니다.
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            확인
          </button>
        </div>
      </form>
    </div>
  );
}
