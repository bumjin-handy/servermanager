import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { v4 as uuid } from "uuid";
import { api } from "../api";
import type { LinkedProgram, LinkedProgramPreset } from "../types";
import { toNativeLocalPath } from "../components/fileManagerShared";

export const DEFAULT_LINKED_PROGRAMS: LinkedProgram[] = [
  {
    id: "vscode",
    name: "VS Code",
    preset: "vscode",
    executablePath: "",
    argTemplate: "{path}",
  },
  {
    id: "dbeaver",
    name: "DBeaver",
    preset: "dbeaver",
    executablePath: "",
    argTemplate: "-f {path}",
  },
  {
    id: "cursor",
    name: "Cursor",
    preset: "cursor",
    executablePath: "",
    argTemplate: "{path}",
  },
  {
    id: "editplus",
    name: "EditPlus",
    preset: "editplus",
    executablePath: "",
    argTemplate: "{path}",
  },
];

const PRESET_IDS = new Set(DEFAULT_LINKED_PROGRAMS.map((p) => p.id));

export function isPresetLinkedProgram(program: LinkedProgram) {
  return PRESET_IDS.has(program.id);
}

export function mergeLinkedPrograms(saved: LinkedProgram[]): LinkedProgram[] {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const hiddenIds = new Set(saved.filter((p) => p.hidden).map((p) => p.id));
  const mergedDefaults = DEFAULT_LINKED_PROGRAMS.filter((d) => !hiddenIds.has(d.id)).map(
    (d) => {
      const override = byId.get(d.id);
      if (!override || override.hidden) return { ...d };
      return { ...d, ...override, hidden: undefined };
    },
  );
  const custom = saved.filter((p) => !PRESET_IDS.has(p.id) && !p.hidden);
  return [...mergedDefaults, ...custom];
}

export async function loadLinkedPrograms() {
  const saved = await api.listLinkedPrograms();
  return mergeLinkedPrograms(saved);
}

export async function persistLinkedPrograms(programs: LinkedProgram[]) {
  const saved = await api.saveLinkedPrograms(programs);
  return mergeLinkedPrograms(saved);
}

export function buildProgramArgs(template: string, filePath: string): string[] {
  const normalized = (template.trim() || "{path}").split(/\s+/).filter(Boolean);
  if (normalized.length === 0) return [filePath];
  return normalized.map((part) => (part === "{path}" ? filePath : part));
}

export async function pickExecutablePath(title = "실행 파일 선택") {
  const selected = await dialogOpen({
    directory: false,
    multiple: false,
    filters: [{ name: "Executable", extensions: ["exe", "cmd", "bat", ""] }],
    title,
  });
  if (typeof selected !== "string") return null;
  return toNativeLocalPath(selected);
}

export type OpenLinkedProgramResult =
  | { ok: true }
  | { ok: false; program: LinkedProgram; filePath: string; error: string };

export async function openWithLinkedProgram(
  program: LinkedProgram,
  filePath: string,
): Promise<OpenLinkedProgramResult> {
  const nativeFile = toNativeLocalPath(filePath);
  const args = buildProgramArgs(program.argTemplate, nativeFile);

  if (program.executablePath.trim()) {
    try {
      await api.openLocalWithProgram(
        nativeFile,
        toNativeLocalPath(program.executablePath),
        args,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, program, filePath, error: String(e) };
    }
  }

  if (program.preset) {
    try {
      await api.openLocalWithEditor(
        nativeFile,
        program.preset as LinkedProgramPreset,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, program, filePath, error: String(e) };
    }
  }

  return {
    ok: false,
    program,
    filePath,
    error: "실행 파일이 설정되지 않았습니다.",
  };
}

export function createCustomLinkedProgram(name: string, executablePath: string): LinkedProgram {
  return {
    id: uuid(),
    name: name.trim() || "사용자 프로그램",
    preset: "",
    executablePath,
    argTemplate: "{path}",
  };
}

export function programsForStore(programs: LinkedProgram[]): LinkedProgram[] {
  return programs
    .filter((p) => {
      if (p.hidden) return true;
      if (isPresetLinkedProgram(p)) return p.executablePath.trim() !== "";
      return true;
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      executablePath: p.executablePath.trim(),
      preset: p.preset,
      argTemplate: p.argTemplate.trim() || "{path}",
      hidden: Boolean(p.hidden),
    }));
}
