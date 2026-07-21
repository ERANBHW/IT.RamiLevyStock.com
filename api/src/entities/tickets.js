const { sql, getPool } = require('../db');
const { sendTicketEmails } = require('../mail');

const STATUS_OPEN = 'פתוחה';
const STATUS_PROGRESS = 'בטיפול';
const STATUS_CLOSED = 'סגורה';
const VALID_STATUSES = [STATUS_OPEN, STATUS_PROGRESS, STATUS_CLOSED];

function rowToTicket(r) {
  if (!r) return null;
  return {
    ticketNumber: r.TicketNumber,
    timestamp: r.Timestamp,
    userEmail: r.UserEmail,
    userName: r.UserName,
    phone: r.Phone,
    branch: r.Branch,
    computerName: r.ComputerName,
    ip: r.IP,
    printer: r.Printer,
    anyDeskId: r.AnyDeskId,
    category: r.Category,
    subcategory: r.Subcategory,
    urgency: r.Urgency,
    description: r.Description,
    status: r.Status,
    assignedToEmail: r.AssignedToEmail,
    assignedToName: r.AssignedToName,
    takenAt: r.TakenAt,
    closedAt: r.ClosedAt,
    isPrinterTicket: !!r.IsPrinterTicket,
    flagged: !!r.Flagged,
    updatedAt: r.UpdatedAt,
  };
}

function rowToLog(r) {
  return {
    id: r.Id,
    timestamp: r.Timestamp,
    actorEmail: r.ActorEmail,
    actorName: r.ActorName,
    action: r.Action,
    fieldName: r.FieldName,
    oldValue: r.OldValue,
    newValue: r.NewValue,
    message: r.Message,
  };
}

async function writeLog(pool, ticketNumber, caller, action, fields = {}) {
  await pool.request()
    .input('ticketNumber', sql.NVarChar, ticketNumber)
    .input('actorEmail', sql.NVarChar, caller.email)
    .input('actorName', sql.NVarChar, caller.name || '')
    .input('action', sql.NVarChar, action)
    .input('fieldName', sql.NVarChar, fields.fieldName ?? null)
    .input('oldValue', sql.NVarChar, fields.oldValue != null ? String(fields.oldValue) : null)
    .input('newValue', sql.NVarChar, fields.newValue != null ? String(fields.newValue) : null)
    .input('message', sql.NVarChar, fields.message ?? null)
    .query(`INSERT INTO TicketLog (TicketNumber, ActorEmail, ActorName, Action, FieldName, OldValue, NewValue, Message)
      VALUES (@ticketNumber, @actorEmail, @actorName, @action, @fieldName, @oldValue, @newValue, @message)`);
}

async function getTicketOr404(pool, ticketNumber) {
  const result = await pool.request().input('num', sql.NVarChar, ticketNumber)
    .query('SELECT * FROM Tickets WHERE TicketNumber = @num');
  return result.recordset[0] || null;
}

