import { useEffect, useState } from "react";
import type { LinkedProgram } from "../types";
import {
  DEFAULT_LINKED_PROGRAMS,
  createCustomLinkedProgram,
  isPresetLinkedProgram,
  loadLinkedPrograms,
  openWithLinkedProgram,
  persistLinkedPrograms,
  pickExecutablePath,
  programsForStore,
} from "../lib/linkedPrograms";

interface Props {
  mode: "pick" | "manage";
  filePath?: string;
  initialProgramId?: string | null;
  errorMessage?: string | null;
  onClose: () => void;
  onOpened?: () => void;
}

export function LinkedProgramModal({
  mode,
  filePath,
  initialProgramId = null,
  errorMessage = null,
  onClose,
  onOpened,
}: Props) {
  const [programs, setPrograms] = useState<LinkedProgram[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialProgramId);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(errorMessage);

  useEffect(() => {
    void (async () => {
      try {
        const list = await loadLinkedPrograms();
        setPrograms(list);
        if (initialProgramId && list.some((p) => p.id === initialProgramId)) {
          setSelectedId(initialProgramId);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [initialProgramId]);

  const savePrograms = async (next: LinkedProgram[]) => {
    const saved = await persistLinkedPrograms(programsForStore(next));
    setPrograms(saved);
    return saved;
  };

  const updateProgram = (id: string, patch: Partial<LinkedProgram>) => {
    setPrograms((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const browseExecutable = async (program: LinkedProgram) => {
    const path = await pickExecutablePath(`${program.name} 실행 파일 선택`);
    if (!path) return;
    updateProgram(program.id, { executablePath: path });
    setStatus(`${program.name} 실행 파일을 설정했습니다.`);
  };

  const addCustomProgram = async () => {
    const path = await pickExecutablePath("새 연결 프로그램 실행 파일");
    if (!path) return;
    const program = createCustomLinkedProgram(newName, path);
    const next = [...programs, program];
    await savePrograms(next);
    setSelectedId(program.id);
    setNewName("");
    setStatus(`"${program.name}" 프로그램을 추가했습니다.`);
  };

  const removeProgram = async (program: LinkedProgram) => {
    if (!window.confirm(`"${program.name}" 연결을 목록에서 삭제할까요?`)) return;
    setError(null);
    setStatus(null);
    try {
      const nextVisible = programs.filter((p) => p.id !== program.id);
      const hiddenMarkers: LinkedProgram[] = isPresetLinkedProgram(program)
        ? [
            {
              ...DEFAULT_LINKED_PROGRAMS.find((p) => p.id === program.id)!,
              executablePath: "",
              hidden: true,
            },
          ]
        : [];
      const saved = await persistLinkedPrograms([
        ...programsForStore(nextVisible),
        ...programsForStore(hiddenMarkers),
      ]);
      setPrograms(saved);
      if (selectedId === program.id) setSelectedId(null);
      setStatus(`"${program.name}" 연결을 삭제했습니다.`);
    } catch (e) {
      setError(String(e));
    }
  };

  const openSelected = async (program: LinkedProgram, persistBeforeOpen = true) => {
    if (!filePath) {
      setError("열 파일 경로가 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (persistBeforeOpen) {
        await savePrograms(programs);
      }
      const result = await openWithLinkedProgram(program, filePath);
      if (result.ok) {
        onOpened?.();
        onClose();
        return;
      }
      setSelectedId(result.program.id);
      setError(result.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveManage = async () => {
    setBusy(true);
    setError(null);
    try {
      await savePrograms(programs);
      setStatus("연결 프로그램 설정을 저장했습니다.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickAndOpen = async () => {
    const program = programs.find((p) => p.id === selectedId);
    if (!program) {
      setError("연결 프로그램을 선택하세요.");
      return;
    }
    if (!program.executablePath.trim() && !program.preset) {
      setError("실행 파일을 먼저 지정하세요.");
      return;
    }
    await openSelected(program);
  };

  const assignBrowseAndOpen = async () => {
    const program = programs.find((p) => p.id === selectedId);
    if (!program) {
      setError("연결 프로그램을 선택하세요.");
      return;
    }
    const path = await pickExecutablePath(`${program.name} 실행 파일 선택`);
    if (!path) return;
    const next = programs.map((p) =>
      p.id === program.id ? { ...p, executablePath: path } : p,
    );
    setPrograms(next);
    await openSelected({ ...program, executablePath: path }, false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal linked-program-modal"
        role="dialog"
        aria-label={mode === "pick" ? "연결 프로그램 선택" : "연결 프로그램 관리"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{mode === "pick" ? "연결 프로그램 선택" : "연결 프로그램 관리"}</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        <div className="modal-body linked-program-body">
          {mode === "pick" && errorMessage && (
            <div className="msg error linked-program-msg">
              연결 프로그램을 실행하지 못했습니다. 프로그램을 선택하거나 실행 파일을
              지정하세요.
              <div className="muted linked-program-error-detail">{errorMessage}</div>
            </div>
          )}

          <p className="sqlbind-help">
            {mode === "pick"
              ? "목록에서 프로그램을 선택한 뒤 열기를 누르거나, 실행 파일을 직접 지정하세요."
              : "자주 쓰는 로컬 프로그램의 실행 파일(.exe) 경로를 등록합니다. 등록한 연결은 삭제로 목록에서 제거할 수 있습니다."}
          </p>

          <ul className="linked-program-list" role="list">
            {programs.map((program) => (
              <li key={program.id} className="linked-program-item">
                <label className="linked-program-row">
                  {mode === "pick" && (
                    <input
                      type="radio"
                      name="linked-program-pick"
                      checked={selectedId === program.id}
                      onChange={() => setSelectedId(program.id)}
                    />
                  )}
                  <span className="linked-program-name">{program.name}</span>
                  <code className="linked-program-path" title={program.executablePath || "(자동 탐색)"}>
                    {program.executablePath.trim() || (program.preset ? "자동 탐색" : "미설정")}
                  </code>
                </label>
                <div className="linked-program-item-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void browseExecutable(program)}
                  >
                    찾아보기
                  </button>
                  {mode === "manage" && (
                    <>
                      <input
                        className="linked-program-name-input"
                        type="text"
                        value={program.name}
                        disabled={isPresetLinkedProgram(program)}
                        aria-label={`${program.name} 이름`}
                        onChange={(e) => updateProgram(program.id, { name: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() => void removeProgram(program)}
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {mode === "manage" && (
            <div className="linked-program-add-row">
              <input
                type="text"
                className="linked-program-name-input"
                placeholder="새 프로그램 이름"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => void addCustomProgram()}>
                + 프로그램 추가
              </button>
            </div>
          )}

          {status && <div className="msg ok linked-program-msg">{status}</div>}
          {error && <div className="msg error linked-program-msg">{error}</div>}
        </div>

        <div className="form-actions linked-program-actions">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {mode === "pick" ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy || !selectedId}
                onClick={() => void assignBrowseAndOpen()}
              >
                실행 파일 지정 후 열기
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !selectedId || !filePath}
                onClick={() => void pickAndOpen()}
              >
                열기
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void saveManage()}
            >
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
