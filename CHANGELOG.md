# Changelog

## 1.0.0
- Rebuilt the backend (`apps-script/Code.gs`) around a real data model: Users, Computers,
  Tickets, TicketLog, Procedures, EmailSettings, Counters.
- Added shared frontend infrastructure (`common.css`, `common.js`): brand palette, identity
  resolution from the launcher's `#email=` hash, shared fetch/role helpers, shared header
  with version badge.
- Replaced the placeholder index page with the real portal foundation (Phase 0 of the IT
  Portal build plan).
