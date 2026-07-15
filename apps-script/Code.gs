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

// ── ROUTER ────────────────────────────────────────────────────
var ROUTES = {
  users: {
    identify: users_identify_,
    updateProfile: users_updateProfile_,
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
