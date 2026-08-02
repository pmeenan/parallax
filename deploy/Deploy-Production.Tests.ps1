$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$productionScriptPath = Join-Path $PSScriptRoot 'Deploy-Production.ps1'
$internalLoadOutput = @(. $productionScriptPath -InternalLoadOnly)
if ($internalLoadOutput.Count -ne 0) {
    throw 'deployment behavior assertion failed: InternalLoadOnly import must not execute the entrypoint'
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "deployment behavior assertion failed: $Message" }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern)
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "expected failure matching $Pattern, received: $($_.Exception.Message)"
        }
        return
    }
    throw "expected failure matching $Pattern"
}

$productionSource = Get-Content -LiteralPath $productionScriptPath -Raw
Assert-True (
    $productionSource -match
        '(?s)\$productionEntryInternalLoadOnly\s*=\s*\[bool\]\$InternalLoadOnly\s*try\s*\{.*Resolve-ModelContentSource\.ps1.*-InternalLoadOnly\s*\}\s*finally\s*\{\s*\$InternalLoadOnly\s*=\s*\$productionEntryInternalLoadOnly\s*\}'
) 'production entrypoint authority must survive resolver dot-source scope mutation'
Assert-True (
    $productionSource -match 'if\s*\(-not\s*\$productionEntryInternalLoadOnly\)'
) 'default execution must use the parent-captured InternalLoadOnly value'
Assert-True (
    $productionSource -notmatch 'if\s*\(-not\s*\$InternalLoadOnly\)'
) 'default execution must not trust the child-mutated InternalLoadOnly parameter'
$rejectSpecialSource = Get-RemoteRejectSpecialEntriesScript `
    -Guard (Get-RemoteGuardScript) `
    -Token ('a' * 32)
Assert-True (
    $rejectSpecialSource -match
        "-printf 'PARALLAX_UNSUPPORTED_ENTRY_V1' -quit.*case .*unsupported_marker.*''\) :;; .*PARALLAX_UNSUPPORTED_ENTRY_V1\)" -and
    $rejectSpecialSource -match "\*\) echo 'malformed-unsupported-entry-probe'.*exit 76" -and
    $rejectSpecialSource -notmatch 'if test -n .*unsupported_entry'
) 'special-entry rejection must decide only from the exact empty/fixed/malformed marker states'
Assert-True (
    $rejectSpecialSource -match "-printf '%P' -quit" -and
    $rejectSpecialSource -match "tr -c 'A-Za-z0-9\._/-' '\?' \| cut -c 1-512" -and
    $rejectSpecialSource -match "unsupported_diagnostic='<path-unavailable>'"
) 'unsupported paths must be bounded diagnostic-only evidence with an explicit fallback'

$script:MockEntrypointCalls = [System.Collections.Generic.List[object]]::new()
$entrypointOutput = @(
    Invoke-ParallaxProductionDeploymentEntrypoint `
        -RepositoryRoot $PSScriptRoot `
        -DeployRequested $false `
        -MutationApproved $false `
        -DeploymentInvoker {
            param($RepositoryRoot, $DeployRequested, $MutationApproved)
            [void]$script:MockEntrypointCalls.Add([pscustomobject]@{
                RepositoryRoot = $RepositoryRoot
                DeployRequested = $DeployRequested
                MutationApproved = $MutationApproved
            })
        }
)
Assert-True (
    $script:MockEntrypointCalls.Count -eq 1 -and
    $script:MockEntrypointCalls[0].RepositoryRoot -eq $PSScriptRoot -and
    -not $script:MockEntrypointCalls[0].DeployRequested -and
    -not $script:MockEntrypointCalls[0].MutationApproved
) 'default preview entrypoint must invoke its deployment authority exactly once'
Assert-True (
    $entrypointOutput.Count -eq 1 -and
    $entrypointOutput[0] -ceq 'PARALLAX_PRODUCTION_ENTRYPOINT_COMPLETE mode=preview'
) 'preview success requires the exact completion marker even when the mocked core emits no output'

function Invoke-RemoteShellScript {
    param(
        [Parameter(Mandatory = $true)][string]$Shell,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$FindmntBody,
        [Parameter(Mandatory = $true)][string]$Body
    )
    $fakeBin = Join-Path $Root "fake-bin-$([guid]::NewGuid().ToString('N'))"
    [void](New-Item -ItemType Directory -Path $fakeBin -Force)
    $findmnt = Join-Path $fakeBin 'findmnt'
    [System.IO.File]::WriteAllText($findmnt, "#!/bin/sh`n$FindmntBody`n")
    & $Shell -c 'PATH=/usr/bin:$PATH; chmod +x "$1"; test -x "$1"' 'guard-test' $findmnt
    if ($LASTEXITCODE -ne 0) { throw "failed to prepare semantic findmnt fixture" }

    $guardPath = Join-Path $Root 'guard-test.sh'
    $shellFakeBin = (
        & $Shell -c 'PATH=/usr/bin:$PATH; cygpath -u "$1"' 'guard-test' $fakeBin
    ).Trim()
    if ($LASTEXITCODE -ne 0 -or $shellFakeBin -eq '') {
        throw "failed to resolve semantic findmnt fixture path"
    }
    [System.IO.File]::WriteAllText(
        $guardPath,
        "#!/bin/sh`nset -eu`nPATH='$shellFakeBin':/usr/bin:`$PATH`n$Body`n"
    )
    $priorErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Shell $guardPath 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $priorErrorActionPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = [string]::Join("`n", $output)
    }
}

function Invoke-WslShellScript {
    param(
        [Parameter(Mandatory = $true)][string]$FindmntBody,
        [Parameter(Mandatory = $true)][string]$Body
    )
    $findmntSource = "#!/bin/sh`n$FindmntBody`n"
    $findmntBase64 = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes($findmntSource)
    )
    $source = @"
set -eu
fake_bin=`$(mktemp -d)
trap 'rm -rf -- "`$fake_bin"' EXIT HUP INT TERM
printf '%s' '$findmntBase64' | base64 -d > "`$fake_bin/findmnt"
chmod 0700 "`$fake_bin/findmnt"
PATH="`$fake_bin:/usr/bin:/bin:`$PATH"
$Body
"@
    $sourceBase64 = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes($source)
    )
    $priorErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(
            & wsl.exe sh -lc "printf '%s' '$sourceBase64' | base64 -d | sh" 2>&1
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $priorErrorActionPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = [string]::Join("`n", $output)
    }
}

function New-Fixture {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) "parallax-deploy-test-$([guid]::NewGuid().ToString('N'))"
    $dist = Join-Path $root 'dist'
    [void](New-Item -ItemType Directory -Path $root)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\dist') -Destination $dist -Recurse
    return [pscustomobject]@{ Dist = $dist; Root = $root }
}

