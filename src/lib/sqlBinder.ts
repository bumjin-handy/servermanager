/** Java 타입 → SQL 타입 매핑 */
export const JAVA_TYPE_TO_SQL_TYPE: Record<string, SqlParamType> = {
  "java.lang.String": "text",
  "java.lang.Integer": "number",
  "java.lang.Long": "number",
  "java.lang.Short": "number",
  "java.lang.Double": "number",
  "java.lang.Float": "number",
  "java.math.BigDecimal": "number",
  "java.util.Date": "date",
  "java.sql.Date": "date",
  "java.sql.Timestamp": "date",
  "java.time.LocalDate": "date",
  "java.time.LocalDateTime": "date",
  "java.time.Instant": "date",
};

export type DbType = "oracle" | "mysql" | "postgresql";
export type SqlParamType = "text" | "number" | "date";

export interface ParsedLog {
  sql: string;
  parameters: string;
  types: string;
}

export interface LogStatementUnit {
  id: string;
  label: string;
  raw: string;
}

/** SQL 주석의 메서드명 + 쿼리 앞부분으로 라디오 라벨 생성 */
export function buildLogStatementLabel(sql: string, maxSqlLen = 60): string {
  const commentMatch = sql.match(/\/\*\s*([^*]+?)\s*\*\//);
  let method = "SQL";
  if (commentMatch) {
    const parts = commentMatch[1].trim().split(".");
    method = parts[parts.length - 1] || commentMatch[1].trim();
  }
  const withoutComment = normalizeSql(sql.replace(/\/\*[\s\S]*?\*\//g, " "));
  const preview =
    withoutComment.length > maxSqlLen
      ? `${withoutComment.slice(0, maxSqlLen)}…`
      : withoutComment;
  return preview ? `${method} — ${preview}` : method;
}

/**
 * dao 로그를 Executing Statement 단위로 분리.
 * 각 단위 raw는 parseLogText / 통합 입력과 호환된다.
 */
export function splitLogStatements(text: string): LogStatementUnit[] {
  const lines = text.split(/\r?\n/);
  const execStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Executing Statement:")) execStarts.push(i);
  }

  const units: LogStatementUnit[] = [];
  for (let u = 0; u < execStarts.length; u++) {
    const start = execStarts[u];
    const hardEnd = u + 1 < execStarts.length ? execStarts[u + 1] : lines.length;
    let end = start + 1;

    for (let i = start + 1; i < hardEnd; i++) {
      const line = lines[i];
      if (
        line.includes("Preparing Statement:") ||
        line.includes("} Connection") ||
        /\{\s*conn-\d+\s*\}\s*Connection\b/.test(line) ||
        line.includes("ResultSet")
      ) {
        break;
      }

      if (line.includes("Parameters:") || line.includes("Types:")) {
        const key = line.includes("Parameters:") ? "Parameters:" : "Types:";
        const idx = line.indexOf(key);
        const rest = [line.substring(idx + key.length), ...lines.slice(i + 1, hardEnd)].join(
          "\n",
        );
        const arr = extractArrayContent(rest);
        if (!arr) {
          end = i + 1;
          continue;
        }
        // 배열이 차지하는 줄 수만큼 end 확장
        const prefix = line.substring(0, idx + key.length);
        const consumed = `${prefix}${arr}`;
        const consumedLines = consumed.split(/\r?\n/).length;
        end = Math.max(end, i + consumedLines);
        i = end - 1;
        continue;
      }
    }

    const raw = lines.slice(start, end).join("\n").trim();
    if (!raw) continue;
    const { sql } = parseLogText(raw);
    units.push({
      id: `stmt-${u}`,
      label: buildLogStatementLabel(sql || raw),
      raw,
    });
  }

  return units;
}

export interface BoundParam {
  value: string;
  type: SqlParamType;
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** 문자열에서 [ ... ] 배열 부분 추출 (여러 줄 지원) */
export function extractArrayContent(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("[");
  if (start === -1) return "";

  let depth = 0;
  let end = -1;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === "[") depth++;
    else if (trimmed[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return end >= 0 ? trimmed.substring(start, end + 1) : "";
}

/** 로그 텍스트에서 Executing Statement, Parameters, Types 추출 */
export function parseLogText(text: string): ParsedLog {
  const lines = text.split(/\r?\n/);
  let sql = "";
  let parameters = "";
  let types = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("Executing Statement:")) {
      const idx = line.indexOf("Executing Statement:");
      const extracted = line.substring(idx + "Executing Statement:".length).trim();
      sql = normalizeSql(extracted);
    } else if (line.includes("Parameters:")) {
      const idx = line.indexOf("Parameters:");
      const rest = [line.substring(idx + "Parameters:".length), ...lines.slice(i + 1)].join(
        "\n",
      );
      parameters = extractArrayContent(rest);
    } else if (line.includes("Types:")) {
      const idx = line.indexOf("Types:");
      const rest = [line.substring(idx + "Types:".length), ...lines.slice(i + 1)].join("\n");
      types = extractArrayContent(rest);
    }
  }

  return { sql, parameters, types };
}

export function parseParameterString(paramText: string): string[] {
  const cleaned = paramText.replace(/^\[|\]$/g, "").trim();
  if (!cleaned) return [];

  const params: string[] = [];
  let i = 0;
  let current = "";

  while (i < cleaned.length) {
    const c = cleaned[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < cleaned.length && cleaned[i] !== quote) {
        if (cleaned[i] === "\\" && i + 1 < cleaned.length) {
          i++;
          current += cleaned[i];
        } else {
          current += cleaned[i];
        }
        i++;
      }
      if (i < cleaned.length) i++;
      params.push(current.trim());
      current = "";
    } else if (c === ",") {
      if (current) {
        params.push(current.trim());
        current = "";
      }
      i++;
    } else {
      current += c;
      i++;
    }
  }
  if (current) params.push(current.trim());
  return params.filter((p) => p !== "");
}

export function parseTypesString(typesText: string): string[] {
  const cleaned = typesText.replace(/^\[|\]$/g, "");
  return cleaned
    .split(",")
    .map((type) => type.trim())
    .filter((type) => type !== "");
}

export function mapJavaTypeToSqlType(javaType: string | undefined): SqlParamType {
  return JAVA_TYPE_TO_SQL_TYPE[javaType?.trim() ?? ""] || "text";
}

export function formatDateParameter(param: string, dbType: DbType): string {
  const dateStr = param.trim();

  const datetimeRegex =
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
  const datetimeMatch = dateStr.match(datetimeRegex);

  const dateOnlyRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dateOnlyMatch = dateStr.match(dateOnlyRegex);

  if (datetimeMatch) {
    const [, year, month, day, hour, minute, second] = datetimeMatch;
    const normalized = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    if (dbType === "oracle") {
      return `TO_DATE('${normalized}', 'YYYY-MM-DD HH24:MI:SS')`;
    }
    if (dbType === "mysql") {
      return `STR_TO_DATE('${normalized}', '%Y-%m-%d %H:%i:%s')`;
    }
    if (dbType === "postgresql") {
      return `TIMESTAMP '${normalized}'`;
    }
    return `'${normalized}'`;
  }

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const normalized = `${year}-${month}-${day}`;
    if (dbType === "oracle") {
      return `TO_DATE('${normalized}', 'YYYY-MM-DD')`;
    }
    if (dbType === "mysql") {
      return `STR_TO_DATE('${normalized}', '%Y-%m-%d')`;
    }
    if (dbType === "postgresql") {
      return `DATE '${normalized}'`;
    }
    return `'${normalized}'`;
  }

  throw new Error(
    `날짜 형식이 올바르지 않습니다: ${dateStr}. 형식: YYYY-MM-DD 또는 YYYY-MM-DD HH:mm:ss`,
  );
}

