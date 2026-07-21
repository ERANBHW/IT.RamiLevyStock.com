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
    urgency: r.Urgency,
    description: r.Description,
    status: r.Status,
    assignedToEmail: r.AssignedToEmail,
    assignedToName: r.AssignedToName,
    closedAt: r.ClosedAt,
    updatedAt: r.UpdatedAt,
  };
}

function rowToLog(r) {
  return {
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
    .input('urgency', sql.NVarChar, String(payload.urgency || ''))
    .input('description', sql.NVarChar, String(payload.description || ''))
    .input('status', sql.NVarChar, STATUS_OPEN)
    .query(`INSERT INTO Tickets
        (UserEmail, UserName, Phone, Branch, ComputerName, IP, Printer, AnyDeskId, Category, Urgency, Description, Status)
      OUTPUT INSERTED.*
      VALUES (@userEmail, @userName, @phone, @branch, @computerName, @ip, @printer, @anyDeskId, @category, @urgency, @description, @status)`);

  const ticket = result.recordset[0];
  await writeLog(pool, ticket.TicketNumber, caller, 'created', { message: 'הקריאה נפתחה' });

  sendTicketEmails(ticket, { isPrinterTicket }).catch((err) => console.error('sendTicketEmails failed', err));

  return { ok: true, data: { ticketNumber: ticket.TicketNumber } };
}

async function listMine(_payload, caller) {
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, caller.email)
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
  return { ok: true, data: { ticket: rowToTicket(ticket), log: logResult.recordset.map(rowToLog) } };
}

// The requester may only touch their own ticket, and only before it's picked up.
const REQUESTER_EDITABLE_FIELDS = ['Category', 'Urgency', 'Description', 'ComputerName', 'IP', 'Printer', 'AnyDeskId'];

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
    .query(`UPDATE Tickets SET AssignedToEmail = @email, AssignedToName = @name, Status = @status, UpdatedAt = SYSUTCDATETIME()
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

module.exports = { create, listMine, list, get, update, take, reassign, updateStatus, rowToTicket };
