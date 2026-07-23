import { apiGet, apiPost } from './api-client.js';
import { showLoading } from './common-ui.js';

// ── ADMIN: EMAIL SETTINGS ──────────────
export async function loadEmailSettingsAdminPage() {
    document.getElementById('emailSettingsError').style.display = 'none';
    document.getElementById('emailSettingsSuccess').style.display = 'none';
    showLoading(true);
    var res = await apiGet('emailSettings', 'get', {});
    showLoading(false);
    var data = res.ok ? res.data : { itCompanyEmail: '', printerCompanyEmail: '', adminEmail: '' };
    document.getElementById('esItCompanyEmail').value = data.itCompanyEmail || '';
    document.getElementById('esPrinterCompanyEmail').value = data.printerCompanyEmail || '';
    document.getElementById('esAdminEmail').value = data.adminEmail || '';
}

document.getElementById('emailSettingsSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('emailSettingsError');
    var successEl = document.getElementById('emailSettingsSuccess');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    var payload = {
        itCompanyEmail: document.getElementById('esItCompanyEmail').value.trim(),
        printerCompanyEmail: document.getElementById('esPrinterCompanyEmail').value.trim(),
        adminEmail: document.getElementById('esAdminEmail').value.trim(),
    };
    showLoading(true);
    var res = await apiPost('emailSettings', 'update', payload);
    showLoading(false);
    if (res.ok) successEl.style.display = 'block';
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});
