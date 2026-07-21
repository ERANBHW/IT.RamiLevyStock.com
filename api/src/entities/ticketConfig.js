const { sql, getPool } = require('../db');

// v2.1, section 7 — lets IT Admins manage the ticket form's categories, subcategories
// (static or "dynamic", i.e. sourced from another table like Printers) and urgency
// levels from the portal itself, instead of them being hardcoded in index.html.

function rowToCategory(r) {
  return { id: r.Id, name: r.Name, order: r.Order };
}
function rowToSubcategory(r) {
  return {
    id: r.Id, categoryId: r.CategoryId, name: r.Name,
    isDynamic: !!r.IsDynamic, dynamicSource: r.DynamicSource, order: r.Order,
  };
}
function rowToUrgency(r) {
  return { id: r.Id, name: r.Name, description: r.Description, colorHex: r.ColorHex, severity: r.Severity, order: r.Order };
}

// Every authenticated user needs this (it drives the ticket form) — not just admins.
async function list(_payload, _caller) {
  const pool = await getPool();
  const [catRes, subRes, urgRes] = await Promise.all([
    pool.request().query('SELECT * FROM TicketCategories ORDER BY [Order], Name'),
    pool.request().query('SELECT * FROM TicketSubcategories ORDER BY [Order], Name'),
    pool.request().query('SELECT * FROM TicketUrgencyLevels ORDER BY [Order], Severity'),
  ]);
  const categories = catRes.recordset.map(rowToCategory).map((c) => ({
    ...c,
    subcategories: subRes.recordset.filter((s) => s.CategoryId === c.id).map(rowToSubcategory),
  }));
  return { ok: true, data: { categories, urgencies: urgRes.recordset.map(rowToUrgency) } };
}

async function saveCategory(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם קטגוריה' };
  const order = Number(payload.order || 0);
  const pool = await getPool();
  if (payload.id) {
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, payload.id)
      .input('name', sql.NVarChar, name)
      .input('order', sql.Int, order)
      .query('UPDATE TicketCategories SET Name = @name, [Order] = @order WHERE Id = @id');
    if (!result.rowsAffected[0]) return { ok: false, error: 'הקטגוריה לא נמצאה' };
    return { ok: true };
  }
  const result = await pool.request()
    .input('name', sql.NVarChar, name)
    .input('order', sql.Int, order)
    .query('INSERT INTO TicketCategories (Name, [Order]) OUTPUT INSERTED.Id VALUES (@name, @order)');
  return { ok: true, data: { id: result.recordset[0].Id } };
}

async function deleteCategory(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM TicketCategories WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הקטגוריה לא נמצאה' };
  return { ok: true };
}

async function saveSubcategory(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם תת-קטגוריה' };
  if (!payload.categoryId) return { ok: false, error: 'חסרה קטגוריית אב' };
  const isDynamic = !!(payload.isDynamic === true || payload.isDynamic === 'true' || payload.isDynamic === '1' || payload.isDynamic === 1);
  const dynamicSource = isDynamic ? String(payload.dynamicSource || '').trim() || null : null;
  const order = Number(payload.order || 0);
  const pool = await getPool();
  if (payload.id) {
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, payload.id)
      .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
      .input('name', sql.NVarChar, name)
      .input('isDynamic', sql.Bit, isDynamic)
      .input('dynamicSource', sql.NVarChar, dynamicSource)
      .input('order', sql.Int, order)
      .query(`UPDATE TicketSubcategories SET CategoryId = @categoryId, Name = @name, IsDynamic = @isDynamic,
        DynamicSource = @dynamicSource, [Order] = @order WHERE Id = @id`);
    if (!result.rowsAffected[0]) return { ok: false, error: 'תת-הקטגוריה לא נמצאה' };
    return { ok: true };
  }
  const result = await pool.request()
    .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
    .input('name', sql.NVarChar, name)
    .input('isDynamic', sql.Bit, isDynamic)
    .input('dynamicSource', sql.NVarChar, dynamicSource)
    .input('order', sql.Int, order)
    .query(`INSERT INTO TicketSubcategories (CategoryId, Name, IsDynamic, DynamicSource, [Order])
      OUTPUT INSERTED.Id VALUES (@categoryId, @name, @isDynamic, @dynamicSource, @order)`);
  return { ok: true, data: { id: result.recordset[0].Id } };
}

async function deleteSubcategory(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM TicketSubcategories WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'תת-הקטגוריה לא נמצאה' };
  return { ok: true };
}

async function saveUrgency(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם דרגה' };
  const description = String(payload.description || '').trim();
  const colorHex = String(payload.colorHex || '#edd76f').trim();
  const severity = Number(payload.severity || 1);
  const order = Number(payload.order || 0);
  const pool = await getPool();
  if (payload.id) {
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, payload.id)
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar, description)
      .input('colorHex', sql.NVarChar, colorHex)
      .input('severity', sql.Int, severity)
      .input('order', sql.Int, order)
      .query(`UPDATE TicketUrgencyLevels SET Name = @name, Description = @description, ColorHex = @colorHex,
        Severity = @severity, [Order] = @order WHERE Id = @id`);
    if (!result.rowsAffected[0]) return { ok: false, error: 'הדרגה לא נמצאה' };
    return { ok: true };
  }
  const result = await pool.request()
    .input('name', sql.NVarChar, name)
    .input('description', sql.NVarChar, description)
    .input('colorHex', sql.NVarChar, colorHex)
    .input('severity', sql.Int, severity)
    .input('order', sql.Int, order)
    .query(`INSERT INTO TicketUrgencyLevels (Name, Description, ColorHex, Severity, [Order])
      OUTPUT INSERTED.Id VALUES (@name, @description, @colorHex, @severity, @order)`);
  return { ok: true, data: { id: result.recordset[0].Id } };
}

async function deleteUrgency(payload, caller) {
  if (!caller.isITAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM TicketUrgencyLevels WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הדרגה לא נמצאה' };
  return { ok: true };
}

module.exports = {
  list, saveCategory, deleteCategory, saveSubcategory, deleteSubcategory, saveUrgency, deleteUrgency,
};
