param(
    [switch]$Apply,
    [switch]$RestartBridge,
    [string]$ConfigPath = (Join-Path $env:USERPROFILE ".codex\config.toml")
)

$ErrorActionPreference = "Stop"

function Get-NodeReplSectionMatch {
    param([string]$Text)

    return [regex]::Match(
        $Text,
        "(?ms)^\[mcp_servers\.node_repl\]\r?\n.*?(?=^\[|\z)"
    )
}

function Stop-NodeReplBridge {
    $ids = @(Get-Process node_repl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if ($ids.Count -eq 0) {
        Write-Host "No node_repl processes running."
        return
    }

    Write-Host "Stopping node_repl: $($ids -join ', ')"
    Stop-Process -Id $ids -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Codex config not found: $ConfigPath"
}

$text = Get-Content -LiteralPath $ConfigPath -Raw
$sectionMatch = Get-NodeReplSectionMatch -Text $text

if (-not $sectionMatch.Success) {
    throw "Could not find [mcp_servers.node_repl] in $ConfigPath."
}

$section = $sectionMatch.Value
$fixedPattern = '(?m)^args\s*=\s*\["--disable-sandbox"\]\s*$'

if ($section -match $fixedPattern) {
    Write-Host "Codex node_repl sandbox workaround is already configured."
    if ($RestartBridge) {
        Stop-NodeReplBridge
    }
    exit 0
}

Write-Host "Codex node_repl sandbox workaround is not configured."
Write-Host "Symptom: browser setup fails with 'CreateProcessAsUserW failed: 5'."

if (-not $Apply) {
    Write-Host ""
    Write-Host "To apply the persistent fix:"
    Write-Host "  .\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge"
    exit 2
}

$replacementLine = 'args = ["--disable-sandbox"]'

if ($section -match '(?m)^args\s*=') {
    $patchedSection = [regex]::Replace($section, '(?m)^args\s*=.*$', $replacementLine, 1)
} else {
    $patchedSection = [regex]::Replace(
        $section,
        '(^\[mcp_servers\.node_repl\]\r?\n)',
        "`$1$replacementLine`r`n",
        1
    )
}

$backupPath = "$ConfigPath.bak-node-repl-disable-sandbox-$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item -LiteralPath $ConfigPath -Destination $backupPath

$patchedText = $text.Substring(0, $sectionMatch.Index) +
    $patchedSection +
    $text.Substring($sectionMatch.Index + $sectionMatch.Length)

Set-Content -LiteralPath $ConfigPath -Value $patchedText -NoNewline

Write-Host "Applied node_repl --disable-sandbox workaround."
Write-Host "Backed up original config to $backupPath"

if ($RestartBridge) {
    Stop-NodeReplBridge
}
