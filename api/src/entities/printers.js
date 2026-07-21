const { sql, getPool } = require('../db');

function rowToPrinter(r) {
  if (!r) return null;
  return { printerName: r.PrinterName, ip: r.IP, branchNumber: r.BranchNumber, notes: r.Notes };
}

function parseBranchNumber(v) {
  return v === '' || v === null || v === undefined ? null : Number(v);
}

// Every authenticated user needs the printer list (ticket form's "for: a printer" toggle)
// — not just admins.
async function list(_payload, _caller) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Printers ORDER BY PrinterName');
  return { ok: true, data: result.recordset.map(rowToPrinter) };
}

async function create(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const printerName = String(payload.printerName || '').trim();
  if (!printerName) return { ok: false, error: 'חסר שם מדפסת' };

  const pool = await getPool();
  const existing = await pool.request().input('name', sql.NVarChar, printerName)
    .query('SELECT PrinterName FROM Printers WHERE PrinterName = @name');
  if (existing.recordset.length) return { ok: false, error: 'מדפסת עם שם זה כבר קיימת' };

  await pool.request()
    .input('printerName', sql.NVarChar, printerName)
    .input('ip', sql.NVarChar, String(payload.ip || ''))
    .input('branchNumber', sql.Int, parseBranchNumber(payload.branchNumber))
    .input('notes', sql.NVarChar, String(payload.notes || ''))
    .query('INSERT INTO Printers (PrinterName, IP, BranchNumber, Notes) VALUES (@printerName, @ip, @branchNumber, @notes)');
  return { ok: true };
}

async function update(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const printerName = String(payload.printerName || '').trim();
  const pool = await getPool();
  const result = await pool.request()
    .input('printerName', sql.NVarChar, printerName)
    .input('ip', sql.NVarChar, String(payload.ip || ''))
    .input('branchNumber', sql.Int, parseBranchNumber(payload.branchNumber))
    .input('notes', sql.NVarChar, String(payload.notes || ''))
    .query('UPDATE Printers SET IP = @ip, BranchNumber = @branchNumber, Notes = @notes WHERE PrinterName = @printerName');
  if (!result.rowsAffected[0]) return { ok: false, error: 'המדפסת לא נמצאה' };
  return { ok: true };
}

async function remove(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const printerName = String(payload.printerName || '').trim();
  const pool = await getPool();
  const result = await pool.request().input('name', sql.NVarChar, printerName)
    .query('DELETE FROM Printers WHERE PrinterName = @name');
  if (!result.rowsAffected[0]) return { ok: false, error: 'המדפסת לא נמצאה' };
  return { ok: true };
}

module.exports = { list, create, update, remove, rowToPrinter };
