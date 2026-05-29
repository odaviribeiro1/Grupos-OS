/**
 * Local test server: serves the built frontend (dist/) AND routes /api/* to the real
 * Vercel serverless handlers (api/*.ts), imported directly (Node 25 strips TS types).
 * Single origin on :5173 so the wizard's relative /api/* fetches resolve. Replaces
 * `vercel dev` (which this project's SAML-scoped token can't authenticate).
 *
 * Env: loads .env.test into process.env. CRYPTO_KEY defaults to CREDENTIALS_ENCRYPTION_KEY
 * but is NOT overwritten if already set (launcher may pin it to the bootstrap key so the
 * deployed Edge Functions and locally-saved credentials share one key).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 5173);

// --- load .env.test ---
for (const line of readFileSync(join(ROOT, ".env.test"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}
if (!process.env.CRYPTO_KEY && process.env.CREDENTIALS_ENCRYPTION_KEY) {
  process.env.CRYPTO_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
};

const handlerCache = {};
async function getHandler(name) {
  if (!(name in handlerCache)) {
    const file = join(ROOT, "api", `${name}.ts`);
    handlerCache[name] = existsSync(file) ? (await import(file)).default : null;
  }
  return handlerCache[name];
}

function readBody(req) {
  return new Promise((res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => res(""));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // --- /api/* → serverless handler ---
  if (pathname.startsWith("/api/")) {
    const name = pathname.slice(5).split("/")[0];
    const handler = await getHandler(name);
    if (!handler) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: `No handler /api/${name}` }));
    }
    const raw = await readBody(req);
    req.query = Object.fromEntries(url.searchParams);
    try {
      req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : raw || undefined;
    } catch {
      req.body = raw;
    }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ success: false, message: err?.message ?? "handler threw", stack: err?.stack }));
      }
    }
    console.log(`[api] ${req.method} ${pathname} -> ${res.statusCode}`);
    return;
  }

  // --- static dist/ with SPA fallback ---
  let filePath = join(DIST, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST, "index.html"); // SPA fallback
  }
  if (!existsSync(filePath)) {
    res.statusCode = 404;
    return res.end("dist/ not built — run `npx vite build` first");
  }
  res.setHeader("content-type", MIME[extname(filePath)] || "application/octet-stream");
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`[test-server] http://localhost:${PORT}  (CRYPTO_KEY ${process.env.CRYPTO_KEY ? "set" : "MISSING"}, SUPABASE ${process.env.SUPABASE_URL ? "set" : "MISSING"})`);
});
