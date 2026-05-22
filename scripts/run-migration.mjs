// Executa um arquivo SQL no projeto Supabase via Management API.
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/run-migration.mjs <ref> <arquivo.sql>

import fs from "node:fs";
import path from "node:path";

const [, , projectRef, sqlPath] = process.argv;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token || !projectRef || !sqlPath) {
  console.error(
    "Uso: SUPABASE_ACCESS_TOKEN=... node scripts/run-migration.mjs <ref> <arquivo.sql>"
  );
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(sqlPath), "utf8");
const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

console.log(`[INFO] SQL size: ${sql.length} chars`);
console.log(`[INFO] POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`[HTTP ${res.status}]`);
console.log(text);
if (!res.ok) process.exit(1);
