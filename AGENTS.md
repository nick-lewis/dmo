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
Codex CLI with `--disable-sandbox` plus `DISABLE_SANDBOX=1`, creates a
timestamped config backup, and stops the running bridge so Codex can reconnect.
The same recovery path is documented in `docs/verification.md`.

If the current thread keeps returning `Transport closed` immediately after the
bridge restart, the config is already fixed but the thread still has the dead
bridge handle. Reopen this thread, or create/open another thread, while Codex
Desktop stays open. Do not restart Codex Desktop after applying the fix until
the browser bridge has reconnected; Desktop startup can regenerate the MCP entry.
