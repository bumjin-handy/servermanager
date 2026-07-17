# AGENTS.md — Server Manager

## Mission

Tauri 2 + React SSH Server Manager. Credentials default to **`.env`**; **Infisical is optional** per server.

## Hard rules

- Each server has its own `.env` file path (`envFilePath`). Do not use one shared global secrets file for all servers.
- Do not persist decrypted passwords or private keys in `store.json` or logs.
- SSH/SFTP only in Rust. Frontend uses xterm.js + Tauri events/commands.
- Do not commit unless the user explicitly asks.
