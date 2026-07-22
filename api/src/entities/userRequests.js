const crypto = require('crypto');
const { sql, getPool } = require('../db');
const { sendUserRequestEmail, sendUserRequestCompletedEmail } = require('../mail');
const users = require('./users');

function rowToUserRequest(r) {
  if (!r) return null;
  return {
    requestId: r.RequestId,
    requestNumber: r.RequestNumber,
    timestamp: r.Timestamp,
    requesterEmail: r.RequesterEmail,
    requesterName: r.RequesterName,
    firstNameHe: r.FirstNameHe,
    lastNameHe: r.LastNameHe,
    firstNameEn: r.FirstNameEn,
    lastNameEn: r.LastNameEn,
    branchNumber: r.BranchNumber,
    role: r.Role,
    suggestedEmail: r.SuggestedEmail,
    tempPassword: r.TempPassword,
    status: r.Status,
    assignedToEmail: r.AssignedToEmail,
    assignedToName: r.AssignedToName,
    reviewedByEmail: r.ReviewedByEmail,
    reviewedAt: r.ReviewedAt,
    accessType: r.AccessType,
    assignedComputerName: r.AssignedComputerName,
    newComputerType: r.NewComputerType,
  };
}

function canReview(caller) {
  return caller.isSuperAdmin || caller.isITAdmin;
}

// Mirrors tickets.js's resolveActor — while impersonating (view-as, IT Admin only),
// take()/markCompleted() should record the impersonated admin as the reviewer, not the
// real admin behind the keyboard, same trust boundary as every viewAsEmail-honoring
// endpoint elsewhere in the app.
async function resolveActor(pool, payload, caller) {
  if (payload.viewAsEmail && caller.isITAdmin) {
    const email = String(payload.viewAsEmail).trim().toLowerCase();
    const result = await pool.request().input('email', sql.NVarChar, email)
      .query('SELECT FirstName, LastName FROM Users WHERE Email = @email');
    const row = result.recordset[0];
    return { email, name: row ? `${row.FirstName} ${row.LastName}`.trim() : email };
  }
  return { email: caller.email, name: caller.name || '' };
}

// Email is always computed server-side, never trusted from the client — same rule as
// every other identity-adjacent value in this codebase (see dispatch.js).
function computeSuggestedEmail(firstNameEn, lastNameEn) {
  const first = String(firstNameEn || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const last = String(lastNameEn || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  if (!first || !last) return '';
  return `${first}.${last}@rami-levy-stock.co.il`;
}

// Generated once per request (at create time) and never regenerated — the same value is
// reused for every later script preview, and shown again in the "welcome message" box
// after IT marks the request as done.
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O - hard to misread when copied by hand
  const lower = 'abcdefghijkmnpqrstuvwxyz'; // no l/o
  const digits = '23456789'; // no 0/1
  const symbols = '!@#$%';
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = 0; i < 8; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = chars[i]; chars[i] = chars[j]; chars[j] = tmp;
  }
  return chars.join('');
}

