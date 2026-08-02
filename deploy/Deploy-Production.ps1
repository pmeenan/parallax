[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [switch]$Deploy,
    [Parameter(DontShow = $true)]
    [switch]$InternalLoadOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:RemoteHost = 'plex'
$script:RemoteParent = '/var/www'
$script:RemoteWebRoot = '/var/www/parallax-web.com'
$script:RemoteLock = '/var/www/parallax-web.com/.parallax-deploy.lock'
$script:RemoteImmutable = '/var/www/parallax-web.com/immutable'

$productionEntryInternalLoadOnly = [bool]$InternalLoadOnly
try {
    . (Join-Path $PSScriptRoot 'Resolve-ModelContentSource.ps1') -InternalLoadOnly
}
finally {
    $InternalLoadOnly = $productionEntryInternalLoadOnly
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $priorErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $priorErrorActionPreference
    }
    if ($exitCode -ne 0) {
        $details = [string]::Join("`n", @($output | ForEach-Object { [string]$_ }))
        throw "$Executable failed with exit code $exitCode`: $details"
    }
    return $output
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (
            $hasher.ComputeHash($stream) |
                ForEach-Object { $_.ToString('x2') }
        ) -join ''
    }
    finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Get-Sha256HexFromBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (
            $hasher.ComputeHash($Bytes) |
                ForEach-Object { $_.ToString('x2') }
        ) -join ''
    }
    finally {
        $hasher.Dispose()
    }
}

function ConvertTo-ValidatedModelContentContract {
    param(
        $Document,
        [string]$ContractPath = ''
    )
    if ($Document -isnot [pscustomobject]) {
        throw 'Model-content contract root must be an object'
    }
    $document = $Document
    $topLevelKeys = @($document.PSObject.Properties.Name | Sort-Object)
    if ([string]::Join("`n", $topLevelKeys) -cne "resources`nschemaVersion`nsource") {
        throw 'Model-content contract must have exact schema-v2 root keys'
    }
    if (
        (($document.schemaVersion -isnot [int]) -and
            ($document.schemaVersion -isnot [long])) -or
        $document.schemaVersion -ne 2 -or
        $document.source -isnot [pscustomobject] -or
        $document.resources -isnot [System.Array]
    ) {
        throw 'Model-content contract has invalid schema or container types'
    }
    $sourceKeys = @($document.source.PSObject.Properties.Name | Sort-Object)
    if (
        [string]::Join("`n", $sourceKeys) -cne "id`nregistryKey" -or
        $document.source.id -isnot [string] -or
        $document.source.id -cne 'gemma-4-E2B-it-qat-GGUF-66a399f6' -or
        $document.source.registryKey -isnot [string] -or
        $document.source.registryKey -cne 'production-model-content' -or
        @($document.resources).Count -ne 5
    ) {
        throw 'Model-content contract must be the exact D-130 schema-v2 five-shard set'
    }
    $resources = [System.Collections.Generic.List[object]]::new()
    $expected = @{
        'ff074d7cae3cbda06f7a32b6d42c206bf88c2bee84c9d6165a0937ec2b61958d' = @{
            Bytes = [long]23532320
            LocalName = 'gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00001-of-00005.gguf'
        }
        '1c5368744032e95ba212561c1985cd8017de6fd165fef1f648528e0be265d4a8' = @{
            Bytes = [long]1321205952
            LocalName = 'gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00002-of-00005.gguf'
        }
        'f8c3b5b6f05090ef292ed643357fed6b1df5381d0a21e11d3515580af3ef48f3' = @{
            Bytes = [long]508734272
            LocalName = 'gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00003-of-00005.gguf'
        }
        'ca3403a90060fc56b92e6b35acb0090eebb8b7eb11c4919536ba645f4d45c461' = @{
            Bytes = [long]510543744
            LocalName = 'gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00004-of-00005.gguf'
        }
        '30c5c95b427827e9f1993f7df2e4d6cbdea2354811ab5dcafd6db41190cfb9f9' = @{
            Bytes = [long]256355264
            LocalName = 'gemma-4-E2B-it-qat-UD-Q4_K_XL-split-00005-of-00005.gguf'
        }
    }
    $names = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $total = [long]0
    foreach ($entry in @($document.resources)) {
        if ($entry -isnot [pscustomobject]) {
            throw 'Model-content resource must be an object'
        }
        $entryKeys = @($entry.PSObject.Properties.Name | Sort-Object)
        if (
            [string]::Join("`n", $entryKeys) -cne "bytes`nlocalName`nremoteName`nsha256" -or
            (($entry.bytes -isnot [int]) -and ($entry.bytes -isnot [long])) -or
            $entry.localName -isnot [string] -or
            $entry.remoteName -isnot [string] -or
            $entry.sha256 -isnot [string]
        ) {
            throw 'Model-content resource has invalid keys or value types'
        }
        $sha256 = $entry.sha256
        $remoteName = $entry.remoteName
        $localName = $entry.localName
        $bytes = [long]$entry.bytes
        if (
            $sha256 -cnotmatch '^[a-f0-9]{64}$' -or
            $remoteName -cne "model-$sha256.gguf" -or
            $localName -cnotmatch
                '^gemma-4-E2B-it-qat-UD-Q4_K_XL-split-0000[1-5]-of-00005\.gguf$' -or
            $bytes -le 0 -or
            -not $expected.ContainsKey($sha256) -or
            $expected[$sha256].Bytes -ne $bytes -or
            $expected[$sha256].LocalName -cne $localName -or
            -not $names.Add($remoteName)
        ) {
            throw "Unsafe or duplicate model-content entry: $remoteName"
        }
        $total += $bytes
        [void]$resources.Add([pscustomobject]@{
            Bytes = $bytes
            LocalName = $localName
            RemoteName = $remoteName
            RemotePath = "immutable/$remoteName"
            Sha256 = $sha256
        })
    }
    if ($total -ne 2620371552) {
        throw "Model-content contract has wrong total bytes: $total"
    }
    return [pscustomobject]@{
        ContractSha256 = if ($ContractPath -eq '') { '' } else { Get-Sha256Hex -Path $ContractPath }
        Resources = @($resources | Sort-Object RemoteName)
        SourceId = $document.source.id
        SourceKey = $document.source.registryKey
        TotalBytes = $total
    }
}

