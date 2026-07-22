// Shared infrastructure for every page of the IT Portal SPA.
// Keep this file dependency-free beyond msal-browser (plain script tags, no build step).

var APP_VERSION = '2.0.0'; // keep in sync with /VERSION - bumped every shipped change
var LOGO_URL = 'https://rami-levy-stock.co.il/sing.png';

// ── AZURE / ENTRA CONFIG ───────────────────────────────────────
// Filled in once infra/provision.sh (steps "resources" + "appregs") has run — copy the
// values from infra/.provision-state. Nothing here is a secret; the SPA is a public
// client (PKCE, no client secret) by design.
var MSAL_TENANT_ID = '9831f885-99f6-47db-9d56-c5a7136ccfe7';
var MSAL_SPA_CLIENT_ID = 'b9997216-1b46-41b5-b003-9ad947c3cc84';
var MSAL_API_CLIENT_ID = 'a211569e-5213-4ae4-8883-f03186890e58';
var API_BASE_URL = 'https://it-portal-api-490fb4.azurewebsites.net/api/dispatch';
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
  var viewAsUser = null; // IT Admin "view as" impersonation target (in-memory only, never persisted)

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

  // While impersonating, getUser() (and every permission check built on it) reflects
  // the IMPERSONATED employee — that's the whole point of "view as": every existing
  // render function that already calls Portal.getUser()/isITAdmin() etc. automatically
  // shows exactly what that employee would see, with no per-page changes needed.
  function getUser() { return viewAsUser || currentUser; }
  function setUser(u) { currentUser = u; }

  function isSuperAdmin() { var u = getUser(); return !!(u && u.isSuperAdmin); }
  function isITAdmin() { var u = getUser(); return !!(u && (u.isITAdmin || u.isSuperAdmin)); }
  function isProceduresAdmin() { var u = getUser(); return !!(u && (u.isProceduresAdmin || u.isSuperAdmin)); }
  function isUserRequestSubmitter() {
    var u = getUser();
    return !!(u && (u.isUserRequestSubmitter || u.isITAdmin || u.isSuperAdmin));
  }

  function isViewingAs() { return !!viewAsUser; }
  function startViewAs(user) { viewAsUser = user; }
  function stopViewAs() { viewAsUser = null; }
  function getViewAsEmail() { return viewAsUser ? viewAsUser.email : null; }
  function getRealUser() { return currentUser; } // the actual logged-in admin, regardless of impersonation

  return {
    loadIdentity: loadIdentity,
    getUser: getUser,
    setUser: setUser,
    isSuperAdmin: isSuperAdmin,
    isITAdmin: isITAdmin,
    isProceduresAdmin: isProceduresAdmin,
    isUserRequestSubmitter: isUserRequestSubmitter,
    acquireToken: acquireToken,
    isViewingAs: isViewingAs,
    startViewAs: startViewAs,
    stopViewAs: stopViewAs,
    getViewAsEmail: getViewAsEmail,
    getRealUser: getRealUser,
  };
})();

// ── API HELPERS ───────────────────────────────────────────────
// GET:  ?entity=<entity>&action=<action>&...params
// POST: JSON body { entity, action, ...payload }
// Every call carries a real Bearer token — the server never trusts an email/id the
// client sends in params/payload for identity purposes.
// While "view as" is active, every call automatically carries viewAsEmail — harmless
// for endpoints that don't look at it, and honored (IT Admin only, re-checked server-
// side from the real Easy Auth token every time) by the handful that do: it's what lets
// listMine/getAssigned/create show and act as the impersonated employee everywhere,
// without every call site needing to remember to pass it.
async function apiGet(entity, action, params) {
  var token = await Portal.acquireToken();
  var url = new URL(API_BASE_URL);
  url.searchParams.set('entity', entity);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  if (Portal.isViewingAs() && !url.searchParams.has('viewAsEmail')) {
    url.searchParams.set('viewAsEmail', Portal.getViewAsEmail());
  }
  var res = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + token } });
  return res.json();
}

async function apiPost(entity, action, payload) {
  var token = await Portal.acquireToken();
  var body = Object.assign({ entity: entity, action: action }, payload || {});
  if (Portal.isViewingAs() && body.viewAsEmail === undefined) body.viewAsEmail = Portal.getViewAsEmail();
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

// Every edit modal in the app follows the same rule (v2.1, section 6): a backdrop click
// never closes it — only the explicit "ביטול" button does, and if the user changed
// anything since the modal opened, that button asks for confirmation first.
function makeDirtyTracker(modalEl) {
  var dirty = false;
  modalEl.addEventListener('input', function () { dirty = true; });
  modalEl.addEventListener('change', function () { dirty = true; });
  return {
    reset: function () { dirty = false; },
    isDirty: function () { return dirty; },
    confirmDiscard: function () {
      return !dirty || confirm('יש נתונים שלא נשמרו - לצאת בכל זאת?');
    },
  };
}

// v2.1, section 6.5 — XXX-XXX-XXXX as the user types, digits only, no library.
function maskPhoneInput(el) {
  el.addEventListener('input', function () {
    var digits = el.value.replace(/\D/g, '').slice(0, 10);
    var parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 3));
    if (digits.length > 3) parts.push(digits.slice(3, 6));
    if (digits.length > 6) parts.push(digits.slice(6, 10));
    el.value = parts.join('-');
  });
}

// Strips disallowed characters live as the user types, keeping the caret position stable.
// Used for name fields (v2.1, follow-up): Hebrew-only inputs reject anything outside
// א-ת (no digits, no Latin), English-only inputs reject anything outside A-Za-z.
function restrictInputChars(el, disallowedPattern, transform) {
  el.addEventListener('input', function () {
    var pos = el.selectionStart;
    var before = el.value;
    var next = el.value.replace(disallowedPattern, '');
    if (transform) next = transform(next);
    el.value = next;
    var removedBeforeCaret = before.slice(0, pos).replace(disallowedPattern, '').length;
    el.setSelectionRange(removedBeforeCaret, removedBeforeCaret);
  });
}

function restrictToHebrewLetters(el) { restrictInputChars(el, /[^א-ת]/g); }
// Item 1 (follow-up): English names are always forced lowercase as the user types — matches
// the server's own suggested-email formula (computeSuggestedEmail), which lowercases anyway.
// Lowercasing never changes string length, so the caret position math above stays correct.
function restrictToEnglishLetters(el) { restrictInputChars(el, /[^A-Za-z]/g, function (v) { return v.toLowerCase(); }); }

// Copies text and gives brief inline feedback on the triggering button (v2.1, section 4ב —
// script/welcome-message copy boxes). Falls back silently if the Clipboard API is blocked.
function copyToClipboard(text, buttonEl) {
  var restore = buttonEl ? buttonEl.textContent : null;
  navigator.clipboard.writeText(text || '').then(function () {
    if (buttonEl) {
      buttonEl.textContent = 'הועתק!';
      setTimeout(function () { buttonEl.textContent = restore; }, 1500);
    }
  }).catch(function () {
    if (buttonEl) {
      buttonEl.textContent = 'העתקה נכשלה';
      setTimeout(function () { buttonEl.textContent = restore; }, 1500);
    }
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
