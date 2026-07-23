import { apiPost } from './api-client.js';
import { branchName, ensureBranchesLoaded, ensurePrintersLoaded, escapeHtml, makeDirtyTracker, populateBranchSelect, printersCache, resetPrintersCache, showLoading } from './common-ui.js';

// ── ADMIN: PRINTERS ───────────────────────
var editingPrinterName = null;

export async function loadPrintersAdminPage() {
    showLoading(true);
    await ensureBranchesLoaded();
    resetPrintersCache(); // admin screen is the source of truth for this list — force a refetch
    await ensurePrintersLoaded();
    showLoading(false);
    renderPrintersTable(printersCache);
}

function renderPrintersTable(list) {
    var body = document.getElementById('printersTableBody');
    body.innerHTML = '';
    list.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td dir="ltr">' + escapeHtml(p.printerName) + '</td>' +
            '<td dir="ltr">' + escapeHtml(p.ip) + '</td>' +
            '<td>' + escapeHtml(branchName(p.branchNumber)) + '</td>' +
            '<td>' + escapeHtml(p.notes) + '</td>' +
            '<td class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></td>';
        tr.querySelector('[data-edit]').addEventListener('click', function () { openPrinterAdminModal(p); });
        tr.querySelector('[data-delete]').addEventListener('click', function () { deleteAdminPrinter(p); });
        body.appendChild(tr);
    });
}

var printerAdminTracker = makeDirtyTracker(document.getElementById('printerAdminModalBackdrop'));

export function openPrinterAdminModal(p) {
    editingPrinterName = p ? p.printerName : null;
    document.getElementById('printerAdminModalTitle').textContent = p ? 'עריכת מדפסת' : 'מדפסת חדשה';
    document.getElementById('paPrinterName').value = p ? p.printerName : '';
    document.getElementById('paPrinterName').disabled = !!p;
    document.getElementById('paIp').value = p ? p.ip : '';
    populateBranchSelect(document.getElementById('paBranch'), p ? p.branchNumber : '');
    document.getElementById('paNotes').value = p ? p.notes : '';
    document.getElementById('printerAdminModalError').style.display = 'none';
    document.getElementById('printerAdminModalBackdrop').classList.add('visible');
    printerAdminTracker.reset();
}

function closePrinterAdminModal() { document.getElementById('printerAdminModalBackdrop').classList.remove('visible'); }

document.getElementById('printerAdminAddBtn').addEventListener('click', function () { openPrinterAdminModal(null); });
document.getElementById('printerAdminCancelBtn').addEventListener('click', function () {
    if (printerAdminTracker.confirmDiscard()) closePrinterAdminModal();
});

document.getElementById('printerAdminSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('printerAdminModalError');
    var payload = {
        printerName: document.getElementById('paPrinterName').value.trim(),
        ip: document.getElementById('paIp').value.trim(),
        branchNumber: document.getElementById('paBranch').value,
        notes: document.getElementById('paNotes').value.trim(),
    };
    if (!payload.printerName) { errEl.textContent = 'יש למלא שם מדפסת'; errEl.style.display = 'block'; return; }

    showLoading(true);
    var res = await apiPost('printers', editingPrinterName ? 'update' : 'create', payload);
    showLoading(false);
    if (res.ok) { printerAdminTracker.reset(); closePrinterAdminModal(); loadPrintersAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteAdminPrinter(p) {
    if (!confirm('למחוק את המדפסת "' + p.printerName + '"?')) return;
    showLoading(true);
    var res = await apiPost('printers', 'delete', { printerName: p.printerName });
    showLoading(false);
    if (res.ok) loadPrintersAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}
