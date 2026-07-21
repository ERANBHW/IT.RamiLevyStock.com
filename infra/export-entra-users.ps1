# One-time export of existing Entra ID users, for the v2.1 Users-table bootstrap.
#
# Run this YOURSELF — in Azure Cloud Shell (PowerShell) or local PowerShell with the
# Microsoft.Graph module installed. It signs in as YOU (Connect-MgGraph, delegated
# permissions, no App Registration, no client secret, nothing left running afterward).
#
# Output: entra-users-export.json in the current directory. Hand that file to Claude —
# it feeds infra/generate-user-seed.js, which produces infra/bootstrap-users.sql.
# See infra/README.md, "ייבוא חד-פעמי של משתמשים קיימים מ-365".

Connect-MgGraph -Scopes "User.Read.All"

# Active, real (non-guest) org accounts only.
$users = Get-MgUser -All -Filter "accountEnabled eq true and userType eq 'Member'" `
  -Property "userPrincipalName,mail,givenName,surname,department" |
  Select-Object userPrincipalName, mail, givenName, surname, department

$users | ConvertTo-Json -Depth 3 | Out-File -FilePath "entra-users-export.json" -Encoding utf8

Write-Host "Exported $($users.Count) users to entra-users-export.json"
Disconnect-MgGraph
