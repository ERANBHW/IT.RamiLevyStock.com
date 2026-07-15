/**
 * IT Portal backend — Web App bound to the "IT Portal DB" Google Sheet.
 * Deployed with clasp; the deployed /exec URL is called from common.js.
 *
 * Request shape:
 *   GET  ?entity=<entity>&action=<action>&...params
 *   POST JSON body { entity, action, ...payload } (sent as text/plain by the client
 *        to avoid a CORS preflight)
 */

var SHEET_SCHEMAS = {
  Users: ['Email', 'FirstName', 'LastName', 'Phone', 'Branch', 'Role',
          'IsSuperAdmin', 'IsITAdmin', 'IsProceduresAdmin', 'CreatedAt', 'UpdatedAt'],
  Computers: ['ComputerName', 'Type', 'RAM', 'IP', 'Printer', 'AnyDeskId',
              'AssignedUserEmail', 'Branch', 'Notes', 'CreatedAt', 'UpdatedAt'],
  Tickets: ['TicketNumber', 'Timestamp', 'UserEmail', 'UserName', 'Phone', 'Branch',
            'ComputerName', 'IP', 'Printer', 'AnyDeskId', 'Category', 'Urgency',
            'Description', 'Status', 'ClosedAt', 'UpdatedAt'],
  TicketLog: ['TicketNumber', 'Timestamp', 'Source', 'Author', 'Message'],
  Procedures: ['Id', 'Title', 'Content', 'Category', 'Order', 'UpdatedAt', 'UpdatedBy'],
  EmailSettings: ['Key', 'Value'],
  Counters: ['Key', 'NextNumber'],
};

// ── SHEET ACCESS ──────────────────────────────────────────────
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEET_SCHEMAS[name]);
  }
  return sheet;
}

function ensureAllSheets_() {
  Object.keys(SHEET_SCHEMAS).forEach(getSheet_);
}

function toCamel_(header) {
  return header.charAt(0).toLowerCase() + header.slice(1);
}

function rowsToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) obj[toCamel_(headers[c])] = values[i][c];
    rows.push(obj);
  }
  return rows;
}

function findRowByColumn_(sheet, columnName, value) {
  if (sheet.getLastRow() < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return -1;
  var values = sheet.getRange(2, colIndex + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === String(value).trim().toLowerCase()) return i + 2;
  }
  return -1;
}

function setRowValues_(sheet, rowIndex, valuesByHeader) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(valuesByHeader, h)) {
      sheet.getRange(rowIndex, i + 1).setValue(valuesByHeader[h]);
    }
  });
}

// ── COUNTERS (for future TK-#### ticket numbering etc.) ──────
function getNextNumber_(key) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_('Counters');
    var rowIndex = findRowByColumn_(sheet, 'Key', key);
    var next;
    if (rowIndex === -1) {
      next = 1;
      sheet.appendRow([key, next + 1]);
    } else {
      next = sheet.getRange(rowIndex, 2).getValue();
      sheet.getRange(rowIndex, 2).setValue(next + 1);
    }
    return next;
  } finally {
    lock.releaseLock();
  }
}

// ── ENTITY: users ─────────────────────────────────────────────
var EDITABLE_PROFILE_FIELDS = ['FirstName', 'LastName', 'Phone', 'Branch', 'Role'];

function users_identify_(params) {
  ensureAllSheets_();
  var sheet = getSheet_('Users');
  var rowIndex = findRowByColumn_(sheet, 'Email', params.email);
  if (rowIndex === -1) return { ok: true, data: null };
  var rows = rowsToObjects_(sheet);
  var user = rows[rowIndex - 2];
  return { ok: true, data: user };
}

function users_updateProfile_(payload) {
  var sheet = getSheet_('Users');
  var rowIndex = findRowByColumn_(sheet, 'Email', payload.email);
  if (rowIndex === -1) return { ok: false, error: 'User not found' };

  var updates = { UpdatedAt: new Date().toISOString() };
  EDITABLE_PROFILE_FIELDS.forEach(function (header) {
    var key = toCamel_(header);
    if (Object.prototype.hasOwnProperty.call(payload, key)) updates[header] = payload[key];
  });
  setRowValues_(sheet, rowIndex, updates);

  var rows = rowsToObjects_(sheet);
  return { ok: true, data: rows[rowIndex - 2] };
}

