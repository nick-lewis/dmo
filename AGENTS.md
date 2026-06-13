# DMO Codex Notes

## Local Browser Verification

When using the Codex in-app browser for DMO, refresh the current localhost page
after frontend changes before judging the UI. The app commonly runs at
`http://localhost:5173/`.

If browser setup fails on Windows with `CreateProcessAsUserW failed: 5`, run:

```powershell
.\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge
```

This repairs the Windows ACL on the Codex Desktop `cua_node` runtime so the
local `CodexSandboxUsers` group can read/execute the bundled Node runtime used
by the in-app browser bridge. It backs up ACLs to `%TEMP%` and stops the running
bridge so Codex can reconnect. The same recovery path is documented in
`docs/verification.md`.

If the current thread keeps returning `Transport closed` immediately after the
bridge restart, the ACL is fixed but the thread still has the dead bridge
handle. Reopen this thread, or create/open another thread, while Codex Desktop
stays open. If Codex Desktop installs a new `cua_node` runtime hash later and
the error returns, run the recovery script again.