export function formatParameter(
  param: string,
  type: SqlParamType,
  dbType: DbType,
): string {
  switch (type) {
    case "text":
      return `'${String(param).replace(/'/g, "''")}'`;
    case "number": {
      const numParam = String(param).trim();
      if (numParam === "" || Number.isNaN(Number(numParam))) {
        throw new Error(`파라미터 "${param}"는 유효한 숫자가 아닙니다.`);
      }
      return numParam;
    }
    case "date":
      return formatDateParameter(String(param).trim(), dbType);
    default:
      return `'${String(param).replace(/'/g, "''")}'`;
  }
}

export function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) || []).length;
}

export function bindSql(sql: string, params: BoundParam[], dbType: DbType): string {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => {
    const param = params[paramIndex];
    if (!param) {
      throw new Error("바인딩할 파라미터가 부족합니다.");
    }
    const bound = formatParameter(param.value, param.type, dbType);
    paramIndex++;
    return bound;
  });
}

export function buildBoundParams(
  values: string[],
  javaTypes: string[] = [],
): BoundParam[] {
  return values.map((value, index) => ({
    value,
    type: javaTypes.length > index ? mapJavaTypeToSqlType(javaTypes[index]) : "text",
  }));
}

export const EXAMPLE_LOG = `2026-04-16 18:17:26,769 DEBUG main31 {pstm-103402} Executing Statement: /* com.hs.gw.service.fldr.dao.AnsiFldrFindDAO.getFldrID */ SELECT FLDRID FROM ( SELECT F.FLDRID FROM FOLDER F WHERE F.OWNERTYPE = ? AND F.OWNERID = ? AND F.APPLID = ? ORDER BY F.FLDRID ) WHERE ROWNUM = 1
2026-04-16 18:17:26,770 DEBUG main31 {pstm-103402} Parameters: [3, 000000601, 1010]
2026-04-16 18:17:26,770 DEBUG main31 {pstm-103402} Types: [java.lang.String, java.lang.String, java.lang.Integer]`;