// ── ENTITY: computers ─────────────────────────────────────────
function computers_getAssigned_(params) {
  var sheet = getSheet_('Computers');
  var rowIndex = findRowByColumn_(sheet, 'AssignedUserEmail', params.email);
  if (rowIndex === -1) return { ok: true, data: null };
  var rows = rowsToObjects_(sheet);
  return { ok: true, data: rows[rowIndex - 2] };
}

// ── ENTITY: tickets ───────────────────────────────────────────
var TICKET_STATUS_OPEN = 'פתוחה';
var TICKET_STATUS_PROGRESS = 'בטיפול';
var TICKET_STATUS_CLOSED = 'סגורה';

function formatTicketNumber_(n) {
  return 'TK-' + ('0000' + n).slice(-4);
}

function getEmailSetting_(key) {
  var sheet = getSheet_('EmailSettings');
  var rowIndex = findRowByColumn_(sheet, 'Key', key);
  if (rowIndex === -1) return '';
  return String(sheet.getRange(rowIndex, 2).getValue() || '').trim();
}

var MAIL_SENDER_NAME = 'IT-Rami-Levy-Stock';

function sendTicketEmails_(ticket) {
  var itEmail = getEmailSetting_('ITCompanyEmail');
  var adminEmail = getEmailSetting_('AdminEmail');
  var subject = 'קריאת שירות חדשה ' + ticket.TicketNumber + ' - ' + ticket.Category;
  var body = [
    'קריאה: ' + ticket.TicketNumber,
    'שם: ' + ticket.UserName,
    'טלפון: ' + ticket.Phone,
    'סניף: ' + ticket.Branch,
    'מחשב: ' + ticket.ComputerName + ' | IP: ' + ticket.IP,
    'מדפסת: ' + ticket.Printer + ' | AnyDesk: ' + ticket.AnyDeskId,
    'קטגוריה: ' + ticket.Category,
    'דחיפות: ' + ticket.Urgency,
    '',
    'תיאור:',
    ticket.Description,
  ].join('\n');

  var staffRecipients = [itEmail, adminEmail].filter(Boolean).join(',');
  if (staffRecipients) {
    MailApp.sendEmail({ to: staffRecipients, subject: subject, body: body, name: MAIL_SENDER_NAME });
  }

  if (ticket.UserEmail) {
    var userSubject = 'הקריאה שלך נפתחה - ' + ticket.TicketNumber;
    var userBody = 'שלום ' + ticket.UserName + ',\n\nהקריאה שלך נפתחה בהצלחה.\n\n' + body;
    MailApp.sendEmail({ to: ticket.UserEmail, subject: userSubject, body: userBody, name: MAIL_SENDER_NAME });
  }
}

// One-time helper: run this manually from the Apps Script editor to trigger the
// MailApp authorization prompt (doGet/doPost alone never reach MailApp, so running
// those doesn't ask for the send_mail scope). Sends a harmless test email to the
// deploying account itself. Safe to leave in the project.
function authorizeMailScope_() {
  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: 'IT Portal - בדיקת הרשאת שליחת מיילים',
    body: 'אם קיבלת את המייל הזה, ההרשאה לשליחת מיילים אושרה בהצלחה.',
    name: MAIL_SENDER_NAME,
  });
}

function tickets_create_(payload) {
  var sheet = getSheet_('Tickets');
  var number = formatTicketNumber_(getNextNumber_('Ticket'));
  var now = new Date().toISOString();

  var row = {
    TicketNumber: number, Timestamp: now, UserEmail: payload.userEmail || '',
    UserName: payload.userName || '', Phone: payload.phone || '', Branch: payload.branch || '',
    ComputerName: payload.computerName || '', IP: payload.ip || '', Printer: payload.printer || '',
    AnyDeskId: payload.anyDeskId || '', Category: payload.category || '', Urgency: payload.urgency || '',
    Description: payload.description || '', Status: TICKET_STATUS_OPEN, ClosedAt: '', UpdatedAt: now,
  };
  sheet.appendRow(SHEET_SCHEMAS.Tickets.map(function (h) { return row[h]; }));

  sendTicketEmails_(row);

  return { ok: true, data: { ticketNumber: number } };
}