async function create(payload, caller) {
  // "printerName" (section 8's "for: a printer" toggle) means this ticket is about a
  // printer, not the caller's computer — it both fills the Printer column and routes the
  // notification email to printer support instead of IT.
  const isPrinterTicket = !!String(payload.printerName || '').trim();
  const printer = String(payload.printerName || payload.printer || '');

  const pool = await getPool();
  const result = await pool.request()
    .input('userEmail', sql.NVarChar, caller.email)
    .input('userName', sql.NVarChar, String(payload.userName || caller.name || ''))
    .input('phone', sql.NVarChar, String(payload.phone || ''))
    .input('branch', sql.NVarChar, String(payload.branch || ''))
    .input('computerName', sql.NVarChar, String(payload.computerName || ''))
    .input('ip', sql.NVarChar, String(payload.ip || ''))
    .input('printer', sql.NVarChar, printer)
    .input('anyDeskId', sql.NVarChar, String(payload.anyDeskId || ''))
    .input('category', sql.NVarChar, String(payload.category || ''))
    .input('subcategory', sql.NVarChar, payload.subcategory ? String(payload.subcategory) : null)
    .input('urgency', sql.NVarChar, String(payload.urgency || ''))
    .input('description', sql.NVarChar, String(payload.description || ''))
    .input('status', sql.NVarChar, STATUS_OPEN)
    .input('isPrinterTicket', sql.Bit, isPrinterTicket)
    .query(`INSERT INTO Tickets
        (UserEmail, UserName, Phone, Branch, ComputerName, IP, Printer, AnyDeskId, Category, Subcategory, Urgency, Description, Status, IsPrinterTicket)
      OUTPUT INSERTED.*
      VALUES (@userEmail, @userName, @phone, @branch, @computerName, @ip, @printer, @anyDeskId, @category, @subcategory, @urgency, @description, @status, @isPrinterTicket)`);

  const ticket = result.recordset[0];
  await writeLog(pool, ticket.TicketNumber, caller, 'created', { message: 'הקריאה נפתחה' });

  sendTicketEmails(ticket, { isPrinterTicket }).catch((err) => console.error('sendTicketEmails failed', err));

  return { ok: true, data: { ticketNumber: ticket.TicketNumber } };
}

// "View as" support (IT Admin/SuperAdmin only) — viewAsEmail is ignored for anyone else,
// so a regular user can never see another user's tickets this way.
async function listMine(payload, caller) {
  const targetEmail = (payload.viewAsEmail && caller.isITAdmin)
    ? String(payload.viewAsEmail).trim().toLowerCase() : caller.email;
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, targetEmail)
    .query('SELECT * FROM Tickets WHERE UserEmail = @email ORDER BY Timestamp DESC');
  return { ok: true, data: result.recordset.map(rowToTicket) };
}

async function list(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('closed', sql.NVarChar, STATUS_CLOSED)
    .query('SELECT * FROM Tickets WHERE Status <> @closed ORDER BY Timestamp ASC');
  return { ok: true, data: result.recordset.map(rowToTicket) };
}

// v2.1, section 5 — home-page dashboard. Open/in-progress counts and the per-branch
// breakdown are derived client-side from list() (already fetching those rows); closed
// tickets are numerous enough over time that they get their own lightweight count here
// instead of being fetched on every dashboard auto-refresh.
async function closedCount(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('closed', sql.NVarChar, STATUS_CLOSED)
    .query('SELECT COUNT(*) AS cnt FROM Tickets WHERE Status = @closed');
  return { ok: true, data: { count: result.recordset[0].cnt } };
}

async function listClosed(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('closed', sql.NVarChar, STATUS_CLOSED)
    .query('SELECT * FROM Tickets WHERE Status = @closed ORDER BY ClosedAt DESC');
  return { ok: true, data: result.recordset.map(rowToTicket) };
}

async function get(payload, caller) {
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };
  if (!(caller.isITAdmin || ticket.UserEmail.toLowerCase() === caller.email)) {
    return { ok: false, error: 'אין הרשאה' };
  }
  const logResult = await pool.request().input('num', sql.NVarChar, ticketNumber)
    .query('SELECT * FROM TicketLog WHERE TicketNumber = @num ORDER BY Timestamp ASC');
  // 'internal_note' entries (closing-dialog internal documentation) are for IT eyes
  // only — never returned to the ticket's own requester.
  const logRows = caller.isITAdmin ? logResult.recordset : logResult.recordset.filter((r) => r.Action !== 'internal_note');
  return { ok: true, data: { ticket: rowToTicket(ticket), log: logRows.map(rowToLog) } };
}

// The requester may only touch their own ticket, and only before it's picked up.
const REQUESTER_EDITABLE_FIELDS = ['Category', 'Subcategory', 'Urgency', 'Description', 'ComputerName', 'IP', 'Printer', 'AnyDeskId'];

