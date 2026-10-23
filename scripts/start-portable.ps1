param([switch]$NoBrowser, [int]$ServicePort = 4318)
$ErrorActionPreference = 'Stop'
$mappedDrive = $null
try {
  $appRoot = Split-Path -Parent $PSScriptRoot
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This package requires Windows x64.' }
  # The ESP32 compiler searches un-normalized paths about 200 characters deep inside the package.
  # Without Windows long-path support a long or non-ASCII folder breaks compilation, so run from a
  # short SUBST drive instead (no administrator rights needed; removed again when the app stops).
  $runRoot = $appRoot
  if ($appRoot.Length -gt 40 -or $appRoot -match '[^\x00-\x7F]') {
    foreach ($line in (& subst.exe)) {
      if ($line -match '^([A-Z]):\\: => (.+)$' -and $Matches[2].TrimEnd('\') -ieq $appRoot.TrimEnd('\')) { $runRoot = $Matches[1] + ':\'; break }
    }
    if ($runRoot -eq $appRoot) {
      foreach ($letter in 'ZYXWVUTSRQPONMLKJIHG'.ToCharArray()) {
        if (Test-Path -LiteralPath ($letter + ':\')) { continue }
        & subst.exe ($letter + ':') $appRoot
        if ($LASTEXITCODE -eq 0) { $mappedDrive = $letter + ':'; $runRoot = $letter + ':\'; break }
      }
    }
    if ($runRoot -eq $appRoot) { Write-Host 'Warning: no free drive letter for a short path; ESP32 compilation may fail in this long folder. Move the folder to a short path such as C:\OpenCircuit.' -ForegroundColor Yellow }
    else { Write-Host ('Long folder path: running from ' + $runRoot + ' (short alias of this folder).') }
  }
  Set-Location -LiteralPath $runRoot
  $nodePath = Join-Path $runRoot '.local/node-v24.15.0-win-x64/node.exe'
  $pythonPath = Join-Path $runRoot '.local/python/python.exe'
  foreach ($required in @($nodePath, $pythonPath, (Join-Path $runRoot 'dist/web/index.html'), (Join-Path $runRoot 'node_modules/tsx/package.json'), (Join-Path $runRoot '.local/bin/arduino-cli.exe'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw ('Package incomplete: ' + $required) }
  }
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $ServicePort)
  try { $listener.Start() } catch { throw ('Port ' + $ServicePort + ' is in use. Close the other OpenCircuit window, or use scripts/start-portable.ps1 -ServicePort 4319.') } finally { $listener.Stop() }
  $env:PATH = (Split-Path $nodePath) + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot
  $env:PORT = [string]$ServicePort
  $env:OPENCIRCUIT_PYTHON = $pythonPath
  $env:OPENCIRCUIT_ESP32_ENGINE = Join-Path $runRoot '.local/esp32-engine/picsimlab_win64/lib/qemu'
  $arduinoRoot = Join-Path $runRoot '.local/arduino'
  foreach ($folder in @('cache','downloads','user','data')) { $null = New-Item -ItemType Directory -Force -Path (Join-Path $arduinoRoot $folder) }
  $config = @{ board_manager=@{additional_urls=@('https://espressif.github.io/arduino-esp32/package_esp32_index.json')}; directories=@{data=(Join-Path $arduinoRoot 'data');downloads=(Join-Path $arduinoRoot 'downloads');user=(Join-Path $arduinoRoot 'user')};build_cache=@{path=(Join-Path $arduinoRoot 'cache')} }
  $configPath = Join-Path $arduinoRoot 'arduino-cli.yaml'
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  $env:ARDUINO_CONFIG_FILE = $configPath
  $env:ARDUINO_DIRECTORIES_DATA = Join-Path $arduinoRoot 'data'
  $env:ARDUINO_DIRECTORIES_DOWNLOADS = Join-Path $arduinoRoot 'downloads'
  $env:ARDUINO_DIRECTORIES_USER = Join-Path $arduinoRoot 'user'
  Write-Host ('OpenCircuit offline package: http://127.0.0.1:' + $ServicePort)
  Write-Host 'Keep this window open. Press Ctrl+C to stop. No installation or download is required.'
  $serverArgs = @('--import', 'tsx', 'packages/cli/index.ts', 'serve')
  if (-not $NoBrowser) { $serverArgs += '--open' }
  & $nodePath @serverArgs
  if ($LASTEXITCODE -ne 0) { throw 'OpenCircuit stopped with an error.' }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; $failed = $true } finally {
  if ($mappedDrive) { Set-Location -LiteralPath $env:SystemRoot; & subst.exe $mappedDrive /d | Out-Null }
}
if ($failed) { exit 1 }
