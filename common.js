// Shared infrastructure for every page of the IT Portal SPA.
// Keep this file dependency-free (no build step - plain script tag on GitHub Pages).

var APP_VERSION = '1.3.0'; // keep in sync with /VERSION - bumped every shipped change
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOkzvQXDsCrGzRzOgaEBWteHSnthbZrjI29taxP4K540W3TwdneWCf5KtUTk8Trvsv/exec';
var LOGO_URL = 'https://rami-levy-stock.co.il/sing.png';

// ── IDENTITY ────────────────────────────────────────────────
// The desktop launcher opens the app as:  ...index.html#email=user@domain.co.il
var Portal = (function () {
  var currentUser = null; // resolved Users row, or null if not found / not yet loaded

  function getEmailFromHash() {
    var raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    var params = new URLSearchParams(raw);
    return (params.get('email') || '').trim().toLowerCase();
  }

  async function loadIdentity() {
    var email = getEmailFromHash();
    if (!email) {
      currentUser = null;
      return null;
    }
    try {
      var res = await apiGet('users', 'identify', { email: email });
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
    getEmailFromHash: getEmailFromHash,
    loadIdentity: loadIdentity,
    getUser: getUser,
    setUser: setUser,
    isSuperAdmin: isSuperAdmin,
    isITAdmin: isITAdmin,
    isProceduresAdmin: isProceduresAdmin,
  };
})();

// ── API HELPERS ───────────────────────────────────────────────
// GET:  ?entity=<entity>&action=<action>&...params
// POST: JSON body { entity, action, ...payload } sent as text/plain (avoids CORS preflight)
async function apiGet(entity, action, params) {
  var url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('entity', entity);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  var res = await fetch(url.toString());
  return res.json();
}

async function apiPost(entity, action, payload) {
  var body = Object.assign({ entity: entity, action: action }, payload || {});
  var res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
      window.location.href = opts.backHref || 'index.html' + window.location.hash;
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
