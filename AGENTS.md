# AGENTS.md — Server Manager

## Mission

Tauri 2 + React SSH Server Manager. Credentials are stored in **session memory only** (prompt once per process). No persistent secrets in `store.json`.

## Hard rules

- Do not persist decrypted passwords or private keys in `store.json` or logs.
- SSH/SFTP only in Rust. Frontend uses xterm.js + Tauri events/commands.
- Do not commit unless the user explicitly asks.

## Product notes (keep docs in sync)

- Switching servers keeps per-server workspaces mounted; do not tear down SSH/SFTP on selection change.
- Toolbar: **Tool ▾** (로컬 탐색기, 파일 관리자, SQL Bind, 결재Tool, 결재INI설명), **Config**, **AI**, **로그 ▾** (로그수집, 로그 뷰어), **설정 ▾** (앱 설정, 연결 프로그램 관리). Overlays are mutually exclusive per server.
- Log viewer (`RemoteLogViewer`): hidden SSH `tail -F`, search/level filter, **로그선택** with checkboxes; copy/save/SQL Bind via context menu on the strip between checkbox and line number.
- Log viewer → SQL Bind: selected lines copied and passed as `initialLogText` to `SqlBindPanel`.
- SQL Bind is client-side only (`src/lib/sqlBinder.ts` + `SqlBindPanel`); no Rust/network. Binding result shown below integrated input; **연결 프로그램** opens temp file via registered local programs (`src/lib/linkedPrograms.ts`, `LinkedProgramModal`). On launch failure, show picker to assign executable; manage via **설정 ▾ → 연결 프로그램 관리**.
- Linked programs: presets (vscode/dbeaver/cursor/editplus) + custom entries in `store.json` `linkedPrograms`; Rust `open_local_with_program` / preset `open_local_with_editor`.
- Approval INI docs: user-selected local xlsx path in `store.json` only; do not commit the Excel/JSON (`ApprovalIniDocsPanel` + `approvalIniDocs.ts`).
- Log download / log collect "open in editor" uses `open_local_with_editor` (Cursor / VS Code / EditPlus / DBeaver).
- AI chat: OpenAI-compatible HTTP in Rust (`ai.rs`); API key session-only (not in `store.json`). Base URL/model in settings. Per-server overlay; attachments use SFTP read.
- Config panel: remote SFTP config browser/editor; `configPath` favorites; `.properties` native↔ASCII via `propertiesNativeAscii.ts`.
- Docs: keep `README.md` and `docs/SPEC.md` aligned when adding or changing user-facing features.
