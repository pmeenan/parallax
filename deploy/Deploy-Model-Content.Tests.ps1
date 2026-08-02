$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'Deploy-Model-Content.ps1') -InternalLoadOnly

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "model deployment behavior assertion failed: $Message" }
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

$contract = Get-ModelContentContract
$local = [pscustomobject]@{
    Files = @($contract.Resources | ForEach-Object {
        [pscustomobject]@{
            Bytes = $_.Bytes
            LocalName = $_.LocalName
            Path = "C:\fixed\$($_.LocalName)"
            RemoteName = $_.RemoteName
            Sha256 = $_.Sha256
        }
    })
    LocalDirectory = $contract.LocalDirectory
    SourceKey = $contract.SourceKey
    TotalBytes = $contract.TotalBytes
}
$script:Scenario = 'exact'
$script:RemoteCalls = [System.Collections.Generic.List[string]]::new()
$script:CopyCalls = [System.Collections.Generic.List[string]]::new()
$script:ModelReads = 0

function Reset-Fakes {
    param([string]$Scenario)
    $script:Scenario = $Scenario
    $script:RemoteCalls.Clear()
    $script:CopyCalls.Clear()
    $script:ModelReads = 0
}

function Invoke-RemoteCommand {
    param([string]$Command)
    [void]$script:RemoteCalls.Add($Command)
    if ($Command -match "printf 'IDENTITY") {
        return @('IDENTITY 10:20 10:30 755 755', '/var/www/parallax-web.com/immutable')
    }
    if ($Command -match "printf 'MODEL") {
        $script:ModelReads += 1
        $immutableUid = if ($script:Scenario -eq 'immutable-owner') { 1001 } else { 1000 }
        $immutableMode = if (
            $script:Scenario -eq 'immutable-mode' -and $script:ModelReads -lt 3
        ) { '775' } else { '755' }
        $lines = @("MODEL_ROOT 1000 1000 755 $immutableUid 1000 $immutableMode")
        $lines += @($contract.Resources | ForEach-Object {
            $state = 'present'
            $bytes = $_.Bytes
            $sha = $_.Sha256
            $uid = 1000
            $mode = '644'
            if ($script:ModelReads -lt 4) {
                if ($script:Scenario -in @('missing', 'copy-failure')) {
                    $state = 'missing'; $bytes = 0; $sha = '-'
                }
                elseif ($script:Scenario -eq 'wrong') {
                    $bytes = 1; $sha = '0' * 64
                }
                elseif ($script:Scenario -eq 'unsafe' -and $script:ModelReads -eq 1) {
                    $state = 'unsafe'; $bytes = 0; $sha = '-'
                }
            }
            if (
                $script:Scenario -eq 'locked-drift' -and
                $script:ModelReads -ge 2 -and
                $_.RemoteName -eq $contract.Resources[0].RemoteName
            ) {
                $state = 'unsafe'; $bytes = 0; $sha = '-'
            }
            if (
                $script:Scenario -eq 'file-owner' -and
                $_.RemoteName -eq $contract.Resources[0].RemoteName
            ) {
                $uid = 1001
            }
            if (
                $script:Scenario -eq 'file-mode' -and
                $script:ModelReads -lt 3 -and
                $_.RemoteName -eq $contract.Resources[0].RemoteName
            ) {
                $mode = '664'
            }
            if ($state -ne 'present') { $uid = 0; $mode = '000' }
            "MODEL $($_.RemoteName) $state $bytes $sha $uid 1000 $mode"
        })
        if ($script:Scenario -eq 'extra') {
            $lines += "EXTRA model-$('e' * 64).gguf"
        }
        return $lines
    }
    return @()
}

function Copy-ToRemote {
    param([string]$Source, [string]$Destination, [switch]$Recursive)
    [void]$script:CopyCalls.Add("$Source|$Destination")
    if ($script:Scenario -eq 'copy-failure') { throw 'simulated interrupted scp upload' }
}

