/**
 * IT Portal backend — Web App bound to the "IT Portal DB" Google Sheet.
 * Deployed with clasp; the deployed /exec URL is called from index.html.
 *
 * Sheet "Data" columns: id | name | value | updatedAt
 */

var SHEET_NAME = 'Data';
var HEADERS = ['id', 'name', 'value', 'updatedAt'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function rowsToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[i][c];
    }
    rows.push(obj);
  }
  return rows;
}

function findRowIndexById_(sheet, id) {
  var ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 1-indexed + header row
  }
  return -1;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET /exec              -> list all rows
 * GET /exec?id=<id>      -> single row
 */
function doGet(e) {
  var sheet = getSheet_();
  var params = (e && e.parameter) || {};

  if (params.id) {
    var rows = rowsToObjects_(sheet);
    var match = rows.filter(function (r) { return String(r.id) === String(params.id); })[0];
    return jsonResponse_({ ok: true, data: match || null });
  }

  return jsonResponse_({ ok: true, data: rowsToObjects_(sheet) });
}

/**
 * POST /exec with JSON body (sent as text/plain to avoid CORS preflight):
 *   { "action": "create", "name": "...", "value": "..." }
 *   { "action": "update", "id": "...", "name": "...", "value": "..." }
 *   { "action": "delete", "id": "..." }
 */
function doPost(e) {
  var sheet = getSheet_();
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON body' });
  }

  var action = body.action;
  var now = new Date().toISOString();

  if (action === 'create') {
    var id = Utilities.getUuid();
    sheet.appendRow([id, body.name || '', body.value || '', now]);
    return jsonResponse_({ ok: true, data: { id: id, name: body.name, value: body.value, updatedAt: now } });
  }

  if (action === 'update') {
    var rowIndex = findRowIndexById_(sheet, body.id);
    if (rowIndex === -1) return jsonResponse_({ ok: false, error: 'Not found' });
    sheet.getRange(rowIndex, 2, 1, 3).setValues([[body.name || '', body.value || '', now]]);
    return jsonResponse_({ ok: true, data: { id: body.id, name: body.name, value: body.value, updatedAt: now } });
  }

  if (action === 'delete') {
    var delIndex = findRowIndexById_(sheet, body.id);
    if (delIndex === -1) return jsonResponse_({ ok: false, error: 'Not found' });
    sheet.deleteRow(delIndex);
    return jsonResponse_({ ok: true });
  }

  return jsonResponse_({ ok: false, error: 'Unknown action: ' + action });
}
