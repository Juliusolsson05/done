param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
# This test installs and uninstalls done, and uses the real default data path.
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Run on a disposable GitHub-hosted Windows runner.' }
$database = Join-Path $env:LOCALAPPDATA 'done/done.db'
if ($env:DONE_DB -or (Test-Path $database)) { throw 'Expected a fresh Windows profile.' }

function Run-Installer([string]$path) {
    $process = Start-Process -FilePath $path -ArgumentList '/S' -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
}

Run-Installer $Installer
$command = (Get-Item 'Registry::HKEY_CLASSES_ROOT\done\shell\open\command').GetValue('')
if ($command -notmatch '^"([^"]+\.exe)"\s+"%1"$') { throw "Unexpected done URI handler: $command" }
$exe = $Matches[1]
if (!(Test-Path -LiteralPath $exe) -or !$exe.StartsWith("$env:LOCALAPPDATA\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected a per-user install; found $exe"
}
$uninstaller = Join-Path (Split-Path $exe) 'uninstall.exe'
$evidence = New-Item -Type Directory -Force "$env:RUNNER_TEMP/done-windows-evidence"
$driver = Join-Path $env:RUNNER_TEMP 'done-ui-driver'
npm install --prefix $driver --no-save --no-audit --no-fund playwright-core@1.63.0
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$env:NODE_PATH = Join-Path $driver 'node_modules'
foreach ($phase in @('create', 'reopen')) {
    node ui/checks/windows-installed.cjs $exe $phase $evidence.FullName
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    if (!(Test-Path -LiteralPath $database)) { throw "Default database was not created at $database" }
    if ($phase -eq 'create') { Run-Installer $Installer }
}

Run-Installer $uninstaller
if ((Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $database)) {
    throw 'Uninstall should remove the application and preserve local tasks.'
}
Write-Output 'Verified per-user setup, protocol registration, installed WebView2 and MCP, relaunch, reinstall and uninstall.'
