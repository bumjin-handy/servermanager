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
  }) => invoke<{ server: Server; envFileCreated: boolean; envFilePath: string }>(
    "upsert_server",
    { input },
  ),
  deleteServer: (id: string) => invoke<void>("delete_server", { id }),
  saveLogCollectPaths: (serverId: string, paths: string[]) =>
    invoke<Server>("save_log_collect_paths", { serverId, paths }),

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
  suggestEnvPath: (serverName: string) =>
    invoke<string>("suggest_env_path", { serverName }),
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
