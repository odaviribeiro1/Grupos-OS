// Faz deploy de uma Edge Function via Supabase Management API.
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-function.mjs <ref> <slug>

import fs from "node:fs";
import path from "node:path";

const [, , projectRef, slug] = process.argv;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token || !projectRef || !slug) {
  console.error(
    "Uso: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-function.mjs <ref> <slug>"
  );
  process.exit(1);
}

const fnDir = path.resolve("supabase", "functions", slug);
const entrypoint = path.join(fnDir, "index.ts");

if (!fs.existsSync(entrypoint)) {
  console.error(`[ERRO] Arquivo não encontrado: ${entrypoint}`);
  process.exit(1);
}

const source = fs.readFileSync(entrypoint, "utf8");

console.log(`[INFO] Function: ${slug}`);
console.log(`[INFO] Source size: ${source.length} chars`);

// Usa o endpoint de deploy multipart (recomendado pela Supabase)
const deployUrl = `https://api.supabase.com/v1/projects/${projectRef}/functions/deploy?slug=${slug}`;
console.log(`[INFO] POST ${deployUrl}`);

const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        name: slug,
        verify_jwt: false,
        entrypoint_path: "index.ts",
      }),
    ],
    { type: "application/json" }
  )
);
form.append(
  "file",
  new Blob([source], { type: "application/typescript" }),
  "index.ts"
);

const res = await fetch(deployUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});

const text = await res.text();
console.log(`[HTTP ${res.status}]`);
console.log(text);
if (!res.ok) process.exit(1);
