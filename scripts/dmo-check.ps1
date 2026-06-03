param(
    [switch]$NoStart,
    [switch]$SkipFrontend,
    [switch]$SkipBackendTests
)

$ErrorActionPreference = "Stop"

function Invoke-DmoCheckStep {
    param(
        [string]$Name,
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "==> $Name"
    & $Script
    Write-Host "OK: $Name"
}

function Invoke-DmoNativeCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not $NoStart) {
    Invoke-DmoCheckStep "Start Docker services" {
        Invoke-DmoNativeCommand "docker" @("compose", "up", "-d")
    }
}

Invoke-DmoCheckStep "Git whitespace check" {
    Invoke-DmoNativeCommand "git" @("diff", "--check")
}

if (-not $SkipFrontend) {
    Invoke-DmoCheckStep "Frontend TypeScript and production build" {
        Invoke-DmoNativeCommand "docker" @(
            "compose",
            "exec",
            "-T",
            "frontend",
            "npm",
            "run",
            "build"
        )
    }
}

Invoke-DmoCheckStep "Django system check" {
    Invoke-DmoNativeCommand "docker" @(
        "compose",
        "exec",
        "-T",
        "backend",
        "python",
        "manage.py",
        "check"
    )
}

Invoke-DmoCheckStep "Django migration drift check" {
    Invoke-DmoNativeCommand "docker" @(
        "compose",
        "exec",
        "-T",
        "backend",
        "python",
        "manage.py",
        "makemigrations",
        "--check",
        "--dry-run"
    )
}

Invoke-DmoCheckStep "Python compile smoke" {
    Invoke-DmoNativeCommand "docker" @(
        "compose",
        "exec",
        "-T",
        "backend",
        "python",
        "-m",
        "compileall",
        "-q",
        "core",
        "dmo_5_2026"
    )
}

if (-not $SkipBackendTests) {
    Invoke-DmoCheckStep "Django test suite" {
        Invoke-DmoNativeCommand "docker" @(
            "compose",
            "exec",
            "-T",
            "backend",
            "python",
            "manage.py",
            "test"
        )
    }
}

Write-Host ""
Write-Host "DMO verification passed."
