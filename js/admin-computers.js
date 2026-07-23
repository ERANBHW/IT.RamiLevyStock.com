import { applySortState, computersCache, makeSortableTable, renderSortArrows, setComputersCache } from './admin-users.js';
import { apiGet, apiPost } from './api-client.js';
import { branchName, ensureBranchesLoaded, ensurePrintersLoaded, escapeHtml, makeDirtyTracker, populateBranchSelect, populatePrinterSelect, showLoading } from './common-ui.js';
import { buildTicketCard } from './tickets.js';

// ── ADMIN: COMPUTERS ──────────────────────────────────────
var editingComputerName = null;

export async function loadComputersAdminPage() {
    showLoading(true);
    await ensureBranchesLoaded();
    var res = await apiGet('computers', 'list', {});
    showLoading(false);
    setComputersCache(res.ok ? res.data : []);
    renderComputersTable(computersCache);
}

var computersSortState = { key: null, dir: 1 };

var computersSortValueFns = {
    computerName: function (c) { return c.computerName || ''; },
    type: function (c) { return c.type || ''; },
    branch: function (c) { return branchName(c.branchNumber); },
    printer: function (c) { return c.defaultPrinterName || ''; },
    user: function (c) { return c.assignedUserEmail || ''; },
};

makeSortableTable('#computersTable thead', computersSortState, computersSortValueFns, function () {
    renderComputersTable(computersCache);
});

// The ticket-history button expands the tickets inline, right
// below the computer's own row, instead of opening a second competing modal on top
// of the still-open history modal (which is what made clicking a ticket look broken).
async function toggleComputerHistoryRow(comp, cell) {
    var isOpen = cell.style.display !== 'none';
    if (isOpen) { cell.style.display = 'none'; return; }
    cell.style.display = 'table-cell';
    cell.innerHTML = '<p style="color:var(--muted);font-size:13px">טוען...</p>';
    var res = await apiGet('computers', 'ticketHistory', { computerName: comp.computerName });
    var tickets = res.ok ? res.data : [];
    if (!tickets.length) {
        cell.innerHTML = '<p style="color:var(--muted);font-size:13px">אין קריאות עבור מחשב זה.</p>';
        return;
    }
    var wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '10px';
    tickets.forEach(function (t) { wrap.appendChild(buildTicketCard(t)); });
    cell.innerHTML = '';
    cell.appendChild(wrap);
}

// Mirrors the users table exactly — grey hover, click-row-to-edit,
// delete lives inside the edit modal; the only remaining per-row button is the
// ticket-history toggle, which stops its click from also opening the edit modal.
function renderComputersTable(computers) {
    renderSortArrows('#computersTable thead', computersSortState);
    var body = document.getElementById('computersTableBody');
    body.innerHTML = '';
    applySortState(computers, computersSortState, computersSortValueFns).forEach(function (c) {
        var tr = document.createElement('tr');
        tr.classList.add('admin-row-clickable');
        var anyDeskCell = c.anyDeskId
            ? '<a class="anydesk-link" href="anydesk:' + encodeURIComponent(c.anyDeskId) + '" title="התחברות מרחוק דרך AnyDesk">🖥️ ' + escapeHtml(c.anyDeskId) + '</a>'
            : '-';
        tr.innerHTML =
            '<td dir="ltr">' + escapeHtml(c.computerName) + '</td>' +
            '<td>' + escapeHtml(c.type) + '</td>' +
            '<td>' + escapeHtml(branchName(c.branchNumber)) + '</td>' +
            '<td>' + escapeHtml(c.defaultPrinterName || '-') + '</td>' +
            '<td>' + anyDeskCell + '</td>' +
            '<td dir="ltr">' + escapeHtml(c.assignedUserEmail || '-') + '</td>' +
            '<td class="admin-row-actions"><button type="button" class="icon-button" data-history title="היסטוריית קריאות">🕘</button></td>';
        tr.addEventListener('click', function () { openComputerAdminModal(c); });

        var historyRow = document.createElement('tr');
        historyRow.addEventListener('click', function (e) { e.stopPropagation(); });
        var historyCell = document.createElement('td');
        historyCell.colSpan = 7;
        historyCell.style.display = 'none';
        historyCell.style.background = 'var(--background)';
        historyCell.style.padding = '12px';
        historyCell.style.whiteSpace = 'normal';
        historyRow.appendChild(historyCell);

        tr.querySelector('[data-history]').addEventListener('click', function (e) {
            e.stopPropagation();
            toggleComputerHistoryRow(c, historyCell);
        });

        body.appendChild(tr);
        body.appendChild(historyRow);
    });
}

var computerAdminTracker = makeDirtyTracker(document.getElementById('computerAdminModalBackdrop'));

function updateAnyDeskConnectLink() {
    var id = document.getElementById('caAnyDesk').value.trim();
    document.getElementById('caAnyDeskConnect').setAttribute('href', 'anydesk:' + encodeURIComponent(id));
}
document.getElementById('caAnyDesk').addEventListener('input', updateAnyDeskConnectLink);

