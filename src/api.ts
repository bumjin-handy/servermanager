import { invoke } from "@tauri-apps/api/core";
import type {
  Favorite,
  FavoriteType,
  AppSettingsView,
  RemoteFileEntry,
  RemoteTextContent,
  Server,
  AuthType,
  CredentialSource,
} from "./types";

export const SECRET_REQUIRED = "SECRET_REQUIRED";

export const api = {
  listServers: () => invoke<Server[]>("list_servers"),
  upsertServer: (input: {
    id?: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: AuthType;
    credentialSource: CredentialSource;
    envFilePath: string;
    envKey: string;
    infisicalProjectId: string;
    infisicalEnv: string;
    infisicalSecretPath: string;
    infisicalSecretName: string;
  }) => invoke<{ server: Server }>("upsert_server", { input }),
  deleteServer: (id: string) => invoke<void>("delete_server", { id }),
  saveLogCollectPaths: (serverId: string, paths: string[]) =>
    invoke<Server>("save_log_collect_paths", { serverId, paths }),

  setSessionSecret: (serverId: string, secret: string) =>
    invoke<void>("set_session_secret", { serverId, secret }),
  clearSessionSecret: (serverId: string) =>
    invoke<void>("clear_session_secret", { serverId }),
  hasSessionSecret: (serverId: string) =>
    invoke<boolean>("has_session_secret", { serverId }),

  listFavorites: (serverId: string) =>
    invoke<Favorite[]>("list_favorites", { serverId }),
  upsertFavorite: (input: {
    id?: string;
    serverId: string;
    type: FavoriteType;
    label: string;
    value: string;
    sortOrder: number;
  }) => invoke<Favorite>("upsert_favorite", { input }),
  deleteFavorite: (id: string) => invoke<void>("delete_favorite", { id }),

  getAppSettings: () => invoke<AppSettingsView>("get_app_settings"),
  saveAppSettings: (input: {
    defaultEnvDir: string;
    siteUrl: string;
    clientId: string;
    projectId: string;
    environment: string;
    clientSecret?: string;
  }) => invoke<void>("save_app_settings", { input }),
  suggestEnvPath: (serverName: string, host?: string) =>
    invoke<string>("suggest_env_path", { serverName, host: host ?? null }),
  testEnvFile: (path: string) => invoke<string>("test_env_file", { path }),
  testInfisicalConnection: () => invoke<void>("test_infisical_connection"),

  sshOpen: (serverId: string, sessionId: string, cols: number, rows: number) =>
    invoke<void>("ssh_open", { serverId, sessionId, cols, rows }),
  sshWrite: (sessionId: string, data: string) =>
    invoke<void>("ssh_write", { sessionId, data }),
  sshResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("ssh_resize", { sessionId, cols, rows }),
  sshClose: (sessionId: string) => invoke<void>("ssh_close", { sessionId }),

  sftpOpen: (serverId: string) => invoke<void>("sftp_open", { serverId }),
  sftpClose: (serverId: string) => invoke<void>("sftp_close", { serverId }),
  sftpHome: (serverId: string) => invoke<string>("sftp_home", { serverId }),
  sftpList: (serverId: string, path: string) =>
    invoke<RemoteFileEntry[]>("sftp_list", { serverId, path }),
  sftpReadText: (serverId: string, path: string) =>
    invoke<RemoteTextContent>("sftp_read_text", { serverId, path }),
  sftpDownload: (serverId: string, remotePath: string, localPath: string) =>
    invoke<void>("sftp_download", { serverId, remotePath, localPath }),
  sftpUpload: (serverId: string, localPath: string, remotePath: string) =>
    invoke<void>("sftp_upload", { serverId, localPath, remotePath }),
  parentRemotePath: (path: string) =>
    invoke<string>("parent_remote_path", { path }),
  localHome: () => invoke<string>("local_home"),
  localMkdir: (path: string) => invoke<void>("local_mkdir", { path }),
  localDrives: () => invoke<RemoteFileEntry[]>("local_drives"),
  localList: (path: string) =>
    invoke<RemoteFileEntry[]>("local_list", { path }),
  localParent: (path: string) => invoke<string>("local_parent", { path }),
};

export function isSecretRequired(error: unknown) {
  return String(error) === SECRET_REQUIRED;
}

export const AUTH_FAILED = "AUTH_FAILED";

export function isAuthFailed(error: unknown) {
  return String(error).includes(AUTH_FAILED);
}

let promptHandler: ((label: string) => Promise<string>) | null = null;

export function registerPromptHandler(handler: (label: string) => Promise<string>) {
  promptHandler = handler;
}

export async function promptForSessionSecret(serverId: string, label = "SSH 암호 또는 개인키") {
  if (promptHandler) {
    try {
      const secret = await promptHandler(label);
      await api.setSessionSecret(serverId, secret);
      return;
    } catch (err) {
      throw new Error("자격 증명 입력이 취소되었습니다.");
    }
  }

  const secret = window.prompt(`${label}를 입력하세요.\n입력값은 현재 앱 실행 중 메모리에만 저장됩니다.`);
  if (!secret?.trim()) {
    throw new Error("자격 증명 입력이 취소되었습니다.");
  }
  await api.setSessionSecret(serverId, secret);
}

export async function runWithSessionSecret<T>(
  serverId: string,
  action: () => Promise<T>,
  label?: string,
): Promise<T> {
  let attempt = 0;
  const maxAttempts = 3;

  while (true) {
    try {
      return await action();
    } catch (e) {
      if (isSecretRequired(e)) {
        await promptForSessionSecret(serverId, label);
        continue;
      }

      if (isAuthFailed(e)) {
        attempt++;
        if (attempt >= maxAttempts) {
          await api.clearSessionSecret(serverId);
          throw new Error("SSH 인증 실패 횟수가 3회를 초과하였습니다.");
        }
        await api.clearSessionSecret(serverId);
        await promptForSessionSecret(
          serverId,
          `${label} (인증 실패, ${attempt}/${maxAttempts}회 재시도 중)`
        );
        continue;
      }

      throw e;
    }
  }
}