# IT Portal desktop icon — Intune packaging

Files in this folder:

- `launch-it-portal.vbs` — the actual launcher. Reads the signed-in user's UPN via
  `whoami /upn` and opens Microsoft Edge in app mode (`--app=`, no address bar) with it in
  the URL hash: `https://it.ramilevystock.com/index.html#email=<upn>`.
- `it-portal.ico` — desktop shortcut icon, generated from the company logo.
- `Install.ps1` / `Uninstall.ps1` — copy the launcher + icon into the current user's profile
  and create/remove the `IT Portal.lnk` desktop shortcut.

## Critical requirement: install as the logged-on user, not SYSTEM

Both scripts write to `%LOCALAPPDATA%` and `[Environment]::GetFolderPath('Desktop')`, which
resolve to *whichever account the script runs as*. Intune Win32 apps default to running as
SYSTEM. If this one runs as SYSTEM, the shortcut lands in SYSTEM's own (invisible) profile,
not the employee's desktop — nothing will appear for the user.

In the Win32 app's **Program** settings, install and uninstall command lines are fine as-is,
but under **Requirements**, and more importantly wherever Intune exposes it for this app
type, install behavior must be set to run **in the user's context** (Win32 apps: this is
controlled by *not* using the "Install for system" all-users option and instead assigning
the app to a **user group** rather than a **device group** — user-targeted Win32 app
installs run as the logged-on user). Test on one machine before wide rollout.

## Packaging steps

1. Download `IntuneWinAppUtil.exe` (Microsoft Win32 Content Prep Tool).
2. Put `launch-it-portal.vbs`, `it-portal.ico`, `Install.ps1`, `Uninstall.ps1` in one source
   folder (this `deployment/` folder works as-is).
3. Run:
   ```
   IntuneWinAppUtil.exe -c deployment -s Install.ps1 -o out
   ```
   This produces `Install.intunewin`.
4. In Intune admin center → **Apps → Windows → Add → Windows app (Win32)**:
   - Upload `Install.intunewin`.
   - Install command: `powershell.exe -ExecutionPolicy Bypass -File Install.ps1`
   - Uninstall command: `powershell.exe -ExecutionPolicy Bypass -File Uninstall.ps1`
   - Install behavior: user context (see above).
   - Detection rule: **File** exists,
     path `%LOCALAPPDATA%\Microsoft\Windows\Desktop\IT Portal.lnk`
     (or the actual Desktop folder path on target machines — confirm with
     `[Environment]::GetFolderPath('Desktop')` on a test machine, some redirected-profile
     setups differ).
5. Assign to a **user group** containing the target employees.

## Testing changes locally before pushing to Intune

On a real Windows machine (not this sandbox — there's no Windows host available here to run
or verify these scripts):

```powershell
.\Install.ps1   # creates the shortcut
# double-click "IT Portal" on the desktop, confirm Edge opens in app mode with your UPN
.\Uninstall.ps1 # removes it
```
