/**
 * 전자결재 OBJECTID → sancbox 경로 (APPROVAL 조회 SQL과 동일).
 *
 * SELECT '/home/egov/hoffice/sancbox/'
 *        || TO_CHAR (TO_DATE (SUBSTR (OBJECTID, 8, 3), 'DDD'), 'YYYY') || '/'
 *        || TO_NUMBER (TO_CHAR (TO_DATE (SUBSTR (OBJECTID, 8, 3), 'DDD'),'MM')) || '/'
 *        || TO_NUMBER (TO_CHAR (TO_DATE (SUBSTR (OBJECTID, 8, 3), 'DDD'),'DD')) || '/'
 *        || TO_NUMBER (TO_CHAR (SUBSTR (OBJECTID, 15, 3))) || '/'
 *        || SUBSTR (OBJECTID, 0, 18)||'*' FILE_PATH
 *   FROM APPROVAL
 *  WHERE OBJECTID = 'JHOMS260760022471000';
 *
 * → /home/egov/hoffice/sancbox/2026/3/17/471/JHOMS2607600224710*
 *
 * 연도는 SQL의 TO_DATE(DDD) 대신 OBJECTID의 YY(6~7자리)를 사용한다.
 * (문서 연도와 실행 연도가 다를 수 있으므로)
 */
export type SancboxPathInfo = {
  objectId: string;
  year: number;
  month: number;
  day: number;
  /** TO_NUMBER(SUBSTR(OBJECTID,15,3)) — 선행 0 제거 */
  folder: number;
  /** SUBSTR(OBJECTID,0,18) — 앞 18자 */
  filePrefix: string;
  /** 디렉터리 상대 경로: YYYY/M/D/folder */
  dirRelativePath: string;
  /** SQL FILE_PATH와 동일한 상대 패턴: YYYY/M/D/folder/prefix* */
  filePathPattern: string;
};

/** Oracle SUBSTR(str, pos, len) — 1-based, pos<=0 은 1로 취급 */
function oracleSubstr(str: string, pos: number, len: number): string {
  const start = Math.max(pos, 1) - 1;
  return str.slice(start, start + len);
}

function dayOfYearToMonthDay(year: number, dayOfYear: number): { month: number; day: number } {
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) {
    throw new Error(`유효하지 않은 연중 일수(DDD): ${dayOfYear}`);
  }
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  if (date.getUTCFullYear() !== year) {
    throw new Error(`연중 일수 ${dayOfYear}는 ${year}년에 존재하지 않습니다.`);
  }
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function parseSancboxPath(objectIdRaw: string): SancboxPathInfo {
  const objectId = objectIdRaw.trim();
  if (!objectId) {
    throw new Error("OBJECTID를 입력해주세요.");
  }
  if (objectId.length < 18) {
    throw new Error("OBJECTID는 최소 18자 이상이어야 합니다.");
  }

  // SUBSTR(OBJECTID, 6, 2) = YY, SUBSTR(OBJECTID, 8, 3) = DDD
  const yy = Number.parseInt(oracleSubstr(objectId, 6, 2), 10);
  const ddd = Number.parseInt(oracleSubstr(objectId, 8, 3), 10);
  if (!Number.isFinite(yy) || !Number.isFinite(ddd)) {
    throw new Error("OBJECTID에서 날짜(YYDDD)를 읽을 수 없습니다.");
  }

  // TO_NUMBER(SUBSTR(OBJECTID, 15, 3))
  const folderRaw = oracleSubstr(objectId, 15, 3);
  const folder = Number.parseInt(folderRaw, 10);
  if (!Number.isFinite(folder)) {
    throw new Error("OBJECTID에서 폴더 번호(15~17)를 읽을 수 없습니다.");
  }

  // SUBSTR(OBJECTID, 0, 18) — Oracle에서 0은 1과 동일
  const filePrefix = oracleSubstr(objectId, 0, 18);

  const year = 2000 + yy;
  const { month, day } = dayOfYearToMonthDay(year, ddd);
  const dirRelativePath = `${year}/${month}/${day}/${folder}`;
  const filePathPattern = `${dirRelativePath}/${filePrefix}*`;

  return {
    objectId,
    year,
    month,
    day,
    folder,
    filePrefix,
    dirRelativePath,
    filePathPattern,
  };
}

/** `$HOME/hoffice/sancbox/` + 상대 경로 (SQL의 /home/egov/... 와 동일 구조) */
export function buildSancboxAbsolutePath(homeDir: string, relativePath: string): string {
  const home = homeDir.trim().replace(/\/+$/, "");
  if (!home) {
    throw new Error("원격 $HOME을 확인할 수 없습니다.");
  }
  return `${home}/hoffice/sancbox/${relativePath.replace(/^\/+/, "")}`;
}

/** 파일명이 OBJECTID 앞 18자 접두사와 일치하는지 (SQL의 prefix*) */
export function matchesSancboxFilePrefix(fileName: string, filePrefix: string): boolean {
  return fileName.startsWith(filePrefix);
}