async function update(payload, caller) {
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };
  if (ticket.UserEmail.toLowerCase() !== caller.email) return { ok: false, error: 'אין הרשאה' };
  if (ticket.Status !== STATUS_OPEN) return { ok: false, error: 'לא ניתן לערוך קריאה שכבר נלקחה לטיפול' };

  const req = pool.request().input('num', sql.NVarChar, ticketNumber);
  const sets = ['UpdatedAt = SYSUTCDATETIME()'];
  const changes = [];
  REQUESTER_EDITABLE_FIELDS.forEach((f) => {
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const newVal = String(payload[key] ?? '');
      const oldVal = String(ticket[f] ?? '');
      if (newVal !== oldVal) {
        req.input(f, sql.NVarChar, newVal);
        sets.push(`${f} = @${f}`);
        changes.push({ field: f, oldVal, newVal });
      }
    }
  });
  if (!changes.length) return { ok: true };

  await req.query(`UPDATE Tickets SET ${sets.join(', ')} WHERE TicketNumber = @num`);
  for (const c of changes) {
    await writeLog(pool, ticketNumber, caller, 'field_updated', { fieldName: c.field, oldValue: c.oldVal, newValue: c.newVal });
  }
  return { ok: true };
}

async function take(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };
  if (ticket.Status !== STATUS_OPEN) return { ok: false, error: 'הקריאה כבר נלקחה' };

  await pool.request()
    .input('num', sql.NVarChar, ticketNumber)
    .input('email', sql.NVarChar, caller.email)
    .input('name', sql.NVarChar, caller.name || '')
    .input('status', sql.NVarChar, STATUS_PROGRESS)
    .query(`UPDATE Tickets SET AssignedToEmail = @email, AssignedToName = @name, Status = @status,
        TakenAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE TicketNumber = @num`);

  await writeLog(pool, ticketNumber, caller, 'assigned', {
    newValue: caller.email,
    message: `${caller.name || caller.email} לקח/ה את הקריאה לטיפול`,
  });
  await writeLog(pool, ticketNumber, caller, 'status_changed', {
    fieldName: 'Status', oldValue: STATUS_OPEN, newValue: STATUS_PROGRESS,
  });
  return { ok: true };
}

async function reassign(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };

  const newEmail = String(payload.assignedToEmail || '').trim().toLowerCase();
  const userRes = await pool.request().input('email', sql.NVarChar, newEmail)
    .query('SELECT FirstName, LastName FROM Users WHERE Email = @email');
  const user = userRes.recordset[0];
  if (!user) return { ok: false, error: 'המשתמש לא נמצא' };
  const newName = `${user.FirstName} ${user.LastName}`.trim();

  await pool.request()
    .input('num', sql.NVarChar, ticketNumber)
    .input('email', sql.NVarChar, newEmail)
    .input('name', sql.NVarChar, newName)
    .query('UPDATE Tickets SET AssignedToEmail = @email, AssignedToName = @name, UpdatedAt = SYSUTCDATETIME() WHERE TicketNumber = @num');

  await writeLog(pool, ticketNumber, caller, 'assigned', {
    oldValue: ticket.AssignedToEmail, newValue: newEmail, message: `שויך מחדש ל-${newName}`,
  });
  return { ok: true };
}

async function updateStatus(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };

  const newStatus = String(payload.status || '');
  if (!VALID_STATUSES.includes(newStatus)) return { ok: false, error: 'סטטוס לא תקין' };

  const closedAtSet = newStatus === STATUS_CLOSED ? ', ClosedAt = SYSUTCDATETIME()' : '';
  await pool.request()
    .input('num', sql.NVarChar, ticketNumber)
    .input('status', sql.NVarChar, newStatus)
    .query(`UPDATE Tickets SET Status = @status, UpdatedAt = SYSUTCDATETIME()${closedAtSet} WHERE TicketNumber = @num`);

  if (newStatus !== ticket.Status) {
    await writeLog(pool, ticketNumber, caller, 'status_changed', {
      fieldName: 'Status', oldValue: ticket.Status, newValue: newStatus,
    });
  }
  if (payload.message) {
    await writeLog(pool, ticketNumber, caller, 'note', { message: String(payload.message) });
  }
  return { ok: true };
}

