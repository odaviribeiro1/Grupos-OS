// Configura PostgREST do projeto Supabase para expor o schema `grupos`.
// Por padrão o Supabase só expõe `public` + `graphql_public`. Como o GrupOS
// vive no schema `grupos`, sem esse passo o frontend bate 406 em todas as
// queries (`Invalid schema: grupos`).
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/setup-postgrest.mjs <ref>

const [, , projectRef] = process.argv;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token || !projectRef) {
  console.error("Uso: SUPABASE_ACCESS_TOKEN=... node scripts/setup-postgrest.mjs <ref>");
  process.exit(1);
}

const url = `https://api.supabase.com/v1/projects/${projectRef}/postgrest`;

const body = {
  db_schema: "public,graphql_public,grupos",
  db_extra_search_path: "public, extensions, grupos",
  max_rows: 1000,
};

console.log(`[INFO] PATCH ${url}`);
console.log(`[INFO] body: ${JSON.stringify(body)}`);

const res = await fetch(url, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`[HTTP ${res.status}]`);
console.log(text);
if (!res.ok) process.exit(1);

console.log("[OK] Schema `grupos` exposto via PostgREST. Pode levar ~5s para o cache recarregar.");