function Copy-JsonDocument {
    param([Parameter(Mandatory = $true)]$Document)
    return ($Document | ConvertTo-Json -Depth 16 | ConvertFrom-Json)
}

function Assert-ModelProjectionRejects {
    param(
        [Parameter(Mandatory = $true)]$InstallManifest,
        [Parameter(Mandatory = $true)]$ModelContract,
        [Parameter(Mandatory = $true)][scriptblock]$Mutation,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $candidate = Copy-JsonDocument -Document $InstallManifest
    & $Mutation $candidate
    Assert-Throws {
        Assert-InstallManifestModelsMatchContract `
            -InstallManifest $candidate `
            -ModelContract $ModelContract
    } '(model projection|noncanonical model path)'
    Write-Host "Install-manifest model projection rejection: $Label"
}

function Assert-ModelContentContractRejects {
    param(
        $Document,
        [Parameter(Mandatory = $true)][string]$Label
    )
    Assert-Throws {
        ConvertTo-ValidatedModelContentContract -Document $Document
    } 'Model-content'
    Write-Host "Model-content schema-v2 rejection: $Label"
}

$script:Scenario = 'success'
$script:RemoteCalls = [System.Collections.Generic.List[string]]::new()
$script:CopyCalls = [System.Collections.Generic.List[string]]::new()
$script:DriftPath = ''
$script:ModelReads = 0
$script:RecursiveCopyCalls = 0

function Invoke-RemoteCommand {
    param([string]$Command)
    [void]$script:RemoteCalls.Add($Command)
    if ($Command -match "printf 'IDENTITY") {
        if ($script:Scenario -eq 'retained-lock-preview') {
            throw 'ssh.exe failed with exit code 75: deployment-lock-present:/var/www/parallax-web.com/.parallax-deploy.lock'
        }
        if ($script:Scenario -eq 'bad-permission-or-mount') {
            throw 'remote permission or mount guard rejected the target'
        }
        return @(
            'IDENTITY 10:20 10:30 755 755',
            '/var/www/parallax-web.com/existing-sentinel'
        )
    }
    if ($Command -match "printf 'MODEL") {
        $script:ModelReads += 1
        $lines = @(
            'MODEL_ROOT 1000 1000 755 ' +
                $(if ($script:Scenario -eq 'immutable-owner') { '1001' } else { '1000' }) +
                ' 1000 ' +
                $(if ($script:Scenario -eq 'immutable-mode') { '775' } else { '755' })
        )
        $lines += @(
            $frozen.ModelContract.Resources | ForEach-Object {
                $state = if (
                    $script:Scenario -eq 'missing-model' -and
                    $_.RemoteName -eq $frozen.ModelContract.Resources[0].RemoteName
                ) { 'missing' } else { 'present' }
                if (
                    $script:Scenario -eq 'locked-model-drift' -and
                    $script:ModelReads -ge 2 -and
                    $_.RemoteName -eq $frozen.ModelContract.Resources[0].RemoteName
                ) {
                    $state = 'unsafe'
                }
                $bytes = if ($state -eq 'present') { $_.Bytes } else { 0 }
                $sha = if ($state -eq 'present') { $_.Sha256 } else { '-' }
                $uid = if (
                    $script:Scenario -eq 'model-owner' -and
                    $_.RemoteName -eq $frozen.ModelContract.Resources[0].RemoteName
                ) { 1001 } else { 1000 }
                $mode = if (
                    $script:Scenario -eq 'model-mode' -and
                    $_.RemoteName -eq $frozen.ModelContract.Resources[0].RemoteName
                ) { '664' } else { '644' }
                if ($state -ne 'present') { $uid = 0; $mode = '000' }
                "MODEL $($_.RemoteName) $state $bytes $sha $uid 1000 $mode"
            }
        )
        if ($script:Scenario -eq 'extra-model') {
            $lines += "EXTRA model-$('e' * 64).gguf"
        }
        return $lines
    }
    if ($Command -match 'mkdir -m 0700 -- /var/www/parallax-web.com/.parallax-deploy.lock') {
        if ($script:Scenario -eq 'target-swap') { throw 'remote inode continuity test failed' }
        if ($script:Scenario -eq 'lock-contention') { throw 'remote lock mkdir failed' }
    }
    if (
        $Command -match 'find /var/www/parallax-web.com -mindepth 1 -maxdepth 1' -and
        $Command -match '! -name .parallax-deploy.lock' -and
        $script:Scenario -eq 'delete-failure'
    ) {
        throw 'simulated bounded delete failure'
    }
    if ($Command -match 'expected=.*/expected.inventory' -and $script:Scenario -eq 'verification-failure') {
        throw 'remote full-inventory verification failed'
    }
    if (
        $Command -match 'expected=.*/expected.inventory' -and
        $script:Scenario -eq 'late-local-drift' -and
        $script:DriftPath -ne ''
    ) {
        [System.IO.File]::AppendAllText($script:DriftPath, 'late-drift')
        $script:DriftPath = ''
    }
    if (
        $Command -match 'symlink=.*find /var/www/parallax-web.com' -and
        $script:Scenario -eq 'normalization-failure'
    ) {
        throw 'simulated partial-content normalization failure'
    }
    if (
        $Command -match 'mkdir -m 0700 -- .*/preserved-models' -and
        $script:Scenario -in @('mid-preserve-failure', 'mid-preserve-and-restore-failure')
    ) {
        throw 'simulated mid-preserve model move failure'
    }
    if (
        $Command -match 'if test -f .*/preserved-models/' -and
        $script:Scenario -in @('model-restore-failure', 'mid-preserve-and-restore-failure')
    ) {
        throw 'simulated pinned-model restoration failure'
    }
    if ($Command -match "printf 'RECOVERY_STATE") {
        return @('RECOVERY_STATE root_mode=700 lock=owned target=/var/www/parallax-web.com')
    }
    return @()
}

function Copy-ToRemote {
    param([string]$Source, [string]$Destination, [switch]$Recursive)
    [void]$script:CopyCalls.Add("$Recursive|$Source|$Destination")
    if ($Recursive) {
        $script:RecursiveCopyCalls += 1
        if (
            ($script:Scenario -in @('first-scp-failure', 'model-restore-failure') -and
                $script:RecursiveCopyCalls -eq 1) -or
            ($script:Scenario -eq 'mid-scp-failure' -and $script:RecursiveCopyCalls -eq 2)
        ) {
            throw 'simulated recursive scp failure'
        }
    }
    if ($Recursive -and $script:Scenario -eq 'local-drift' -and $script:DriftPath -ne '') {
        [System.IO.File]::AppendAllText($script:DriftPath, 'drift')
        $script:DriftPath = ''
    }
}

function Reset-Fakes {
    param([string]$Scenario)
    $script:Scenario = $Scenario
    $script:RemoteCalls.Clear()
    $script:CopyCalls.Clear()
    $script:DriftPath = ''
    $script:ModelReads = 0
    $script:RecursiveCopyCalls = 0
}

$fixtures = [System.Collections.Generic.List[string]]::new()
try {
    $fixture = New-Fixture
    [void]$fixtures.Add($fixture.Root)
    $frozen = Get-ValidatedLocalDeployment -DistPath $fixture.Dist

    $modelDocument = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model-content.json') `
        -Raw | ConvertFrom-Json
    foreach ($case in @(
        @{ Label = 'root array'; Document = @($modelDocument) },
        @{ Label = 'root null'; Document = $null }
    )) {
        Assert-ModelContentContractRejects -Document $case.Document -Label $case.Label
    }
    foreach ($mutation in @(
        @{ Label = 'root extra'; Change = { param($d) $d | Add-Member extra 'forbidden' } },
        @{ Label = 'root missing'; Change = { param($d) $d.PSObject.Properties.Remove('source') } },
        @{ Label = 'schema string'; Change = { param($d) $d.schemaVersion = '2' } },
        @{ Label = 'schema double'; Change = { param($d) $d.schemaVersion = [double]2 } },
        @{ Label = 'source null'; Change = { param($d) $d.source = $null } },
        @{ Label = 'source array'; Change = { param($d) $d.source = @($d.source) } },
        @{ Label = 'source extra'; Change = { param($d) $d.source | Add-Member extra 'forbidden' } },
        @{ Label = 'source missing'; Change = { param($d) $d.source.PSObject.Properties.Remove('id') } },
        @{ Label = 'source id type'; Change = { param($d) $d.source.id = 42 } },
        @{ Label = 'source id case'; Change = { param($d) $d.source.id = $d.source.id.ToUpperInvariant() } },
        @{ Label = 'registry key type'; Change = { param($d) $d.source.registryKey = 42 } },
        @{ Label = 'registry key case'; Change = { param($d) $d.source.registryKey = 'Production-model-content' } },
        @{ Label = 'resources null'; Change = { param($d) $d.resources = $null } },
        @{ Label = 'resource null'; Change = { param($d) $d.resources[0] = $null } },
        @{ Label = 'resource array'; Change = { param($d) $d.resources[0] = @($d.resources[0]) } },
        @{ Label = 'resource extra'; Change = { param($d) $d.resources[0] | Add-Member extra 'forbidden' } },
        @{ Label = 'resource missing'; Change = { param($d) $d.resources[0].PSObject.Properties.Remove('bytes') } },
        @{ Label = 'bytes string'; Change = { param($d) $d.resources[0].bytes = [string]$d.resources[0].bytes } },
        @{ Label = 'bytes double'; Change = { param($d) $d.resources[0].bytes = [double]$d.resources[0].bytes } },
        @{ Label = 'bytes wrong integer'; Change = { param($d) $d.resources[0].bytes += 1 } },
        @{ Label = 'local name type'; Change = { param($d) $d.resources[0].localName = 42 } },
        @{ Label = 'local name case'; Change = { param($d) $d.resources[0].localName = $d.resources[0].localName.ToLowerInvariant() } },
        @{ Label = 'local name swapped'; Change = { param($d) $d.resources[0].localName = $d.resources[1].localName } },
        @{ Label = 'remote name type'; Change = { param($d) $d.resources[0].remoteName = 42 } },
        @{ Label = 'remote name case'; Change = { param($d) $d.resources[0].remoteName = $d.resources[0].remoteName.ToUpperInvariant() } },
        @{ Label = 'sha type'; Change = { param($d) $d.resources[0].sha256 = 42 } },
        @{ Label = 'sha case'; Change = { param($d) $d.resources[0].sha256 = $d.resources[0].sha256.ToUpperInvariant() } }
    )) {
        $candidate = Copy-JsonDocument -Document $modelDocument
        & $mutation.Change $candidate
        Assert-ModelContentContractRejects -Document $candidate -Label $mutation.Label
    }

    $installManifest = Get-Content `
        -LiteralPath (Join-Path $fixture.Dist 'install-manifest.json') `
        -Raw |
            ConvertFrom-Json
    Assert-InstallManifestModelsMatchContract `
        -InstallManifest $installManifest `
        -ModelContract $frozen.ModelContract
    $modelIndex = [array]::IndexOf(
        @($installManifest.resources.kind),
        'model'
    )
    Assert-True ($modelIndex -ge 0) 'the fixture must contain a model resource'

    $swappedManifest = Copy-JsonDocument -Document $installManifest
    $swappedManifest.resources[$modelIndex].bytes += 1
    $swappedManifestJson = $swappedManifest | ConvertTo-Json -Depth 16
    $swappedManifestBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
        $swappedManifestJson
    )
    Reset-Fakes 'success'
    Assert-Throws {
        Get-ValidatedLocalDeployment `
            -DistPath $fixture.Dist `
            -InstallManifestReader { param([string]$Path) return $swappedManifestBytes }
    } 'artifact changed before model projection parsing'
    Assert-True (
        $script:RemoteCalls.Count -eq 0 -and $script:CopyCalls.Count -eq 0
    ) 'a read-swapped install manifest must fail before remote access or copy'

    foreach ($drift in @(
        @{ Label = 'bytes'; Mutation = { param($m) $m.resources[$modelIndex].bytes += 1 } },
        @{ Label = 'id'; Mutation = { param($m) $m.resources[$modelIndex].id += '-drift' } },
        @{ Label = 'kind'; Mutation = { param($m) $m.resources[$modelIndex].kind = 'wasm' } },
        @{ Label = 'scope'; Mutation = { param($m) $m.resources[$modelIndex].scope = 'game-specific' } },
        @{ Label = 'sha256'; Mutation = { param($m) $m.resources[$modelIndex].sha256 = '0' * 64 } },
        @{ Label = 'source'; Mutation = { param($m) $m.resources[$modelIndex].source += '.drift' } },
        @{ Label = 'target'; Mutation = { param($m) $m.resources[$modelIndex].target = 'shell' } },
        @{ Label = 'id case'; Mutation = {
            param($m) $m.resources[$modelIndex].id = $m.resources[$modelIndex].id.ToUpperInvariant()
        } },
        @{ Label = 'kind case'; Mutation = { param($m) $m.resources[$modelIndex].kind = 'Model' } },
        @{ Label = 'scope case'; Mutation = { param($m) $m.resources[$modelIndex].scope = 'Common' } },
        @{ Label = 'sha256 case'; Mutation = {
            param($m) $m.resources[$modelIndex].sha256 = $m.resources[$modelIndex].sha256.ToUpperInvariant()
        } },
        @{ Label = 'source case'; Mutation = {
            param($m) $m.resources[$modelIndex].source = $m.resources[$modelIndex].source.ToUpperInvariant()
        } },
        @{ Label = 'target case'; Mutation = { param($m) $m.resources[$modelIndex].target = 'OPFS' } },
        @{ Label = 'noncanonical absolute source'; Mutation = {
            param($m) $m.resources[$modelIndex].source = '/' + $m.resources[$modelIndex].source
        } },
        @{ Label = 'noncanonical segmented source'; Mutation = {
            param($m) $m.resources[$modelIndex].source =
                $m.resources[$modelIndex].source.Replace('immutable/', 'immutable/./')
        } },
        @{ Label = 'missing'; Mutation = {
            param($m) $m.resources = @($m.resources | Where-Object { $_.id -ne $m.resources[$modelIndex].id })
        } },
        @{ Label = 'extra'; Mutation = {
            param($m)
            $extra = Copy-JsonDocument -Document $m.resources[$modelIndex]
            $extra.id = 'common-model-extra.gguf'
            $extra.sha256 = 'e' * 64
            $extra.source = "immutable/model-$($extra.sha256).gguf"
            $m.resources = @($m.resources) + $extra
        } },
        @{ Label = 'duplicate'; Mutation = {
            param($m)
            $m.resources = @($m.resources) +
                (Copy-JsonDocument -Document $m.resources[$modelIndex])
        } }
    )) {
        Assert-ModelProjectionRejects `
            -InstallManifest $installManifest `
            -ModelContract $frozen.ModelContract `
            -Mutation $drift.Mutation `
            -Label $drift.Label
    }
    $noncanonicalContract = Copy-JsonDocument -Document $frozen.ModelContract
    $noncanonicalContract.Resources[0].RemotePath =
        "immutable/./$($noncanonicalContract.Resources[0].RemoteName)"
    Assert-Throws {
        Assert-InstallManifestModelsMatchContract `
            -InstallManifest $installManifest `
            -ModelContract $noncanonicalContract
    } 'noncanonical model path'

    $inventoryFixturePath = [System.IO.Path]::GetTempFileName()
    try {
        Write-ExpectedInventoryFile `
            -Path $inventoryFixturePath `
            -InventoryLines $frozen.InventoryLines
        $expectedInventoryBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
            [string]::Join("`n", $frozen.InventoryLines) + "`n"
        )
        $actualInventoryBytes = [System.IO.File]::ReadAllBytes($inventoryFixturePath)
        Assert-True (
            [Convert]::ToBase64String($actualInventoryBytes) -eq
            [Convert]::ToBase64String($expectedInventoryBytes)
        ) 'expected inventory bytes must be deterministic UTF-8 without BOM and with terminal LF'
        Assert-True (
            -not ($actualInventoryBytes -contains 13)
        ) 'expected inventory must not contain Windows CR bytes'
    }
    finally {
        [System.IO.File]::Delete($inventoryFixturePath)
    }

    Reset-Fakes 'success'
    Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $false -MutationApproved $false
    Assert-True ($script:RemoteCalls.Count -eq 2) 'preview must perform only read-only identity/model inventory'
    Assert-True ($script:CopyCalls.Count -eq 0) 'preview must not copy'

    Reset-Fakes 'retained-lock-preview'
    Assert-Throws {
        Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $false -MutationApproved $false
    } 'deployment-lock-present:/var/www/parallax-web.com/.parallax-deploy.lock'
    Assert-True ($script:CopyCalls.Count -eq 0) 'retained-lock preview rejection must not copy'
    Reset-Fakes 'success'
    $identity = Read-RemoteIdentity
    Assert-True (
        $identity.ParentMode -eq '755' -and $identity.TargetMode -eq '755'
    ) 'remote identity parser must preserve verified permission modes'

    Reset-Fakes 'success'
    Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $false
    Assert-True ($script:RemoteCalls.Count -eq 2) 'confirmation cancellation must stop after preview'
    Assert-True ($script:CopyCalls.Count -eq 0) 'confirmation cancellation must not copy'

    foreach ($scenario in @(
        'missing-model',
        'extra-model',
        'immutable-owner',
        'immutable-mode',
        'model-owner',
        'model-mode'
    )) {
        Reset-Fakes $scenario
        Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $false -MutationApproved $false
        Assert-True ($script:CopyCalls.Count -eq 0) "$scenario preview must not mutate"
        Reset-Fakes $scenario
        Assert-Throws {
            Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
        } 'exact five pinned model'
        Assert-True ($script:CopyCalls.Count -eq 0) "$scenario deploy must fail before copy"
    }

    Reset-Fakes 'locked-model-drift'
    Assert-Throws {
        Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
    } 'changed after lock acquisition'
    Assert-True ($script:CopyCalls.Count -eq 0) 'under-lock model drift must fail before any copy'
    Assert-True (
        @($script:RemoteCalls | Where-Object { $_ -match 'preserved-models' }).Count -eq 0
    ) 'under-lock model drift must fail before preservation'

    foreach ($scenario in @('bad-permission-or-mount', 'target-swap', 'lock-contention')) {
        Reset-Fakes $scenario
        Assert-Throws {
            Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
        } '(guard|inode|lock)'
        Assert-True ($script:CopyCalls.Count -eq 0) "$scenario must stop before any copy"
    }

    Assert-True (
        $frozen.TopLevelChildren.Count -ge 2
    ) 'the deploy fixture must exercise a distinct mid-SCP failure'

    foreach ($preserveFailure in @(
        @{ Scenario = 'mid-preserve-failure'; Pattern = 'mid-preserve model move failure.*RECOVERY_STATE root_mode=700 lock=owned' },
        @{ Scenario = 'mid-preserve-and-restore-failure'; Pattern = 'mid-preserve model move failure.*cleanup/status also failed: remote pinned-model restoration failed' }
    )) {
        Reset-Fakes $preserveFailure.Scenario
        Assert-Throws {
            Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
        } $preserveFailure.Pattern
        $privatizeIndex = $script:RemoteCalls.FindIndex({
            param($call)
            $call -match 'chmod 0700 -- /var/www/parallax-web.com'
        })
        $preserveIndex = $script:RemoteCalls.FindIndex({
            param($call)
            $call -match 'mv -- .*/immutable/model-.* .*/preserved-models/'
        })
        Assert-True (
            $privatizeIndex -ge 0 -and $preserveIndex -gt $privatizeIndex
        ) "$($preserveFailure.Scenario) must privatize and verify the root before the first model move"
        Assert-True (
            @($script:RemoteCalls | Where-Object {
                $_ -match 'find /var/www/parallax-web.com -mindepth 1 -maxdepth 1' -and
                $_ -match '! -name .parallax-deploy.lock' -and
                $_ -match '-exec rm -rf'
            }).Count -eq 0
        ) "$($preserveFailure.Scenario) must fail before destructive deletion"
        Assert-True (
            @($script:RemoteCalls | Where-Object {
                $_ -match 'chmod 0755 -- /var/www/parallax-web.com;' -or
                (
                    $_ -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
                    $_ -notmatch 'mkdir -m 0700 --'
                )
            }).Count -eq 0
        ) "$($preserveFailure.Scenario) must retain the private root and owned lock"
        Assert-True (
            @($script:RemoteCalls | Where-Object { $_ -match "printf 'RECOVERY_STATE" }).Count -eq 1
        ) "$($preserveFailure.Scenario) must report guarded private recovery evidence"
    }

    foreach ($failureCase in @(
        @{ Scenario = 'delete-failure'; Pattern = 'bounded delete failure' },
        @{ Scenario = 'first-scp-failure'; Pattern = 'scp failure' },
        @{ Scenario = 'mid-scp-failure'; Pattern = 'scp failure' },
        @{ Scenario = 'verification-failure'; Pattern = 'full-inventory' },
        @{ Scenario = 'normalization-failure'; Pattern = 'normalization failure' }
    )) {
        Reset-Fakes $failureCase.Scenario
        Assert-Throws {
            Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
        } "$($failureCase.Pattern).*manual recovery required; recovery evidence: .*RECOVERY_STATE root_mode=700 lock=owned target=/var/www/parallax-web.com"
        Assert-True (
            @($script:RemoteCalls | Where-Object {
                $_ -match 'chmod 0755 -- /var/www/parallax-web.com;'
            }).Count -eq 0
        ) "$($failureCase.Scenario) must not publish the incomplete root"
        Assert-True (
            @($script:RemoteCalls | Where-Object {
                $_ -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
                $_ -notmatch 'mkdir -m 0700 --'
            }).Count -eq 0
        ) "$($failureCase.Scenario) must retain its owned lock for manual recovery"
        Assert-True (
            @($script:RemoteCalls | Where-Object { $_ -match "printf 'RECOVERY_STATE" }).Count -eq 1
        ) "$($failureCase.Scenario) must report guarded private-root/lock evidence"
        $failureDeletes = @($script:RemoteCalls | Where-Object {
            $_ -match 'find /var/www/parallax-web.com -mindepth 1.*-exec rm -rf'
        })
        Assert-True ($failureDeletes.Count -eq 1) "$($failureCase.Scenario) must use one bounded deletion attempt"
        Assert-True (
            $failureDeletes[0] -match '! -name .parallax-deploy.lock' -and
            $failureDeletes[0] -notmatch 'find /var/www -mindepth'
        ) "$($failureCase.Scenario) cleanup must not broaden the fixed target"
    }

    Reset-Fakes 'model-restore-failure'
    Assert-Throws {
        Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
    } 'scp failure.*cleanup/status also failed: remote pinned-model restoration failed'
    Assert-True (
        @($script:RemoteCalls | Where-Object {
            $_ -match 'chmod 0755 -- /var/www/parallax-web.com;' -or
            (
                $_ -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
                $_ -notmatch 'mkdir -m 0700 --'
            )
        }).Count -eq 0
    ) 'failed model restoration must retain the private root and owned lock'

    $driftFixture = New-Fixture
    [void]$fixtures.Add($driftFixture.Root)
    $driftFrozen = Get-ValidatedLocalDeployment -DistPath $driftFixture.Dist
    Reset-Fakes 'local-drift'
    $script:DriftPath = Join-Path $driftFixture.Dist 'index.html'
    Assert-Throws {
        Invoke-ProductionDeploymentCore -Frozen $driftFrozen -DeployRequested $true -MutationApproved $true
    } '(does not match|mismatch|changed)'

    $lateDriftFixture = New-Fixture
    [void]$fixtures.Add($lateDriftFixture.Root)
    $lateDriftFrozen = Get-ValidatedLocalDeployment -DistPath $lateDriftFixture.Dist
    Reset-Fakes 'late-local-drift'
    $script:DriftPath = Join-Path $lateDriftFixture.Dist 'index.html'
    Assert-Throws {
        Invoke-ProductionDeploymentCore -Frozen $lateDriftFrozen -DeployRequested $true -MutationApproved $true
    } '(?s)(does not match|mismatch|changed).*RECOVERY_STATE root_mode=700 lock=owned'
    Assert-True (
        @($script:RemoteCalls | Where-Object {
            $_ -match 'expected=.*/expected.inventory' -and $_ -match 'cmp -s'
        }).Count -eq 1
    ) 'late local-source drift must be detected after exact remote inventory verification'
    Assert-True (
        @($script:RemoteCalls | Where-Object {
            $_ -match 'chmod 0755 -- /var/www/parallax-web.com;' -or
            (
                $_ -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
                $_ -notmatch 'mkdir -m 0700 --'
            )
        }).Count -eq 0
    ) 'late local-source drift must retain the private root and owned lock after remote verification'

    $extraFixture = New-Fixture
    [void]$fixtures.Add($extraFixture.Root)
    [System.IO.File]::WriteAllText((Join-Path $extraFixture.Dist 'extra.txt'), 'sentinel')
    Assert-Throws {
        Get-ValidatedLocalDeployment -DistPath $extraFixture.Dist
    } '(not in the build manifest|inventory must equal)'

    $extraDirectoryFixture = New-Fixture
    [void]$fixtures.Add($extraDirectoryFixture.Root)
    [void](New-Item -ItemType Directory -Path (Join-Path $extraDirectoryFixture.Dist 'unexpected'))
    Assert-Throws {
        Get-ValidatedLocalDeployment -DistPath $extraDirectoryFixture.Dist
    } 'directory inventory'

    $oldSchemaFixture = New-Fixture
    [void]$fixtures.Add($oldSchemaFixture.Root)
    $oldSchemaManifestPath = Join-Path $oldSchemaFixture.Dist 'build-manifest.json'
    $oldSchemaManifest = Get-Content -LiteralPath $oldSchemaManifestPath -Raw | ConvertFrom-Json
    $oldSchemaManifest.schemaVersion = 11
    [System.IO.File]::WriteAllText(
        $oldSchemaManifestPath,
        ($oldSchemaManifest | ConvertTo-Json -Depth 8)
    )
    Assert-Throws {
        Get-ValidatedLocalDeployment -DistPath $oldSchemaFixture.Dist
    } 'unsupported build manifest schema'

    $missingEntrypointFixture = New-Fixture
    [void]$fixtures.Add($missingEntrypointFixture.Root)
    $missingEntrypointManifestPath = Join-Path $missingEntrypointFixture.Dist 'build-manifest.json'
    $missingEntrypointManifest = Get-Content -LiteralPath $missingEntrypointManifestPath -Raw |
        ConvertFrom-Json
    $missingEntrypointManifest.installManifestEntrypoint.path = 'other.json'
    [System.IO.File]::WriteAllText(
        $missingEntrypointManifestPath,
        ($missingEntrypointManifest | ConvertTo-Json -Depth 8)
    )
    Assert-Throws {
        Get-ValidatedLocalDeployment -DistPath $missingEntrypointFixture.Dist
    } 'exact install-manifest v1 entrypoint'

    foreach ($malformation in @('extra-key', 'empty-resources')) {
        $malformedFixture = New-Fixture
        [void]$fixtures.Add($malformedFixture.Root)
        $installPath = Join-Path $malformedFixture.Dist 'install-manifest.json'
        $install = Get-Content -LiteralPath $installPath -Raw | ConvertFrom-Json
        if ($malformation -eq 'extra-key') {
            $install | Add-Member -NotePropertyName release -NotePropertyValue 'forbidden'
        }
        else {
            $install.resources = @()
        }
        [System.IO.File]::WriteAllText($installPath, ($install | ConvertTo-Json -Depth 12))
        $buildPath = Join-Path $malformedFixture.Dist 'build-manifest.json'
        $build = Get-Content -LiteralPath $buildPath -Raw | ConvertFrom-Json
        $entry = @($build.artifacts | Where-Object { $_.path -eq 'install-manifest.json' })
        $entry[0].bytes = (Get-Item -LiteralPath $installPath).Length
        $entry[0].sha256 = Get-Sha256Hex -Path $installPath
        [System.IO.File]::WriteAllText($buildPath, ($build | ConvertTo-Json -Depth 12))
        Assert-Throws {
            Get-ValidatedLocalDeployment -DistPath $malformedFixture.Dist
        } '(exact gameId|non-empty resources)'
    }

    $guard = Get-RemoteGuardScript -ExpectedParentIdentity '10:20' -ExpectedTargetIdentity '10:30'
    Assert-True ($guard -match '0\$parent_mode & 022') 'permission guard must reject group/world write'
    Assert-True ($guard -match 'findmnt -rn -o TARGET') 'mount guard must inspect bind and ordinary mounts'
    Assert-True ($guard -match 'mount-inventory-unavailable') 'mount discovery failure must fail closed'
    Assert-True ($guard -match 'target_dev.*target_ino') 'guard must preserve target inode identity'
    Assert-True ($guard -notmatch 'mktemp') 'read-only guard must not create a remote temporary file'
    Assert-True ($guard -notmatch 'rm -f.*mount_inventory') 'read-only guard must not remove remote state'

    $runPosixSemanticTests = $env:PARALLAX_RUN_POSIX_DEPLOY_TESTS -ceq '1'
    if ($runPosixSemanticTests) {
        $shell = (Get-Command sh.exe -ErrorAction Stop).Source
        [void](Get-Command wsl.exe -ErrorAction Stop)
        $shellFixture = Join-Path $fixture.Root 'remote-guard'
        $shellParent = Join-Path $shellFixture 'parent'
        $shellWebRoot = Join-Path $shellParent 'webroot'
        [void](New-Item -ItemType Directory -Path $shellWebRoot -Force)
        $savedParent = $script:RemoteParent
        $savedWebRoot = $script:RemoteWebRoot
        $savedLock = $script:RemoteLock
        try {
        $script:RemoteParent = $shellParent.Replace('\', '/')
        $script:RemoteWebRoot = $shellWebRoot.Replace('\', '/')
        $script:RemoteLock = "$($script:RemoteWebRoot)/.parallax-deploy.lock"

        $findmntFailure = Invoke-RemoteShellScript `
            -Shell $shell `
            -Root $shellFixture `
            -FindmntBody 'exit 42' `
            -Body "$(Get-RemoteGuardScript) printf 'GUARD_OK\n'"
        Assert-True ($findmntFailure.ExitCode -eq 72) 'findmnt failure must exit through the fail-closed guard'
        Assert-True (
            $findmntFailure.Output -match 'mount-inventory-unavailable'
        ) 'findmnt failure must explain that mount inventory was unavailable'

        $mountedBody = "printf '%s\n' '$($script:RemoteWebRoot)/descendant'"
        $mounted = Invoke-RemoteShellScript `
            -Shell $shell `
            -Root $shellFixture `
            -FindmntBody $mountedBody `
            -Body "$(Get-RemoteGuardScript) printf 'GUARD_OK\n'"
        Assert-True (
            $mounted.ExitCode -eq 71
        ) "descendant mount output must reject the webroot (exit $($mounted.ExitCode): $($mounted.Output))"
        Assert-True (
            $mounted.Output -match 'webroot-or-descendant-is-a-mount'
        ) 'descendant mount rejection must remain explicit'

        $wslRoot = (& wsl.exe sh -lc 'mktemp -d /tmp/parallax-lock-test.XXXXXX').Trim()
        if ($LASTEXITCODE -ne 0 -or $wslRoot -notmatch '^/tmp/parallax-lock-test\.[a-zA-Z0-9]+$') {
            throw 'failed to create the isolated Linux lock fixture'
        }
        try {
            $script:RemoteParent = "$wslRoot/parent"
            $script:RemoteWebRoot = "$($script:RemoteParent)/webroot"
            $script:RemoteLock = "$($script:RemoteWebRoot)/.parallax-deploy.lock"
            $unmountedBody = "printf '%s\n' '/'"
            $setupResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "mkdir -p -- $($script:RemoteWebRoot); printf '%s\n' old-content > $($script:RemoteWebRoot)/old.txt; printf '%s\n' outside-lock-sentinel > $($script:RemoteParent)/sibling-sentinel"
            Assert-True ($setupResult.ExitCode -eq 0) 'the isolated Linux lock fixture must initialize'

            $correctToken = 'a' * 32
            $wrongToken = 'b' * 32
            $acquire = Get-RemoteLockAcquireScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $acquireResult = Invoke-WslShellScript -FindmntBody $unmountedBody -Body $acquire
            Assert-True ($acquireResult.ExitCode -eq 0) 'the generated acquisition must create its owned lock'
            $modeResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "test -f $($script:RemoteParent)/sibling-sentinel; printf 'MODES %s %s\n' `$(stat -c %a $($script:RemoteLock)) `$(stat -c %a $($script:RemoteLock)/token)"
            Assert-True (
                $modeResult.ExitCode -eq 0 -and $modeResult.Output -match 'MODES 700 600'
            ) "acquisition must force lock/token modes 0700/0600 (received $($modeResult.Output))"
            $privatize = Get-RemotePrivatizeRootScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $privatizeResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$privatize; test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; test -e $($script:RemoteWebRoot)/old.txt; test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; printf 'PRIVATE_ROOT_OK\n'"
            Assert-True ($privatizeResult.ExitCode -eq 0) 'privatization must precede any content move or deletion'
            Assert-True ($privatizeResult.Output -match 'PRIVATE_ROOT_OK') 'privatization must preserve existing content, lock, and sibling sentinel'

            $delete = Get-RemoteDeleteContentScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $deleteResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$delete; test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; test ! -e $($script:RemoteWebRoot)/old.txt; test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; printf 'PRIVATE_DELETE_OK\n'"
            Assert-True ($deleteResult.ExitCode -eq 0) 'bounded deletion must require and retain private root mode'
            Assert-True ($deleteResult.Output -match 'PRIVATE_DELETE_OK') 'private deletion must preserve lock and sibling sentinel'

            $tokenGuard = Get-RemoteLockGuardScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $correctTokenResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$tokenGuard test -f $($script:RemoteParent)/sibling-sentinel; printf 'TOKEN_OK\n'"
            Assert-True ($correctTokenResult.ExitCode -eq 0) 'the generated guard must accept its exact token, owner, and modes'
            Assert-True ($correctTokenResult.Output -match 'TOKEN_OK') 'the accepted token guard must continue'

            $wrongTokenGuard = Get-RemoteLockGuardScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $wrongToken
            $wrongTokenResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$wrongTokenGuard printf 'WRONG_TOKEN_ACCEPTED\n'"
            Assert-True ($wrongTokenResult.ExitCode -ne 0) 'the generated guard must reject a wrong token'
            Assert-True (
                $wrongTokenResult.Output -notmatch 'WRONG_TOKEN_ACCEPTED'
            ) 'wrong-token rejection must stop the guarded operation'

            $widenModeResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "chmod 0770 -- $($script:RemoteLock)"
            Assert-True ($widenModeResult.ExitCode -eq 0) 'the mode-rejection fixture must widen the lock mode'
            $widenedLockResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$tokenGuard printf 'WIDE_LOCK_ACCEPTED\n'"
            Assert-True ($widenedLockResult.ExitCode -ne 0) 'the generated guard must reject group-accessible lock mode'
            Assert-True (
                $widenedLockResult.Output -notmatch 'WIDE_LOCK_ACCEPTED'
            ) 'wrong lock mode must stop the guarded operation'
            $wrongModeState = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; chmod 0700 -- $($script:RemoteLock)"
            Assert-True ($wrongModeState.ExitCode -eq 0) 'wrong-mode rejection must preserve lock and sibling sentinel'

            $irregularContent = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "mkdir -m 0707 -- $($script:RemoteWebRoot)/immutable; printf '%s\n' app > $($script:RemoteWebRoot)/index.html; printf '%s\n' bundle > $($script:RemoteWebRoot)/immutable/app.js; chmod 0664 -- $($script:RemoteWebRoot)/index.html $($script:RemoteWebRoot)/immutable/app.js; ln -s -- $($script:RemoteParent)/sibling-sentinel $($script:RemoteWebRoot)/unsafe-link"
            Assert-True ($irregularContent.ExitCode -eq 0) 'the post-copy mode/symlink fixture must initialize'
            $normalize = Get-RemoteNormalizePrivateContentScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $symlinkNormalizeResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$normalize; printf 'SYMLINK_ACCEPTED\n'"
            Assert-True ($symlinkNormalizeResult.ExitCode -ne 0) 'normalization must reject copied symlinks before public restoration'
            Assert-True (
                $symlinkNormalizeResult.Output -notmatch 'SYMLINK_ACCEPTED'
            ) 'symlink rejection must stop normalization'
            $symlinkFailureState = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; rm -f -- $($script:RemoteWebRoot)/unsafe-link"
            Assert-True ($symlinkFailureState.ExitCode -eq 0) 'symlink failure must retain private root, lock, and sentinel'

            $failureRestoreResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$normalize; test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; test `"`$(stat -c %a $($script:RemoteWebRoot)/immutable)`" = 755; test `"`$(stat -c %a $($script:RemoteWebRoot)/index.html)`" = 644; test `"`$(stat -c %a $($script:RemoteWebRoot)/immutable/app.js)`" = 644; test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; printf 'PRIVATE_NORMALIZE_OK\n'"
            Assert-True ($failureRestoreResult.ExitCode -eq 0) 'guarded normalization must normalize descendants while retaining private root mode'
            Assert-True ($failureRestoreResult.Output -match 'PRIVATE_NORMALIZE_OK') 'private normalization must preserve lock and sibling sentinel'

            $rejectSpecial = Get-RemoteRejectSpecialEntriesScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $noSpecialResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$rejectSpecial printf 'NO_SPECIAL_ENTRY_OK\n'"
            Assert-True ($noSpecialResult.ExitCode -eq 0) 'an empty unsupported-entry marker must permit exact inventory verification'
            Assert-True (
                $noSpecialResult.Output -match 'NO_SPECIAL_ENTRY_OK' -and
                $noSpecialResult.Output -notmatch 'unsupported-remote-entry-type|malformed-unsupported-entry-probe'
            ) 'ordinary directories and files must produce only the exact empty-marker outcome'

            $fifoPath = "$($script:RemoteWebRoot)/unsupported.fifo"
            $fifoSetup = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "command -v mkfifo >/dev/null; mkfifo -- $fifoPath; test -p $fifoPath"
            Assert-True ($fifoSetup.ExitCode -eq 0) 'the special-entry fixture requires FIFO support'
            $specialResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$rejectSpecial printf 'SPECIAL_ENTRY_ACCEPTED\n'"
            Assert-True ($specialResult.ExitCode -eq 74) 'final content-type verification must reject a FIFO'
            Assert-True (
                $specialResult.Output -match 'unsupported-remote-entry-type:.*unsupported.fifo' -and
                $specialResult.Output -notmatch 'SPECIAL_ENTRY_ACCEPTED'
            ) 'FIFO rejection must identify the unsupported remote entry and stop publication'
            $specialFailureState = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 700; test -d $($script:RemoteLock); test -p $fifoPath; test -f $($script:RemoteParent)/sibling-sentinel; rm -f -- $fifoPath; printf 'SPECIAL_REJECT_OK\n'"
            Assert-True ($specialFailureState.ExitCode -eq 0) 'FIFO rejection must retain private root, owned lock, and sibling sentinel'
            Assert-True ($specialFailureState.Output -match 'SPECIAL_REJECT_OK') 'FIFO recovery state must remain inspectable and bounded'

            $malformedFindSource = "#!/bin/sh`nprintf ' \n'`n"
            $malformedFindBase64 = [Convert]::ToBase64String(
                [System.Text.Encoding]::UTF8.GetBytes($malformedFindSource)
            )
            $malformedMarkerResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "printf '%s' '$malformedFindBase64' | base64 -d > `"`$fake_bin/find`"; chmod 0700 `"`$fake_bin/find`"; $rejectSpecial printf 'MALFORMED_MARKER_ACCEPTED\n'"
            Assert-True ($malformedMarkerResult.ExitCode -eq 76) 'blank-like nonempty marker output must fail closed as malformed probe evidence'
            Assert-True (
                $malformedMarkerResult.Output -match 'malformed-unsupported-entry-probe' -and
                $malformedMarkerResult.Output -notmatch 'MALFORMED_MARKER_ACCEPTED|unsupported-remote-entry-type:'
            ) 'malformed marker evidence must not be reinterpreted as a captured unsupported path'

            $failingFindSource = "#!/bin/sh`nexit 37`n"
            $failingFindBase64 = [Convert]::ToBase64String(
                [System.Text.Encoding]::UTF8.GetBytes($failingFindSource)
            )
            $findFailureResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "printf '%s' '$failingFindBase64' | base64 -d > `"`$fake_bin/find`"; chmod 0700 `"`$fake_bin/find`"; $rejectSpecial printf 'FIND_FAILURE_ACCEPTED\n'"
            Assert-True ($findFailureResult.ExitCode -eq 37) 'set -e must preserve a nonzero GNU find probe failure'
            Assert-True (
                $findFailureResult.Output -notmatch 'FIND_FAILURE_ACCEPTED|malformed-unsupported-entry-probe|unsupported-remote-entry-type:'
            ) 'a failed find probe must not be converted into marker or path evidence'

            $publish = Get-RemotePublishRootScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $publishResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$publish; test `"`$(stat -c %a $($script:RemoteWebRoot))`" = 755; test -d $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; printf 'PUBLISH_OK\n'"
            Assert-True ($publishResult.ExitCode -eq 0) 'guarded publication must restore public root mode only at its dedicated boundary'
            Assert-True ($publishResult.Output -match 'PUBLISH_OK') 'publication must preserve lock and sibling sentinel'

            $release = Get-RemoteLockReleaseScript `
                -Guard (Get-RemoteGuardScript) `
                -Token $correctToken
            $releaseResult = Invoke-WslShellScript `
                -FindmntBody $unmountedBody `
                -Body "$release; test ! -e $($script:RemoteLock); test -f $($script:RemoteParent)/sibling-sentinel; printf 'RELEASE_OK\n'"
            Assert-True ($releaseResult.ExitCode -eq 0) 'the generated release must remove only its owned private lock'
            Assert-True ($releaseResult.Output -match 'RELEASE_OK') 'lock release must preserve the sibling sentinel'
        }
        finally {
            & wsl.exe sh -c 'rm -rf -- "$1"' 'lock-test-cleanup' $wslRoot
            if ($LASTEXITCODE -ne 0) { throw 'failed to remove the isolated Linux lock fixture' }
        }
        }
        finally {
            $script:RemoteParent = $savedParent
            $script:RemoteWebRoot = $savedWebRoot
            $script:RemoteLock = $savedLock
        }
    }
    else {
        Write-Host 'POSIX semantic deployment tests: SKIPPED (set PARALLAX_RUN_POSIX_DEPLOY_TESTS=1 to opt in)'
    }

    Reset-Fakes 'success'
    Invoke-ProductionDeploymentCore -Frozen $frozen -DeployRequested $true -MutationApproved $true
    $deleteCalls = @($script:RemoteCalls | Where-Object {
        $_ -match 'find /var/www/parallax-web.com -mindepth 1.*-exec rm -rf'
    })
    Assert-True ($deleteCalls.Count -eq 1) 'successful flow must contain one constrained deletion'
    Assert-True ($deleteCalls[0] -match '! -name .parallax-deploy.lock') 'deletion must preserve active lock'
    Assert-True ($deleteCalls[0] -notmatch 'find /var/www -mindepth') 'deletion must not reach parent sentinel'
    $preserveCall = @($script:RemoteCalls | Where-Object {
        $_ -match 'mkdir -m 0700 -- .*/preserved-models'
    })
    Assert-True (
        $preserveCall.Count -eq 1 -and
        $preserveCall[0] -match 'stat -c %u .*/immutable' -and
        $preserveCall[0] -match 'stat -c %g .*/immutable' -and
        $preserveCall[0] -match 'stat -c %a .*/immutable'
    ) 'preservation must reassert immutable and model ownership/modes under the lock'
    $privatizeIndex = $script:RemoteCalls.FindIndex({
        param($call)
        $call -match 'chmod 0700 -- /var/www/parallax-web.com'
    })
    $preserveIndex = $script:RemoteCalls.FindIndex({
        param($call)
        $call -match 'mv -- .*/immutable/model-.* .*/preserved-models/'
    })
    Assert-True (
        $privatizeIndex -ge 0 -and $preserveIndex -gt $privatizeIndex
    ) 'successful flow must privatize and verify the root before the first model move'
    $finalVerify = @($script:RemoteCalls | Where-Object {
        $_ -match 'expected=.*/expected.inventory' -and $_ -match 'expected_uid='
    })
    Assert-True (
        $finalVerify.Count -eq 1 -and
        $finalVerify[0] -match 'stat -c %a /var/www/parallax-web.com.*= 700' -and
        $finalVerify[0] -match "! -type d ! -type f -printf 'PARALLAX_UNSUPPORTED_ENTRY_V1' -quit" -and
        $finalVerify[0] -match 'stat -c %u .*/immutable/model-' -and
        $finalVerify[0] -match 'stat -c %g .*/immutable/model-'
    ) 'final inventory verification must keep the root private, reject special entries, and bind model UID/GID, type, and mode'
    $verifyIndex = $script:RemoteCalls.FindIndex({
        param($call)
        $call -match 'expected=.*/expected.inventory' -and $call -match 'cmp -s'
    })
    $publishIndex = $script:RemoteCalls.FindIndex({
        param($call)
        $call -match 'chmod 0755 -- /var/www/parallax-web.com;'
    })
    $releaseIndex = $script:RemoteCalls.FindIndex({
        param($call)
        $call -match 'rm -rf -- /var/www/parallax-web.com/.parallax-deploy.lock' -and
        $call -notmatch 'mkdir -m 0700 --'
    })
    Assert-True (
        $verifyIndex -ge 0 -and
        $publishIndex -gt $verifyIndex -and
        $releaseIndex -gt $publishIndex
    ) 'success must verify exact private inventory before chmod 0755, then release only its owned lock'
    Assert-True (
        @($script:RemoteCalls | Where-Object { $_ -match "printf 'RECOVERY_STATE" }).Count -eq 0
    ) 'successful deployment must not enter manual-recovery status collection'
    Write-Output 'Deploy-Production behavior tests: PASS'
}
finally {
    foreach ($path in $fixtures) {
        if ($path.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $path -Force -Recurse
        }
    }
}
