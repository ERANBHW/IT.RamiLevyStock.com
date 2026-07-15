# IT Portal - uninstaller (mirrors Install-ITPortal.ps1's machine-wide install).
# Run as administrator, same as the installer.

#Requires -RunAsAdministrator
$ErrorActionPreference = 'SilentlyContinue'

$installDir = Join-Path $env:ProgramData 'ITPortal'
$publicDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$shortcutPath = Join-Path $publicDesktop 'IT Portal.lnk'

Remove-Item -Path $shortcutPath -Force
Remove-Item -Path $installDir -Recurse -Force

Write-Output 'IT Portal removed.'
