import { APP_VERSION, LOGO_URL, apiGet } from './api-client.js';

// ── SHARED UI ─────────────────────────────────────────────────
export function renderHeader(containerEl, opts) {
  opts = opts || {};
  var actionsHtml = '';
  if (opts.showBack) actionsHtml += '<button type="button" class="back-button" data-nav-back>← חזור</button>';

  containerEl.innerHTML =
    '<header class="topbar">' +
      '<img class="logo" src="' + LOGO_URL + '" alt="רמי לוי סטוק">' +
      '<div class="topbar-actions">' +
        '<span class="version-badge">v' + APP_VERSION + '</span>' +
        actionsHtml +
      '</div>' +
    '</header>';

  var backBtn = containerEl.querySelector('[data-nav-back]');
  if (backBtn) {
    backBtn.addEventListener('click', opts.onBack || function () {
      window.location.href = opts.backHref || 'index.html';
    });
  }
}

export function showLoading(visible) {
  var el = document.getElementById('loadingOverlay');
  if (el) el.classList.toggle('visible', !!visible);
}

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Every edit modal in the app follows the same rule: a backdrop click
// never closes it — only the explicit "ביטול" button does, and if the user changed
// anything since the modal opened, that button asks for confirmation first.
export function makeDirtyTracker(modalEl) {
  var dirty = false;
  modalEl.addEventListener('input', function () { dirty = true; });
  modalEl.addEventListener('change', function () { dirty = true; });
  return {
    reset: function () { dirty = false; },
    isDirty: function () { return dirty; },
    confirmDiscard: function () {
      return !dirty || confirm('יש נתונים שלא נשמרו - לצאת בכל זאת?');
    },
  };
}

// XXX-XXX-XXXX as the user types, digits only, no library.
export function maskPhoneInput(el) {
  el.addEventListener('input', function () {
    var digits = el.value.replace(/\D/g, '').slice(0, 10);
    var parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 3));
    if (digits.length > 3) parts.push(digits.slice(3, 6));
    if (digits.length > 6) parts.push(digits.slice(6, 10));
    el.value = parts.join('-');
  });
}

// Strips disallowed characters live as the user types, keeping the caret position stable.
// Used for name fields: Hebrew-only inputs reject anything outside
// א-ת (no digits, no Latin), English-only inputs reject anything outside A-Za-z.
function restrictInputChars(el, disallowedPattern, transform) {
  el.addEventListener('input', function () {
    var pos = el.selectionStart;
    var before = el.value;
    var next = el.value.replace(disallowedPattern, '');
    if (transform) next = transform(next);
    el.value = next;
    var removedBeforeCaret = before.slice(0, pos).replace(disallowedPattern, '').length;
    el.setSelectionRange(removedBeforeCaret, removedBeforeCaret);
  });
}

export function restrictToHebrewLetters(el) { restrictInputChars(el, /[^א-ת]/g); }
// English names are always forced lowercase as the user types — matches
// the server's own suggested-email formula (computeSuggestedEmail), which lowercases anyway.
// Lowercasing never changes string length, so the caret position math above stays correct.
export function restrictToEnglishLetters(el) { restrictInputChars(el, /[^A-Za-z]/g, function (v) { return v.toLowerCase(); }); }

// Copies text and gives brief inline feedback on the triggering button (used by the
// script/welcome-message copy boxes). Falls back silently if the Clipboard API is blocked.
export function copyToClipboard(text, buttonEl) {
  var restore = buttonEl ? buttonEl.textContent : null;
  navigator.clipboard.writeText(text || '').then(function () {
    if (buttonEl) {
      buttonEl.textContent = 'הועתק!';
      setTimeout(function () { buttonEl.textContent = restore; }, 1500);
    }
  }).catch(function () {
    if (buttonEl) {
      buttonEl.textContent = 'העתקה נכשלה';
      setTimeout(function () { buttonEl.textContent = restore; }, 1500);
    }
  });
}

export function formatDateTime(dateStr) {
  try {
    var d = new Date(dateStr);
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var hours = String(d.getHours()).padStart(2, '0');
    var mins = String(d.getMinutes()).padStart(2, '0');
    return day + '/' + month + '/' + d.getFullYear() + ' ' + hours + ':' + mins;
  } catch (e) {
    return dateStr;
  }
}

// ── BRANCHES: shared cache used by profile/ticket/admin screens ───
export var branchesCache = null;

export async function ensureBranchesLoaded() {
    if (branchesCache) return branchesCache;
    var res = await apiGet('branches', 'list', {});
    branchesCache = res.ok ? res.data : [];
    return branchesCache;
}

export function branchName(branchNumber) {
    if (branchNumber === null || branchNumber === undefined || branchNumber === '') return '';
    var b = (branchesCache || []).find(function (x) { return x.number === Number(branchNumber); });
    return b ? b.name : '';
}

