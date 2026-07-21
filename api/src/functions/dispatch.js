/**
 * IT Portal backend — single HTTP entry point, mirroring the entity/action router of
 * apps-script/Code.gs so the frontend's apiGet/apiPost shape barely changes.
 *
 * Request shape (unchanged from v1):
 *   GET  /api/dispatch?entity=<entity>&action=<action>&...params
 *   POST /api/dispatch  JSON body { entity, action, ...payload }
 *
 * Unlike v1, the caller's identity is NEVER taken from the request — Easy Auth
 * (configured in infra/authsettingsv2.template.json) validates the Entra ID token
 * before this code runs and injects the caller's claims into x-ms-client-principal.
 */
const { app } = require('@azure/functions');
const { sql, getPool } = require('../db');
const { getCallerFromRequest } = require('../auth');
const users = require('../entities/users');
const computers = require('../entities/computers');
const tickets = require('../entities/tickets');
const procedures = require('../entities/procedures');
const branches = require('../entities/branches');
const sharedFolders = require('../entities/sharedFolders');

const ROUTES = {
  users: {
    identify: users.identify,
    updateProfile: users.updateProfile,
    list: users.list,
    create: users.create,
    adminUpdate: users.adminUpdate,
    delete: users.remove,
  },
  computers: {
    getAssigned: computers.getAssigned,
    list: computers.list,
    create: computers.create,
    update: computers.update,
    delete: computers.remove,
    ticketHistory: computers.ticketHistory,
  },
  tickets: {
    create: tickets.create,
    listMine: tickets.listMine,
    list: tickets.list,
    get: tickets.get,
    update: tickets.update,
    take: tickets.take,
    reassign: tickets.reassign,
    updateStatus: tickets.updateStatus,
  },
  procedures: {
    list: procedures.list,
    create: procedures.create,
    update: procedures.update,
    delete: procedures.remove,
  },
  branches: {
    list: branches.list,
    create: branches.create,
    update: branches.update,
    delete: branches.remove,
  },
  sharedFolders: {
    list: sharedFolders.list,
    create: sharedFolders.create,
    update: sharedFolders.update,
    delete: sharedFolders.remove,
  },
};

async function loadCaller(identity) {
  const pool = await getPool();
  const result = await pool.request().input('email', sql.NVarChar, identity.email)
    .query('SELECT * FROM Users WHERE Email = @email');
  const row = result.recordset[0] || null;
  return {
    email: identity.email,
    name: identity.name,
    row,
    isSuperAdmin: !!(row && row.IsSuperAdmin),
    isITAdmin: !!(row && (row.IsITAdmin || row.IsSuperAdmin)),
    isProceduresAdmin: !!(row && (row.IsProceduresAdmin || row.IsSuperAdmin)),
  };
}

app.http('dispatch', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // gated by Easy Auth at the platform level, not by function key
  route: 'dispatch',
  handler: async (request, context) => {
    const identity = getCallerFromRequest(request);
    if (!identity) {
      return { status: 401, jsonBody: { ok: false, error: 'Unauthorized' } };
    }

    let entity;
    let action;
    let payload;
    if (request.method === 'GET') {
      entity = request.query.get('entity');
      action = request.query.get('action');
      payload = Object.fromEntries(request.query.entries());
    } else {
      payload = await request.json().catch(() => ({}));
      entity = payload.entity;
      action = payload.action;
    }

    const entityRoutes = ROUTES[entity];
    if (!entityRoutes || !entityRoutes[action]) {
      return { status: 400, jsonBody: { ok: false, error: `Unknown entity/action: ${entity}/${action}` } };
    }

    try {
      const caller = await loadCaller(identity);
      const result = await entityRoutes[action](payload, caller);
      return { jsonBody: result };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { ok: false, error: String((err && err.message) || err) } };
    }
  },
});
