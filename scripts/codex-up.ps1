param(
    [switch]$Build,
    [switch]$CheckOnly,
    [switch]$Restart,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Wait-ForHttp {
    param(
        [string]$Name,
        [string]$Url,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "$Name ready ($($response.StatusCode)): $Url"
                return
            }
        } catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Seconds 2
    }

    if ($lastError) {
        throw "$Name did not become ready at $Url. Last error: $lastError"
    }

    throw "$Name did not become ready at $Url."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not $CheckOnly) {
    if ($Restart) {
        docker compose restart backend frontend
    } elseif ($Build) {
        docker compose up -d --build
    } else {
        docker compose up -d
    }
}

Wait-ForHttp -Name "Backend" -Url "http://localhost:8000/api/health/" -TimeoutSeconds $TimeoutSeconds
Wait-ForHttp -Name "Frontend" -Url "http://localhost:5173/" -TimeoutSeconds $TimeoutSeconds

Write-Host ""
Write-Host "DMO is running."
Write-Host "Frontend:    http://localhost:5173/"
Write-Host "Backend:     http://localhost:8000/api/health/"
Write-Host "Dev sign-in: use the local dev login button, or POST next=/ to http://localhost:5173/accounts/dev-login/"
Write-Host ""
Write-Host "Useful follow-ups:"
Write-Host "  docker compose ps"
Write-Host "  docker compose logs -f backend frontend"