export function populateBranchSelect(selectEl, selectedNumber) {
    var options = (branchesCache || []).map(function (b) {
        return '<option value="' + b.number + '"' + (String(selectedNumber) === String(b.number) ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>';
    }).join('');
    selectEl.innerHTML = '<option value="">בחר סניף</option>' + options;
}

// ── SHARED FOLDERS: shared cache used by the user-request form + admin screens ───
var allSharedFoldersCache = null;

export async function ensureSharedFoldersLoaded() {
    if (allSharedFoldersCache) return allSharedFoldersCache;
    var res = await apiGet('sharedFolders', 'list', {});
    allSharedFoldersCache = res.ok ? res.data : [];
    return allSharedFoldersCache;
}

export function renderFolderCheckboxes(containerEl, selectedIds) {
    selectedIds = selectedIds || [];
    containerEl.innerHTML = (allSharedFoldersCache || []).map(function (f) {
        var checked = selectedIds.indexOf(f.id) !== -1 ? ' checked' : '';
        return '<label><input type="checkbox" value="' + f.id + '"' + checked + '>' + escapeHtml(f.name) + '</label>';
    }).join('') || '<p style="color:var(--muted);font-size:13px;margin:0">אין תיקיות מוגדרות עדיין.</p>';
}

export function getSelectedFolderIds(containerEl) {
    return Array.from(containerEl.querySelectorAll('input[type="checkbox"]:checked')).map(function (el) { return el.value; });
}

// ── PRINTERS: shared cache used by the computer-admin modal + ticket form ───
export var printersCache = null;

export async function ensurePrintersLoaded() {
    if (printersCache) return printersCache;
    var res = await apiGet('printers', 'list', {});
    printersCache = res.ok ? res.data : [];
    return printersCache;
}

export function populatePrinterSelect(selectEl, selectedName, filterBranchNumber) {
    var list = printersCache || [];
    if (filterBranchNumber !== undefined && filterBranchNumber !== null && filterBranchNumber !== '') {
        list = list.filter(function (p) { return String(p.branchNumber) === String(filterBranchNumber); });
    }
    var options = list.map(function (p) {
        return '<option value="' + escapeHtml(p.printerName) + '"' + (p.printerName === selectedName ? ' selected' : '') + '>' + escapeHtml(p.printerName) + '</option>';
    }).join('');
    selectEl.innerHTML = '<option value="">ללא</option>' + options;
}

// ── BRANCH-SCOPED COMPUTER PICKER: shared by the user-request form, the admin review
// wizard and the unified users-admin modal (all three need "pick an existing workstation
// in this branch, or order a new one"). ─────────────────────────────────────────────
export var ORDER_NEW_COMPUTER_VALUE = '__order_new__';

export async function loadComputersByBranch(branchNumber) {
    if (branchNumber === '' || branchNumber === null || branchNumber === undefined) return [];
    var res = await apiGet('computers', 'listByBranch', { branchNumber: branchNumber });
    return res.ok ? res.data : [];
}

export function populateBranchComputerSelect(selectEl, list, selectedName) {
    var options = (list || []).map(function (c) {
        var label = c.computerName + (c.assignedToName ? ' (משוייך ל-' + c.assignedToName + ')' : '');
        return '<option value="' + escapeHtml(c.computerName) + '"' + (c.computerName === selectedName ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');
    var orderSelected = !selectedName ? '' : (selectedName === ORDER_NEW_COMPUTER_VALUE ? ' selected' : '');
    selectEl.innerHTML = '<option value="">בחר עמדה</option>' + options +
        '<option value="' + ORDER_NEW_COMPUTER_VALUE + '"' + orderSelected + '>🖥️ הזמנת מחשב חדש</option>';
}

// ── TOGGLE BUTTON GROUPS: replaces radio pairs — real buttons, no default selection,
// wired via [data-toggle-group] instead of a shared `name`.
// Shared by the user-request form, its review wizard, and the users-admin modal.
function toggleGroupEl(groupId) { return document.querySelector('[data-toggle-group="' + groupId + '"]'); }

export function getToggleValue(groupId) {
    var active = toggleGroupEl(groupId).querySelector('.choice-btn.selected');
    return active ? active.getAttribute('data-value') : null;
}

export function setToggleValue(groupId, value) {
    toggleGroupEl(groupId).querySelectorAll('.choice-btn').forEach(function (btn) {
        btn.classList.toggle('selected', value != null && btn.getAttribute('data-value') === value);
    });
}

// Wired once at page load (the group element itself never gets re-created); onChange
// fires only on a real click, not when setToggleValue() sets a value programmatically.
export function initToggleGroup(groupId, onChange) {
    toggleGroupEl(groupId).querySelectorAll('.choice-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            setToggleValue(groupId, btn.getAttribute('data-value'));
            if (onChange) onChange(btn.getAttribute('data-value'));
        });
    });
}

// ── COLLAPSIBLE SHARED-FOLDERS PICKER: collapsed by default,
// showing a one-line summary of what's already checked; clicking the header opens it
// up to change the selection. Shared by the same three forms as the toggle groups above.
function folderCollapseSummary(listEl) {
    var names = Array.from(listEl.querySelectorAll('label')).filter(function (l) {
        return l.querySelector('input').checked;
    }).map(function (l) { return l.textContent.trim(); });
    return names.length ? names.join(', ') : 'לא נבחרו תיקיות';
}

export function refreshFolderCollapseSummary(prefix) {
    var summaryEl = document.getElementById(prefix + 'FoldersSummary');
    if (summaryEl) summaryEl.textContent = folderCollapseSummary(document.getElementById(prefix + 'Folders'));
}

export function collapseFolderPicker(prefix) {
    document.getElementById(prefix + 'Folders').classList.remove('expanded');
    document.getElementById(prefix + 'FoldersHeader').classList.remove('expanded');
}

export function initFolderCollapse(prefix) {
    var header = document.getElementById(prefix + 'FoldersHeader');
    var list = document.getElementById(prefix + 'Folders');
    header.addEventListener('click', function () {
        list.classList.toggle('expanded');
        header.classList.toggle('expanded');
    });
    list.addEventListener('change', function (e) {
        if (e.target.type === 'checkbox') refreshFolderCollapseSummary(prefix);
    });
}


export function resetBranchesCache() { branchesCache = null; }
export function resetPrintersCache() { printersCache = null; }
