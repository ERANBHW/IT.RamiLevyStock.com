import { apiGet, apiPost } from './api-client.js';
import { escapeHtml, makeDirtyTracker, showLoading } from './common-ui.js';

// ── ADMIN: SHARED FOLDERS ─────────────────────────────────
var sharedFoldersCache = [];
var editingSharedFolderId = null;
export async function loadSharedFoldersAdminPage() {
    showLoading(true);
    var res = await apiGet('sharedFolders', 'list', {});
    showLoading(false);
    sharedFoldersCache = res.ok ? res.data : [];
    renderSharedFoldersTable(sharedFoldersCache);
}

function renderSharedFoldersTable(list) {
    var body = document.getElementById('sharedFoldersTableBody');
    body.innerHTML = '';
    list.forEach(function (f) {
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + escapeHtml(f.name) + '</td>' +
            '<td dir="ltr">' + (f.entraGroupObjectId ? escapeHtml(f.entraGroupObjectId) : '<span style="color:var(--danger)">חסר</span>') + '</td>' +
            '<td class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></td>';
        tr.querySelector('[data-edit]').addEventListener('click', function () { openSharedFolderAdminModal(f); });
        tr.querySelector('[data-delete]').addEventListener('click', function () { deleteAdminSharedFolder(f); });
        body.appendChild(tr);
    });
}

var sharedFolderAdminTracker = makeDirtyTracker(document.getElementById('sharedFolderAdminModalBackdrop'));

function openSharedFolderAdminModal(f) {
    editingSharedFolderId = f ? f.id : null;
    document.getElementById('sharedFolderAdminModalTitle').textContent = f ? 'עריכת תיקייה' : 'תיקייה חדשה';
    document.getElementById('sfName').value = f ? f.name : '';
    document.getElementById('sfObjectId').value = f ? f.entraGroupObjectId : '';
    document.getElementById('sharedFolderAdminModalError').style.display = 'none';
    document.getElementById('sharedFolderAdminModalBackdrop').classList.add('visible');
    sharedFolderAdminTracker.reset();
}

function closeSharedFolderAdminModal() { document.getElementById('sharedFolderAdminModalBackdrop').classList.remove('visible'); }

document.getElementById('sharedFolderAdminAddBtn').addEventListener('click', function () { openSharedFolderAdminModal(null); });
document.getElementById('sharedFolderAdminCancelBtn').addEventListener('click', function () {
    if (sharedFolderAdminTracker.confirmDiscard()) closeSharedFolderAdminModal();
});

document.getElementById('sharedFolderAdminSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('sharedFolderAdminModalError');
    var payload = {
        name: document.getElementById('sfName').value.trim(),
        entraGroupObjectId: document.getElementById('sfObjectId').value.trim(),
    };
    if (!payload.name) { errEl.textContent = 'יש למלא שם תיקייה'; errEl.style.display = 'block'; return; }
    if (editingSharedFolderId) payload.id = editingSharedFolderId;

    showLoading(true);
    var res = await apiPost('sharedFolders', editingSharedFolderId ? 'update' : 'create', payload);
    showLoading(false);
    if (res.ok) { sharedFolderAdminTracker.reset(); closeSharedFolderAdminModal(); loadSharedFoldersAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteAdminSharedFolder(f) {
    if (!confirm('למחוק את התיקייה "' + f.name + '"?')) return;
    showLoading(true);
    var res = await apiPost('sharedFolders', 'delete', { id: f.id });
    showLoading(false);
    if (res.ok) loadSharedFoldersAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}
