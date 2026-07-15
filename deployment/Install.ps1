# IT Portal - desktop icon installer.
# Intended to run via Intune as a Win32 app in USER context (not SYSTEM) - the launcher
# relies on "whoami /upn" reflecting the actually signed-in employee, and this script
# writes to the current user's own profile, which standard (non-admin) users can do
# without elevation.

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'ITPortal'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Copy-Item -Path (Join-Path $PSScriptRoot 'launch-it-portal.vbs') -Destination $installDir -Force
Copy-Item -Path (Join-Path $PSScriptRoot 'it-portal.ico') -Destination $installDir -Force

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'IT Portal.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $installDir 'launch-it-portal.vbs') + '"'
$shortcut.IconLocation = Join-Path $installDir 'it-portal.ico'
$shortcut.Description = 'IT Portal'
$shortcut.WorkingDirectory = $installDir
$shortcut.Save()

Write-Output 'IT Portal shortcut installed.'
