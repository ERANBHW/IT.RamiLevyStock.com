const { ConfidentialClientApplication } = require('@azure/msal-node');

// Separate app registration from mail.js's it-portal-mail on purpose (v2.1, section 4א):
// it-portal-graph holds ONLY the read-only User.Read.All application permission, never a
// write scope — the portal never creates/edits users in Entra ID itself.
let msalClient;
function getSyncMsalClient() {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.GRAPH_SYNC_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
        clientSecret: process.env.GRAPH_SYNC_CLIENT_SECRET,
      },
    });
  }
  return msalClient;
}

async function getSyncGraphToken() {
  const result = await getSyncMsalClient().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

async function listAllEntraUsers() {
  const token = await getSyncGraphToken();
  const users = [];
  let url = 'https://graph.microsoft.com/v1.0/users?$select=userPrincipalName,mail,accountEnabled&$top=999';
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph /users failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    users.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }
  return users;
}

module.exports = { listAllEntraUsers };