// Dashboard follow-up round 3 — replaces the plain prompt()-based close flow. Only
// resolutionDescription is required; it's logged as a normal 'note' (visible to the
// requester, same as before). internalNote (if any) is logged as 'internal_note'
// (IT-only, filtered out of get() for the requester). flagged marks the ticket for
// later review. followUpDescription (if any) creates a bare-bones follow-up row —
// deliberately minimal, the product owner asked for just "create + a count" for now.
async function closeWithDetails(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const ticketNumber = String(payload.ticketNumber || '');
  const ticket = await getTicketOr404(pool, ticketNumber);
  if (!ticket) return { ok: false, error: 'הקריאה לא נמצאה' };
  if (ticket.Status !== STATUS_PROGRESS) return { ok: false, error: 'ניתן לסגור רק קריאה שנמצאת בטיפול' };

  const resolutionDescription = String(payload.resolutionDescription || '').trim();
  if (!resolutionDescription) return { ok: false, error: 'יש למלא תיאור פתרון' };
  const internalNote = String(payload.internalNote || '').trim();
  const followUpDescription = String(payload.followUpDescription || '').trim();
  const flagged = !!(payload.flagged === true || payload.flagged === 'true' || payload.flagged === '1' || payload.flagged === 1);

  await pool.request()
    .input('num', sql.NVarChar, ticketNumber)
    .input('status', sql.NVarChar, STATUS_CLOSED)
    .input('flagged', sql.Bit, flagged)
    .query(`UPDATE Tickets SET Status = @status, Flagged = @flagged, ClosedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE TicketNumber = @num`);

  await writeLog(pool, ticketNumber, caller, 'status_changed', {
    fieldName: 'Status', oldValue: ticket.Status, newValue: STATUS_CLOSED,
  });
  await writeLog(pool, ticketNumber, caller, 'note', { message: resolutionDescription });
  if (internalNote) await writeLog(pool, ticketNumber, caller, 'internal_note', { message: internalNote });

  if (followUpDescription) {
    await pool.request()
      .input('num', sql.NVarChar, ticketNumber)
      .input('description', sql.NVarChar, followUpDescription)
      .input('email', sql.NVarChar, caller.email)
      .input('name', sql.NVarChar, caller.name || '')
      .query(`INSERT INTO TicketFollowUps (TicketNumber, Description, CreatedByEmail, CreatedByName)
        VALUES (@num, @description, @email, @name)`);
  }

  return { ok: true };
}

async function followUpCount(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('open', sql.NVarChar, 'פתוחה')
    .query('SELECT COUNT(*) AS cnt FROM TicketFollowUps WHERE Status = @open');
  return { ok: true, data: { count: result.recordset[0].cnt } };
}

// Dashboard timeline follow-up: only the person who wrote a free-text note may edit it
// later (clicking its dot in the timeline) — never a system-generated entry (status
// changes, field updates, assignment), and never someone else's note.
async function updateNote(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const logId = Number(payload.logId);
  const message = String(payload.message || '').trim();
  if (!message) return { ok: false, error: 'ההערה לא יכולה להיות ריקה' };

  const result = await pool.request().input('id', sql.Int, logId).query('SELECT * FROM TicketLog WHERE Id = @id');
  const entry = result.recordset[0];
  if (!entry) return { ok: false, error: 'הרשומה לא נמצאה' };
  if (entry.Action !== 'note' && entry.Action !== 'internal_note') return { ok: false, error: 'ניתן לערוך רק הערות' };
  if (String(entry.ActorEmail).toLowerCase() !== caller.email.toLowerCase()) {
    return { ok: false, error: 'ניתן לערוך רק הערות שהוספת בעצמך' };
  }

  await pool.request().input('id', sql.Int, logId).input('message', sql.NVarChar, message)
    .query('UPDATE TicketLog SET Message = @message WHERE Id = @id');
  return { ok: true };
}

module.exports = {
  create, listMine, list, closedCount, listClosed, get, update, take, reassign, updateStatus, updateNote,
  closeWithDetails, followUpCount, rowToTicket,
};
