[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$LASTEXITCODE = 0
& (Join-Path $PSScriptRoot 'Deploy-Model-Content.ps1') -Deploy -Confirm:$false
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
