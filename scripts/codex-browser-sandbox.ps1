param(
    [switch]$Apply,
    [switch]$RestartBridge,
    [string]$ConfigPath = (Join-Path $env:USERPROFILE ".codex\config.toml"),
    [string]$RuntimeRoot,
    [string]$SandboxGroup = "$env:COMPUTERNAME\CodexSandboxUsers"
)

$ErrorActionPreference = "Stop"

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

function Get-NodeReplEnvSectionMatch {
    param([string]$Text)

    return [regex]::Match(
        $Text,
        "(?ms)^\[mcp_servers\.node_repl\.env\]\r?\n.*?(?=^\[|\z)"
    )
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

function Get-RuntimeRootFromNodePath {
    param([string]$NodePath)

    if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) {
        return $null
    }

    $nodeFile = Get-Item -LiteralPath $NodePath
    if ($nodeFile.Directory -and $nodeFile.Directory.Parent) {
        return $nodeFile.Directory.Parent.FullName
    }

    return $null
}

function Get-ConfiguredRuntimeRoot {
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        return $null
    }

    $text = Get-Content -LiteralPath $ConfigPath -Raw
    $envSectionMatch = Get-NodeReplEnvSectionMatch -Text $text
    if (-not $envSectionMatch.Success) {
        return $null
    }

    $nodeReplEnv = Get-NodeReplEnv -Section $envSectionMatch.Value
    if (-not $nodeReplEnv.Contains("NODE_REPL_NODE_PATH")) {
        return $null
    }

    return Get-RuntimeRootFromNodePath -NodePath $nodeReplEnv["NODE_REPL_NODE_PATH"]
}

function Get-DiscoveredRuntimeRoot {
    $runtimeParent = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\runtimes\cua_node"
    if (-not (Test-Path -LiteralPath $runtimeParent)) {
        return $null
    }

    $candidate = Get-ChildItem -LiteralPath $runtimeParent -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\node.exe") } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($candidate) {
        return $candidate.FullName
    }

    return $null
}

function Resolve-RuntimeRoot {
    if ($RuntimeRoot) {
        if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot "bin\node.exe"))) {
            throw "RuntimeRoot does not contain bin\node.exe: $RuntimeRoot"
        }
        return (Resolve-Path -LiteralPath $RuntimeRoot).Path
    }

    $configured = Get-ConfiguredRuntimeRoot
    if ($configured) {
        return $configured
    }

    $discovered = Get-DiscoveredRuntimeRoot
    if ($discovered) {
        return $discovered
    }

    throw "Could not find the Codex cua_node runtime. Pass -RuntimeRoot explicitly."
}

function Test-SandboxRuntimeAccess {
    param([string]$Root)

    $nodePath = Join-Path $Root "bin\node.exe"
    if (-not (Test-Path -LiteralPath $nodePath)) {
        throw "node.exe not found: $nodePath"
    }

    $readExecute = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
    $acl = Get-Acl -LiteralPath $nodePath
    foreach ($ace in $acl.Access) {
        $identity = $ace.IdentityReference.Value
        $matchesSandboxGroup =
            $identity -eq $SandboxGroup -or
            $identity -like "*\CodexSandboxUsers"
        $hasReadExecute = ($ace.FileSystemRights -band $readExecute) -eq $readExecute

        if (
            $matchesSandboxGroup -and
            $ace.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $hasReadExecute
        ) {
            return $true
        }
    }

    return $false
}

function Grant-SandboxRuntimeAccess {
    param([string]$Root)

    $runtimeName = Split-Path -Leaf $Root
    $backupPath = Join-Path ([System.IO.Path]::GetTempPath()) "codex-cua-node-acl-$runtimeName-$(Get-Date -Format 'yyyyMMddHHmmss').txt"

    Write-Host "Backing up ACLs to $backupPath"
    & icacls.exe $Root /save $backupPath /T /Q
    if ($LASTEXITCODE -ne 0) {
        throw "icacls backup failed with exit code $LASTEXITCODE."
    }

    Write-Host "Granting $SandboxGroup read/execute on $Root"
    & icacls.exe $Root /grant "${SandboxGroup}:(OI)(CI)RX" /T /C /Q
    if ($LASTEXITCODE -ne 0) {
        throw "icacls grant failed with exit code $LASTEXITCODE."
    }
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

function Write-ReconnectNote {
    Write-Host ""
    Write-Host "Next step: reopen this thread, or create/open another thread, without restarting Codex Desktop."
    Write-Host "If the current thread still says 'Transport closed', it is holding the old dead bridge handle."
    Write-Host "After frontend changes, refresh the local app page before judging the UI."
}

$resolvedRuntimeRoot = Resolve-RuntimeRoot
$nodePath = Join-Path $resolvedRuntimeRoot "bin\node.exe"
$hasAccess = Test-SandboxRuntimeAccess -Root $resolvedRuntimeRoot

Write-Host "Codex cua_node runtime: $resolvedRuntimeRoot"
Write-Host "Sandbox group: $SandboxGroup"

if ($hasAccess) {
    Write-Host "Codex node_repl sandbox ACL is already configured."
    if ($RestartBridge) {
        Stop-NodeReplBridge
        Write-ReconnectNote
    }
    exit 0
}

Write-Host "Codex node_repl sandbox ACL is not configured."
Write-Host "Symptom: browser setup fails with 'CreateProcessAsUserW failed: 5'."
Write-Host "Expected: $SandboxGroup has read/execute access on $nodePath."

if (-not $Apply) {
    Write-Host ""
    Write-Host "To apply the persistent fix:"
    Write-Host "  .\scripts\codex-browser-sandbox.ps1 -Apply -RestartBridge"
    exit 2
}

Grant-SandboxRuntimeAccess -Root $resolvedRuntimeRoot
Write-Host "Codex node_repl sandbox ACL repair applied."

if ($RestartBridge) {
    Stop-NodeReplBridge
    Write-ReconnectNote
}
