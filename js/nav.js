import { loadBranchesAdminPage } from './admin-branches.js';
import { loadComputersAdminPage } from './admin-computers.js';
import { loadEmailSettingsAdminPage } from './admin-email-settings.js';
import { loadPrintersAdminPage } from './admin-printers.js';
import { loadSharedFoldersAdminPage } from './admin-shared-folders.js';
import { loadTicketConfigAdminPage } from './admin-ticket-config.js';
import { loadUsersAdminPage } from './admin-users.js';
import { loadViewAsPage } from './admin-view-as.js';
import { renderHeader } from './common-ui.js';
import { loadHubDashboard, renderHubActions, renderHubGreeting, startDashboardAutoRefresh, stopDashboardAutoRefresh } from './hub.js';
import { loadProcedureConfigAdminPage, loadProceduresPage, procedureEditorTracker } from './procedures.js';
import { loadTicketPage, refreshMyTickets } from './tickets.js';
import { loadUserRequestFormPage } from './user-requests.js';

// ── VIEW NAVIGATION ───────────────────────────────────────
export function showView(id) {
    document.querySelectorAll('.app').forEach(function (el) { el.classList.remove('active'); });
    var target = document.getElementById('view-' + id);
    if (target) target.classList.add('active');

    renderHeader(document.getElementById('headerContainer'), {
        showBack: id !== 'hub' && id !== 'notfound',
        onBack: function () {
            // The editor is reached from "עריכת נהלי עבודה", not the
            // hub — back should return there (and still ask before discarding changes).
            if (id === 'procedure-editor') {
                if (procedureEditorTracker.confirmDiscard()) showView('admin-procedure-config');
                return;
            }
            showView('hub');
        },
    });

    if (id === 'ticket') loadTicketPage();
    if (id === 'procedures') loadProceduresPage();
    if (id === 'admin-users') loadUsersAdminPage();
    if (id === 'admin-computers') loadComputersAdminPage();
    if (id === 'admin-branches') loadBranchesAdminPage();
    if (id === 'admin-sharedfolders') loadSharedFoldersAdminPage();
    if (id === 'admin-email-settings') loadEmailSettingsAdminPage();
    if (id === 'user-request') loadUserRequestFormPage();
    if (id === 'admin-printers') loadPrintersAdminPage();
    if (id === 'admin-ticket-config') loadTicketConfigAdminPage();
    if (id === 'admin-procedure-config') loadProcedureConfigAdminPage();
    if (id === 'admin-view-as') loadViewAsPage();

    if (id === 'hub') {
        renderHubGreeting();
        renderHubActions();
        refreshMyTickets();
        loadHubDashboard();
        startDashboardAutoRefresh();
    } else {
        stopDashboardAutoRefresh();
    }
}
