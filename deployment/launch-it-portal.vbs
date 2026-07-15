' IT Portal launcher.
' Reads the signed-in user's UPN (whoami /upn - no admin rights needed) and opens
' Microsoft Edge in app mode (no address bar) with the email passed as a URL
' fragment, e.g. https://it.ramilevystock.com/index.html#email=user@domain.co.il
'
' Runs silently (no console flash) because it's a .vbs, not a .bat.
' Must run in the signed-in user's context, not SYSTEM - see Phase 6 packaging
' notes for the Intune deployment requirement.

Option Explicit

Dim PORTAL_BASE_URL
PORTAL_BASE_URL = "https://it.ramilevystock.com/index.html"

Dim shell, exec, upn, portalUrl

Set shell = CreateObject("WScript.Shell")
Set exec = shell.Exec("%comspec% /c whoami /upn")

Do While exec.Status = 0
    WScript.Sleep 50
Loop

upn = Trim(LCase(exec.StdOut.ReadAll()))

portalUrl = PORTAL_BASE_URL & "#email=" & upn

' Relies on Edge's "App Paths" registry entry so a full install path isn't needed.
shell.Run "msedge.exe --app=""" & portalUrl & """", 1, False
