import { Portal } from './api-client.js';
import { ensureBranchesLoaded, showLoading } from './common-ui.js';
import { renderHubActions, renderHubGreeting } from './hub.js';
import { showView } from './nav.js';
import { ensureTicketConfigLoaded } from './tickets.js';

function showLoginError(message) {
    var box = document.querySelector('#loadingOverlay .loading-box');
    if (!box) return;
    box.innerHTML =
        '<p style="margin:0 0 12px;font-size:14px;color:var(--danger,#c00)">' + message + '</p>' +
        '<button type="button" class="primary-button" id="loginRetryBtn">נסה שוב</button>';
    document.getElementById('loginRetryBtn').addEventListener('click', function () {
        window.location.reload();
    });
}

// ── INIT ──────────────────────────────────────────────────
(async function init() {
    showLoading(true);
    try {
        await Portal.loadIdentity();
    } catch (e) {
        showLoginError(e.message || 'ההתחברות נכשלה.');
        return;
    }
    showLoading(false);

    if (!Portal.getUser()) {
        showView('notfound');
        return;
    }
    showLoading(true);
    await ensureBranchesLoaded();
    await ensureTicketConfigLoaded();
    showLoading(false);
    renderHubGreeting();
    renderHubActions();
    showView('hub');
})();
