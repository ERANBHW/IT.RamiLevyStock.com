// Shared infrastructure for every page of the IT Portal SPA.
// Keep this file dependency-free beyond msal-browser (plain script tags, no build step).

export var APP_VERSION = '2.5.0'; // keep in sync with /VERSION - bumped every shipped change
export var LOGO_URL = 'https://rami-levy-stock.co.il/sing.png';

// ── AZURE / ENTRA CONFIG ───────────────────────────────────────
// Filled in once infra/provision.sh (steps "resources" + "appregs") has run — copy the
// values from infra/.provision-state. Nothing here is a secret; the SPA is a public
// client (PKCE, no client secret) by design.
var MSAL_TENANT_ID = '9831f885-99f6-47db-9d56-c5a7136ccfe7';
var MSAL_SPA_CLIENT_ID = 'b9997216-1b46-41b5-b003-9ad947c3cc84';
var MSAL_API_CLIENT_ID = 'a211569e-5213-4ae4-8883-f03186890e58';
var API_BASE_URL = 'https://func-portal-api-490fb4.azurewebsites.net/api/dispatch';
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
export var Portal = (function () {
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

  var REDIRECT_ATTEMPT_KEY = 'portalAuthRedirectAttempted';

  async function loadIdentity() {
    await msalInstance.initialize();

    var redirectResult = null;
    try {
      redirectResult = await msalInstance.handleRedirectPromise();
    } catch (e) {
      // A broken/expired redirect response (stale state from an interrupted previous
      // attempt) — treat it the same as "no account yet" rather than throwing.
      redirectResult = null;
    }
    if (redirectResult && redirectResult.account) account = redirectResult.account;

    if (!account) {
      var accounts = msalInstance.getAllAccounts();
      if (accounts.length) account = accounts[0];
    }

    if (account) {
      sessionStorage.removeItem(REDIRECT_ATTEMPT_KEY);
    } else {
      // Some browser/account combinations (seen with Edge signed in to a work profile)
      // can make ssoSilent's hidden-iframe check bounce through a real interactive
      // redirect instead of failing cleanly, so handleRedirectPromise() never resolves
      // into an account and we'd otherwise retry ssoSilent -> loginRedirect forever.
      // This flag caps it at one interactive attempt per tab: if we already redirected
      // away and came back with still no account, stop and surface a clear retry
      // instead of silently looping.
      if (sessionStorage.getItem(REDIRECT_ATTEMPT_KEY) === '1') {
        sessionStorage.removeItem(REDIRECT_ATTEMPT_KEY);
        throw new Error('ההתחברות לא הושלמה. רענן/י את הדף ונסה/י שוב.');
      }
      try {
        var ssoResult = await msalInstance.ssoSilent({ scopes: [API_SCOPE] });
        account = ssoResult.account;
        sessionStorage.removeItem(REDIRECT_ATTEMPT_KEY);
      } catch (e) {
        sessionStorage.setItem(REDIRECT_ATTEMPT_KEY, '1');
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
// GET: ?entity=<entity>&action=<action>&...params
// POST: JSON body { entity, action,...payload }
// Every call carries a real Bearer token — the server never trusts an email/id the
// client sends in params/payload for identity purposes.
// While "view as" is active, every call automatically carries viewAsEmail — harmless
// for endpoints that don't look at it, and honored (IT Admin only, re-checked server-
// side from the real Easy Auth token every time) by the handful that do: it's what lets
// listMine/getAssigned/create show and act as the impersonated employee everywhere,
// without every call site needing to remember to pass it.
export async function apiGet(entity, action, params) {
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

export async function apiPost(entity, action, payload) {
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
