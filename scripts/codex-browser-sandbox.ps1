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

function Get-NodeReplEnvSectionMatch {
    param([string]$Text)

    return [regex]::Match(
        $Text,
        "(?ms)^\[mcp_servers\.node_repl\.env\]\r?\n.*?(?=^\[|\z)"
    )
}

function ConvertFrom-TomlScalar {
    param([string]$Value)

    $trimmed = $Value.Trim()
    if (
        ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'")) -or
        ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"'))
    ) {
        return $trimmed.Substring(1, $trimmed.Length - 2)
    }

    return $trimmed
}

function Get-ConfigScalar {
    param(
        [string]$Section,
        [string]$Key
    )

    $match = [regex]::Match(
        $Section,
        "(?m)^$([regex]::Escape($Key))\s*=\s*(?<value>.+)$"
    )

    if (-not $match.Success) {
        return $null
    }

    return ConvertFrom-TomlScalar -Value $match.Groups["value"].Value
}

function Get-NodeReplEnv {
    param([string]$Section)

    $env = [ordered]@{}
    foreach ($line in ($Section -split "\r?\n")) {
        $match = [regex]::Match(
            $line,
            '^(?<key>[A-Z0-9_]+)\s*=\s*(?<value>.+)$'
        )
        if ($match.Success) {
            $env[$match.Groups["key"].Value] = ConvertFrom-TomlScalar -Value $match.Groups["value"].Value
        }
    }

    return $env
}

function Invoke-NativeCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Register-NodeReplDisableSandbox {
    param(
        [string]$CodexPath,
        [string]$NodeReplPath,
        [System.Collections.IDictionary]$Env
    )

    $arguments = @("mcp", "add", "node_repl")
    foreach ($item in $Env.GetEnumerator()) {
        $arguments += "--env"
        $arguments += "$($item.Key)=$($item.Value)"
    }

    $arguments += "--"
    $arguments += $NodeReplPath
    $arguments += "--disable-sandbox"

    Invoke-NativeCommand -FilePath $CodexPath -Arguments $arguments
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
$envSectionMatch = Get-NodeReplEnvSectionMatch -Text $text

if (-not $envSectionMatch.Success) {
    throw "Could not find [mcp_servers.node_repl.env] in $ConfigPath."
}

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

$nodeReplPath = Get-ConfigScalar -Section $section -Key "command"
if (-not $nodeReplPath) {
    throw "Could not read node_repl command from $ConfigPath."
}

$nodeReplEnv = Get-NodeReplEnv -Section $envSectionMatch.Value
$codexPath = $nodeReplEnv["CODEX_CLI_PATH"]
if (-not $codexPath) {
    $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $codexCommand) {
        throw "Could not find CODEX_CLI_PATH in config or codex on PATH."
    }
    $codexPath = $codexCommand.Source
}

if (-not (Test-Path -LiteralPath $codexPath)) {
    throw "Codex CLI not found: $codexPath"
}

if (-not (Test-Path -LiteralPath $nodeReplPath)) {
    throw "node_repl executable not found: $nodeReplPath"
}

$backupPath = "$ConfigPath.bak-node-repl-disable-sandbox-$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item -LiteralPath $ConfigPath -Destination $backupPath

Register-NodeReplDisableSandbox -CodexPath $codexPath -NodeReplPath $nodeReplPath -Env $nodeReplEnv
Write-Host "Registered node_repl with --disable-sandbox through Codex CLI."
Write-Host "Backed up original config to $backupPath"

if ($RestartBridge) {
    Stop-NodeReplBridge
}
