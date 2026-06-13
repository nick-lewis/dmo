# DMO Codex Notes

## Local Browser Verification

When using the Codex in-app browser for DMO, refresh the current localhost page
after frontend changes before judging the UI. The app commonly runs at
`http://localhost:5173/`.

If browser setup fails on Windows with `CreateProcessAsUserW failed: 5`, run:

```powershell
.\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge
```

This updates `%USERPROFILE%\.codex\config.toml` so `node_repl` starts with
`--disable-sandbox`, creates a timestamped config backup, and stops the running
bridge so Codex can reconnect. The same recovery path is documented in
`docs/verification.md`.
