# Changelog

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
