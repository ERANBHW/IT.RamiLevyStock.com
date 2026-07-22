const { sql, getPool } = require('../db');

function rowToProcedure(r) {
  return {
    id: r.Id,
    title: r.Title,
    content: r.Content,
    categoryId: r.CategoryId,
    subcategoryId: r.SubcategoryId,
    isDraft: !!r.IsDraft,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy,
  };
}

// A draft is only visible to Procedures Admins (follow-up, item 3) — a regular employee
// must never see unfinished/unpublished content, even by guessing an id.
async function list(_payload, caller) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Procedures ORDER BY Title');
  const rows = caller.isProceduresAdmin ? result.recordset : result.recordset.filter((r) => !r.IsDraft);
  return { ok: true, data: rows.map(rowToProcedure) };
}

async function create(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  if (!payload.categoryId) return { ok: false, error: 'יש לבחור קטגוריה' };
  const pool = await getPool();
  const result = await pool.request()
    .input('title', sql.NVarChar, String(payload.title || ''))
    .input('content', sql.NVarChar, String(payload.content || ''))
    .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
    .input('subcategoryId', sql.UniqueIdentifier, payload.subcategoryId || null)
    .input('isDraft', sql.Bit, !!payload.isDraft)
    .input('updatedBy', sql.NVarChar, caller.email)
    .query(`INSERT INTO Procedures (Title, Content, CategoryId, SubcategoryId, IsDraft, UpdatedBy)
      OUTPUT INSERTED.Id VALUES (@title, @content, @categoryId, @subcategoryId, @isDraft, @updatedBy)`);
  return { ok: true, data: { id: result.recordset[0].Id } };
}

async function update(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  if (!payload.categoryId) return { ok: false, error: 'יש לבחור קטגוריה' };
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.UniqueIdentifier, payload.id)
    .input('title', sql.NVarChar, String(payload.title || ''))
    .input('content', sql.NVarChar, String(payload.content || ''))
    .input('categoryId', sql.UniqueIdentifier, payload.categoryId)
    .input('subcategoryId', sql.UniqueIdentifier, payload.subcategoryId || null)
    .input('isDraft', sql.Bit, !!payload.isDraft)
    .input('updatedBy', sql.NVarChar, caller.email)
    .query(`UPDATE Procedures SET Title=@title, Content=@content, CategoryId=@categoryId, SubcategoryId=@subcategoryId, IsDraft=@isDraft,
      UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@updatedBy WHERE Id=@id`);
  if (!result.rowsAffected[0]) return { ok: false, error: 'הנוהל לא נמצא' };
  return { ok: true };
}

async function remove(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().input('id', sql.UniqueIdentifier, payload.id)
    .query('DELETE FROM Procedures WHERE Id=@id');
  if (!result.rowsAffected[0]) return { ok: false, error: 'הנוהל לא נמצא' };
  return { ok: true };
}

module.exports = { list, create, update, remove };