function Get-ModelContentContract {
    $contractPath = Join-Path $PSScriptRoot 'model-content.json'
    try {
        $document = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
    }
    catch {
        throw 'Model-content contract is not valid bounded JSON'
    }
    $contract = ConvertTo-ValidatedModelContentContract `
        -Document $document `
        -ContractPath $contractPath
    $localSource = Resolve-ParallaxModelContentSource `
        -RegistryPath (Join-Path $PSScriptRoot '..\.parallax-toolchain.local.json') `
        -SourceKey $contract.SourceKey `
        -ExpectedVersion $contract.SourceId `
        -RepositoryRoot ([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
    $contract | Add-Member -NotePropertyName LocalDirectory -NotePropertyValue $localSource.Directory
    return $contract
}

function Assert-InstallManifestModelsMatchContract {
    param(
        [Parameter(Mandatory = $true)]$InstallManifest,
        [Parameter(Mandatory = $true)]$ModelContract
    )

    $topLevelKeys = @($InstallManifest.PSObject.Properties.Name | Sort-Object)
    if ([string]::Join("`n", $topLevelKeys) -cne "gameId`nresources`nschemaVersion") {
        throw 'Install-manifest model projection requires the exact v1 top-level keys'
    }
    if (
        [int]$InstallManifest.schemaVersion -ne 1 -or
        [string]$InstallManifest.gameId -cne 'parallax' -or
        $null -eq $InstallManifest.resources
    ) {
        throw 'Install-manifest model projection requires the exact Parallax v1 document'
    }

    $expectedById = [System.Collections.Generic.Dictionary[string, object]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($model in @($ModelContract.Resources)) {
        $expectedRemoteName = "model-$($model.Sha256).gguf"
        $expectedRemotePath = "immutable/$expectedRemoteName"
        if (
            [string]$model.RemoteName -cne $expectedRemoteName -or
            [string]$model.RemotePath -cne $expectedRemotePath -or
            [string]$model.LocalName -cnotmatch
                '^gemma-4-E2B-it-qat-UD-Q4_K_XL-split-0000[1-5]-of-00005\.gguf$'
        ) {
            throw 'Deployment model-content contract has a noncanonical model path'
        }
        $id = "common-model-$(([string]$model.LocalName).ToLowerInvariant())"
        if ($expectedById.ContainsKey($id)) {
            throw "Deployment model-content contract has a duplicate model id: $id"
        }
        $expectedById.Add($id, [pscustomobject]@{
            Bytes = [long]$model.Bytes
            Id = $id
            Kind = 'model'
            Scope = 'common'
            Sha256 = [string]$model.Sha256
            Source = $expectedRemotePath
            Target = 'opfs'
        })
    }

    $resourceKeys = 'bytes', 'id', 'kind', 'scope', 'sha256', 'source', 'target'
    $models = @(
        @($InstallManifest.resources) | Where-Object {
            $kind = $_.PSObject.Properties['kind']
            $null -ne $kind -and $kind.Value -ceq 'model'
        }
    )
    if ($models.Count -ne $expectedById.Count) {
        throw (
            'Install-manifest model projection does not equal the deployment contract: ' +
                "expected $($expectedById.Count), received $($models.Count)"
        )
    }

    $seenIds = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $seenSources = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $seenHashes = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($candidate in $models) {
        $actualKeys = @($candidate.PSObject.Properties.Name | Sort-Object)
        if ([string]::Join("`n", $actualKeys) -cne [string]::Join("`n", $resourceKeys)) {
            throw 'Install-manifest model projection has unsupported or missing resource keys'
        }
        $id = [string]$candidate.id
        $source = [string]$candidate.source
        $sha256 = [string]$candidate.sha256
        if (
            -not $seenIds.Add($id) -or
            -not $seenSources.Add($source) -or
            -not $seenHashes.Add($sha256)
        ) {
            throw 'Install-manifest model projection contains a duplicate identity'
        }
        $expected = if ($expectedById.ContainsKey($id)) { $expectedById[$id] } else { $null }
        $bytesIsInteger = $candidate.bytes -is [int] -or $candidate.bytes -is [long]
        if (
            $null -eq $expected -or
            -not $bytesIsInteger -or
            [long]$candidate.bytes -ne $expected.Bytes -or
            $id -cne $expected.Id -or
            [string]$candidate.kind -cne $expected.Kind -or
            [string]$candidate.scope -cne $expected.Scope -or
            $sha256 -cne $expected.Sha256 -or
            $source -cne $expected.Source -or
            [string]$candidate.target -cne $expected.Target
        ) {
            throw "Install-manifest model projection mismatch for resource: $id"
        }
    }
}

function Invoke-RemoteCommand {
    param([Parameter(Mandatory = $true)][string]$Command)
    return @(Invoke-CheckedNative -Executable 'ssh.exe' -Arguments @($script:RemoteHost, $Command))
}

function Copy-ToRemote {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [switch]$Recursive
    )
    $arguments = if ($Recursive) {
        @('-r', $Source, "$($script:RemoteHost):$Destination")
    }
    else {
        @($Source, "$($script:RemoteHost):$Destination")
    }
    [void](Invoke-CheckedNative -Executable 'scp.exe' -Arguments $arguments)
}

function Get-ValidatedLocalDeployment {
    param(
        [Parameter(Mandatory = $true)][string]$DistPath,
        [Parameter(DontShow = $true)][scriptblock]$InstallManifestReader = {
            param([string]$Path)
            return [System.IO.File]::ReadAllBytes($Path)
        }
    )

    $resolvedDist = [System.IO.Path]::GetFullPath($DistPath)
    if (-not (Test-Path -LiteralPath $resolvedDist -PathType Container)) {
        throw "Production build did not create the expected dist directory: $resolvedDist"
    }
    $validator = Join-Path $PSScriptRoot '..\harness\dist\types\validate-deployment.js'
    if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
        throw 'Compiled independent deployment validator is missing'
    }
    [void](Invoke-CheckedNative -Executable 'node.exe' -Arguments @($validator, $resolvedDist))
    $manifestPath = Join-Path $resolvedDist 'build-manifest.json'
    $indexPath = Join-Path $resolvedDist 'index.html'
    if (
        -not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $indexPath -PathType Leaf)
    ) {
        throw 'Production dist is missing build-manifest.json or index.html'
    }

    $manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
    $manifest = [System.Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 15 -or $null -eq $manifest.artifacts) {
        throw "Production dist has an unsupported build manifest schema: $($manifest.schemaVersion)"
    }
    $installEntrypoint = $manifest.installManifestEntrypoint
    if (
        $null -eq $installEntrypoint -or
        [string]$installEntrypoint.path -ne 'install-manifest.json' -or
        [int]$installEntrypoint.schemaVersion -ne 1
    ) {
        throw 'Production dist is missing the exact install-manifest v1 entrypoint'
    }
    $offlineShell = $manifest.offlineShell
    if (
        $null -eq $offlineShell -or
        [int]$offlineShell.generationSchemaVersion -ne 1 -or
        [int]$offlineShell.saveSchemaVersion -ne 1 -or
        [string]$offlineShell.serviceWorkerPath -ne 'service-worker.js'
    ) {
        throw 'Production dist is missing the exact offline-shell v1 compatibility contract'
    }

    $expectedFiles = @{}
    $modelContract = Get-ModelContentContract
    $installOnlyModelPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($model in $modelContract.Resources) {
        [void]$installOnlyModelPaths.Add($model.RemotePath)
    }
    foreach ($artifact in @($manifest.artifacts)) {
        $path = [string]$artifact.path
        $sha256 = [string]$artifact.sha256
        $bytes = [long]$artifact.bytes
        if (
            $path -notmatch '^[a-zA-Z0-9._/-]+$' -or
            $path.Contains('..') -or
            $path -eq '.parallax-deploy.lock' -or
            $path.StartsWith('.parallax-deploy.lock/') -or
            $sha256 -notmatch '^[a-f0-9]{64}$' -or
            $bytes -le 0 -or
            $installOnlyModelPaths.Contains($path) -or
            $expectedFiles.ContainsKey($path)
        ) {
            throw "Unsafe or duplicate build-manifest artifact entry: $path"
        }
        $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedDist $path))
        if (-not $artifactPath.StartsWith(
            $resolvedDist + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Build-manifest artifact escapes dist: $path"
        }
        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            throw "Build-manifest artifact is missing: $path"
        }
        $actual = Get-Item -LiteralPath $artifactPath
        $actualSha256 = Get-Sha256Hex -Path $artifactPath
        if ($actual.Length -ne $bytes -or $actualSha256 -ne $sha256) {
            throw "Build-manifest artifact bytes or digest mismatch: $path"
        }
        $expectedFiles[$path] = [pscustomobject]@{
            Bytes = $bytes
            Path = $path
            Sha256 = $sha256
        }
    }
    if (-not $expectedFiles.ContainsKey('install-manifest.json')) {
        throw 'Production build manifest does not list install-manifest.json as an artifact'
    }
    $installManifestPath = Join-Path $resolvedDist 'install-manifest.json'
    $installManifestBytes = [byte[]]@(& $InstallManifestReader $installManifestPath)
    $expectedInstallManifest = $expectedFiles['install-manifest.json']
    if (
        $installManifestBytes.LongLength -ne $expectedInstallManifest.Bytes -or
        (Get-Sha256HexFromBytes -Bytes $installManifestBytes) -cne
            $expectedInstallManifest.Sha256
    ) {
        throw 'Install-manifest artifact changed before model projection parsing'
    }
    $installManifest = [System.Text.Encoding]::UTF8.GetString($installManifestBytes) |
        ConvertFrom-Json
    Assert-InstallManifestModelsMatchContract `
        -InstallManifest $installManifest `
        -ModelContract $modelContract
    if (-not $expectedFiles.ContainsKey('service-worker.js')) {
        throw 'Production build manifest does not list the stable service-worker artifact'
    }

    $manifestSha256 = Get-Sha256Hex -Path $manifestPath
    $expectedFiles['build-manifest.json'] = [pscustomobject]@{
        Bytes = [long]$manifestBytes.Length
        Path = 'build-manifest.json'
        Sha256 = $manifestSha256
    }
    $actualFiles = @(
        Get-ChildItem -LiteralPath $resolvedDist -File -Force -Recurse |
            ForEach-Object {
                $_.FullName.Substring($resolvedDist.Length + 1).Replace(
                    [System.IO.Path]::DirectorySeparatorChar,
                    '/'
                )
            } |
            Sort-Object
    )
    $expectedPaths = @($expectedFiles.Keys | Sort-Object)
    if ([string]::Join("`n", $actualFiles) -ne [string]::Join("`n", $expectedPaths)) {
        throw "Production dist inventory must equal manifest artifacts plus build-manifest.json"
    }

    $directories = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($path in $expectedPaths) {
        $parts = $path.Split('/')
        for ($index = 1; $index -lt $parts.Length; $index += 1) {
            [void]$directories.Add([string]::Join('/', $parts[0..($index - 1)]))
        }
    }
    $actualDirectories = @(
        Get-ChildItem -LiteralPath $resolvedDist -Directory -Force -Recurse |
            ForEach-Object {
                $_.FullName.Substring($resolvedDist.Length + 1).Replace(
                    [System.IO.Path]::DirectorySeparatorChar,
                    '/'
                )
            } |
            Sort-Object
    )
    $expectedDirectories = @($directories | Sort-Object)
    if (
        [string]::Join("`n", $actualDirectories) -ne
            [string]::Join("`n", $expectedDirectories)
    ) {
        throw 'Production dist directory inventory contains an unexpected or missing path'
    }
    $reparsePoints = @(
        Get-ChildItem -LiteralPath $resolvedDist -Force -Recurse |
            Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 }
    )
    if ($reparsePoints.Count -ne 0) {
        throw 'Production dist inventory must not contain symlinks or other reparse points'
    }
    $inventoryLines = @(
        $expectedDirectories |
            ForEach-Object { "d 755 $_" }
        $expectedPaths |
            ForEach-Object {
                $file = $expectedFiles[$_]
                "f 644 $($file.Sha256) $($file.Bytes) $($file.Path)"
            }
    )
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fingerprintLines = @(
            $inventoryLines
            "model-contract $($modelContract.ContractSha256)"
        )
        $fingerprint = (
            $hasher.ComputeHash(
                [System.Text.Encoding]::UTF8.GetBytes(
                    [string]::Join("`n", $fingerprintLines)
                )
            ) |
                ForEach-Object { $_.ToString('x2') }
        ) -join ''
    }
    finally {
        $hasher.Dispose()
    }
    return [pscustomobject]@{
        DistPath = $resolvedDist
        ExpectedFiles = $expectedFiles
        Fingerprint = $fingerprint
        IndexPath = $indexPath
        InventoryLines = $inventoryLines
        ManifestPath = $manifestPath
        TopLevelChildren = @(Get-ChildItem -LiteralPath $resolvedDist -Force | Sort-Object Name)
        ModelContract = $modelContract
    }
}

