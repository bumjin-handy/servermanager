# AGENTS.md — Server Manager

## Mission

Tauri 2 + React SSH Server Manager. Credentials are stored in **session memory only** (prompt once per process). No persistent secrets in `store.json`.

## Hard rules

- Do not persist decrypted passwords or private keys in `store.json` or logs.
- SSH/SFTP only in Rust. Frontend uses xterm.js + Tauri events/commands.
- Do not commit unless the user explicitly asks.

## Product notes (keep docs in sync)

- Switching servers keeps per-server workspaces mounted; do not tear down SSH/SFTP on selection change.
- SQL Bind is client-side only (`src/lib/sqlBinder.ts` + `SqlBindPanel`); no Rust/network.
- Approval INI docs: user-selected local xlsx path in `store.json` only; do not commit the Excel/JSON (`ApprovalIniDocsPanel` + `approvalIniDocs.ts`).
- Log download "open in editor" uses `open_local_with_editor` (Cursor / VS Code / EditPlus).