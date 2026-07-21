import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import {
  EXAMPLE_LOG,
  bindSql,
  buildBoundParams,
  countPlaceholders,
  parseLogText,
  parseParameterString,
  parseTypesString,
  splitLogStatements,
  type BoundParam,
  type DbType,
  type LogStatementUnit,
  type SqlParamType,
} from "../lib/sqlBinder";

interface Props {
  onClose: () => void;
}

type WorkflowFlags = {
  hasInput: boolean;
  hasParse: boolean;
  hasBind: boolean;
  hasCopy: boolean;
};

function workflowStepClass(flags: WorkflowFlags, index: number): string {
  const done = [flags.hasInput, flags.hasParse, flags.hasBind, flags.hasCopy];
  if (done.every(Boolean)) {
    return index === 3 ? "is-done is-current" : "is-done";
  }
  const current = done.findIndex((d) => !d);
  const classes: string[] = [];
  if (done[index]) classes.push("is-done");
  if (index === current) classes.push("is-current");
  return classes.join(" ");
}

export function SqlBindPanel({ onClose }: Props) {
  const [dbType, setDbType] = useState<DbType>("oracle");
  const [logText, setLogText] = useState("");
  const [sql, setSql] = useState("");
  const [paramText, setParamText] = useState("");
  const [typesText, setTypesText] = useState("");
  const [parsedParams, setParsedParams] = useState<BoundParam[]>([]);
  const [resultSql, setResultSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const [copyLabel, setCopyLabel] = useState("복사");
  const [importedUnits, setImportedUnits] = useState<LogStatementUnit[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const placeholderCount = useMemo(() => countPlaceholders(sql), [sql]);

  const flags: WorkflowFlags = {
    hasInput: Boolean(sql.trim() && paramText.trim()),
    hasParse: parsedParams.length > 0,
    hasBind: Boolean(resultSql),
    hasCopy: hasCopied,
  };

  const runBind = (params: BoundParam[], sqlValue: string, db: DbType) => {
    try {
      const bound = bindSql(sqlValue.trim(), params, db);
      setResultSql(bound);
      setHasCopied(false);
      setError(null);
      setStatus("파라미터 바인딩이 완료되었습니다. 아래 결과를 복사해 사용하세요.");
      return true;
    } catch (e) {
      setResultSql("");
      setError(`바인딩 중 오류가 발생했습니다: ${(e as Error).message}`);
      return false;
    }
  };

  const parseParameters = (
    sqlValue = sql,
    paramValue = paramText,
    typesValue = typesText,
  ) => {
    setError(null);
    setHasCopied(false);
    setResultSql("");

    const trimmedSql = sqlValue.trim();
    const trimmedParams = paramValue.trim();
    const trimmedTypes = typesValue.trim();

    if (!trimmedSql || !trimmedParams) {
      setError("SQL과 파라미터를 모두 입력해주세요.");
      setParsedParams([]);
      return;
    }

    try {
      const values = parseParameterString(trimmedParams);
      const javaTypes = trimmedTypes ? parseTypesString(trimmedTypes) : [];
      const qCount = countPlaceholders(trimmedSql);

      if (values.length !== qCount) {
        setError(
          `SQL의 ? 개수(${qCount})와 파라미터 개수(${values.length})가 일치하지 않습니다.`,
        );
        setParsedParams([]);
        return;
      }

      if (javaTypes.length > 0 && javaTypes.length !== values.length) {
        setError(
          `파라미터 개수(${values.length})와 타입 개수(${javaTypes.length})가 일치하지 않습니다.`,
        );
        setParsedParams([]);
        return;
      }

      const params = buildBoundParams(values, javaTypes);
      setParsedParams(params);
      runBind(params, trimmedSql, dbType);
    } catch (e) {
      setError(`파라미터 파싱 중 오류가 발생했습니다: ${(e as Error).message}`);
      setParsedParams([]);
    }
  };

  const applyFromLog = (raw = logText) => {
    setError(null);
    setStatus(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("로그 내용을 입력해주세요.");
      return;
    }

    const { sql: parsedSql, parameters, types } = parseLogText(trimmed);
    if (!parsedSql) {
      setError("Executing Statement를 찾을 수 없습니다.");
      return;
    }
    if (!parameters) {
      setError("Parameters를 찾을 수 없습니다.");
      return;
    }

    setSql(parsedSql);
    setParamText(parameters);
    setTypesText(types);
    parseParameters(parsedSql, parameters, types);
  };

  const onLogPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes("Executing Statement:") || !pasted.includes("Parameters:")) {
      return;
    }
    window.setTimeout(() => {
      const el = document.getElementById("sqlbind-log") as HTMLTextAreaElement | null;
      const next = el?.value ?? "";
      if (next.includes("Executing Statement:") && next.includes("Parameters:")) {
        setLogText(next);
        applyFromLog(next);
      }
    }, 50);
  };

  const insertExampleLog = () => {
    setLogText(EXAMPLE_LOG);
    applyFromLog(EXAMPLE_LOG);
    setStatus("예제 로그가 로드되어 자동으로 파싱·바인딩되었습니다.");
  };

  const selectImportedUnit = (unit: LogStatementUnit) => {
    setSelectedUnitId(unit.id);
    setLogText(unit.raw);
    applyFromLog(unit.raw);
    setStatus(`선택한 로그가 적용되었습니다: ${unit.label}`);
  };

  const onImportFileChange = (e: ReactChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setStatus(null);
    void (async () => {
      try {
        const text = await file.text();
        const units = splitLogStatements(text);
        if (units.length === 0) {
          setImportedUnits([]);
          setImportedFileName(null);
          setSelectedUnitId(null);
          setError("Executing Statement를 찾을 수 없습니다.");
          return;
        }
        setImportedUnits(units);
        setImportedFileName(file.name);
        selectImportedUnit(units[0]);
      } catch {
        setError("로그 파일을 읽지 못했습니다.");
      }
    })();
  };

  const clearAll = () => {
    setLogText("");
    setSql("");
    setParamText("");
    setTypesText("");
    setParsedParams([]);
    setResultSql("");
    setError(null);
    setStatus(null);
    setHasCopied(false);
    setImportedUnits([]);
    setImportedFileName(null);
    setSelectedUnitId(null);
  };

  const updateParamValue = (index: number, value: string) => {
    setParsedParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, value } : p)),
    );
  };

  const updateParamType = (index: number, type: SqlParamType) => {
    setParsedParams((prev) => {
      const next = prev.map((p, i) => (i === index ? { ...p, type } : p));
      runBind(next, sql, dbType);
      return next;
    });
  };

  useEffect(() => {
    if (parsedParams.length === 0) return;
    runBind(parsedParams, sql, dbType);
    // dbType 변경 시에만 재바인딩
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbType]);

  const copyResult = async () => {
    if (!resultSql) {
      setError("복사할 결과가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(resultSql);
      setHasCopied(true);
      setCopyLabel("복사됨!");
      window.setTimeout(() => setCopyLabel("복사"), 2000);
    } catch {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = resultSql;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (!ok) throw new Error("copy failed");
        setHasCopied(true);
        setCopyLabel("복사됨!");
        window.setTimeout(() => setCopyLabel("복사"), 2000);
      } catch {
        setError("클립보드 복사에 실패했습니다.");
      }
    }
  };

  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal sqlbind-modal"
        role="dialog"
        aria-label="SQL Bind"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" ref={topRef}>
          <h3>SQL Bind</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        <div className="modal-body sqlbind-body">
          <nav className="sqlbind-workflow" aria-label="작업 단계">
            <ol className="sqlbind-steps">
              {["입력", "파싱", "바인딩", "복사"].map((label, i) => (
                <li key={label} className={`sqlbind-step ${workflowStepClass(flags, i)}`}>
                  <span className="sqlbind-step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </nav>

          <p className="sqlbind-hint">
            통합 로그는 <strong>적용</strong>으로 필드를 채운 뒤,{" "}
            <strong>파라미터 파싱</strong>을 누르면 검증 후 <strong>바인딩까지 자동</strong>
            으로 실행됩니다. 표에서 타입을 바꾸면 결과가 다시 반영됩니다.
          </p>
          <p className="sqlbind-privacy">
            입력한 내용과 생성 SQL은 앱 안에서만 처리되며 외부로 전송되지 않습니다.
          </p>

          <label className="field-label" htmlFor="sqlbind-db">
            데이터베이스
          </label>
          <select
            id="sqlbind-db"
            className="sqlbind-select"
            value={dbType}
            onChange={(e) => setDbType(e.target.value as DbType)}
          >
            <option value="oracle">Oracle</option>
            <option value="mysql">MySQL</option>
            <option value="postgresql">PostgreSQL</option>
          </select>

          <div className="sqlbind-log-header">
            <label className="field-label" htmlFor="sqlbind-log">
              통합 입력 (로그 붙여넣기)
            </label>
            <div className="sqlbind-actions">
              <button type="button" className="btn" onClick={() => applyFromLog()}>
                적용
              </button>
              <button type="button" className="btn" onClick={insertExampleLog}>
                예제 로그
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
              >
                불러오기
              </button>
              <button type="button" className="btn" onClick={clearAll}>
                모두 지우기
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".log,text/plain"
                className="sqlbind-file-input"
                onChange={onImportFileChange}
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          </div>
          <textarea
            id="sqlbind-log"
            className="sqlbind-textarea sqlbind-log"
            rows={5}
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            onPaste={onLogPaste}
            placeholder={
              "로그를 붙여넣으면 Executing Statement, Parameters, Types를 자동 추출합니다.\n" +
              "예:\n... Executing Statement: SELECT ... WHERE id=?\n... Parameters: [val1, val2]\n... Types: [java.lang.String, java.lang.String]"
            }
          />

          {importedUnits.length > 0 && (
            <div className="sqlbind-import-list" role="radiogroup" aria-label="불러온 로그 목록">
              <div className="sqlbind-import-header">
                <span className="field-label">
                  불러온 로그 ({importedUnits.length}건)
                </span>
                {importedFileName && (
                  <span className="sqlbind-import-filename" title={importedFileName}>
                    {importedFileName}
                  </span>
                )}
              </div>
              <ul className="sqlbind-import-items">
                {importedUnits.map((unit) => (
                  <li key={unit.id}>
                    <label className="sqlbind-import-item">
                      <input
                        type="radio"
                        name="sqlbind-imported-unit"
                        checked={selectedUnitId === unit.id}
                        onChange={() => selectImportedUnit(unit)}
                      />
                      <span className="sqlbind-import-label" title={unit.label}>
                        {unit.label}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <hr className="sqlbind-divider" />

          <div className="sqlbind-label-row">
            <label className="field-label" htmlFor="sqlbind-sql">
              SQL 쿼리
            </label>
            <span className="sqlbind-count">플레이스홀더 ? : {placeholderCount}개</span>
          </div>
          <textarea
            id="sqlbind-sql"
            className="sqlbind-textarea sqlbind-sql"
            rows={8}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT * FROM emp WHERE name=? AND birthdate=?"
          />

          <label className="field-label" htmlFor="sqlbind-params">
            파라미터
          </label>
          <textarea
            id="sqlbind-params"
            className="sqlbind-textarea sqlbind-params"
            rows={4}
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            placeholder="[JOHN, 2025-10-16 08:45:56.0]"
          />

          <label className="field-label" htmlFor="sqlbind-types">
            Java 타입 (선택)
          </label>
          <textarea
            id="sqlbind-types"
            className="sqlbind-textarea sqlbind-types"
            rows={4}
            value={typesText}
            onChange={(e) => setTypesText(e.target.value)}
            placeholder="[java.lang.String, java.util.Date]"
          />
          <p className="sqlbind-help">타입을 생략하면 모든 파라미터는 텍스트로 처리됩니다.</p>

          <div className="sqlbind-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => parseParameters()}
            >
              파라미터 파싱
            </button>
          </div>

          {status && <div className="msg ok sqlbind-msg">{status}</div>}
          {error && <div className="msg error sqlbind-msg">{error}</div>}

          {parsedParams.length > 0 && (
            <div className="sqlbind-param-list">
              <h4>파라미터 목록</h4>
              <p className="sqlbind-help">
                값을 수정한 뒤 <strong>바인딩</strong>을 누르면 결과에 반영됩니다.
              </p>
              <table className="sqlbind-table">
                <thead>
                  <tr>
                    <th>순번</th>
                    <th>값</th>
                    <th>SQL 타입</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedParams.map((param, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>
                        <input
                          className="sqlbind-param-input"
                          type="text"
                          value={param.value}
                          aria-label={`파라미터 ${index + 1} 값`}
                          onChange={(e) => updateParamValue(index, e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="sqlbind-select"
                          value={param.type}
                          aria-label={`파라미터 ${index + 1} 타입`}
                          onChange={(e) =>
                            updateParamType(index, e.target.value as SqlParamType)
                          }
                        >
                          <option value="text">텍스트</option>
                          <option value="number">숫자</option>
                          <option value="date">날짜</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sqlbind-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => runBind(parsedParams, sql, dbType)}
                >
                  바인딩
                </button>
              </div>
            </div>
          )}

          {resultSql && (
            <div className="sqlbind-result">
              <div className="sqlbind-result-header">
                <h4>바인딩 결과</h4>
                <div className="sqlbind-actions">
                  <button type="button" className="btn primary" onClick={() => void copyResult()}>
                    {copyLabel}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={scrollToTop}
                    title="맨 위로"
                  >
                    ↑
                  </button>
                </div>
              </div>
              <textarea
                ref={resultRef}
                className="sqlbind-textarea sqlbind-result-output"
                readOnly
                rows={6}
                value={resultSql}
                aria-label="바인딩된 SQL 결과"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
