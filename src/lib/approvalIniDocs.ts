import * as XLSX from "xlsx";

export type IniRow = Record<string, string>;

export type IniSheet = {
  id: string;
  name: string;
  title: string;
  intro: string[];
  columns: string[];
  sections: { title: string; rowIndex: number }[];
  rows: IniRow[];
};

export type IniDocs = {
  source: string;
  sheets: IniSheet[];
};

const SKIP = new Set(["XXXXXX", "Sheet1"]);

function cell(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function trimRow(row: unknown[]): string[] {
  const vals = row.map(cell);
  while (vals.length && vals[vals.length - 1] === "") vals.pop();
  return vals;
}

function sheetRows(ws: XLSX.WorkSheet): string[][] {
  const raw = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  });
  return raw.map((r) => trimRow(r as unknown[])).filter((r) => r.some(Boolean));
}

function parseConfigSheet(name: string, raw: string[][]): IniSheet {
  const columns = ["옵션명", "설정값", "설명", "Default", "Version", "비고"];
  let title = name;
  const intro: string[] = [];
  const rows: IniRow[] = [];
  const sections: { title: string; rowIndex: number }[] = [];
  let headerSeen = false;

  for (const r of raw) {
    if (!headerSeen) {
      if (r[0] === "옵션명") {
        headerSeen = true;
        continue;
      }
      if (r[0]) {
        if (title === name && r[0].length < 120) title = r[0];
        else intro.push(r[0]);
      }
      continue;
    }
    if (r[0] === "옵션명") continue;
    if (
      r[0] &&
      (r[0].includes("Section") || (r[0].startsWith("[") && r[0].includes("]")))
    ) {
      sections.push({ title: r[0], rowIndex: rows.length });
      continue;
    }
    const padded = [...r, "", "", "", "", "", ""].slice(0, 6);
    if (!padded.some(Boolean)) continue;
    rows.push({
      옵션명: padded[0],
      설정값: padded[1],
      설명: padded[2],
      Default: padded[3],
      Version: padded[4],
      비고: padded[5],
    });
  }

  return { id: name, name, title, intro, columns, sections, rows };
}

function parseRoleSheet(name: string, raw: string[][]): IniSheet {
  const title = "HSO 결재관련 권한별 역할";
  const columns = ["권한", "권한에 따른 역할", "메뉴", "기능", "기능권한"];
  const rows: IniRow[] = [];
  let headerSeen = false;
  let lastAuth = "";

  for (const r of raw) {
    if (!headerSeen) {
      if (r[1] === "권한") headerSeen = true;
      continue;
    }
    const auth = r[1] ?? "";
    const role = r[2] ?? "";
    const menu = r[3] ?? "";
    const feat = r[5] ?? "";
    const featAuth = r[6] ?? "";
    if (auth) lastAuth = auth;
    if (![auth, role, menu, feat, featAuth].some(Boolean)) continue;
    rows.push({
      권한: auth || lastAuth,
      "권한에 따른 역할": role,
      메뉴: menu,
      기능: feat,
      기능권한: featAuth,
    });
  }

  return { id: name, name, title, intro: [], columns, sections: [], rows };
}

function parseFormGuide(name: string, raw: string[][]): IniSheet {
  const title = "HSO 결재 서식 셀명";
  const columns = ["서식셀명", "영문셀명", "설명", "Version"];
  const rows: IniRow[] = [];
  let headerSeen = false;

  for (const r of raw) {
    if (!headerSeen) {
      if ((r[1] ?? "").includes("서식셀명")) headerSeen = true;
      continue;
    }
    const padded = [...r, "", "", "", "", ""].slice(0, 6);
    if (!padded[1] && !padded[2]) continue;
    rows.push({
      서식셀명: padded[1],
      영문셀명: padded[2],
      설명: padded[3],
      Version: padded[4],
    });
  }

  return { id: name, name, title, intro: [], columns, sections: [], rows };
}

function parseNotify(name: string, raw: string[][]): IniSheet {
  const title = "결재 알림 (노티파이)";
  const columns = ["알림종류", "알림대상", "알림내용", "내용보기", "지원버전", "기타"];
  const rows: IniRow[] = [];
  let headerSeen = false;

  for (const r of raw) {
    if (!headerSeen) {
      if ((r[1] ?? "").includes("알림") && (r[1] ?? "").includes("종류")) {
        headerSeen = true;
      }
      continue;
    }
    const padded = [...r, "", "", "", "", "", "", ""].slice(0, 8);
    if (!padded[1]) continue;
    rows.push({
      알림종류: padded[1],
      알림대상: padded[2],
      알림내용: padded[3],
      내용보기: padded[4],
      지원버전: padded[5],
      기타: padded[6],
    });
  }

  return { id: name, name, title, intro: [], columns, sections: [], rows };
}

function parseErrorCodes(name: string, raw: string[][]): IniSheet {
  const title = "Handy Groupware Error Code";
  const columns = ["오류번호", "심볼릭값", "의미및조치"];
  const rows: IniRow[] = [];
  const sections: { title: string; rowIndex: number }[] = [];
  let headerSeen = false;

  for (const r of raw) {
    if (!headerSeen) {
      if (r[0] === "오류번호") headerSeen = true;
      continue;
    }
    const padded = [...r, "", ""].slice(0, 3);
    if (!padded[0] && padded[1] && !padded[2]) {
      sections.push({ title: padded[1], rowIndex: rows.length });
      continue;
    }
    if (!padded[0] && !padded[1]) continue;
    rows.push({
      오류번호: padded[0],
      심볼릭값: padded[1],
      의미및조치: padded[2],
    });
  }

  return { id: name, name, title, intro: [], columns, sections, rows };
}

const CONFIG_SHEETS = new Set([
  "globals.properties",
  "jhomscfg.xml",
  "handydef.ini",
  "기타설정및가이드",
]);

/** Parse HANDY HSO Approval INI workbook bytes into searchable sheet docs. */
export function parseApprovalIniWorkbook(
  data: Uint8Array,
  sourceName: string,
): IniDocs {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const sheets: IniSheet[] = [];

  for (const name of wb.SheetNames) {
    if (SKIP.has(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const raw = sheetRows(ws);

    if (CONFIG_SHEETS.has(name)) {
      sheets.push(parseConfigSheet(name, raw));
    } else if (name === "권한별역할") {
      sheets.push(parseRoleSheet(name, raw));
    } else if (name === "서식Guide") {
      sheets.push(parseFormGuide(name, raw));
    } else if (name === "결재알림(노티파이)") {
      sheets.push(parseNotify(name, raw));
    } else if (name === "ErrorCode설명") {
      sheets.push(parseErrorCodes(name, raw));
    }
  }

  return { source: sourceName, sheets };
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