function Assert-LocalDeploymentUnchanged {
    param(
        [Parameter(Mandatory = $true)]$Frozen,
        [Parameter(Mandatory = $true)][string]$Boundary
    )
    $current = Get-ValidatedLocalDeployment -DistPath $Frozen.DistPath
    if ($current.Fingerprint -ne $Frozen.Fingerprint) {
        throw "Local deployment source changed $Boundary"
    }
}

function Write-ExpectedInventoryFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$InventoryLines
    )
    if ($InventoryLines.Count -eq 0) {
        throw 'Expected deployment inventory must not be empty'
    }
    $text = [string]::Join("`n", $InventoryLines) + "`n"
    [System.IO.File]::WriteAllBytes(
        $Path,
        [System.Text.UTF8Encoding]::new($false).GetBytes($text)
    )
}

function Get-RemoteGuardScript {
    param(
        [string]$ExpectedParentIdentity = '',
        [string]$ExpectedTargetIdentity = ''
    )
    $identityChecks = if ($ExpectedParentIdentity -eq '') {
        ''
    }
    else {
        "test `"`${parent_dev}:`${parent_ino}`" = '$ExpectedParentIdentity'; " +
        "test `"`${target_dev}:`${target_ino}`" = '$ExpectedTargetIdentity'; "
    }
    return @"
p=$($script:RemoteParent); w=$($script:RemoteWebRoot); lock=$($script:RemoteLock);
test -d "`$p"; test ! -L "`$p"; test -d "`$w"; test ! -L "`$w";
uid=`$(id -u);
set -- `$(stat -c '%u %a %d %i' "`$p"); parent_uid=`$1; parent_mode=`$2; parent_dev=`$3; parent_ino=`$4;
set -- `$(stat -c '%u %a %d %i' "`$w"); target_uid=`$1; target_mode=`$2; target_dev=`$3; target_ino=`$4;
test "`$parent_uid" = "`$uid"; test "`$target_uid" = "`$uid";
test `$((0`$parent_mode & 022)) -eq 0; test `$((0`$target_mode & 022)) -eq 0;
$identityChecks
if ! mount_inventory=`$(findmnt -rn -o TARGET); then echo mount-inventory-unavailable >&2; exit 72; fi;
target_is_mount=0;
for mountpoint in `$mount_inventory; do case "`$mountpoint" in "`$w"|"`$w"/*) target_is_mount=1;; esac; done;
if test "`$target_is_mount" -ne 0; then echo webroot-or-descendant-is-a-mount >&2; exit 71; fi;
"@ -replace "`r?`n", ' '
}

function Get-RemoteLockGuardScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    if ($Token -notmatch '^[a-f0-9]{32}$') {
        throw 'Remote deployment lock token must be exactly 32 lowercase hexadecimal characters'
    }
    return "$Guard test -d $($script:RemoteLock); test ! -L $($script:RemoteLock); " +
        "set -- `$(stat -c '%u %a' $($script:RemoteLock)); " +
        "lock_uid=`$1; lock_mode=`$2; test `"`$lock_uid`" = `"`$(id -u)`"; " +
        "test `"`$lock_mode`" = 700; " +
        "test -f $($script:RemoteLock)/token; test ! -L $($script:RemoteLock)/token; " +
        "set -- `$(stat -c '%u %a' $($script:RemoteLock)/token); " +
        "token_uid=`$1; token_mode=`$2; test `"`$token_uid`" = `"`$(id -u)`"; " +
        "test `"`$token_mode`" = 600; " +
        "test `"`$(cat $($script:RemoteLock)/token)`" = '$Token'; "
}

function Get-RemoteLockAcquireScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    if ($Token -notmatch '^[a-f0-9]{32}$') {
        throw 'Remote deployment lock token must be exactly 32 lowercase hexadecimal characters'
    }
    return "set -eu; $Guard umask 077; " +
        "mkdir -m 0700 -- $($script:RemoteLock); " +
        "if ! { printf '%s\n' '$Token' > $($script:RemoteLock)/token && " +
        "chmod 0600 -- $($script:RemoteLock)/token; }; then " +
        "rm -rf -- $($script:RemoteLock); exit 73; fi"
}

function Get-RemoteLockReleaseScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard rm -rf -- $($script:RemoteLock)"
}

function Get-RemotePrivatizeRootScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard chmod 0700 -- $($script:RemoteWebRoot); " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700"
}

function Get-RemoteDeleteContentScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; " +
        "find $($script:RemoteWebRoot) -mindepth 1 -maxdepth 1 " +
        "! -name .parallax-deploy.lock -exec rm -rf -- {} +"
}

function Get-RemoteNormalizePrivateContentScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; " +
        "symlink=`$(find $($script:RemoteWebRoot) -path $($script:RemoteLock) -prune -o " +
        "-mindepth 1 -type l -print -quit); test -z `"`$symlink`"; " +
        "find $($script:RemoteWebRoot) -path $($script:RemoteLock) -prune -o " +
        "-mindepth 1 -type f -exec chmod 0644 -- {} +; " +
        "find $($script:RemoteWebRoot) -path $($script:RemoteLock) -prune -o " +
        "-mindepth 1 -type d -exec chmod 0755 -- {} +; " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700"
}

function Get-RemotePublishRootScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; " +
        "chmod 0755 -- $($script:RemoteWebRoot); " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 755"
}

function Get-RemotePrivateRecoveryStatusScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    return "set -eu; $lockGuard " +
        "root_mode=`$(stat -c %a $($script:RemoteWebRoot)); " +
        "test `"`$root_mode`" = 700; " +
        "printf 'RECOVERY_STATE root_mode=%s lock=owned target=%s\n' " +
        "`"`$root_mode`" '$($script:RemoteWebRoot)'"
}

function Get-RemoteRejectSpecialEntriesScript {
    param(
        [Parameter(Mandatory = $true)][string]$Guard,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $lockGuard = Get-RemoteLockGuardScript -Guard $Guard -Token $Token
    $unsupportedMarker = 'PARALLAX_UNSUPPORTED_ENTRY_V1'
    return "set -eu; $lockGuard " +
        "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; " +
        "unsupported_marker=`$(find $($script:RemoteWebRoot) " +
        "-path $($script:RemoteLock) -prune -o -mindepth 1 " +
        "! -type d ! -type f -printf '$unsupportedMarker' -quit); " +
        "case `"`$unsupported_marker`" in " +
        "'') :;; " +
        "$unsupportedMarker) " +
        "unsupported_entry=`$(find $($script:RemoteWebRoot) " +
        "-path $($script:RemoteLock) -prune -o -mindepth 1 " +
        "! -type d ! -type f -printf '%P' -quit); " +
        "unsupported_diagnostic=`$(printf '%s' `"`$unsupported_entry`" | " +
        "LC_ALL=C tr -c 'A-Za-z0-9._/-' '?' | cut -c 1-512); " +
        "if test -z `"`$unsupported_diagnostic`"; then " +
        "unsupported_diagnostic='<path-unavailable>'; fi; " +
        "printf 'unsupported-remote-entry-type:%s\n' `"`$unsupported_diagnostic`" >&2; " +
        "exit 74;; " +
        "*) echo 'malformed-unsupported-entry-probe' >&2; exit 76;; " +
        "esac;"
}

function Read-RemoteIdentity {
    $guard = Get-RemoteGuardScript
    $command = "set -eu; $guard printf 'IDENTITY %s:%s %s:%s %s %s\n' " +
        '"$parent_dev" "$parent_ino" "$target_dev" "$target_ino" "$parent_mode" "$target_mode"; ' +
        "if test -e $($script:RemoteLock); then " +
        "echo 'deployment-lock-present:$($script:RemoteLock)' >&2; exit 75; fi; " +
        "find $($script:RemoteWebRoot) -mindepth 1 -maxdepth 1 -print | sort"
    $output = @(Invoke-RemoteCommand -Command $command)
    $identityLine = @($output | Where-Object { $_ -match '^IDENTITY ' })
    if ($identityLine.Count -ne 1 -or $identityLine[0] -notmatch '^IDENTITY ([0-9]+:[0-9]+) ([0-9]+:[0-9]+) ([0-7]+) ([0-7]+)$') {
        throw 'Remote target identity output is missing or malformed'
    }
    $parentIdentity = $Matches[1]
    $targetIdentity = $Matches[2]
    $parentMode = $Matches[3]
    $targetMode = $Matches[4]
    return [pscustomobject]@{
        Inventory = @($output | Where-Object { $_ -notmatch '^IDENTITY ' })
        ParentIdentity = $parentIdentity
        ParentMode = $parentMode
        TargetIdentity = $targetIdentity
        TargetMode = $targetMode
    }
}

function Read-RemoteModelState {
    param([Parameter(Mandatory = $true)]$Contract)
    $guard = Get-RemoteGuardScript
    $expectedCase = [string]::Join(
        '|',
        @($Contract.Resources | ForEach-Object { $_.RemoteName })
    )
    $probes = [string]::Join(
        ' ',
        @($Contract.Resources | ForEach-Object {
            $path = "$($script:RemoteImmutable)/$($_.RemoteName)"
            "if test -L $path; then printf 'MODEL %s unsafe 0 - 0 0 000\n' '$($_.RemoteName)'; " +
                "elif test -f $path; then set -- `$(stat -c '%s %u %g %a' $path); " +
                "bytes=`$1; file_uid=`$2; file_gid=`$3; file_mode=`$4; " +
                "sha=`$(sha256sum $path | cut -d ' ' -f 1); " +
                "printf 'MODEL %s present %s %s %s %s %s\n' '$($_.RemoteName)' " +
                "`"`$bytes`" `"`$sha`" `"`$file_uid`" `"`$file_gid`" `"`$file_mode`"; " +
                "elif test -e $path; then printf 'MODEL %s unsafe 0 - 0 0 000\n' '$($_.RemoteName)'; " +
                "else printf 'MODEL %s missing 0 - 0 0 000\n' '$($_.RemoteName)'; fi;"
        })
    )
    $command = "set -eu; $guard " +
        "test -d $($script:RemoteImmutable); test ! -L $($script:RemoteImmutable); " +
        "set -- `$(stat -c '%u %g %a' $($script:RemoteWebRoot)); " +
        "web_uid=`$1; web_gid=`$2; web_mode=`$3; " +
        "set -- `$(stat -c '%u %g %a' $($script:RemoteImmutable)); " +
        "immutable_uid=`$1; immutable_gid=`$2; immutable_mode=`$3; " +
        "printf 'MODEL_ROOT %s %s %s %s %s %s\n' `"`$web_uid`" `"`$web_gid`" " +
        "`"`$web_mode`" `"`$immutable_uid`" `"`$immutable_gid`" `"`$immutable_mode`"; " +
        "$probes " +
        "find $($script:RemoteImmutable) -mindepth 1 -maxdepth 1 -name 'model-*.gguf' " +
        "-printf '%f\n' | while IFS= read -r name; do case `"`$name`" in " +
        "$expectedCase) :;; *) printf 'EXTRA %s\n' `"`$name`";; esac; done"
    $output = @(Invoke-RemoteCommand -Command $command)
    $states = [System.Collections.Generic.List[object]]::new()
    $extras = [System.Collections.Generic.List[string]]::new()
    $root = $null
    foreach ($line in $output) {
        if ($line -match '^MODEL_ROOT ([0-9]+) ([0-9]+) ([0-7]+) ([0-9]+) ([0-9]+) ([0-7]+)$') {
            if ($null -ne $root) {
                throw 'Remote model inventory returned duplicate root identity'
            }
            $root = [pscustomobject]@{
                WebRootUid = [long]$Matches[1]
                WebRootGid = [long]$Matches[2]
                WebRootMode = $Matches[3]
                ImmutableUid = [long]$Matches[4]
                ImmutableGid = [long]$Matches[5]
                ImmutableMode = $Matches[6]
            }
        }
        elseif ($line -match '^MODEL ([a-z0-9.-]+) (present|missing|unsafe) ([0-9]+) ([a-f0-9]{64}|-) ([0-9]+) ([0-9]+) ([0-7]+)$') {
            [void]$states.Add([pscustomobject]@{
                Bytes = [long]$Matches[3]
                Gid = [long]$Matches[6]
                Mode = $Matches[7]
                RemoteName = $Matches[1]
                Sha256 = $Matches[4]
                State = $Matches[2]
                Uid = [long]$Matches[5]
            })
        }
        elseif ($line -match '^EXTRA ([a-z0-9.-]+)$') {
            [void]$extras.Add($Matches[1])
        }
        else {
            throw "Malformed remote model inventory output: $line"
        }
    }
    if ($null -eq $root -or $states.Count -ne 5) {
        throw "Remote model inventory returned $($states.Count) records instead of five"
    }
    return [pscustomobject]@{
        Extras = @($extras | Sort-Object)
        Root = $root
        States = @($states | Sort-Object RemoteName)
    }
}

function Test-RemoteModelsExact {
    param(
        [Parameter(Mandatory = $true)]$Contract,
        [Parameter(Mandatory = $true)]$RemoteModels
    )
    if (
        $RemoteModels.Extras.Count -ne 0 -or
        $RemoteModels.Root.ImmutableMode -ne '755' -or
        $RemoteModels.Root.ImmutableUid -ne $RemoteModels.Root.WebRootUid -or
        $RemoteModels.Root.ImmutableGid -ne $RemoteModels.Root.WebRootGid
    ) {
        return $false
    }
    foreach ($resource in $Contract.Resources) {
        $state = @(
            $RemoteModels.States |
                Where-Object { $_.RemoteName -eq $resource.RemoteName }
        )
        if (
            $state.Count -ne 1 -or
            $state[0].State -ne 'present' -or
            $state[0].Bytes -ne $resource.Bytes -or
            $state[0].Sha256 -ne $resource.Sha256 -or
            $state[0].Uid -ne $RemoteModels.Root.WebRootUid -or
            $state[0].Gid -ne $RemoteModels.Root.WebRootGid -or
            $state[0].Mode -ne '644'
        ) {
            return $false
        }
    }
    return $true
}

function Get-CombinedDeploymentInventory {
    param([Parameter(Mandatory = $true)]$Frozen)
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $Frozen.InventoryLines) { [void]$lines.Add($line) }
    foreach ($model in $Frozen.ModelContract.Resources) {
        [void]$lines.Add(
            "f 644 $($model.Sha256) $($model.Bytes) $($model.RemotePath)"
        )
    }
    return @($lines | Sort-Object)
}

function Invoke-ProductionDeploymentCore {
    param(
        [Parameter(Mandatory = $true)]$Frozen,
        [Parameter(Mandatory = $true)][bool]$DeployRequested,
        [Parameter(Mandatory = $true)][bool]$MutationApproved
    )

    Write-Host (
        "Local deployment inventory: $($Frozen.ExpectedFiles.Count) files, " +
        "frozen fingerprint $($Frozen.Fingerprint)."
    )
    $Frozen.TopLevelChildren | ForEach-Object {
        $kind = if ($_.PSIsContainer) { 'directory' } else { 'file' }
        Write-Host "  $kind $($_.Name)"
    }
    Write-Host 'Remote target verification and current inventory:'
    $remote = Read-RemoteIdentity
    $remote.Inventory | ForEach-Object { Write-Host "  $_" }
    Write-Host "Remote permission identity: parent mode $($remote.ParentMode), target mode $($remote.TargetMode)."
    $remoteModels = Read-RemoteModelState -Contract $Frozen.ModelContract
    foreach ($state in $remoteModels.States) {
        Write-Host (
            "  model $($state.RemoteName): $($state.State), " +
            "$($state.Bytes) bytes, sha256 $($state.Sha256)"
        )
    }
    foreach ($extra in $remoteModels.Extras) {
        Write-Host "  unexpected managed-prefix object: $extra"
    }
    $modelsExact = Test-RemoteModelsExact `
        -Contract $Frozen.ModelContract `
        -RemoteModels $remoteModels

    if (-not $DeployRequested) {
        if (-not $modelsExact) {
            Write-Host (
                'BLOCKED: ordinary deployment requires the exact five pinned model objects. ' +
                'Run pnpm deploy:model-content and then pnpm deploy:model-content:apply ' +
                '(the fixed no-argument apply wrapper) first.'
            )
        }
        Write-Host 'PREVIEW ONLY: no remote files were deleted or copied.'
        Write-Host (
            'Run pnpm deploy:production:apply (the fixed no-argument apply wrapper) ' +
            'to request the guarded destructive replacement.'
        )
        return
    }
    if (-not $MutationApproved) {
        Write-Host 'Deployment cancelled before remote mutation.'
        return
    }
    if (-not $modelsExact) {
        throw 'Refusing destructive app deployment until the exact five pinned model objects exist with no managed-prefix extras'
    }

    $token = [guid]::NewGuid().ToString('N')
    $guard = Get-RemoteGuardScript `
        -ExpectedParentIdentity $remote.ParentIdentity `
        -ExpectedTargetIdentity $remote.TargetIdentity
    $lockAcquired = $false
    $privateRootPhaseStarted = $false
    $rootPrivatized = $false
    $modelsPreserved = $false
    $sourceIdentityBoundaryVerified = $false
    $finalInventoryVerified = $false
    $rootPublished = $false
    $expectedInventoryPath = [System.IO.Path]::GetTempFileName()
    $operationError = $null
    $cleanupFailures = [System.Collections.Generic.List[string]]::new()
    $recoveryEvidence = [System.Collections.Generic.List[string]]::new()
    try {
        Write-ExpectedInventoryFile `
            -Path $expectedInventoryPath `
            -InventoryLines (Get-CombinedDeploymentInventory -Frozen $Frozen)
        $acquire = Get-RemoteLockAcquireScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $acquire)
        $lockAcquired = $true
        $lockedModels = Read-RemoteModelState -Contract $Frozen.ModelContract
        if (-not (Test-RemoteModelsExact -Contract $Frozen.ModelContract -RemoteModels $lockedModels)) {
            throw 'Remote model inventory changed after lock acquisition; refusing preservation'
        }
        Copy-ToRemote `
            -Source $expectedInventoryPath `
            -Destination "$($script:RemoteLock)/expected.inventory"

        Assert-LocalDeploymentUnchanged `
            -Frozen $Frozen `
            -Boundary 'immediately before remote privatization'
        $lockGuard = Get-RemoteLockGuardScript -Guard $guard -Token $token
        $privateRootPhaseStarted = $true
        $privatize = Get-RemotePrivatizeRootScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $privatize)
        $rootPrivatized = $true

        $expectedModelUid = $lockedModels.Root.WebRootUid
        $expectedModelGid = $lockedModels.Root.WebRootGid
        $preserveParts = @(
            $Frozen.ModelContract.Resources | ForEach-Object {
                $source = "$($script:RemoteImmutable)/$($_.RemoteName)"
                "test -f $source; test ! -L $source; " +
                    "test `"`$(stat -c %u $source)`" = '$expectedModelUid'; " +
                    "test `"`$(stat -c %g $source)`" = '$expectedModelGid'; " +
                    "test `"`$(stat -c %a $source)`" = 644; " +
                    "test `"`$(stat -c %s $source)`" = '$($_.Bytes)'; " +
                    "test `"`$(sha256sum $source | cut -d ' ' -f 1)`" = '$($_.Sha256)'; " +
                    "mv -- $source $($script:RemoteLock)/preserved-models/$($_.RemoteName);"
            }
        )
        $preserve = "set -eu; $lockGuard " +
            "test -d $($script:RemoteImmutable); test ! -L $($script:RemoteImmutable); " +
            "test `"`$(stat -c %u $($script:RemoteImmutable))`" = '$expectedModelUid'; " +
            "test `"`$(stat -c %g $($script:RemoteImmutable))`" = '$expectedModelGid'; " +
            "test `"`$(stat -c %a $($script:RemoteImmutable))`" = 755; " +
            "mkdir -m 0700 -- $($script:RemoteLock)/preserved-models; " +
            [string]::Join(' ', $preserveParts)
        $modelsPreserved = $true
        [void](Invoke-RemoteCommand -Command $preserve)
        $delete = Get-RemoteDeleteContentScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $delete)

        foreach ($child in $Frozen.TopLevelChildren) {
            Copy-ToRemote `
                -Source $child.FullName `
                -Destination "$($script:RemoteWebRoot)/" `
                -Recursive
        }
        $restoreParts = @(
            $Frozen.ModelContract.Resources | ForEach-Object {
                "test ! -e $($script:RemoteImmutable)/$($_.RemoteName); " +
                    "mv -- $($script:RemoteLock)/preserved-models/$($_.RemoteName) " +
                    "$($script:RemoteImmutable)/$($_.RemoteName);"
            }
        )
        $restoreModels = "set -eu; $lockGuard " +
            "test -d $($script:RemoteImmutable); test ! -L $($script:RemoteImmutable); " +
            [string]::Join(' ', $restoreParts) +
            " rmdir -- $($script:RemoteLock)/preserved-models"
        [void](Invoke-RemoteCommand -Command $restoreModels)
        $modelsPreserved = $false
        Assert-LocalDeploymentUnchanged -Frozen $Frozen -Boundary 'after recursive scp'
        $normalize = Get-RemoteNormalizePrivateContentScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $normalize)

        $modelOwnershipVerify = [string]::Join(
            ' ',
            @($Frozen.ModelContract.Resources | ForEach-Object {
                $path = "$($script:RemoteImmutable)/$($_.RemoteName)"
                "test -f $path; test ! -L $path; " +
                    "test `"`$(stat -c %u $path)`" = `"`$expected_uid`"; " +
                    "test `"`$(stat -c %g $path)`" = `"`$expected_gid`"; " +
                    "test `"`$(stat -c %a $path)`" = 644;"
            })
        )
        $rejectSpecialEntries = Get-RemoteRejectSpecialEntriesScript `
            -Guard $guard `
            -Token $token
        $verify = @"
$rejectSpecialEntries
expected=$($script:RemoteLock)/expected.inventory; actual=$($script:RemoteLock)/actual.inventory;
: > "`$actual";
test "`$(stat -c %a $($script:RemoteWebRoot))" = 700;
set -- `$(stat -c '%u %g' $($script:RemoteWebRoot)); expected_uid=`$1; expected_gid=`$2;
test -d $($script:RemoteImmutable); test ! -L $($script:RemoteImmutable);
test "`$(stat -c %u $($script:RemoteImmutable))" = "`$expected_uid";
test "`$(stat -c %g $($script:RemoteImmutable))" = "`$expected_gid";
test "`$(stat -c %a $($script:RemoteImmutable))" = 755;
$modelOwnershipVerify
find $($script:RemoteWebRoot) -path $($script:RemoteLock) -prune -o -mindepth 1 -type d -printf '%P\n' | while IFS= read -r path; do
  mode=`$(stat -c %a "$($script:RemoteWebRoot)/`$path");
  printf 'd %s %s\n' "`$mode" "`$path" >> "`$actual";
done;
find $($script:RemoteWebRoot) -path $($script:RemoteLock) -prune -o -mindepth 1 -type f -printf '%P\n' | while IFS= read -r path; do
  file=$($script:RemoteWebRoot)/`$path; mode=`$(stat -c %a "`$file");
  sha=`$(sha256sum "`$file" | cut -d ' ' -f 1); bytes=`$(stat -c %s "`$file");
  printf 'f %s %s %s %s\n' "`$mode" "`$sha" "`$bytes" "`$path" >> "`$actual";
done;
LC_ALL=C sort -o "`$actual" "`$actual"; LC_ALL=C sort -o "`$expected" "`$expected";
cmp -s "`$expected" "`$actual";
"@ -replace "`r?`n", ' '
        [void](Invoke-RemoteCommand -Command $verify)
        $finalInventoryVerified = $true
        Assert-LocalDeploymentUnchanged -Frozen $Frozen -Boundary 'immediately before publication'
        $sourceIdentityBoundaryVerified = $true
        $publish = Get-RemotePublishRootScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $publish)
        $rootPublished = $true
    }
    catch {
        $operationError = $_
    }
    finally {
        $safeToReleaseLock = -not $privateRootPhaseStarted
        if ($lockAcquired -and $modelsPreserved) {
            try {
                $restoreModelGuard = Get-RemoteGuardScript `
                    -ExpectedParentIdentity $remote.ParentIdentity `
                    -ExpectedTargetIdentity $remote.TargetIdentity
                $restoreModelLockGuard = Get-RemoteLockGuardScript `
                    -Guard $restoreModelGuard `
                    -Token $token
                $restoreParts = @(
                    $Frozen.ModelContract.Resources | ForEach-Object {
                        $saved = "$($script:RemoteLock)/preserved-models/$($_.RemoteName)"
                        $final = "$($script:RemoteImmutable)/$($_.RemoteName)"
                        "if test -f $saved && test ! -e $final; then mv -- $saved $final; fi;"
                    }
                )
                $restoreModels = "set -eu; $restoreModelLockGuard " +
                    "mkdir -p -- $($script:RemoteImmutable); " +
                    "mkdir -p -- $($script:RemoteLock)/preserved-models; " +
                    [string]::Join(' ', $restoreParts) +
                    " test -z `"`$(find $($script:RemoteLock)/preserved-models " +
                    "-mindepth 1 -print -quit)`"; " +
                    "rmdir -- $($script:RemoteLock)/preserved-models"
                [void](Invoke-RemoteCommand -Command $restoreModels)
                $modelsPreserved = $false
                if ($privateRootPhaseStarted) {
                    [void]$recoveryEvidence.Add('pinned models restored under the owned lock')
                }
            }
            catch {
                $safeToReleaseLock = $false
                [void]$cleanupFailures.Add(
                    "remote pinned-model restoration failed: $($_.Exception.Message)"
                )
            }
        }
        if (
            $lockAcquired -and
            $privateRootPhaseStarted -and
            $null -eq $operationError -and
            $rootPrivatized -and
            $sourceIdentityBoundaryVerified -and
            $finalInventoryVerified -and
            $rootPublished
        ) {
            $safeToReleaseLock = $true
        }
        if ($lockAcquired -and $privateRootPhaseStarted -and $null -ne $operationError) {
            try {
                $statusGuard = Get-RemoteGuardScript `
                    -ExpectedParentIdentity $remote.ParentIdentity `
                    -ExpectedTargetIdentity $remote.TargetIdentity
                $status = Get-RemotePrivateRecoveryStatusScript `
                    -Guard $statusGuard `
                    -Token $token
                $statusOutput = @((Invoke-RemoteCommand -Command $status))
                $statusLines = @($statusOutput | Where-Object { $_ -match '^RECOVERY_STATE ' })
                if ($statusLines.Count -ne 1) {
                    throw 'remote private recovery status was missing or malformed'
                }
                [void]$recoveryEvidence.Add($statusLines[0])
            }
            catch {
                [void]$cleanupFailures.Add(
                    "remote private-root/owned-lock status verification failed: " +
                        $_.Exception.Message
                )
            }
        }
        if ($lockAcquired -and $safeToReleaseLock) {
            try {
                $releaseGuard = Get-RemoteGuardScript `
                    -ExpectedParentIdentity $remote.ParentIdentity `
                    -ExpectedTargetIdentity $remote.TargetIdentity
                $release = Get-RemoteLockReleaseScript -Guard $releaseGuard -Token $token
                [void](Invoke-RemoteCommand -Command $release)
            }
            catch {
                [void]$cleanupFailures.Add(
                    "remote owned-lock release failed: $($_.Exception.Message)"
                )
            }
        }
        try {
            [System.IO.File]::Delete($expectedInventoryPath)
        }
        catch {
            [void]$cleanupFailures.Add(
                "local expected-inventory cleanup failed: $($_.Exception.Message)"
            )
        }
    }
    if ($null -ne $operationError) {
        $failureDetails = [System.Collections.Generic.List[string]]::new()
        if ($privateRootPhaseStarted) {
            if ($recoveryEvidence.Count -ne 0) {
                [void]$failureDetails.Add(
                    "manual recovery required; recovery evidence: " +
                        [string]::Join('; ', $recoveryEvidence)
                )
            }
            else {
                [void]$failureDetails.Add(
                    'manual recovery required; private-root/owned-lock status unavailable'
                )
            }
        }
        if ($cleanupFailures.Count -ne 0) {
            [void]$failureDetails.Add(
                "cleanup/status also failed: $([string]::Join('; ', $cleanupFailures))"
            )
        }
        if ($failureDetails.Count -eq 0) {
            throw $operationError
        }
        throw [System.InvalidOperationException]::new(
            "$($operationError.Exception.Message); $([string]::Join('; ', $failureDetails))",
            $operationError.Exception
        )
    }
    if ($cleanupFailures.Count -ne 0) {
        throw "Deployment cleanup failed: $([string]::Join('; ', $cleanupFailures))"
    }
    Write-Host "Deployment copied and fully verified the frozen dist inventory at plex:$($script:RemoteWebRoot)."
    Write-Host 'Run a production-target harness command to validate the public origin before closing the milestone item.'
}

function Invoke-ParallaxProductionDeployment {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][bool]$DeployRequested,
        [Parameter(Mandatory = $true)][bool]$MutationApproved
    )

    $resolvedRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $distPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot 'dist'))
    $sitePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot 'site'))
    if ($distPath -eq $sitePath -or -not $distPath.StartsWith(
        $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Resolved dist path is outside the repository or aliases the frozen site source: $distPath"
    }
    $nodeVersion = (& node.exe --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.18.1') {
        throw "node.exe must be the pinned v24.18.1; received $nodeVersion"
    }
    $pnpmVersion = (& pnpm.cmd --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '11.12.0') {
        throw "pnpm.cmd must be the pinned 11.12.0; received $pnpmVersion"
    }
    Write-Host 'Building and verifying a fresh production dist with the pinned project toolchain...'
    [void](Invoke-CheckedNative -Executable 'pnpm.cmd' -Arguments @('build'))
    $frozen = Get-ValidatedLocalDeployment -DistPath $distPath

    $frozenPlaceholder = Join-Path $sitePath 'index.html'
    if (
        (Test-Path -LiteralPath $frozenPlaceholder -PathType Leaf) -and
        (Get-Sha256Hex -Path $frozenPlaceholder) -eq
            (Get-Sha256Hex -Path $frozen.IndexPath)
    ) {
        throw 'Refusing to deploy: dist/index.html is the frozen site placeholder'
    }
    $distIndex = Get-Content -LiteralPath $frozen.IndexPath -Raw
    if ($distIndex -match '(?i)\bmemory64\b|built-in AI Prompt API') {
        throw 'Refusing to deploy obsolete placeholder capability framing from dist/index.html'
    }
    Invoke-ProductionDeploymentCore `
        -Frozen $frozen `
        -DeployRequested $DeployRequested `
        -MutationApproved $MutationApproved
}

function Invoke-ParallaxProductionDeploymentEntrypoint {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][bool]$DeployRequested,
        [Parameter(Mandatory = $true)][bool]$MutationApproved,
        [Parameter(DontShow = $true)]
        [scriptblock]$DeploymentInvoker = {
            param(
                [string]$EntryRepositoryRoot,
                [bool]$EntryDeployRequested,
                [bool]$EntryMutationApproved
            )
            Invoke-ParallaxProductionDeployment `
                -RepositoryRoot $EntryRepositoryRoot `
                -DeployRequested $EntryDeployRequested `
                -MutationApproved $EntryMutationApproved
        }
    )
    & $DeploymentInvoker $RepositoryRoot $DeployRequested $MutationApproved
    $mode = if ($DeployRequested) { 'deploy' } else { 'preview' }
    Write-Output "PARALLAX_PRODUCTION_ENTRYPOINT_COMPLETE mode=$mode"
}

if (-not $productionEntryInternalLoadOnly) {
    $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $approved = $false
    if ($Deploy) {
        $approved = $PSCmdlet.ShouldProcess(
            'plex:/var/www/parallax-web.com children',
            'Lock the fixed webroot, delete all non-lock children, recursively copy dist, and verify every file'
        )
    }
    Invoke-ParallaxProductionDeploymentEntrypoint `
        -RepositoryRoot $repositoryRoot `
        -DeployRequested ([bool]$Deploy) `
        -MutationApproved $approved
}
