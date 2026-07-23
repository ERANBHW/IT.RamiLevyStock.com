import { apiPost } from './api-client.js';
import { branchesCache, ensureBranchesLoaded, escapeHtml, makeDirtyTracker, resetBranchesCache, showLoading } from './common-ui.js';

// ── ADMIN: BRANCHES ───────────────────────────────────────
var editingBranchNumber = null;

export async function loadBranchesAdminPage() {
    showLoading(true);
    resetBranchesCache(); // admin screen is the source of truth for this list — force a refetch
    await ensureBranchesLoaded();
    showLoading(false);
    renderBranchesTable(branchesCache);
}

function renderBranchesTable(list) {
    var body = document.getElementById('branchesTableBody');
    body.innerHTML = '';
    list.forEach(function (b) {
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td dir="ltr">' + escapeHtml(b.number) + '</td>' +
            '<td>' + escapeHtml(b.name) + '</td>' +
            '<td class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></td>';
        tr.querySelector('[data-edit]').addEventListener('click', function () { openBranchAdminModal(b); });
        tr.querySelector('[data-delete]').addEventListener('click', function () { deleteAdminBranch(b); });
        body.appendChild(tr);
    });
}

var branchAdminTracker = makeDirtyTracker(document.getElementById('branchAdminModalBackdrop'));

function openBranchAdminModal(b) {
    editingBranchNumber = b ? b.number : null;
    document.getElementById('branchAdminModalTitle').textContent = b ? 'עריכת סניף' : 'סניף חדש';
    document.getElementById('baNumber').value = b ? b.number : '';
    document.getElementById('baNumber').disabled = !!b;
    document.getElementById('baName').value = b ? b.name : '';
    document.getElementById('branchAdminModalError').style.display = 'none';
    document.getElementById('branchAdminModalBackdrop').classList.add('visible');
    branchAdminTracker.reset();
}

function closeBranchAdminModal() { document.getElementById('branchAdminModalBackdrop').classList.remove('visible'); }

document.getElementById('branchAdminAddBtn').addEventListener('click', function () { openBranchAdminModal(null); });
document.getElementById('branchAdminCancelBtn').addEventListener('click', function () {
    if (branchAdminTracker.confirmDiscard()) closeBranchAdminModal();
});

document.getElementById('branchAdminSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('branchAdminModalError');
    var payload = {
        number: document.getElementById('baNumber').value,
        name: document.getElementById('baName').value.trim(),
    };
    if (payload.number === '' || !payload.name) { errEl.textContent = 'יש למלא מספר ושם סניף'; errEl.style.display = 'block'; return; }

    showLoading(true);
    var res = await apiPost('branches', editingBranchNumber !== null ? 'update' : 'create', payload);
    showLoading(false);
    if (res.ok) { branchAdminTracker.reset(); closeBranchAdminModal(); loadBranchesAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteAdminBranch(b) {
    if (!confirm('למחוק את הסניף "' + b.name + '"?')) return;
    showLoading(true);
    var res = await apiPost('branches', 'delete', { number: b.number });
    showLoading(false);
    if (res.ok) loadBranchesAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}
