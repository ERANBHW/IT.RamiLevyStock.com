const { sql, getPool } = require('../db');

function rowToProcedure(r) {
  return {
    id: r.Id,
    title: r.Title,
    content: r.Content,
    category: r.Category,
    order: r.Order,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy,
  };
}

async function list() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Procedures ORDER BY Category, [Order]');
  return { ok: true, data: result.recordset.map(rowToProcedure) };
}

async function create(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  await pool.request()
    .input('title', sql.NVarChar, String(payload.title || ''))
    .input('content', sql.NVarChar, String(payload.content || ''))
    .input('category', sql.NVarChar, String(payload.category || ''))
    .input('order', sql.Int, Number(payload.order) || 0)
    .input('updatedBy', sql.NVarChar, caller.email)
    .query('INSERT INTO Procedures (Title, Content, Category, [Order], UpdatedBy) VALUES (@title, @content, @category, @order, @updatedBy)');
  return { ok: true };
}

async function update(payload, caller) {
  if (!caller.isProceduresAdmin) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.UniqueIdentifier, payload.id)
    .input('title', sql.NVarChar, String(payload.title || ''))
    .input('content', sql.NVarChar, String(payload.content || ''))
    .input('category', sql.NVarChar, String(payload.category || ''))
    .input('order', sql.Int, Number(payload.order) || 0)
    .input('updatedBy', sql.NVarChar, caller.email)
    .query(`UPDATE Procedures SET Title=@title, Content=@content, Category=@category, [Order]=@order,
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
