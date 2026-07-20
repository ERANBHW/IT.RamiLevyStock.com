// Shared infrastructure for every page of the IT Portal SPA.
// Keep this file dependency-free beyond msal-browser (plain script tags, no build step).

var APP_VERSION = '2.0.0'; // keep in sync with /VERSION - bumped every shipped change
var LOGO_URL = 'https://rami-levy-stock.co.il/sing.png';

// ── AZURE / ENTRA CONFIG ───────────────────────────────────────
// Filled in once infra/provision.sh (steps "resources" + "appregs") has run — copy the
// values from infra/.provision-state. Nothing here is a secret; the SPA is a public
// client (PKCE, no client secret) by design.
var MSAL_TENANT_ID = '<TENANT_ID>';
var MSAL_SPA_CLIENT_ID = '<SPA_APP_ID>';
var MSAL_API_CLIENT_ID = '<API_APP_ID>';
var API_BASE_URL = 'https://<FUNCTION_APP_NAME>.azurewebsites.net/api/dispatch';
var API_SCOPE = 'api://' + MSAL_API_CLIENT_ID + '/access_as_user';

var msalInstance = new msal.PublicClientApplication({
  auth: {
    clientId: MSAL_SPA_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/' + MSAL_TENANT_ID,
    redirectUri: window.location.origin + '/index.html',
  },
  cache: { cacheLocation: 'sessionStorage' },
});

// ── IDENTITY ────────────────────────────────────────────────
// Identity comes from a real Entra ID token (MSAL + Easy Auth on the API side), not
// from a URL parameter the client controls. ssoSilent() picks up the Windows/Edge
// session automatically for devices already signed in (Intune-managed machines) —
// interactive login is only a fallback for the rare case that fails.
var Portal = (function () {
  var currentUser = null; // resolved Users row, or null if not found / not yet provisioned
  var account = null;

  async function acquireToken() {
    if (!account) throw new Error('לא מחובר');
    try {
      var result = await msalInstance.acquireTokenSilent({ scopes: [API_SCOPE], account: account });
      return result.accessToken;
    } catch (e) {
      // Silent renewal failed (e.g. token expired and no refresh available) — fall back
      // to an interactive redirect. This navigates away; nothing meaningful returns here.
      await msalInstance.acquireTokenRedirect({ scopes: [API_SCOPE], account: account });
      return null;
    }
  }

  async function loadIdentity() {
    await msalInstance.initialize();

    var redirectResult = await msalInstance.handleRedirectPromise();
    if (redirectResult && redirectResult.account) account = redirectResult.account;

    if (!account) {
      var accounts = msalInstance.getAllAccounts();
      if (accounts.length) account = accounts[0];
    }

    if (!account) {
      try {
        var ssoResult = await msalInstance.ssoSilent({ scopes: [API_SCOPE] });
        account = ssoResult.account;
      } catch (e) {
        await msalInstance.loginRedirect({ scopes: [API_SCOPE] });
        return null; // navigates away
      }
    }

    try {
      var res = await apiGet('users', 'identify', {});
      currentUser = (res && res.ok) ? res.data : null;
    } catch (e) {
      currentUser = null;
    }
    return currentUser;
  }

  function getUser() { return currentUser; }
  function setUser(u) { currentUser = u; }

  function isSuperAdmin() { return !!(currentUser && currentUser.isSuperAdmin); }
  function isITAdmin() { return !!(currentUser && (currentUser.isITAdmin || currentUser.isSuperAdmin)); }
  function isProceduresAdmin() { return !!(currentUser && (currentUser.isProceduresAdmin || currentUser.isSuperAdmin)); }

  return {
    loadIdentity: loadIdentity,
    getUser: getUser,
    setUser: setUser,
    isSuperAdmin: isSuperAdmin,
    isITAdmin: isITAdmin,
    isProceduresAdmin: isProceduresAdmin,
    acquireToken: acquireToken,
  };
})();

// ── API HELPERS ───────────────────────────────────────────────
// GET:  ?entity=<entity>&action=<action>&...params
// POST: JSON body { entity, action, ...payload }
// Every call carries a real Bearer token — the server never trusts an email/id the
// client sends in params/payload for identity purposes.
async function apiGet(entity, action, params) {
  var token = await Portal.acquireToken();
  var url = new URL(API_BASE_URL);
  url.searchParams.set('entity', entity);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  var res = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + token } });
  return res.json();
}

async function apiPost(entity, action, payload) {
  var token = await Portal.acquireToken();
  var body = Object.assign({ entity: entity, action: action }, payload || {});
  var res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── SHARED UI ─────────────────────────────────────────────────
function renderHeader(containerEl, opts) {
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

function showLoading(visible) {
  var el = document.getElementById('loadingOverlay');
  if (el) el.classList.toggle('visible', !!visible);
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatDateTime(dateStr) {
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
