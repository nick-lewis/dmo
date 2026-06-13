# DMO Codex Notes

## Local Browser Verification

When using the Codex in-app browser for DMO, refresh the current localhost page
after frontend changes before judging the UI. The app commonly runs at
`http://localhost:5173/`.

If browser setup fails on Windows with `CreateProcessAsUserW failed: 5`, run:

```powershell
.\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge
```

This reads the current `node_repl` MCP command and environment from
`%USERPROFILE%\.codex\config.toml`, re-registers the MCP server through the
Codex CLI with `--disable-sandbox`, creates a timestamped config backup, and
stops the running bridge so Codex can reconnect. The same recovery path is
documented in `docs/verification.md`.

If the current thread keeps returning `Transport closed` immediately after the
restart, the config is already fixed but the thread still has the dead bridge
handle. Reopen the thread or restart Codex Desktop so the MCP server starts from
the updated config.
