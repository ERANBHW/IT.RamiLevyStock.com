import { Portal } from './api-client.js';
import { ensureBranchesLoaded, showLoading } from './common-ui.js';
import { renderHubActions, renderHubGreeting } from './hub.js';
import { showView } from './nav.js';
import { ensureTicketConfigLoaded } from './tickets.js';

// ── INIT ──────────────────────────────────────────────────
(async function init() {
    showLoading(true);
    await Portal.loadIdentity();
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
