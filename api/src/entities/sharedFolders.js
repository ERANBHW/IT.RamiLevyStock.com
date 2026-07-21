const { sql, getPool } = require('../db');

function rowToSharedFolder(r) {
  if (!r) return null;
  return { id: r.Id, name: r.Name, entraGroupObjectId: r.EntraGroupObjectId };
}

// Every authenticated user needs the folder list (user-request form's multi-select) —
// not just admins.
async function list(_payload, _caller) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM SharedFolders ORDER BY Name');
  return { ok: true, data: result.recordset.map(rowToSharedFolder) };
}

async function create(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם תיקייה' };
  const entraGroupObjectId = String(payload.entraGroupObjectId || '').trim();

  const pool = await getPool();
  await pool.request().input('name', sql.NVarChar, name).input('objId', sql.NVarChar, entraGroupObjectId)
    .query('INSERT INTO SharedFolders (Name, EntraGroupObjectId) VALUES (@name, @objId)');
  return { ok: true };
}

async function update(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const id = String(payload.id || '');
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם תיקייה' };
  const entraGroupObjectId = String(payload.entraGroupObjectId || '').trim();

  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, id)
    .input('name', sql.NVarChar, name).input('objId', sql.NVarChar, entraGroupObjectId)
    .query('UPDATE SharedFolders SET Name = @name, EntraGroupObjectId = @objId WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'התיקייה לא נמצאה' };
  return { ok: true };
}

async function remove(payload, caller) {
  if (!caller.isSuperAdmin) return { ok: false, error: 'אין הרשאה' };
  const id = String(payload.id || '');
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, id)
    .query('DELETE FROM SharedFolders WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'התיקייה לא נמצאה' };
  return { ok: true };
}

module.exports = { list, create, update, remove, rowToSharedFolder };
