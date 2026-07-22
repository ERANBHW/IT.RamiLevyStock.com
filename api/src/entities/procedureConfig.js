const { sql, getPool } = require('../db');

// Follow-up feature — lets Procedures Admins manage the procedures screen's categories/
// subcategories (with a color per category) and their drag-drop order, mirroring the
// TicketCategories/TicketSubcategories pattern in ticketConfig.js.

function rowToCategory(r) {
  return { id: r.Id, name: r.Name, colorHex: r.ColorHex, order: r.Order };
}
function rowToSubcategory(r) {
  return { id: r.Id, categoryId: r.CategoryId, name: r.Name, order: r.Order };
}

// Every authenticated user needs this (it drives the main procedures page's grouping and
// colors), not just procedures admins.
async function list(_payload, _caller) {
  const pool = await getPool();
  const [catRes, subRes] = await Promise.all([
    pool.request().query('SELECT * FROM ProcedureCategories ORDER BY [Order], Name'),
    pool.request().query('SELECT * FROM ProcedureSubcategories ORDER BY [Order], Name'),
  ]);
  const categories = catRes.recordset.map(rowToCategory).map((c) => ({
    ...c,
    subcategories: subRes.recordset.filter((s) => s.CategoryId === c.id).map(rowToSubcategory),
  }));
  return { ok: true, data: { categories } };
}

async function saveCategory(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם קטגוריה' };
  const colorHex = String(payload.colorHex || '#8b5cf6').trim();
  const order = Number(payload.order || 0);
  const pool = await getPool();
  if (payload.id) {
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, payload.id)
      .input('name', sql.NVarChar, name)
      .input('colorHex', sql.NVarChar, colorHex)
      .input('order', sql.Int, order)
      .query('UPDATE ProcedureCategories SET Name = @name, ColorHex = @colorHex, [Order] = @order WHERE Id = @id');
    if (!result.rowsAffected[0]) return { ok: false, error: 'הקטגוריה לא נמצאה' };
    return { ok: true };
  }
  const result = await pool.request()
    .input('name', sql.NVarChar, name)
    .input('colorHex', sql.NVarChar, colorHex)
    .input('order', sql.Int, order)
    .query('INSERT INTO ProcedureCategories (Name, ColorHex, [Order]) OUTPUT INSERTED.Id VALUES (@name, @colorHex, @order)');
  return { ok: true, data: { id: result.recordset[0].Id } };
}

// Deleting a category cascades (in the DB) into deleting its subcategories. Procedures.
// SubcategoryId has no cascading FK of its own (see schema.sql — a second cascade path
// down to Procedures isn't allowed), so any procedure still pointing at one of those
// subcategories is unlinked here first, or the cascade delete would fail on the FK.
async function deleteCategory(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query(`UPDATE Procedures SET SubcategoryId = NULL
      WHERE SubcategoryId IN (SELECT Id FROM ProcedureSubcategories WHERE CategoryId = @id)`);
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM ProcedureCategories WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הקטגוריה לא נמצאה' };
  return { ok: true };
}

async function saveSubcategory(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, error: 'חסר שם תת-קטגוריה' };
  if (!payload.categoryId) return { ok: false, error: 'חסרה קטגוריית אב' };
  const order = Number(payload.order || 0);
  const pool = await getPool();
  if (payload.id) {
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, payload.id)
      .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
      .input('name', sql.NVarChar, name)
      .input('order', sql.Int, order)
      .query('UPDATE ProcedureSubcategories SET CategoryId = @categoryId, Name = @name, [Order] = @order WHERE Id = @id');
    if (!result.rowsAffected[0]) return { ok: false, error: 'תת-הקטגוריה לא נמצאה' };
    return { ok: true };
  }
  const result = await pool.request()
    .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
    .input('name', sql.NVarChar, name)
    .input('order', sql.Int, order)
    .query('INSERT INTO ProcedureSubcategories (CategoryId, Name, [Order]) OUTPUT INSERTED.Id VALUES (@categoryId, @name, @order)');
  return { ok: true, data: { id: result.recordset[0].Id } };
}

// Same reason as deleteCategory above — Procedures.SubcategoryId has no cascading FK,
// so any procedure still pointing at this subcategory is unlinked before the delete.
async function deleteSubcategory(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('UPDATE Procedures SET SubcategoryId = NULL WHERE SubcategoryId = @id');
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM ProcedureSubcategories WHERE Id = @id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'תת-הקטגוריה לא נמצאה' };
  return { ok: true };
}

module.exports = { list, saveCategory, deleteCategory, saveSubcategory, deleteSubcategory };
