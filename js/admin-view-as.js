import { Portal, apiGet } from './api-client.js';
import { escapeHtml, showLoading } from './common-ui.js';
import { renderHubActions, renderHubGreeting } from './hub.js';
import { showView } from './nav.js';

// ── ADMIN: TRUE IMPERSONATION ("היכנס בתור המשתמש") ──────────
// Puts the admin inside the real hub UI exactly as the target employee sees it
// (Portal.getUser() becomes the impersonated user everywhere), wrapped in a red
// border so it's never mistaken for the admin's own session. Every apiGet/apiPost
// call automatically carries viewAsEmail (common.js), and the backend re-validates
// caller.isITAdmin from the real Easy Auth token on every honored endpoint — the
// client-side switch below is purely a UI convenience, not a trust boundary.
var viewAsUsersCache = [];

export async function loadViewAsPage() {
    document.getElementById('viewAsUserSelect').value = '';
    document.getElementById('viewAsEnterBtn').disabled = true;
    showLoading(true);
    var res = await apiGet('users', 'list', {});
    showLoading(false);
    viewAsUsersCache = res.ok ? res.data : [];
    var sel = document.getElementById('viewAsUserSelect');
    sel.innerHTML = '<option value="">בחר משתמש...</option>' +
        viewAsUsersCache.map(function (u) {
            var name = [u.firstName, u.lastName].filter(Boolean).join(' ');
            return '<option value="' + escapeHtml(u.email) + '">' + escapeHtml(name ? (name + ' — ' + u.email) : u.email) + '</option>';
        }).join('');
}

document.getElementById('viewAsUserSelect').addEventListener('change', function () {
    document.getElementById('viewAsEnterBtn').disabled = !this.value;
});

document.getElementById('viewAsEnterBtn').addEventListener('click', function () {
    var email = document.getElementById('viewAsUserSelect').value;
    var user = viewAsUsersCache.find(function (u) { return u.email === email; });
    if (!user) return;
    Portal.startViewAs(user);
    document.body.classList.add('viewing-as-active');
    var name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    document.getElementById('viewAsBannerText').textContent =
        'אתה מתחזה כרגע ל-' + (name || user.email) + ' — כל פעולה (כולל פתיחת קריאות) מבוצעת בשמו';
    showView('hub');
});

document.getElementById('viewAsExitBtn').addEventListener('click', function () {
    Portal.stopViewAs();
    document.body.classList.remove('viewing-as-active');
    renderHubGreeting();
    renderHubActions();
    showView('hub');
});
