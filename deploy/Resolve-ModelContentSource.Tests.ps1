$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'Resolve-ModelContentSource.ps1') -InternalLoadOnly

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "model source resolver assertion failed: $Message" }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "expected failure matching $Pattern, received: $($_.Exception.Message)"
        }
        return
    }
    throw "expected failure matching $Pattern"
}

function Write-RegistryFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Entry,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )
    $document = [ordered]@{
        schemaVersion = 1
        repositoryRoot = $RepositoryRoot
        tools = @($Entry)
    }
    [System.IO.File]::WriteAllText(
        $Path,
        ($document | ConvertTo-Json -Depth 8),
        [System.Text.UTF8Encoding]::new($false)
    )
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) "parallax-model-resolver-$([guid]::NewGuid().ToString('N'))"
$source = Join-Path $root 'model-source'
$registry = Join-Path $root 'registry.json'
[void](New-Item -ItemType Directory -Path $source)
try {
    $valid = [ordered]@{
        id = 'production-model-content'
        version = 'gemma-4-E2B-it-qat-GGUF-66a399f6'
        path = $source
        role = 'test fixture'
        pinSource = 'deploy/model-content.json'
        verifiedAt = '2026-08-02'
    }
    Write-RegistryFixture -Path $registry -Entry $valid -RepositoryRoot $root
    $resolved = Resolve-ParallaxModelContentSource `
        -RegistryPath $registry `
        -SourceKey 'production-model-content' `
        -ExpectedVersion 'gemma-4-E2B-it-qat-GGUF-66a399f6' `
        -RepositoryRoot $root
    Assert-True ($resolved.Directory -ceq $source) 'valid source must resolve exactly'

    $checkoutRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $checkoutRegistry = Join-Path $checkoutRoot '.parallax-toolchain.local.json'
    if (Test-Path -LiteralPath $checkoutRegistry -PathType Leaf) {
        $live = Resolve-ParallaxModelContentSource `
            -RegistryPath $checkoutRegistry `
            -SourceKey 'production-model-content' `
            -ExpectedVersion 'gemma-4-E2B-it-qat-GGUF-66a399f6' `
            -RepositoryRoot $checkoutRoot
        Assert-True ($live.SourceKey -ceq 'production-model-content') `
            'checkout-local registry must resolve the exact key'
    }

    Assert-Throws {
        Resolve-ParallaxModelContentSource `
            -RegistryPath (Join-Path $root 'missing.json') `
            -SourceKey 'production-model-content' `
            -ExpectedVersion 'gemma-4-E2B-it-qat-GGUF-66a399f6' `
            -RepositoryRoot $root
    } 'registry is missing'

    $missingKey = [ordered]@{} + $valid
    $missingKey.id = 'another-key'
    Write-RegistryFixture -Path $registry -Entry $missingKey -RepositoryRoot $root
    Assert-Throws {
        Resolve-ParallaxModelContentSource -RegistryPath $registry `
            -SourceKey 'production-model-content' -ExpectedVersion $valid.version `
            -RepositoryRoot $root
    } 'key is missing'

    $relative = [ordered]@{} + $valid
    $relative.path = '.\model-source'
    Write-RegistryFixture -Path $registry -Entry $relative -RepositoryRoot $root
    Assert-Throws {
        Resolve-ParallaxModelContentSource -RegistryPath $registry `
            -SourceKey $valid.id -ExpectedVersion $valid.version -RepositoryRoot $root
    } 'wrong type or identity'

    $notDirectoryPath = Join-Path $root 'regular-file'
    [System.IO.File]::WriteAllText($notDirectoryPath, 'fixture')
    $notDirectory = [ordered]@{} + $valid
    $notDirectory.path = $notDirectoryPath
    Write-RegistryFixture -Path $registry -Entry $notDirectory -RepositoryRoot $root
    Assert-Throws {
        Resolve-ParallaxModelContentSource -RegistryPath $registry `
            -SourceKey $valid.id -ExpectedVersion $valid.version -RepositoryRoot $root
    } 'not a directory'

    $wrongType = [ordered]@{} + $valid
    $wrongType.path = 42
    Write-RegistryFixture -Path $registry -Entry $wrongType -RepositoryRoot $root
    Assert-Throws {
        Resolve-ParallaxModelContentSource -RegistryPath $registry `
            -SourceKey $valid.id -ExpectedVersion $valid.version -RepositoryRoot $root
    } 'wrong type or identity'

    $escape = [ordered]@{} + $valid
    $escape.path = Join-Path $source '..'
    Write-RegistryFixture -Path $registry -Entry $escape -RepositoryRoot $root
    Assert-Throws {
        Resolve-ParallaxModelContentSource -RegistryPath $registry `
            -SourceKey $valid.id -ExpectedVersion $valid.version -RepositoryRoot $root
    } 'not canonical'

    $junctionTarget = Join-Path $root 'junction-target'
    $junction = Join-Path $root 'junction'
    [void](New-Item -ItemType Directory -Path $junctionTarget)
    $junctionCreated = $false
    try {
        [void](New-Item -ItemType Junction -Path $junction -Target $junctionTarget -ErrorAction Stop)
        $junctionCreated = $true
    }
    catch {
        Write-Host 'Junction ancestor test skipped: junction creation is unavailable'
    }
    if ($junctionCreated) {
        $junctionEntry = [ordered]@{} + $valid
        $junctionEntry.path = $junction
        Write-RegistryFixture -Path $registry -Entry $junctionEntry -RepositoryRoot $root
        try {
            Assert-Throws {
                Resolve-ParallaxModelContentSource -RegistryPath $registry `
                    -SourceKey $valid.id -ExpectedVersion $valid.version -RepositoryRoot $root
            } 'reparse-point ancestor'
        }
        finally {
            if (Test-Path -LiteralPath $junction) {
                Remove-Item -LiteralPath $junction -Force
            }
        }
    }
}
finally {
    $resolvedRoot = [System.IO.Path]::GetFullPath($root)
    if ($resolvedRoot.StartsWith(
        [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()),
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
}

Write-Host 'Resolve-ModelContentSource behavior tests: PASS'
