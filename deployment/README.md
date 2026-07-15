# IT Portal desktop icon

## The installer

**`Install-ITPortal.ps1`** is a single, self-contained file — the launcher script and the
desktop icon are both embedded inside it as text, nothing else needs to be copied alongside
it. An IT admin runs it once per machine (with administrator rights); every regular employee
who logs into that machine afterward sees an "IT Portal" icon on the shared desktop and just
double-clicks it — no install step of their own.

```powershell
powershell.exe -ExecutionPolicy Bypass -File Install-ITPortal.ps1
```

or right-click the file → **Run with PowerShell** (as administrator).

It writes to `C:\ProgramData\ITPortal` (machine-wide) and creates
`IT Portal.lnk` on the **Public** desktop (`C:\Users\Public\Desktop`), which Windows shows
on every user's desktop on that machine. Needs admin rights for both of those locations —
that's why `#Requires -RunAsAdministrator` is at the top.

**`Uninstall-ITPortal.ps1`** reverses it (also needs admin rights).

## Why admin-only at install time, but no admin needed to use it

Installing writes to machine-wide, admin-only locations (`ProgramData`, the Public desktop).
Actually *launching* the portal only runs `whoami /upn`, which works for any standard
(non-admin) Windows account — that's the whole point of this design: install once as admin,
every employee just uses the icon afterward with zero permissions of their own.

## Distributing to many machines: Intune

The simplest fit is Intune's **Devices → Scripts** feature (not a Win32 app / `.intunewin`
package — that's unnecessary complexity here since this is one self-contained `.ps1`):

1. **Intune admin center → Devices → Scripts and remediations → Platform scripts → Add**
2. Upload `Install-ITPortal.ps1`.
3. **Run this script using the logged-on credentials**: **No** — run as SYSTEM, which has
   the administrator rights the installer needs. This is fine because the script doesn't
   care who's logged in at install time; user identity is resolved later, each time the
   *icon* is actually launched, via `whoami /upn` in that moment's session.
4. Assign to a **device group** (not user group — this only needs to run once per machine).
5. Set the script to run once (not repeatedly) unless you want it to self-heal if someone
   deletes the shortcut.

## Regenerating the installer after changing the launcher or the icon

`Install-ITPortal.ps1` embeds copies of `launch-it-portal.vbs` and `it-portal.ico`. If either
of those source files changes, the embedded copies inside the installer need to be
regenerated to match — ask Claude to rebuild it next time either source file changes, rather
than hand-editing the giant base64 blob inside the `.ps1`.

## Testing before wide rollout

This environment has no Windows host to run or verify these scripts. Test on one real
machine first:

```powershell
.\Install-ITPortal.ps1
# double-click "IT Portal" on the Public desktop, confirm Edge opens in app mode
# with your UPN in the URL
.\Uninstall-ITPortal.ps1
```
