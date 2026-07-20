const { sql, getPool } = require('../db');
const { rowToTicket } = require('./tickets');

function rowToComputer(r) {
  if (!r) return null;
  return {
    computerName: r.ComputerName,
    type: r.Type,
    ram: r.RAM,
    ip: r.IP,
    printer: r.Printer,
    anyDeskId: r.AnyDeskId,
    assignedUserEmail: r.AssignedUserEmail,
    branch: r.Branch,
    notes: r.Notes,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}

async function getAssigned(_payload, caller) {
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, caller.email)
    .query('SELECT * FROM Computers WHERE AssignedUserEmail = @email');
  return { ok: true, data: rowToComputer(result.recordset[0]) };
}

async function list(_payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Computers ORDER BY ComputerName');
  return { ok: true, data: result.recordset.map(rowToComputer) };
}

const EDITABLE_COMPUTER_FIELDS = ['Type', 'RAM', 'IP', 'Printer', 'AnyDeskId', 'AssignedUserEmail', 'Branch', 'Notes'];

async function create(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const computerName = String(payload.computerName || '').trim();
  if (!computerName) return { ok: false, error: 'חסר שם מחשב' };

  const pool = await getPool();
  const existing = await pool.request().input('name', sql.NVarChar, computerName)
    .query('SELECT ComputerName FROM Computers WHERE ComputerName = @name');
  if (existing.recordset.length) return { ok: false, error: 'מחשב עם שם זה כבר קיים' };

  const req = pool.request().input('computerName', sql.NVarChar, computerName);
  EDITABLE_COMPUTER_FIELDS.forEach((f) => {
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    req.input(f, sql.NVarChar, payload[key] ? String(payload[key]) : null);
  });
  await req.query(`INSERT INTO Computers (ComputerName, Type, RAM, IP, Printer, AnyDeskId, AssignedUserEmail, Branch, Notes)
    VALUES (@computerName, @Type, @RAM, @IP, @Printer, @AnyDeskId, @AssignedUserEmail, @Branch, @Notes)`);
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
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      req.input(f, sql.NVarChar, payload[key] ? String(payload[key]) : null);
      sets.push(`${f} = @${f}`);
    }
  });
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

module.exports = { getAssigned, list, create, update, remove, ticketHistory, rowToComputer };
