#!/usr/bin/env node
// One-time converter: entra-users-export.json (from export-entra-users.ps1) → bootstrap-users.sql
//
// Usage: node infra/generate-user-seed.js entra-users-export.json
//
// Matches each user's Department (365) to Branches.Name (seed.sql) by exact match;
// unmatched departments are reported on stderr and left NULL for manual fix-up in the
// portal afterward — never guessed. Every INSERT is guarded (IF NOT EXISTS), so this is
// safe to run against a database that already has the two seeded SuperAdmin rows, or to
// re-run if it's interrupted partway through.

const fs = require('fs');
const path = require('path');

// Keep in sync with infra/seed.sql's Branches rows.
const BRANCHES = [
  { number: 0, name: 'מרוחק (ניידים)' },
  { number: 1, name: 'פרדס חנה' },
  { number: 2, name: 'רמלה' },
];

function branchNumberFor(department) {
  const dep = String(department || '').trim();
  if (!dep) return null;
  const match = BRANCHES.find((b) => b.name === dep);
  return match ? match.number : null;
}

function sqlEscape(str) {
  return String(str || '').replace(/'/g, "''");
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node infra/generate-user-seed.js <entra-users-export.json>');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
// Get-MgUser | ConvertTo-Json emits a bare object (not an array) when there's exactly one result.
const rows = Array.isArray(parsed) ? parsed : [parsed];

const outPath = path.join(__dirname, 'bootstrap-users.sql');
const lines = [
  '-- One-time bootstrap: existing Entra ID users -> Users table.',
  `-- Generated from ${path.basename(inputPath)} by infra/generate-user-seed.js.`,
  '-- Every row is guarded (IF NOT EXISTS) -- safe to re-run.',
  '',
];

let inserted = 0;
let unmatchedBranch = 0;
let skippedNoEmail = 0;

for (const u of rows) {
  const email = String(u.userPrincipalName || u.mail || '').trim().toLowerCase();
  if (!email) { skippedNoEmail++; continue; }

  const firstName = sqlEscape(u.givenName);
  const lastName = sqlEscape(u.surname);
  const branchNumber = branchNumberFor(u.department);
  if (branchNumber === null && u.department) {
    unmatchedBranch++;
    console.error(`No branch match for department "${u.department}" (${email}) — left NULL, set it manually in the portal.`);
  }

  lines.push(
    `IF NOT EXISTS (SELECT 1 FROM Users WHERE Email = N'${email}')`,
    `INSERT INTO Users (Email, FirstName, LastName, BranchNumber) VALUES (N'${email}', N'${firstName}', N'${lastName}', ${branchNumber === null ? 'NULL' : branchNumber});`,
    'GO',
    '',
  );
  inserted++;
}

fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Wrote ${outPath}: ${inserted} users (${unmatchedBranch} without a branch match, ${skippedNoEmail} skipped for missing email).`);
