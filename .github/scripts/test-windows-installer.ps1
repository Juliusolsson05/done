param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
# This test installs and uninstalls done, and uses the real default data path.
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Run on a disposable GitHub-hosted Windows runner.' }
$database = Join-Path $env:LOCALAPPDATA 'dev.done.app/done.db'
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
$installDir = Split-Path $exe
$dataDir = Split-Path ([IO.Path]::GetFullPath($database))
if ($dataDir.StartsWith("$installDir\", [StringComparison]::OrdinalIgnoreCase) -or $dataDir -ieq $installDir) {
    throw "The data folder $dataDir is inside the install folder $installDir"
}
Write-Output "Silent per-user install: $exe (URI handler $command)"
$uninstaller = Join-Path $installDir 'uninstall.exe'
$evidence = New-Item -Type Directory -Force "$env:RUNNER_TEMP/done-windows-evidence"
$driver = Join-Path $env:RUNNER_TEMP 'done-ui-driver'
npm install --prefix $driver --no-save --no-audit --no-fund playwright-core@1.63.0
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$env:NODE_PATH = Join-Path $driver 'node_modules'
foreach ($phase in @('create', 'reopen')) {
    node ui/checks/windows-installed.cjs $exe $phase $evidence.FullName
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    if (!(Test-Path -LiteralPath $database)) { throw "Default database was not created at $database" }
    $stray = @(Get-ChildItem -LiteralPath $installDir -Recurse -Filter 'done.db*' -ErrorAction SilentlyContinue)
    if ($stray.Count) { throw "Found a database in the install folder: $($stray.FullName -join ', ')" }
    Write-Output "${phase}: data file at $database ($((Get-Item -LiteralPath $database).Length) bytes); none in $installDir"
    if ($phase -eq 'create') {
        Run-Installer $Installer
        Write-Output 'Reinstalled over the existing install with /S.'
    }
}

Run-Installer $uninstaller
# An NSIS uninstaller copies itself to TEMP and returns at once; the copy removes the files.
$deadline = (Get-Date).AddSeconds(60)
while ((Test-Path -LiteralPath $exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath $exe) { throw "Uninstall left the application at $exe" }
if (!(Test-Path -LiteralPath $database)) { throw "Uninstall removed the local tasks at $database" }
Write-Output "Uninstalled: $exe is gone; $database is kept ($((Get-Item -LiteralPath $database).Length) bytes)."
Write-Output 'Verified per-user setup, protocol registration, installed WebView2 and MCP, relaunch, reinstall and uninstall.'