function tickets_listMine_(params) {
  var sheet = getSheet_('Tickets');
  var rows = rowsToObjects_(sheet);
  var mine = rows.filter(function (r) {
    return String(r.userEmail).trim().toLowerCase() === String(params.email).trim().toLowerCase();
  });
  mine.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return { ok: true, data: mine };
}

// ── ENTITY: procedures ────────────────────────────────────────
function userHasRole_(email, roleField) {
  var sheet = getSheet_('Users');
  var rowIndex = findRowByColumn_(sheet, 'Email', email);
  if (rowIndex === -1) return false;
  var rows = rowsToObjects_(sheet);
  var user = rows[rowIndex - 2];
  return !!(user.isSuperAdmin || user[roleField]);
}

function procedures_list_(params) {
  var sheet = getSheet_('Procedures');
  var rows = rowsToObjects_(sheet);
  rows.sort(function (a, b) {
    var catCompare = String(a.category).localeCompare(String(b.category), 'he');
    if (catCompare !== 0) return catCompare;
    return (Number(a.order) || 0) - (Number(b.order) || 0);
  });
  return { ok: true, data: rows };
}

function procedures_create_(payload) {
  if (!userHasRole_(payload.requesterEmail, 'isProceduresAdmin')) return { ok: false, error: 'אין הרשאה' };
  var sheet = getSheet_('Procedures');
  var now = new Date().toISOString();
  var row = {
    Id: Utilities.getUuid(), Title: payload.title || '', Content: payload.content || '',
    Category: payload.category || '', Order: payload.order || 0, UpdatedAt: now, UpdatedBy: payload.requesterEmail || '',
  };
  sheet.appendRow(SHEET_SCHEMAS.Procedures.map(function (h) { return row[h]; }));
  return { ok: true };
}

function procedures_update_(payload) {
  if (!userHasRole_(payload.requesterEmail, 'isProceduresAdmin')) return { ok: false, error: 'אין הרשאה' };
  var sheet = getSheet_('Procedures');
  var rowIndex = findRowByColumn_(sheet, 'Id', payload.id);
  if (rowIndex === -1) return { ok: false, error: 'הנוהל לא נמצא' };
  setRowValues_(sheet, rowIndex, {
    Title: payload.title || '', Content: payload.content || '', Category: payload.category || '',
    Order: payload.order || 0, UpdatedAt: new Date().toISOString(), UpdatedBy: payload.requesterEmail || '',
  });
  return { ok: true };
}

function procedures_delete_(payload) {
  if (!userHasRole_(payload.requesterEmail, 'isProceduresAdmin')) return { ok: false, error: 'אין הרשאה' };
  var sheet = getSheet_('Procedures');
  var rowIndex = findRowByColumn_(sheet, 'Id', payload.id);
  if (rowIndex === -1) return { ok: false, error: 'הנוהל לא נמצא' };
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

// ── ROUTER ────────────────────────────────────────────────────
var ROUTES = {
  users: {
    identify: users_identify_,
    updateProfile: users_updateProfile_,
  },
  computers: {
    getAssigned: computers_getAssigned_,
  },
  tickets: {
    create: tickets_create_,
    listMine: tickets_listMine_,
  },
  procedures: {
    list: procedures_list_,
    create: procedures_create_,
    update: procedures_update_,
    delete: procedures_delete_,
  },
};

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(entity, action, params) {
  ensureAllSheets_();
  var entityRoutes = ROUTES[entity];
  if (!entityRoutes || !entityRoutes[action]) {
    return { ok: false, error: 'Unknown entity/action: ' + entity + '/' + action };
  }
  try {
    return entityRoutes[action](params);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  return jsonResponse_(dispatch_(params.entity, params.action, params));
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON body' });
  }
  return jsonResponse_(dispatch_(body.entity, body.action, body));
}
