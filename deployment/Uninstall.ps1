# IT Portal - desktop icon uninstaller (mirrors Install.ps1's USER-context install).

$ErrorActionPreference = 'SilentlyContinue'

$installDir = Join-Path $env:LOCALAPPDATA 'ITPortal'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'IT Portal.lnk'

Remove-Item -Path $shortcutPath -Force
Remove-Item -Path $installDir -Recurse -Force

Write-Output 'IT Portal shortcut removed.'
