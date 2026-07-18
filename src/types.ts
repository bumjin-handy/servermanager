export type AuthType = "password" | "privateKey";
export type CredentialSource = "env" | "infisical";
export type FavoriteType = "command" | "path" | "localPath" | "remotePath";

/** Path favorites for the local file-manager site (not tied to an SSH server). */
export const LOCAL_FAVORITES_SERVER_ID = "__local__";

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  credentialSource: CredentialSource;
  /** Legacy field; memory credentials do not use an env file. */
  envFilePath: string;
  envKey: string;
  infisicalProjectId: string;
  infisicalEnv: string;
  infisicalSecretPath: string;
  infisicalSecretName: string;
  /** Remote log paths for log-collect (`tail -f`), one path per entry */
  logCollectPaths: string[];
}

export interface Favorite {
  id: string;
  serverId: string;
  type: FavoriteType;
  label: string;
  value: string;
  sortOrder: number;
}

export interface AppSettingsView {
  defaultEnvDir: string;
  resolvedDefaultEnvDir: string;
  siteUrl: string;
  clientId: string;
  projectId: string;
  environment: string;
  clientSecretConfigured: boolean;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export type PaneKind = "terminal" | "files" | "favorites";

export interface WorkspacePane {
  id: string;
  kind: PaneKind;
  sessionId?: string;
  title: string;
}

export interface SshOutputEvent {
  sessionId: string;
  data: string;
}

export interface SshClosedEvent {
  sessionId: string;
  reason: string;
}

export interface TransferProgressEvent {
  transferId: string;
  bytes: number;
  total: number;
}

export interface RemoteTextContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}
