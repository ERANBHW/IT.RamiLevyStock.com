const { sql, getPool } = require('../db');

function rowToBranch(r) {
  if (!r) return null;
  return { number: r.Number, name: r.Name };
}

// Every authenticated user needs the branch list (profile, ticket form, admin selects) —
// not just admins.
async function list(_payload, _caller) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Branches ORDER BY Number');
  return { ok: true, data: result.recordset.map(rowToBranch) };
}

async function create(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const number = Number(payload.number);
  const name = String(payload.name || '').trim();
  if (!Number.isInteger(number)) return { ok: false, error: 'מספר סניף לא תקין' };
  if (!name) return { ok: false, error: 'חסר שם סניף' };

  const pool = await getPool();
  const existing = await pool.request().input('number', sql.Int, number)
    .query('SELECT Number FROM Branches WHERE Number = @number');
  if (existing.recordset.length) return { ok: false, error: 'סניף עם מספר זה כבר קיים' };

  await pool.request().input('number', sql.Int, number).input('name', sql.NVarChar, name)
    .query('INSERT INTO Branches (Number, Name) VALUES (@number, @name)');
  return { ok: true };
}

async function update(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const number = Number(payload.number);
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם סניף' };

  const pool = await getPool();
  const result = await pool.request().input('number', sql.Int, number).input('name', sql.NVarChar, name)
    .query('UPDATE Branches SET Name = @name WHERE Number = @number');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הסניף לא נמצא' };
  return { ok: true };
}

async function remove(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const number = Number(payload.number);
  const pool = await getPool();
  const result = await pool.request().input('number', sql.Int, number)
    .query('DELETE FROM Branches WHERE Number = @number');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הסניף לא נמצא' };
  return { ok: true };
}

module.exports = { list, create, update, remove, rowToBranch };
