const sql = require('mssql');

let poolPromise;

// SQL Serverless auto-pauses after inactivity (see infra/README.md) — the first
// connection after a pause can take up to ~60s to resume, well past the mssql default
// 15s timeout. A longer timeout alone isn't enough: caching a *rejected* connect()
// promise here means every request after one failed attempt reuses that same rejection
// forever, even once the database is back up — so a failed attempt must clear the cache
// and let the next call try fresh.
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      authentication: { type: 'azure-active-directory-default' },
      options: { encrypt: true },
      connectionTimeout: 60000,
      requestTimeout: 60000,
    }).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
