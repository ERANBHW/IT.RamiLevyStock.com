# Changelog

## 2.0.0 — migration to Azure / Entra ID
- The Google account backing v1 (`apps-script/`, Google Sheets as the DB) was permanently
  blocked by Google for Terms of Service violations — not a normal reauth prompt. Rather
  than fight to restore a personal Gmail account with no Google Workspace behind it, the
  backend was rebuilt from scratch on Azure, reusing the frontend structure and business
  logic that v1 had already proven out. No v1 data carried over (it was sample/test data).
- **Backend**: `apps-script/Code.gs` → `api/` (Azure Functions, Node.js), same
  entity/action router shape. Google Sheets → Azure SQL Database (real column types,
  `IDENTITY` ticket numbering instead of the Counters+LockService hack).
- **Auth**: the biggest change. v1 trusted an `#email=` URL parameter the client sent —
  no cryptographic proof of identity. v2 uses MSAL.js (`common.js`) against Entra ID with
  `ssoSilent()`, and every API request is gated by Easy Auth on the Function App, which
  validates the signed token *before* any application code runs. No endpoint accepts a
  client-supplied email/id for identity purposes anymore.
- **Mail**: `MailApp.sendEmail` (personal Gmail) → Microsoft Graph `sendMail` from a
  dedicated Exchange Online shared mailbox, via a confidential-client app registration.
- **Permissions**: extended beyond v1. `IsSuperAdmin` (immutable, DB-only) is now the only
  role that can grant `IsITAdmin`/`IsProceduresAdmin` to other users; those admins can
  manage plain users but not other admins.
- **Tickets**: added a full audit trail. Every field edit, IT-admin "take" (self-assign),
  reassignment, status change, and closing note is written to `TicketLog` server-side
  (actor identity from Easy Auth, never from the client) and rendered as a timeline in the
  ticket detail view. The requester can edit their own ticket only while it's still
  unclaimed (`פתוחה`); once an IT admin takes it, only IT can change it further.
- **Deployment**: `deployment/*.vbs`/`*.ps1` (desktop shortcut installer) removed —
  replaced by an Intune Settings Catalog policy that sets the portal as Microsoft Edge's
  startup URL, no install step at all. GitHub Pages frontend and DNS are unchanged.
- See `infra/README.md` for the Azure provisioning steps this release depends on.

## 1.5.0
- Deployment tooling only — no change to the running web app (in-app version badge stays
  at 1.4.0).
- `deployment/`: `launch-it-portal.vbs` (whoami /upn → Edge app-mode launch, unchanged from
  Phase 1), `it-portal.ico` (generated from the company logo), `Install.ps1`/`Uninstall.ps1`
  (create/remove the desktop shortcut in the current user's profile — must run in USER
  context, not SYSTEM, for `whoami /upn` and the desktop path to resolve to the actual
  employee), and a packaging `README.md` with Intune Win32 app steps. These PowerShell/VBS
  scripts could not be executed here (no Windows host in this environment) — verify on a
  real machine before wide rollout.

## 1.4.0
- Admin panels, both gated server-side (not just hidden in the UI):
  - Users (`IsSuperAdmin`): add/edit/delete employees, toggle `IsITAdmin`/`IsProceduresAdmin`,
    assign a computer from the Computers list.
  - Computers (`IsITAdmin`): add/edit/delete machines (type, RAM, IP, printer, AnyDesk ID,
    branch, notes), per-computer ticket history, one-click `anydesk:<id>` connect link.
  - Both surfaced as conditional buttons under a "ניהול" section on the hub, visible only
    to users with the matching role.
  - Seeded the requester as the first `IsSuperAdmin` (one-time bootstrap, since the admin
    panels would otherwise be inaccessible to everyone with an empty Users sheet).
- Bug fix: `toCamel_` only lowercased the first character of sheet headers, so all-caps
  headers like `RAM`/`IP` serialized as `rAM`/`iP` instead of `ram`/`ip` - silently broken
  since Phase 2 (the ticket IP field) and would have broken Computers entirely. Now handles
  all-caps headers correctly.
- Hardening: the backend now refuses to delete a super-admin via the API, not just hides the
  delete button client-side.

## 1.3.0
- Procedures page: grouped by category, expandable cards. Employees with the
  `IsProceduresAdmin` flag (or `IsSuperAdmin`) see add/edit/delete controls; the
  permission check is enforced server-side, not just hidden client-side.
- Backend: `procedures.list/create/update/delete`. Seeded 6 example procedures across
  בטיחות/אבטחת מידע/מחשוב.

## 1.2.0
- Support ticket page: form prefilled from the employee's assigned computer (pencil to
  override for a single ticket, e.g. opening a ticket for a colleague), category/urgency
  selection, submit flow with a confirmation screen showing the new `TK-####` number.
- Backend: `computers.getAssigned`, `tickets.create` (TK-#### numbering via Counters +
  LockService, sends IT/admin + employee confirmation emails from EmailSettings, sender
  name "IT-Rami-Levy-Stock"), and `tickets.listMine`.
- Hub: blinking bordered banner on the ticket page when open tickets exist, listing their
  numbers and expanding to ticket cards; a "קריאות סגורות" toggle for closed tickets;
  click-through ticket detail modal.

## 1.1.0
- Home hub: personalized greeting resolved from the launcher's `#email=` hash, editable
  profile (first/last name, phone, branch, role) syncing back to the Users sheet.
- Graceful "not found" screen for emails not yet in the Users sheet.
- 3 main action buttons (open ticket / create signature / procedures) wired to
  placeholder views, ready for Phases 2/3/5 to fill in.
- Desktop launcher (`deployment/launch-it-portal.vbs`): captures the signed-in user's UPN
  via `whoami /upn` and opens Edge in app mode with it in the URL hash.

## 1.0.0
- Rebuilt the backend (`apps-script/Code.gs`) around a real data model: Users, Computers,
  Tickets, TicketLog, Procedures, EmailSettings, Counters.
- Added shared frontend infrastructure (`common.css`, `common.js`): brand palette, identity
  resolution from the launcher's `#email=` hash, shared fetch/role helpers, shared header
  with version badge.
- Replaced the placeholder index page with the real portal foundation (Phase 0 of the IT
  Portal build plan).