function escapePs(str) {
  return String(str || '').replace(/`/g, '``').replace(/"/g, '`"');
}

// Graph PowerShell, cloud-only (no on-prem AD in this project). IT always runs this
// manually, signed in under their own Global Admin session — never through an app
// registration the portal controls (see PROJECT_STATUS.md, section 4).
function buildScript(data) {
  const firstNameHe = data.firstNameHe || '';
  const lastNameHe = data.lastNameHe || '';
  const firstNameEn = data.firstNameEn || '';
  const lastNameEn = data.lastNameEn || '';
  const role = data.role || '';
  const branchNumber = data.branchNumber;
  const branchName = data.branchName || '';
  const suggestedEmail = data.suggestedEmail || '';
  const tempPassword = data.tempPassword || '';
  const folders = data.folders || [];

  const displayName = (firstNameHe + ' ' + lastNameHe).trim();
  const localPart = suggestedEmail.split('@')[0];
  const department = Number(branchNumber) === 0 ? '' : branchName;

  const lines = [
    'Connect-MgGraph -Scopes "User.ReadWrite.All","Group.ReadWrite.All"',
    '$pw = ConvertTo-SecureString "' + escapePs(tempPassword) + '" -AsPlainText -Force',
    '$user = New-MgUser -DisplayName "' + escapePs(displayName) + '" -UserPrincipalName "' + escapePs(suggestedEmail) + '" `',
    '  -MailNickname "' + escapePs(localPart) + '" -AccountEnabled `',
    '  -PasswordProfile @{Password=$pw; ForceChangePasswordNextSignIn=$true} `',
    '  -GivenName "' + escapePs(firstNameEn) + '" -Surname "' + escapePs(lastNameEn) + '" -JobTitle "' + escapePs(role) + '" -Department "' + escapePs(department) + '" `',
    '  -UsageLocation "IL"',
  ];
  folders.forEach((f) => {
    if (f.entraGroupObjectId) {
      lines.push('Add-MgGroupMember -GroupId "' + escapePs(f.entraGroupObjectId) + '" -DirectoryObjectId $user.Id  # ' + f.name);
    } else {
      lines.push('# WARNING: missing Object ID for folder "' + f.name + '" - look it up in Entra ID -> Groups and run Add-MgGroupMember manually.');
    }
  });
  return lines.join('\n');
}

async function getBranchName(pool, branchNumber) {
  if (branchNumber === null || branchNumber === undefined) return '';
  const res = await pool.request().input('n', sql.Int, branchNumber).query('SELECT Name FROM Branches WHERE Number = @n');
  return res.recordset[0] ? res.recordset[0].Name : '';
}

async function getFoldersByIds(pool, ids) {
  if (!ids || !ids.length) return [];
  const req = pool.request();
  const placeholders = ids.map((id, i) => {
    req.input(`f${i}`, sql.UniqueIdentifier, id);
    return `@f${i}`;
  });
  const res = await req.query(`SELECT * FROM SharedFolders WHERE Id IN (${placeholders.join(',')})`);
  return res.recordset.map((r) => ({ id: r.Id, name: r.Name, entraGroupObjectId: r.EntraGroupObjectId }));
}

async function getFoldersForRequest(pool, requestId) {
  const res = await pool.request().input('id', sql.Int, requestId)
    .query(`SELECT sf.* FROM UserRequestFolders urf
      JOIN SharedFolders sf ON sf.Id = urf.SharedFolderId
      WHERE urf.RequestId = @id ORDER BY sf.Name`);
  return res.recordset.map((r) => ({ id: r.Id, name: r.Name, entraGroupObjectId: r.EntraGroupObjectId }));
}

const ACCESS_TYPES = ['מחשב', 'מייל'];
const COMPUTER_TYPES = ['נייח', 'נייד'];

async function create(payload, caller) {
  if (!caller.isUserRequestSubmitter) return { ok: false, error: 'אין הרשאה' };

  const firstNameHe = String(payload.firstNameHe || '').trim();
  const lastNameHe = String(payload.lastNameHe || '').trim();
  const firstNameEn = String(payload.firstNameEn || '').trim();
  const lastNameEn = String(payload.lastNameEn || '').trim();
  const role = String(payload.role || '').trim();
  const branchNumber = payload.branchNumber === '' || payload.branchNumber == null ? null : Number(payload.branchNumber);
  if (!firstNameHe || !lastNameHe || !firstNameEn || !lastNameEn) {
    return { ok: false, error: 'יש למלא שם פרטי ומשפחה בעברית ובאנגלית' };
  }
  const suggestedEmail = computeSuggestedEmail(firstNameEn, lastNameEn);
  if (!suggestedEmail) return { ok: false, error: 'שם באנגלית לא תקין ליצירת מייל' };

  // Item 3 (user-request follow-up): "מחשב" needs either an existing workstation or a
  // brand-new order (נייח/נייד) — never both, never neither.
  const accessType = ACCESS_TYPES.includes(payload.accessType) ? payload.accessType : 'מחשב';
  let assignedComputerName = null;
  let newComputerType = null;
  if (accessType === 'מחשב') {
    assignedComputerName = String(payload.assignedComputerName || '').trim() || null;
    if (!assignedComputerName) {
      newComputerType = COMPUTER_TYPES.includes(payload.newComputerType) ? payload.newComputerType : null;
      if (!newComputerType) return { ok: false, error: 'יש לבחור עמדת מחשב קיימת או סוג מחשב להזמנה' };
    }
  }

  const folderIds = accessType === 'מחשב' && Array.isArray(payload.folderIds) ? payload.folderIds : [];
  const tempPassword = generateTempPassword();

  const pool = await getPool();
  const result = await pool.request()
    .input('requesterEmail', sql.NVarChar, caller.email)
    .input('requesterName', sql.NVarChar, caller.name || '')
    .input('firstNameHe', sql.NVarChar, firstNameHe)
    .input('lastNameHe', sql.NVarChar, lastNameHe)
    .input('firstNameEn', sql.NVarChar, firstNameEn)
    .input('lastNameEn', sql.NVarChar, lastNameEn)
    .input('branchNumber', sql.Int, branchNumber)
    .input('role', sql.NVarChar, role)
    .input('suggestedEmail', sql.NVarChar, suggestedEmail)
    .input('tempPassword', sql.NVarChar, tempPassword)
    .input('accessType', sql.NVarChar, accessType)
    .input('assignedComputerName', sql.NVarChar, assignedComputerName)
    .input('newComputerType', sql.NVarChar, newComputerType)
    .query(`INSERT INTO UserRequests
        (RequesterEmail, RequesterName, FirstNameHe, LastNameHe, FirstNameEn, LastNameEn, BranchNumber, Role, SuggestedEmail, TempPassword, AccessType, AssignedComputerName, NewComputerType)
      OUTPUT INSERTED.*
      VALUES (@requesterEmail, @requesterName, @firstNameHe, @lastNameHe, @firstNameEn, @lastNameEn, @branchNumber, @role, @suggestedEmail, @tempPassword, @accessType, @assignedComputerName, @newComputerType)`);

  const request = result.recordset[0];
  for (const folderId of folderIds) {
    await pool.request().input('reqId', sql.Int, request.RequestId).input('folderId', sql.UniqueIdentifier, folderId)
      .query('INSERT INTO UserRequestFolders (RequestId, SharedFolderId) VALUES (@reqId, @folderId)');
  }

  // Item 4 (user-request follow-up): ordering a new computer spawns a "רכש" task —
  // IT procures/registers the actual hardware and links it here before the request
  // itself can be marked "הוקם" (see markCompleted below).
  if (newComputerType) {
    await pool.request().input('reqId', sql.Int, request.RequestId).input('type', sql.NVarChar, newComputerType)
      .query('INSERT INTO ProcurementTasks (RequestId, ComputerType) VALUES (@reqId, @type)');
  }

  sendUserRequestEmail(request).catch((err) => console.error('sendUserRequestEmail failed', err));

  return { ok: true, data: { requestNumber: request.RequestNumber } };
}

async function list(_payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM UserRequests ORDER BY Timestamp DESC');
  return { ok: true, data: result.recordset.map(rowToUserRequest) };
}

// Best-effort — ProcurementTasks may not exist yet on a DB that hasn't run the migration
// in infra/schema.sql, and this lookup is a nice-to-have (the "create computer" button
// in the review wizard), not core to reviewing/updating/completing the request itself.
async function getOpenProcurementTaskId(pool, requestId) {
  try {
    const res = await pool.request().input('reqId', sql.Int, requestId)
      .query("SELECT TOP 1 Id FROM ProcurementTasks WHERE RequestId = @reqId AND Status <> N'הושלם' ORDER BY CreatedAt DESC");
    return res.recordset[0] ? res.recordset[0].Id : null;
  } catch (err) {
    return null;
  }
}

async function get(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();
  const requestId = Number(payload.requestId);
  const result = await pool.request().input('id', sql.Int, requestId).query('SELECT * FROM UserRequests WHERE RequestId = @id');
  const row = result.recordset[0];
  if (!row) return { ok: false, error: 'הבקשה לא נמצאה' };
  const folders = await getFoldersForRequest(pool, requestId);
  const procurementTaskId = await getOpenProcurementTaskId(pool, requestId);
  return { ok: true, data: { request: rowToUserRequest(row), folders, procurementTaskId } };
}

const EDITABLE_REQUEST_FIELDS = ['FirstNameHe', 'LastNameHe', 'FirstNameEn', 'LastNameEn', 'Role'];

async function update(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const requestId = Number(payload.requestId);
  const pool = await getPool();
  const existing = await pool.request().input('id', sql.Int, requestId).query('SELECT * FROM UserRequests WHERE RequestId = @id');
  const row = existing.recordset[0];
  if (!row) return { ok: false, error: 'הבקשה לא נמצאה' };

  const req = pool.request().input('id', sql.Int, requestId);
  const sets = [];
  EDITABLE_REQUEST_FIELDS.forEach((f) => {
    const key = f.charAt(0).toLowerCase() + f.slice(1);
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      req.input(f, sql.NVarChar, String(payload[key] ?? ''));
      sets.push(`${f} = @${f}`);
    }
  });
  if (Object.prototype.hasOwnProperty.call(payload, 'branchNumber')) {
    const branchNumber = payload.branchNumber === '' || payload.branchNumber == null ? null : Number(payload.branchNumber);
    req.input('BranchNumber', sql.Int, branchNumber);
    sets.push('BranchNumber = @BranchNumber');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'accessType')) {
    const accessType = ACCESS_TYPES.includes(payload.accessType) ? payload.accessType : 'מחשב';
    req.input('AccessType', sql.NVarChar, accessType);
    sets.push('AccessType = @AccessType');
    // Switching access type or workstation source clears whichever half doesn't apply
    // anymore — never leave a stale AssignedComputerName/NewComputerType behind.
    const assignedComputerName = accessType === 'מחשב'
      ? (String(payload.assignedComputerName || '').trim() || null) : null;
    req.input('AssignedComputerName', sql.NVarChar, assignedComputerName);
    sets.push('AssignedComputerName = @AssignedComputerName');
    const newComputerType = (accessType === 'מחשב' && !assignedComputerName && COMPUTER_TYPES.includes(payload.newComputerType))
      ? payload.newComputerType : null;
    req.input('NewComputerType', sql.NVarChar, newComputerType);
    sets.push('NewComputerType = @NewComputerType');
  }

  // Names drive the generated UPN — recompute and persist whenever either changes.
  const firstNameEn = Object.prototype.hasOwnProperty.call(payload, 'firstNameEn') ? payload.firstNameEn : row.FirstNameEn;
  const lastNameEn = Object.prototype.hasOwnProperty.call(payload, 'lastNameEn') ? payload.lastNameEn : row.LastNameEn;
  const suggestedEmail = computeSuggestedEmail(firstNameEn, lastNameEn);
  req.input('SuggestedEmail', sql.NVarChar, suggestedEmail);
  sets.push('SuggestedEmail = @SuggestedEmail');

  if (sets.length) await req.query(`UPDATE UserRequests SET ${sets.join(', ')} WHERE RequestId = @id`);

  if (Array.isArray(payload.folderIds)) {
    await pool.request().input('id', sql.Int, requestId).query('DELETE FROM UserRequestFolders WHERE RequestId = @id');
    for (const folderId of payload.folderIds) {
      await pool.request().input('reqId', sql.Int, requestId).input('folderId', sql.UniqueIdentifier, folderId)
        .query('INSERT INTO UserRequestFolders (RequestId, SharedFolderId) VALUES (@reqId, @folderId)');
    }
  }
  return { ok: true };
}

