# AGENTS.md — Server Manager

## Mission

Tauri 2 + React SSH Server Manager. Credentials default to **session memory** (prompt once per process); **Infisical is optional** per server. Per-server `.env` paths remain in the model for recommendation/validation.

## Hard rules

- Each server has its own `.env` file path (`envFilePath`) when `.env` is used. Do not use one shared global secrets file for all servers.
- Do not persist decrypted passwords or private keys in `store.json` or logs.
- SSH/SFTP only in Rust. Frontend uses xterm.js + Tauri events/commands.
- Do not commit unless the user explicitly asks.

## Product notes (keep docs in sync)

- Switching servers keeps per-server workspaces mounted; do not tear down SSH/SFTP on selection change.
- SQL Bind is client-side only (`src/lib/sqlBinder.ts` + `SqlBindPanel`); no Rust/network.
- Log download “open in editor” uses `open_local_with_editor` (Cursor / VS Code / EditPlus).
