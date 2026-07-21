const { sql, getPool } = require('../db');

function rowToUser(r) {
  if (!r) return null;
  return {
    email: r.Email,
    firstName: r.FirstName,
    lastName: r.LastName,
    phone: r.Phone,
    branchNumber: r.BranchNumber,
    role: r.Role,
    isSuperAdmin: !!r.IsSuperAdmin,
    isITAdmin: !!r.IsITAdmin,
    isProceduresAdmin: !!r.IsProceduresAdmin,
    isUserRequestSubmitter: !!r.IsUserRequestSubmitter,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}

// '' / null / undefined all mean "no branch selected" — stored as NULL, never as 0
// unless 0 (the seeded "מרוחק") was actually chosen.
function parseBranchNumber(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function isAnyAdmin(caller) {
  return caller.isSuperAdmin || caller.isITAdmin || caller.isProceduresAdmin;
}

async function identify(_payload, caller) {
  return { ok: true, data: rowToUser(caller.row) };
}

const EDITABLE_PROFILE_FIELDS = ['FirstName', 'LastName', 'Phone', 'Role'];

async function updateProfile(payload, caller) {
  const pool = await getPool();
  const req = pool.request().input('email', sql.NVarChar, caller.email);
  const sets = ['UpdatedAt = SYSUTCDATETIME()'];
  EDITABLE_PROFILE_FIELDS.forEach((f) => {
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      req.input(f, sql.NVarChar, String(payload[key] ?? ''));
      sets.push(`${f} = @${f}`);
    }
  });
  const branchNumber = parseBranchNumber(payload.branchNumber);
  if (branchNumber !== undefined) {
    req.input('BranchNumber', sql.Int, branchNumber);
    sets.push('BranchNumber = @BranchNumber');
  }
  await req.query(`UPDATE Users SET ${sets.join(', ')} WHERE Email = @email`);
  const result = await pool.request().input('email', sql.NVarChar, caller.email)
    .query('SELECT * FROM Users WHERE Email = @email');
  return { ok: true, data: rowToUser(result.recordset[0]) };
}

async function list(_payload, caller) {
  if (!isAnyAdmin(caller)) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Users ORDER BY Email');
  return { ok: true, data: result.recordset.map(rowToUser) };
}

async function setAssignment(pool, computerName, email) {
  await pool.request().input('email', sql.NVarChar, email)
    .query('UPDATE Computers SET AssignedUserEmail = NULL WHERE AssignedUserEmail = @email');
  await pool.request().input('email', sql.NVarChar, email).input('name', sql.NVarChar, computerName)
    .query('UPDATE Computers SET AssignedUserEmail = @email, UpdatedAt = SYSUTCDATETIME() WHERE ComputerName = @name');
}

// The "add user" form only takes a username (section 11) — the server owns composing the
// real address, same rule as SuggestedEmail in userRequests.js.
const USER_EMAIL_DOMAIN = 'rami-levy-stock.co.il';

async function create(payload, caller) {
  if (!isAnyAdmin(caller)) return { ok: false, error: 'אין הרשאה' };
  const username = String(payload.username || '').trim().toLowerCase().replace(/@.*$/, '');
  if (!username) return { ok: false, error: 'חסר שם משתמש' };
  const email = `${username}@${USER_EMAIL_DOMAIN}`;

  const pool = await getPool();
  const existing = await pool.request().input('email', sql.NVarChar, email)
    .query('SELECT Email FROM Users WHERE Email = @email');
  if (existing.recordset.length) return { ok: false, error: 'משתמש עם מייל זה כבר קיים' };

  // Only a SuperAdmin may grant admin flags — an IT/Procedures admin always creates a plain user.
  const isITAdmin = caller.isSuperAdmin ? !!payload.isITAdmin : false;
  const isProceduresAdmin = caller.isSuperAdmin ? !!payload.isProceduresAdmin : false;
  const isUserRequestSubmitter = caller.isSuperAdmin ? !!payload.isUserRequestSubmitter : false;

  await pool.request()
    .input('email', sql.NVarChar, email)
    .input('firstName', sql.NVarChar, String(payload.firstName || ''))
    .input('lastName', sql.NVarChar, String(payload.lastName || ''))
    .input('phone', sql.NVarChar, String(payload.phone || ''))
    .input('branchNumber', sql.Int, parseBranchNumber(payload.branchNumber) ?? null)
    .input('role', sql.NVarChar, String(payload.role || ''))
    .input('isITAdmin', sql.Bit, isITAdmin)
    .input('isProceduresAdmin', sql.Bit, isProceduresAdmin)
    .input('isUserRequestSubmitter', sql.Bit, isUserRequestSubmitter)
    .query(`INSERT INTO Users (Email, FirstName, LastName, Phone, BranchNumber, Role, IsSuperAdmin, IsITAdmin, IsProceduresAdmin, IsUserRequestSubmitter)
      VALUES (@email, @firstName, @lastName, @phone, @branchNumber, @role, 0, @isITAdmin, @isProceduresAdmin, @isUserRequestSubmitter)`);

  if (payload.assignedComputerName) await setAssignment(pool, payload.assignedComputerName, email);
  return { ok: true };
}

const EDITABLE_ADMIN_USER_FIELDS = ['FirstName', 'LastName', 'Phone', 'Role'];

async function adminUpdate(payload, caller) {
  if (!isAnyAdmin(caller)) return { ok: false, error: 'אין הרשאה' };
  const email = String(payload.email || '').trim().toLowerCase();
  const pool = await getPool();
  const targetRes = await pool.request().input('email', sql.NVarChar, email)
    .query('SELECT * FROM Users WHERE Email = @email');
  const target = targetRes.recordset[0];
  if (!target) return { ok: false, error: 'המשתמש לא נמצא' };

  // Non-SuperAdmin admins may only manage plain users, never other admins.
  const targetIsAdmin = !!(target.IsSuperAdmin || target.IsITAdmin || target.IsProceduresAdmin);
  if (!caller.isSuperAdmin && targetIsAdmin) return { ok: false, error: 'אין הרשאה לערוך מנהל' };

  const req = pool.request().input('email', sql.NVarChar, email);
  const sets = ['UpdatedAt = SYSUTCDATETIME()'];
  EDITABLE_ADMIN_USER_FIELDS.forEach((f) => {
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      req.input(f, sql.NVarChar, String(payload[key] ?? ''));
      sets.push(`${f} = @${f}`);
    }
  });
  const branchNumber = parseBranchNumber(payload.branchNumber);
  if (branchNumber !== undefined) {
    req.input('BranchNumber', sql.Int, branchNumber);
    sets.push('BranchNumber = @BranchNumber');
  }
  // IsSuperAdmin is never settable through this (or any) endpoint. Admin flags: SuperAdmin only.
  if (caller.isSuperAdmin) {
    if (Object.prototype.hasOwnProperty.call(payload, 'isITAdmin')) {
      req.input('IsITAdmin', sql.Bit, !!payload.isITAdmin);
      sets.push('IsITAdmin = @IsITAdmin');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'isProceduresAdmin')) {
      req.input('IsProceduresAdmin', sql.Bit, !!payload.isProceduresAdmin);
      sets.push('IsProceduresAdmin = @IsProceduresAdmin');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'isUserRequestSubmitter')) {
      req.input('IsUserRequestSubmitter', sql.Bit, !!payload.isUserRequestSubmitter);
      sets.push('IsUserRequestSubmitter = @IsUserRequestSubmitter');
    }
  }
  await req.query(`UPDATE Users SET ${sets.join(', ')} WHERE Email = @email`);

  if (Object.prototype.hasOwnProperty.call(payload, 'assignedComputerName')) {
    await pool.request().input('email', sql.NVarChar, email)
      .query('UPDATE Computers SET AssignedUserEmail = NULL WHERE AssignedUserEmail = @email');
    if (payload.assignedComputerName) await setAssignment(pool, payload.assignedComputerName, email);
  }
  return { ok: true };
}

async function remove(payload, caller) {
  if (!isAnyAdmin(caller)) return { ok: false, error: 'אין הרשאה' };
  const email = String(payload.email || '').trim().toLowerCase();
  const pool = await getPool();
  const targetRes = await pool.request().input('email', sql.NVarChar, email)
    .query('SELECT * FROM Users WHERE Email = @email');
  const target = targetRes.recordset[0];
  if (!target) return { ok: false, error: 'המשתמש לא נמצא' };
  if (target.IsSuperAdmin) return { ok: false, error: 'לא ניתן למחוק מנהל-על' };
  const targetIsAdmin = !!(target.IsITAdmin || target.IsProceduresAdmin);
  if (!caller.isSuperAdmin && targetIsAdmin) return { ok: false, error: 'אין הרשאה למחוק מנהל' };

  await pool.request().input('email', sql.NVarChar, email).query('DELETE FROM Users WHERE Email = @email');
  return { ok: true };
}

module.exports = { identify, updateProfile, list, create, adminUpdate, remove, rowToUser };