// Used both for the live preview while IT edits a queued request (requestId given, reuses
// its already-generated TempPassword) and for the stateless "prepare setup script" button
// on the plain "add user" form (no requestId — nothing is persisted, section 4ג/11).
async function previewScript(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const pool = await getPool();

  let base = {};
  let tempPassword;
  if (payload.requestId) {
    const existing = await pool.request().input('id', sql.Int, Number(payload.requestId))
      .query('SELECT * FROM UserRequests WHERE RequestId = @id');
    const row = existing.recordset[0];
    if (!row) return { ok: false, error: 'הבקשה לא נמצאה' };
    base = rowToUserRequest(row);
    tempPassword = row.TempPassword;
  } else {
    tempPassword = generateTempPassword();
  }
  // IT can hand-edit the shown password (never persisted — only the queued request's own
  // TempPassword, generated once at create() time, is ever stored in the DB).
  if (typeof payload.tempPassword === 'string' && payload.tempPassword.trim()) {
    tempPassword = payload.tempPassword.trim();
  }

  const firstNameHe = payload.firstNameHe ?? base.firstNameHe ?? '';
  const lastNameHe = payload.lastNameHe ?? base.lastNameHe ?? '';
  const firstNameEn = payload.firstNameEn ?? base.firstNameEn ?? '';
  const lastNameEn = payload.lastNameEn ?? base.lastNameEn ?? '';
  const role = payload.role ?? base.role ?? '';
  const branchNumber = payload.branchNumber !== undefined
    ? (payload.branchNumber === '' ? null : Number(payload.branchNumber))
    : (base.branchNumber ?? null);
  const folderIds = Array.isArray(payload.folderIds) ? payload.folderIds
    : (payload.requestId ? (await getFoldersForRequest(pool, Number(payload.requestId))).map((f) => f.id) : []);

  const suggestedEmail = computeSuggestedEmail(firstNameEn, lastNameEn);
  const branchName = await getBranchName(pool, branchNumber);
  const folders = await getFoldersByIds(pool, folderIds);

  const script = buildScript({
    firstNameHe, lastNameHe, firstNameEn, lastNameEn, role, branchNumber, branchName, suggestedEmail, tempPassword, folders,
  });

  return { ok: true, data: { script, suggestedEmail, tempPassword } };
}

