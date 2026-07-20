const sql = require('mssql');

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      authentication: { type: 'azure-active-directory-default' },
      options: { encrypt: true },
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
