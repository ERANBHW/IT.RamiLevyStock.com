const { sql, getPool } = require('../db');
const { rowToTicket } = require('./tickets');

function rowToComputer(r) {
  if (!r) return null;
  return {
    computerName: r.ComputerName,
    type: r.Type,
    ram: r.RAM,
    anyDeskId: r.AnyDeskId,
    assignedUserEmail: r.AssignedUserEmail,
    branchNumber: r.BranchNumber,
    defaultPrinterName: r.DefaultPrinterName,
    notes: r.Notes,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}

// '' / null / undefined all mean "no branch selected" — stored as NULL, never as 0
// unless 0 (the seeded "מרוחק") was actually chosen.
function parseBranchNumber(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// "View as" support (IT Admin/SuperAdmin only) — viewAsEmail is ignored for anyone else,
// so a regular user can never see another user's assigned computer this way.
async function getAssigned(payload, caller) {
  const targetEmail = (payload.viewAsEmail && caller.isITAdmin)
    ? String(payload.viewAsEmail).trim().toLowerCase() : caller.email;
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, targetEmail)
    .query('SELECT * FROM Computers WHERE AssignedUserEmail = @email');
  return { ok: true, data: rowToComputer(result.recordset[0]) };
}

async function list(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Computers ORDER BY ComputerName');
  return { ok: true, data: result.recordset.map(rowToComputer) };
}

// Every authenticated user needs this for the ticket form's "pick a different computer"
// pencil (v2.1, section 10) — just names, none of the sensitive fields list() exposes.
async function listNames(_payload, _caller) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT ComputerName FROM Computers ORDER BY ComputerName');
  return { ok: true, data: result.recordset.map((r) => r.ComputerName) };
}

const EDITABLE_COMPUTER_FIELDS = ['Type', 'RAM', 'AnyDeskId', 'AssignedUserEmail', 'DefaultPrinterName', 'Notes'];

// 'RAM' isn't a normal capitalized word — naive camelCase (charAt(0).toLowerCase() + rest)
// turns it into 'rAM', which never matches payload.ram and silently inserted NULL into a
// NOT NULL column. Every other field name here is a single leading capital, so this is
// the only special case needed.
function payloadKeyFor(field) {
  return field === 'RAM' ? 'ram' : field.charAt(0).toLowerCase() + field.slice(1);
}

async function create(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const computerName = String(payload.computerName || '').trim();
  if (!computerName) return { ok: false, error: 'חסר שם מחשב' };

  const pool = await getPool();
  const existing = await pool.request().input('name', sql.NVarChar, computerName)
    .query('SELECT ComputerName FROM Computers WHERE ComputerName = @name');
  if (existing.recordset.length) return { ok: false, error: 'מחשב עם שם זה כבר קיים' };

  const req = pool.request().input('computerName', sql.NVarChar, computerName)
    .input('BranchNumber', sql.Int, parseBranchNumber(payload.branchNumber) ?? null);
  EDITABLE_COMPUTER_FIELDS.forEach((f) => {
    const key = payloadKeyFor(f);
    req.input(f, sql.NVarChar, payload[key] ? String(payload[key]) : null);
  });
  await req.query(`INSERT INTO Computers (ComputerName, Type, RAM, AnyDeskId, AssignedUserEmail, DefaultPrinterName, BranchNumber, Notes)
    VALUES (@computerName, @Type, @RAM, @AnyDeskId, @AssignedUserEmail, @DefaultPrinterName, @BranchNumber, @Notes)`);
  return { ok: true };
}

async function update(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const computerName = String(payload.computerName || '').trim();
  const pool = await getPool();
  const existing = await pool.request().input('name', sql.NVarChar, computerName)
    .query('SELECT ComputerName FROM Computers WHERE ComputerName = @name');
  if (!existing.recordset.length) return { ok: false, error: 'המחשב לא נמצא' };

  const req = pool.request().input('computerName', sql.NVarChar, computerName);
  const sets = ['UpdatedAt = SYSUTCDATETIME()'];
  EDITABLE_COMPUTER_FIELDS.forEach((f) => {
    const key = payloadKeyFor(f);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      req.input(f, sql.NVarChar, payload[key] ? String(payload[key]) : null);
      sets.push(`${f} = @${f}`);
    }
  });
  const branchNumber = parseBranchNumber(payload.branchNumber);
  if (branchNumber !== undefined) {
    req.input('BranchNumber', sql.Int, branchNumber);
    sets.push('BranchNumber = @BranchNumber');
  }
  await req.query(`UPDATE Computers SET ${sets.join(', ')} WHERE ComputerName = @computerName`);
  return { ok: true };
}

async function remove(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const computerName = String(payload.computerName || '').trim();
  const pool = await getPool();
  const result = await pool.request().input('name', sql.NVarChar, computerName)
    .query('DELETE FROM Computers WHERE ComputerName = @name');
  if (!result.rowsAffected[0]) return { ok: false, error: 'המחשב לא נמצא' };
  return { ok: true };
}

async function ticketHistory(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('name', sql.NVarChar, String(payload.computerName || ''))
    .query('SELECT * FROM Tickets WHERE ComputerName = @name ORDER BY Timestamp DESC');
  return { ok: true, data: result.recordset.map(rowToTicket) };
}

module.exports = { getAssigned, list, listNames, create, update, remove, ticketHistory, rowToComputer };