// Mirrors tickets.take() — a pending request moves to "בטיפול" and is pinned to whoever
// took it, same as a ticket. Appears alongside tickets in the dashboard/queue.
async function take(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const requestId = Number(payload.requestId);
  const pool = await getPool();
  const existing = await pool.request().input('id', sql.Int, requestId).query('SELECT * FROM UserRequests WHERE RequestId = @id');
  const row = existing.recordset[0];
  if (!row) return { ok: false, error: 'הבקשה לא נמצאה' };
  if (row.Status !== 'ממתינה') return { ok: false, error: 'הבקשה כבר נלקחה' };
  const actor = await resolveActor(pool, payload, caller);

  await pool.request()
    .input('id', sql.Int, requestId)
    .input('email', sql.NVarChar, actor.email)
    .input('name', sql.NVarChar, actor.name)
    .query(`UPDATE UserRequests SET Status = N'בטיפול', AssignedToEmail = @email, AssignedToName = @name
      WHERE RequestId = @id`);
  return { ok: true };
}

async function markCompleted(payload, caller) {
  if (!canReview(caller)) return { ok: false, error: 'אין הרשאה' };
  const requestId = Number(payload.requestId);
  const pool = await getPool();
  const existing = await pool.request().input('id', sql.Int, requestId).query('SELECT * FROM UserRequests WHERE RequestId = @id');
  const row = existing.recordset[0];
  if (!row) return { ok: false, error: 'הבקשה לא נמצאה' };
  if (row.Status !== 'בטיפול') return { ok: false, error: 'יש לקחת את הבקשה לטיפול לפני סימון כהוקמה' };
  // Item 4 (user-request follow-up): a new-computer order has to actually become a real
  // Computer record (via the linked procurement task) before the request can complete —
  // otherwise there'd be nothing for the new user to be assigned to.
  if (row.AccessType === 'מחשב' && row.NewComputerType && !row.AssignedComputerName) {
    return { ok: false, error: 'יש לשייך קודם מחשב חדש (דרך משימת הרכש) לפני סימון הבקשה כהוקמה' };
  }
  const actor = await resolveActor(pool, payload, caller);

  // The portal's own User row is created automatically here, from exactly what was
  // collected on the request — no separate manual step in "ניהול משתמשים" afterward. A
  // mail-only request simply has no AssignedComputerName, so the new user naturally
  // shows no computer/printer/AnyDesk anywhere else in the app. Portal permissions
  // (SuperAdmin only — enforced again inside users.create) come from the wizard's
  // "הרשאות פורטל" step, same fields as the plain "ניהול משתמשים" add flow.
  const createRes = await users.create({
    username: row.SuggestedEmail.split('@')[0],
    firstName: row.FirstNameHe,
    lastName: row.LastNameHe,
    firstNameEn: row.FirstNameEn,
    lastNameEn: row.LastNameEn,
    branchNumber: row.BranchNumber,
    role: row.Role,
    assignedComputerName: row.AssignedComputerName || '',
    isITAdmin: payload.isITAdmin,
    isProceduresAdmin: payload.isProceduresAdmin,
    isUserRequestSubmitter: payload.isUserRequestSubmitter,
  }, caller);
  if (!createRes.ok) return createRes;

  await pool.request()
    .input('id', sql.Int, requestId)
    .input('reviewer', sql.NVarChar, actor.email)
    .query(`UPDATE UserRequests SET Status = N'הוקם', ReviewedByEmail = @reviewer, ReviewedAt = SYSUTCDATETIME()
      WHERE RequestId = @id`);

  sendUserRequestCompletedEmail(row).catch((err) => console.error('sendUserRequestCompletedEmail failed', err));
  return { ok: true };
}

module.exports = { create, list, get, update, previewScript, take, markCompleted, rowToUserRequest };
