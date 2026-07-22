const { sql, getPool } = require('../db');

function rowToProcurementTask(r) {
  if (!r) return null;
  return {
    id: r.Id,
    requestId: r.RequestId,
    computerType: r.ComputerType,
    status: r.Status,
    createdAt: r.CreatedAt,
    completedAt: r.CompletedAt,
    createdComputerName: r.CreatedComputerName,
    // joined from UserRequests, for the tasks-tab card display
    firstNameHe: r.FirstNameHe,
    lastNameHe: r.LastNameHe,
    branchNumber: r.BranchNumber,
    suggestedEmail: r.SuggestedEmail,
    requestNumber: r.RequestNumber,
  };
}

function canReview(caller) {
  return caller.isSuperAdmin || caller.isITAdmin;
}

async function list(_payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query(`SELECT pt.*, ur.FirstNameHe, ur.LastNameHe, ur.BranchNumber, ur.SuggestedEmail, ur.RequestNumber
    FROM ProcurementTasks pt JOIN UserRequests ur ON ur.RequestId = pt.RequestId
    ORDER BY pt.CreatedAt DESC`);
  return { ok: true, data: result.recordset.map(rowToProcurementTask) };
}

// Called after IT registers the actual hardware (via computers.create, reusing the
// existing computer-admin flow) — links the new Computer back to both the procurement
// task and the originating request, unblocking userRequests.markCompleted.
async function linkComputer(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const taskId = Number(payload.taskId);
  const computerName = String(payload.computerName || '').trim();
  if (!computerName) return { ok: false, error: 'חסר שם מחשב' };

  const pool = await getPool();
  const existing = await pool.request().input('id', sql.Int, taskId).query('SELECT * FROM ProcurementTasks WHERE Id = @id');
  const row = existing.recordset[0];
  if (!row) return { ok: false, error: 'המשימה לא נמצאה' };
  if (row.Status === 'הושלם') return { ok: false, error: 'המשימה כבר הושלמה' };

  const computerRes = await pool.request().input('name', sql.NVarChar, computerName)
    .query('SELECT ComputerName FROM Computers WHERE ComputerName = @name');
  if (!computerRes.recordset.length) return { ok: false, error: 'המחשב לא נמצא - יש ליצור אותו קודם' };

  await pool.request().input('id', sql.Int, taskId).input('name', sql.NVarChar, computerName)
    .query(`UPDATE ProcurementTasks SET Status = N'הושלם', CompletedAt = SYSUTCDATETIME(), CreatedComputerName = @name
      WHERE Id = @id`);
  await pool.request().input('reqId', sql.Int, row.RequestId).input('name', sql.NVarChar, computerName)
    .query('UPDATE UserRequests SET AssignedComputerName = @name WHERE RequestId = @reqId');

  return { ok: true };
}

module.exports = { list, linkComputer, rowToProcurementTask };