Reset-Fakes 'missing'
Invoke-ModelContentDeploymentCore `
    -Contract $contract -Local $local -DeployRequested $false -MutationApproved $false
Assert-True ($script:CopyCalls.Count -eq 0) 'preview must not copy'
Assert-True (
    @($script:RemoteCalls | Where-Object { $_ -match 'mkdir -m 0700' }).Count -eq 0
) 'preview must not acquire the lock'

Reset-Fakes 'exact'
Invoke-ModelContentDeploymentCore `
    -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
Assert-True ($script:CopyCalls.Count -eq 0) 'exact remote objects must be skipped'

foreach ($scenario in @('missing', 'wrong')) {
    Reset-Fakes $scenario
    Invoke-ModelContentDeploymentCore `
        -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
    Assert-True ($script:CopyCalls.Count -eq 5) "$scenario objects must be uploaded"
    Assert-True (
        @($script:RemoteCalls | Where-Object {
            $_ -match 'sha256sum .*/upload-' -and
            $_ -match 'mv -f --' -and
            $_ -match 'stat -c %u .*/immutable/model-' -and
            $_ -match 'stat -c %g .*/immutable/model-'
        }).Count -eq 5
    ) "$scenario uploads must verify existing/final ownership and bytes before publication"
}

foreach ($scenario in @('extra', 'unsafe')) {
    Reset-Fakes $scenario
    Assert-Throws {
        Invoke-ModelContentDeploymentCore `
            -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
    } '(unexpected|regular file)'
    Assert-True ($script:CopyCalls.Count -eq 0) "$scenario must block before upload"
}

foreach ($scenario in @('immutable-owner', 'file-owner')) {
    Reset-Fakes $scenario
    Assert-Throws {
        Invoke-ModelContentDeploymentCore `
            -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
    } 'ownership'
    Assert-True ($script:CopyCalls.Count -eq 0) "$scenario must fail before upload"
}

foreach ($scenario in @('immutable-mode', 'file-mode')) {
    Reset-Fakes $scenario
    Invoke-ModelContentDeploymentCore `
        -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
    Assert-True ($script:CopyCalls.Count -eq 0) "$scenario must normalize without uploading exact bytes"
    Assert-True (
        @($script:RemoteCalls | Where-Object {
            $_ -match 'chmod 0755 -- /var/www/parallax-web.com/immutable' -and
            $_ -match 'chmod 0644 -- /var/www/parallax-web.com/immutable/model-'
        }).Count -eq 1
    ) "$scenario must normalize guarded directory and file modes under the lock"
}

Reset-Fakes 'locked-drift'
Assert-Throws {
    Invoke-ModelContentDeploymentCore `
        -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
} 'regular file'
Assert-True ($script:CopyCalls.Count -eq 0) 'under-lock model drift must fail before upload'

Reset-Fakes 'copy-failure'
Assert-Throws {
    Invoke-ModelContentDeploymentCore `
        -Contract $contract -Local $local -DeployRequested $true -MutationApproved $true
} 'interrupted scp'
Assert-True (
    @($script:RemoteCalls | Where-Object {
        $_ -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
        $_ -notmatch 'mkdir -m 0700'
    }).Count -eq 1
) 'interrupted upload must release and thereby remove its private temp area'

$unsafeContract = [pscustomobject]@{
    LocalDirectory = 'C:\not-the-pinned-directory'
    Resources = $contract.Resources
}
Assert-Throws {
    Get-ValidatedLocalModelContent `
        -Contract $unsafeContract `
        -LocalDirectory $unsafeContract.LocalDirectory
} 'missing or changed'

Assert-True (
    (Get-Command Invoke-ParallaxModelContentDeployment).Parameters.Keys -notcontains
        'RemoteHost' -and
    (Get-Command Invoke-ParallaxModelContentDeployment).Parameters.Keys -notcontains
        'RemotePath'
) 'public model deploy entrypoint must not expose remote target parameters'

Write-Host 'Deploy-Model-Content behavior tests: PASS'
