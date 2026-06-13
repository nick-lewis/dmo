# DMO Codex Notes

## Browser Bridge First Aid

If the user says the in-app browser, Browser plugin, or `node_repl` is broken,
do this first before debugging anything else:

```powershell
.\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge
```

Then smoke test the bridge:

```javascript
nodeRepl.write(JSON.stringify({ ok: true, cwd: nodeRepl.cwd }))
```

Known failure text includes `CreateProcessAsUserW failed: 5` and
`Transport closed`. The durable fix is the ACL repair in
`scripts/codex-browser-sandbox.ps1`: it grants the local `CodexSandboxUsers`
group read/execute access on the active Codex Desktop `cua_node` runtime.

Do not start by replacing `node_repl.exe`, relying on `DISABLE_SANDBOX=1`, or
re-registering `node_repl` through Codex CLI. Those paths were tested and were
not durable. If the current thread still says `Transport closed` after the
script runs, open or fork a fresh same-directory thread because the old thread
may still hold the dead bridge handle.

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
