const { sql, getPool } = require('../db');

function rowToSettings(r) {
  if (!r) return { itCompanyEmail: '', printerCompanyEmail: '', adminEmail: '' };
  return {
    itCompanyEmail: r.ItCompanyEmail,
    printerCompanyEmail: r.PrinterCompanyEmail,
    adminEmail: r.AdminEmail,
  };
}

// Global Admin's "ניהול כתובות מייל" screen — a single settings row read by mail.js on
// every send (with a fallback to the old env vars if this row doesn't exist yet, so
// there's no hard cutover moment tied to running the migration).
async function get(_payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM EmailSettings WHERE Id = 1');
  return { ok: true, data: rowToSettings(result.recordset[0]) };
}

async function update(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const itCompanyEmail = String(payload.itCompanyEmail || '').trim();
  const printerCompanyEmail = String(payload.printerCompanyEmail || '').trim();
  const adminEmail = String(payload.adminEmail || '').trim();

  const pool = await getPool();
  await pool.request()
    .input('it', sql.NVarChar, itCompanyEmail)
    .input('printer', sql.NVarChar, printerCompanyEmail)
    .input('admin', sql.NVarChar, adminEmail)
    .query(`MERGE EmailSettings AS target
      USING (SELECT 1 AS Id) AS src ON target.Id = src.Id
      WHEN MATCHED THEN UPDATE SET ItCompanyEmail = @it, PrinterCompanyEmail = @printer, AdminEmail = @admin, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (Id, ItCompanyEmail, PrinterCompanyEmail, AdminEmail) VALUES (1, @it, @printer, @admin);`);
  return { ok: true };
}

module.exports = { get, update };
