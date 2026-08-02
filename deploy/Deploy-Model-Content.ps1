[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [switch]$Deploy,
    [Parameter(DontShow = $true)]
    [switch]$InternalLoadOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$modelEntryDeployRequested = [bool]$Deploy
$modelEntryInternalLoadOnly = [bool]$InternalLoadOnly
try {
    . (Join-Path $PSScriptRoot 'Deploy-Production.ps1') -InternalLoadOnly
}
finally {
    $Deploy = $modelEntryDeployRequested
    $InternalLoadOnly = $modelEntryInternalLoadOnly
}

function Get-ValidatedLocalModelContent {
    param(
        [Parameter(Mandatory = $true)]$Contract,
        [Parameter(Mandatory = $true)][string]$LocalDirectory
    )
    $resolved = [System.IO.Path]::GetFullPath($LocalDirectory)
    if (
        $resolved -ne [System.IO.Path]::GetFullPath($Contract.LocalDirectory) -or
        -not (Test-Path -LiteralPath $resolved -PathType Container)
    ) {
        throw 'Pinned model-content directory is missing or changed'
    }
    $actualNames = @(
        Get-ChildItem -LiteralPath $resolved -File -Force |
            Select-Object -ExpandProperty Name |
            Sort-Object
    )
    $expectedNames = @($Contract.Resources.LocalName | Sort-Object)
    if (@($expectedNames | Where-Object { $_ -notin $actualNames }).Count -ne 0) {
        throw 'Pinned model-content directory is missing one or more managed shard files'
    }
    $files = [System.Collections.Generic.List[object]]::new()
    foreach ($resource in $Contract.Resources) {
        $path = [System.IO.Path]::GetFullPath((Join-Path $resolved $resource.LocalName))
        if (
            -not $path.StartsWith(
                $resolved + [System.IO.Path]::DirectorySeparatorChar,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -or
            -not (Test-Path -LiteralPath $path -PathType Leaf)
        ) {
            throw "Pinned model shard is missing or escapes its directory: $($resource.LocalName)"
        }
        $item = Get-Item -LiteralPath $path -Force
        if (
            ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $item.Length -ne $resource.Bytes -or
            (Get-Sha256Hex -Path $path) -ne $resource.Sha256
        ) {
            throw "Pinned model shard identity mismatch: $($resource.LocalName)"
        }
        [void]$files.Add([pscustomobject]@{
            Bytes = $resource.Bytes
            LocalName = $resource.LocalName
            Path = $path
            RemoteName = $resource.RemoteName
            Sha256 = $resource.Sha256
        })
    }
    return [pscustomobject]@{
        Files = @($files | Sort-Object RemoteName)
        LocalDirectory = $resolved
        SourceKey = $Contract.SourceKey
        TotalBytes = $Contract.TotalBytes
    }
}

function Assert-RemoteModelStateSafeForMutation {
    param(
        [Parameter(Mandatory = $true)]$Contract,
        [Parameter(Mandatory = $true)]$RemoteModels
    )
    if ($RemoteModels.Extras.Count -ne 0) {
        throw 'Refusing model upload while unexpected model-*.gguf objects exist'
    }
    if (
        $RemoteModels.Root.ImmutableUid -ne $RemoteModels.Root.WebRootUid -or
        $RemoteModels.Root.ImmutableGid -ne $RemoteModels.Root.WebRootGid
    ) {
        throw 'Refusing model upload because immutable directory ownership differs from the guarded webroot'
    }
    foreach ($resource in $Contract.Resources) {
        $state = @(
            $RemoteModels.States |
                Where-Object { $_.RemoteName -eq $resource.RemoteName }
        )
        if ($state.Count -ne 1 -or $state[0].State -eq 'unsafe') {
            throw 'Refusing model upload because a managed final path is not a regular file'
        }
        if (
            $state[0].State -eq 'present' -and
            (
                $state[0].Uid -ne $RemoteModels.Root.WebRootUid -or
                $state[0].Gid -ne $RemoteModels.Root.WebRootGid
            )
        ) {
            throw "Refusing model upload because managed file ownership is unsafe: $($resource.RemoteName)"
        }
    }
}

function Invoke-ModelContentDeploymentCore {
    param(
        [Parameter(Mandatory = $true)]$Contract,
        [Parameter(Mandatory = $true)]$Local,
        [Parameter(Mandatory = $true)][bool]$DeployRequested,
        [Parameter(Mandatory = $true)][bool]$MutationApproved
    )
    Write-Host (
        "Validated local model content: $($Local.Files.Count) files, " +
        "$($Local.TotalBytes) bytes from logical source $($Local.SourceKey)."
    )
    $remote = Read-RemoteIdentity
    $remoteModels = Read-RemoteModelState -Contract $Contract
    foreach ($file in $Local.Files) {
        $state = @(
            $remoteModels.States |
                Where-Object { $_.RemoteName -eq $file.RemoteName }
        )[0]
        $action = if (
            $state.State -eq 'present' -and
            $state.Bytes -eq $file.Bytes -and
            $state.Sha256 -eq $file.Sha256 -and
            $state.Uid -eq $remoteModels.Root.WebRootUid -and
            $state.Gid -eq $remoteModels.Root.WebRootGid -and
            $state.Mode -eq '644' -and
            $remoteModels.Root.ImmutableUid -eq $remoteModels.Root.WebRootUid -and
            $remoteModels.Root.ImmutableGid -eq $remoteModels.Root.WebRootGid -and
            $remoteModels.Root.ImmutableMode -eq '755'
        ) {
            'skip exact'
        }
        elseif ($state.State -eq 'unsafe') {
            'blocked unsafe'
        }
        elseif (
            $state.State -eq 'present' -and
            (
                $state.Uid -ne $remoteModels.Root.WebRootUid -or
                $state.Gid -ne $remoteModels.Root.WebRootGid -or
                $remoteModels.Root.ImmutableUid -ne $remoteModels.Root.WebRootUid -or
                $remoteModels.Root.ImmutableGid -ne $remoteModels.Root.WebRootGid
            )
        ) {
            'blocked ownership'
        }
        elseif (
            $state.State -eq 'present' -and
            $state.Bytes -eq $file.Bytes -and
            $state.Sha256 -eq $file.Sha256
        ) {
            'normalize permissions'
        }
        else {
            'upload and publish'
        }
        Write-Host (
            "  ${action}: $($file.LocalName) -> " +
            "plex:$($script:RemoteImmutable)/$($file.RemoteName)"
        )
    }
    foreach ($extra in $remoteModels.Extras) {
        Write-Host "  blocked unexpected managed-prefix object: $extra"
    }
    if (-not $DeployRequested) {
        Write-Host 'PREVIEW ONLY: no remote model files were copied or changed.'
        Write-Host (
            'Run pnpm deploy:model-content:apply (the fixed no-argument apply wrapper) ' +
            'to request the guarded uploads.'
        )
        return
    }
    if (-not $MutationApproved) {
        Write-Host 'Model-content deployment cancelled before remote mutation.'
        return
    }
    Assert-RemoteModelStateSafeForMutation -Contract $Contract -RemoteModels $remoteModels

    $token = [guid]::NewGuid().ToString('N')
    $guard = Get-RemoteGuardScript `
        -ExpectedParentIdentity $remote.ParentIdentity `
        -ExpectedTargetIdentity $remote.TargetIdentity
    $lockAcquired = $false
    $operationError = $null
    $cleanupError = $null
    try {
        $acquire = Get-RemoteLockAcquireScript -Guard $guard -Token $token
        [void](Invoke-RemoteCommand -Command $acquire)
        $lockAcquired = $true
        $lockGuard = Get-RemoteLockGuardScript -Guard $guard -Token $token
        $lockedModels = Read-RemoteModelState -Contract $Contract
        Assert-RemoteModelStateSafeForMutation -Contract $Contract -RemoteModels $lockedModels
        $expectedUid = $lockedModels.Root.WebRootUid
        $expectedGid = $lockedModels.Root.WebRootGid
        $normalizeParts = @(
            $lockedModels.States |
                Where-Object { $_.State -eq 'present' } |
                ForEach-Object {
                    $path = "$($script:RemoteImmutable)/$($_.RemoteName)"
                    "test -f $path; test ! -L $path; " +
                        "test `"`$(stat -c %u $path)`" = '$expectedUid'; " +
                        "test `"`$(stat -c %g $path)`" = '$expectedGid'; " +
                        "chmod 0644 -- $path;"
                }
        )
        $normalizeModels = "set -eu; $lockGuard " +
            "test -d $($script:RemoteImmutable); test ! -L $($script:RemoteImmutable); " +
            "test `"`$(stat -c %u $($script:RemoteImmutable))`" = '$expectedUid'; " +
            "test `"`$(stat -c %g $($script:RemoteImmutable))`" = '$expectedGid'; " +
            "chmod 0755 -- $($script:RemoteImmutable); " +
            [string]::Join(' ', $normalizeParts)
        [void](Invoke-RemoteCommand -Command $normalizeModels)
        $lockedModels = Read-RemoteModelState -Contract $Contract
        Assert-RemoteModelStateSafeForMutation -Contract $Contract -RemoteModels $lockedModels
        if ($lockedModels.Root.ImmutableMode -ne '755') {
            throw 'Remote immutable directory mode normalization failed'
        }
        if (@(
            $lockedModels.States |
                Where-Object { $_.State -eq 'present' -and $_.Mode -ne '644' }
        ).Count -ne 0) {
            throw 'Remote model file mode normalization failed'
        }
        $immutableGuard = (
            "test -d $($script:RemoteImmutable); " +
            "test ! -L $($script:RemoteImmutable); " +
            "set -- `$(stat -c '%u %g %a' $($script:RemoteImmutable)); " +
            "test `"`$1`" = '$expectedUid'; test `"`$2`" = '$expectedGid'; " +
            "test `"`$3`" = 755;"
        )
        foreach ($file in $Local.Files) {
            $prior = @(
                $lockedModels.States |
                    Where-Object { $_.RemoteName -eq $file.RemoteName }
            )[0]
            if (
                $prior.State -eq 'present' -and
                $prior.Bytes -eq $file.Bytes -and
                $prior.Sha256 -eq $file.Sha256 -and
                $prior.Uid -eq $expectedUid -and
                $prior.Gid -eq $expectedGid -and
                $prior.Mode -eq '644'
            ) {
                continue
            }
            $temporary = "$($script:RemoteLock)/upload-$($file.Sha256).partial"
            Copy-ToRemote -Source $file.Path -Destination $temporary
            $final = "$($script:RemoteImmutable)/$($file.RemoteName)"
            $publish = "set -eu; $lockGuard $immutableGuard " +
                "test -f $temporary; test ! -L $temporary; " +
                "test `"`$(stat -c %s $temporary)`" = '$($file.Bytes)'; " +
                "test `"`$(sha256sum $temporary | cut -d ' ' -f 1)`" = '$($file.Sha256)'; " +
                "if test -e $final; then test -f $final; test ! -L $final; " +
                "test `"`$(stat -c %u $final)`" = '$expectedUid'; " +
                "test `"`$(stat -c %g $final)`" = '$expectedGid'; fi; " +
                "test `"`$(stat -c %u $temporary)`" = '$expectedUid'; " +
                "chgrp -- '$expectedGid' $temporary; chmod 0644 -- $temporary; " +
                "test `"`$(stat -c %g $temporary)`" = '$expectedGid'; " +
                "mv -f -- $temporary $final; " +
                "test `"`$(stat -c %u $final)`" = '$expectedUid'; " +
                "test `"`$(stat -c %g $final)`" = '$expectedGid'; " +
                "test `"`$(stat -c %a $final)`" = 644; " +
                "test `"`$(stat -c %s $final)`" = '$($file.Bytes)'; " +
                "test `"`$(sha256sum $final | cut -d ' ' -f 1)`" = '$($file.Sha256)'"
            [void](Invoke-RemoteCommand -Command $publish)
        }
        $finalState = Read-RemoteModelState -Contract $Contract
        if (-not (Test-RemoteModelsExact -Contract $Contract -RemoteModels $finalState)) {
            throw 'Remote model inventory did not equal the exact pinned five-shard set'
        }
    }
    catch {
        $operationError = $_
    }
    finally {
        if ($lockAcquired) {
            try {
                $releaseGuard = Get-RemoteGuardScript `
                    -ExpectedParentIdentity $remote.ParentIdentity `
                    -ExpectedTargetIdentity $remote.TargetIdentity
                $release = Get-RemoteLockReleaseScript -Guard $releaseGuard -Token $token
                [void](Invoke-RemoteCommand -Command $release)
            }
            catch {
                $cleanupError = $_
            }
        }
    }
    if ($null -ne $operationError) {
        if ($null -ne $cleanupError) {
            throw [System.InvalidOperationException]::new(
                "$($operationError.Exception.Message); owned-lock cleanup also failed: " +
                    $cleanupError.Exception.Message,
                $operationError.Exception
            )
        }
        throw $operationError
    }
    if ($null -ne $cleanupError) {
        throw "Model-content deployment cleanup failed: $($cleanupError.Exception.Message)"
    }
    Write-Host (
        "Model-content deployment verified the exact five pinned objects at " +
        "plex:$($script:RemoteImmutable)."
    )
}

function Invoke-ParallaxModelContentDeployment {
    param(
        [Parameter(Mandatory = $true)][bool]$DeployRequested,
        [Parameter(Mandatory = $true)][bool]$MutationApproved
    )
    $contract = Get-ModelContentContract
    $local = Get-ValidatedLocalModelContent `
        -Contract $contract `
        -LocalDirectory $contract.LocalDirectory
    Invoke-ModelContentDeploymentCore `
        -Contract $contract `
        -Local $local `
        -DeployRequested $DeployRequested `
        -MutationApproved $MutationApproved
}

if (-not $modelEntryInternalLoadOnly) {
    $approved = $false
    if ($Deploy) {
        $approved = $PSCmdlet.ShouldProcess(
            'plex:/var/www/parallax-web.com/immutable exact five model objects',
            'Lock the fixed webroot, upload missing/wrong objects privately, verify, and publish by content hash'
        )
    }
    Invoke-ParallaxModelContentDeployment `
        -DeployRequested ([bool]$Deploy) `
        -MutationApproved $approved
}
