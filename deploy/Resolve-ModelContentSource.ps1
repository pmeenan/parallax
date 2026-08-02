[CmdletBinding()]
param(
    [string]$RegistryPath = '',
    [string]$SourceKey = 'production-model-content',
    [string]$ExpectedVersion = 'gemma-4-E2B-it-qat-GGUF-66a399f6',
    [string]$RepositoryRoot = '',
    [Parameter(DontShow = $true)]
    [switch]$InternalLoadOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
if ([string]::IsNullOrWhiteSpace($RegistryPath)) {
    $RegistryPath = Join-Path $RepositoryRoot '.parallax-toolchain.local.json'
}

function Resolve-ParallaxModelContentSource {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)][string]$SourceKey,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )

    if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) {
        throw 'Machine-local model-content registry is missing'
    }
    $registryItem = Get-Item -LiteralPath $RegistryPath -Force
    if (
        ($registryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $registryItem.Length -gt 1048576
    ) {
        throw 'Machine-local model-content registry is not a bounded regular file'
    }
    try {
        $document = Get-Content -LiteralPath $registryItem.FullName -Raw | ConvertFrom-Json
    }
    catch {
        throw 'Machine-local model-content registry is malformed JSON'
    }
    if (
        $document -isnot [pscustomobject] -or
        $null -eq $document.PSObject.Properties['schemaVersion'] -or
        (($document.schemaVersion -isnot [int]) -and
            ($document.schemaVersion -isnot [long])) -or
        $document.schemaVersion -ne 1 -or
        $null -eq $document.PSObject.Properties['repositoryRoot'] -or
        $document.repositoryRoot -isnot [string] -or
        -not [System.IO.Path]::IsPathRooted($document.repositoryRoot) -or
        [System.IO.Path]::GetFullPath($document.repositoryRoot) -cne $document.repositoryRoot -or
        [System.IO.Path]::GetFullPath($document.repositoryRoot) -cne
            [System.IO.Path]::GetFullPath($RepositoryRoot) -or
        $null -eq $document.PSObject.Properties['tools'] -or
        $document.tools -isnot [System.Array]
    ) {
        throw 'Machine-local model-content registry has the wrong root type'
    }
    $matches = @(
        $document.tools | Where-Object {
            $_ -is [pscustomobject] -and
            $null -ne $_.PSObject.Properties['id'] -and
            $_.id -is [string] -and
            $_.id -ceq $SourceKey
        }
    )
    if ($matches.Count -ne 1) {
        throw 'Machine-local model-content registry key is missing or duplicated'
    }
    $entry = $matches[0]
    if (
        $null -eq $entry.PSObject.Properties['version'] -or
        $entry.version -isnot [string] -or
        $entry.version -cne $ExpectedVersion -or
        $null -eq $entry.PSObject.Properties['path'] -or
        $entry.path -isnot [string] -or
        [string]::IsNullOrWhiteSpace($entry.path) -or
        -not [System.IO.Path]::IsPathRooted($entry.path)
    ) {
        throw 'Machine-local model-content registry entry has the wrong type or identity'
    }
    try {
        $resolved = [System.IO.Path]::GetFullPath($entry.path)
    }
    catch {
        throw 'Machine-local model-content registry path is invalid'
    }
    if ($resolved -cne $entry.path) {
        throw 'Machine-local model-content registry path is not canonical'
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw 'Machine-local model-content registry path is not a directory'
    }
    $directory = Get-Item -LiteralPath $resolved -Force
    $ancestor = $directory
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Machine-local model-content registry directory has a reparse-point ancestor'
        }
        $ancestor = $ancestor.Parent
    }
    return [pscustomobject]@{
        Directory = $directory.FullName
        SourceId = $ExpectedVersion
        SourceKey = $SourceKey
    }
}

if (-not $InternalLoadOnly) {
    $resolved = Resolve-ParallaxModelContentSource `
        -RegistryPath $RegistryPath `
        -SourceKey $SourceKey `
        -ExpectedVersion $ExpectedVersion `
        -RepositoryRoot $RepositoryRoot
    $resolved | ConvertTo-Json -Compress
}