// opts.onSaved lets other flows (e.g. the user-request wizard's procurement step)
// hijack what happens after a successful save instead of the default admin-table
// refresh — used to link the freshly-created computer back to its ProcurementTask.
var computerAdminModalOnSaved = null;

export async function openComputerAdminModal(comp, opts) {
    opts = opts || {};
    computerAdminModalOnSaved = opts.onSaved || null;
    editingComputerName = comp ? comp.computerName : null;
    document.getElementById('computerAdminModalTitle').textContent = comp ? 'עריכת מחשב' : 'מחשב חדש';
    document.getElementById('caComputerName').value = comp ? comp.computerName : '';
    document.getElementById('caComputerName').disabled = !!comp;
    var typeSelect = document.getElementById('caType');
    typeSelect.querySelectorAll('option[data-legacy]').forEach(function (opt) { opt.remove(); });
    if (comp && comp.type && comp.type !== 'נייח' && comp.type !== 'נייד') {
        var legacyOpt = document.createElement('option');
        legacyOpt.setAttribute('data-legacy', '1');
        legacyOpt.value = comp.type;
        legacyOpt.textContent = comp.type + ' (ערך קודם)';
        typeSelect.appendChild(legacyOpt);
    }
    typeSelect.value = comp ? comp.type : (opts.prefillType || 'נייח');
    document.getElementById('caRam').value = comp ? String(comp.ram || '').replace(/\D/g, '') : '';
    await ensurePrintersLoaded();
    populatePrinterSelect(document.getElementById('caPrinter'), comp ? comp.defaultPrinterName : '');
    document.getElementById('caAnyDesk').value = comp ? comp.anyDeskId : '';
    updateAnyDeskConnectLink();
    populateBranchSelect(document.getElementById('caBranch'), comp ? comp.branchNumber : (opts.prefillBranchNumber != null ? opts.prefillBranchNumber : ''));
    document.getElementById('caNotes').value = comp ? comp.notes : '';
    document.getElementById('computerAdminModalError').style.display = 'none';
    // The red delete button only makes sense once the computer
    // already exists — never offered while adding a new one.
    document.getElementById('computerAdminDeleteBtn').style.display = comp ? 'inline-block' : 'none';
    document.getElementById('computerAdminModalBackdrop').classList.add('visible');
    computerAdminTracker.reset();
}

function closeComputerAdminModal() { document.getElementById('computerAdminModalBackdrop').classList.remove('visible'); }

document.getElementById('computerAdminAddBtn').addEventListener('click', function () { openComputerAdminModal(null); });
document.getElementById('computerAdminCancelBtn').addEventListener('click', function () {
    if (computerAdminTracker.confirmDiscard()) closeComputerAdminModal();
});

document.getElementById('computerAdminSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('computerAdminModalError');
    var payload = {
        computerName: document.getElementById('caComputerName').value.trim(),
        type: document.getElementById('caType').value.trim(),
        ram: document.getElementById('caRam').value.trim() ? document.getElementById('caRam').value.trim() + 'GB' : '',
        defaultPrinterName: document.getElementById('caPrinter').value,
        anyDeskId: document.getElementById('caAnyDesk').value.trim(),
        branchNumber: document.getElementById('caBranch').value,
        notes: document.getElementById('caNotes').value.trim(),
    };
    if (!payload.computerName) { errEl.textContent = 'יש למלא שם מחשב'; errEl.style.display = 'block'; return; }
    var isDuplicate = !editingComputerName && computersCache.some(function (c) {
        return c.computerName.toLowerCase() === payload.computerName.toLowerCase();
    });
    if (isDuplicate) { errEl.textContent = 'מחשב עם שם זה כבר קיים'; errEl.style.display = 'block'; return; }

    showLoading(true);
    var res = await apiPost('computers', editingComputerName ? 'update' : 'create', payload);
    showLoading(false);
    if (res.ok) {
        computerAdminTracker.reset();
        var onSaved = computerAdminModalOnSaved;
        computerAdminModalOnSaved = null;
        closeComputerAdminModal();
        if (onSaved) await onSaved(payload.computerName);
        else loadComputersAdminPage();
    } else {
        errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block';
    }
});

async function deleteAdminComputer(comp) {
    if (!confirm('למחוק את המחשב ' + comp.computerName + '?')) return;
    showLoading(true);
    var res = await apiPost('computers', 'delete', { computerName: comp.computerName });
    showLoading(false);
    if (res.ok) { closeComputerAdminModal(); loadComputersAdminPage(); }
    else {
        var errEl = document.getElementById('computerAdminModalError');
        errEl.textContent = res.error || 'שגיאה במחיקה';
        errEl.style.display = 'block';
    }
}

document.getElementById('computerAdminDeleteBtn').addEventListener('click', function () {
    if (editingComputerName) deleteAdminComputer({ computerName: editingComputerName });
});
