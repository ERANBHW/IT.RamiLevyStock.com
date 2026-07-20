// Identity comes ONLY from Easy Auth — never from a client-supplied email/param.
// App Service Authentication (configured in infra/authsettingsv2.template.json) validates
// the Entra ID token before this code runs and injects the caller's claims into the
// x-ms-client-principal header. If that header is missing, the caller is not authenticated.

function getCallerFromRequest(request) {
  const principalHeader = request.headers.get('x-ms-client-principal');
  if (principalHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
      const claims = decoded.claims || [];
      const claim = (type) => (claims.find((c) => c.typ === type) || {}).val;
      const email = (
        claim('preferred_username') ||
        claim('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn') ||
        decoded.userDetails ||
        ''
      ).trim().toLowerCase();
      if (email) return { email, name: claim('name') || email };
    } catch {
      return null;
    }
  }

  // Local development only: Easy Auth doesn't run under `func start`. Never set
  // DEV_FAKE_IDENTITY in the deployed Function App's settings — production requests
  // always carry a real x-ms-client-principal header from Easy Auth.
  if (process.env.DEV_FAKE_IDENTITY) {
    const email = process.env.DEV_FAKE_IDENTITY.trim().toLowerCase();
    return { email, name: email };
  }

  return null;
}

module.exports = { getCallerFromRequest };
