import { test, expect } from "@playwright/test";
import { STEP2, missingFor } from "../env";
import { signInOwner, rest, restJson, callEdge, SUPABASE_URL, ANON } from "../helpers/supabase";

/**
 * Verificação dos fixes que exigem backend ao vivo:
 *  - #2: send-summary-to-group aceita a service_role (cron interno) sem 401 — e PÁRA
 *        em "summary not found" (404), provando que NÃO houve envio ao WhatsApp.
 *  - #3: match_knowledge (RPC criada na migration 0008) retorna doc da base de
 *        conhecimento por similaridade pgvector. Vetor unitário → sim=1.0 (determinístico,
 *        sem custo OpenAI).
 */
const PAT = STEP2.supabase_pat;
const REF = (STEP2.supabase_url.match(/^https:\/\/([a-z0-9]+)/i) || [])[1];
const CHAT_ID = "kbgrp-grupos-test@g.us";
const OWNER_ID = "60adf863-aa84-4e39-bd5e-fdcefe93f213";
let groupId = "";

async function mgmtSql(query: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt sql (${r.status}): ${t}`);
  return t ? JSON.parse(t) : {};
}

function randomUuid() {
  // determinístico-suficiente: um uuid v4 fixo improvável de existir
  return "00000000-dead-beef-0000-000000000000";
}

test.describe.serial("Fixes (verificação ao vivo)", () => {
  test.beforeAll(() => {
    const miss = missingFor("integration");
    test.skip(miss.length > 0, `Faltam vars: ${miss.join(", ")}`);
  });

  test("#2 send-summary-to-group: cron interno (x-internal-secret) passa auth → 404, sem enviar; sem segredo → 401", async () => {
    // O segredo interno é a CRYPTO_KEY (compartilhada entre as functions), guardada no
    // bootstrap. Antes do fix, o cron mandava a service_role como Bearer e auth.getUser
    // a rejeitava (401) — resumo diário nunca era enviado.
    const rows = await mgmtSql(`select metadata->>'crypto_key' as k from public._bootstrap_state where step='crypto_key_generated';`);
    const cryptoKey = (Array.isArray(rows) ? rows : rows.data)[0].k;

    const headers = {
      apikey: ANON,
      Authorization: `Bearer ${STEP2.supabase_service_role_key}`,
      "Content-Type": "application/json",
    };
    // Com o segredo interno → auth passa → summary não encontrado → 404 (NÃO envia).
    const ok = await fetch(`${SUPABASE_URL}/functions/v1/send-summary-to-group`, {
      method: "POST", headers: { ...headers, "x-internal-secret": cryptoKey },
      body: JSON.stringify({ summary_id: randomUuid() }),
    });
    expect(ok.status, `interno deve passar auth e parar em not-found: ${await ok.clone().text()}`).toBe(404);
    expect(await ok.text()).toContain("not found");

    // Sem o segredo (e service_role não é JWT de usuário) → bloqueado 401.
    const blocked = await fetch(`${SUPABASE_URL}/functions/v1/send-summary-to-group`, {
      method: "POST", headers, body: JSON.stringify({ summary_id: randomUuid() }),
    });
    expect(blocked.status, "sem segredo interno deve bloquear").toBe(401);
  });

  test("#3 match_knowledge retorna doc da base de conhecimento por similaridade", async () => {
    await signInOwner();
    await rest(`/groups?whatsapp_group_id=eq.${encodeURIComponent(CHAT_ID)}`, { method: "DELETE" }, "grupos");
    const g = await restJson<Array<{ id: string }>>(`/groups`, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: OWNER_ID, whatsapp_group_id: CHAT_ID, name: "KB test", is_active: true }),
    }, "grupos");
    groupId = g[0].id;

    // Vetor unitário 1536-dim (text-embedding-3-small). Consulta com o mesmo vetor → sim=1.
    const vec = "[" + ["1", ...Array(1535).fill("0")].join(",") + "]";
    await mgmtSql(
      `insert into grupos.knowledge_base (group_id, title, content, embedding)
       values ('${groupId}', 'Política de reembolso', 'Reembolsos sao processados em 7 dias uteis pelo financeiro.', '${vec}'::vector);`
    );

    // Chama a RPC como as Edge Functions chamam (schema grupos, query_embedding string).
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
      method: "POST",
      headers: {
        apikey: STEP2.supabase_service_role_key,
        Authorization: `Bearer ${STEP2.supabase_service_role_key}`,
        "Content-Type": "application/json",
        "Content-Profile": "grupos",
        "Accept-Profile": "grupos",
      },
      body: JSON.stringify({ query_embedding: vec, match_group_id: groupId, match_threshold: 0.5, match_count: 3 }),
    });
    const rows = await r.json();
    expect(r.status, JSON.stringify(rows)).toBe(200);
    expect(Array.isArray(rows) && rows.length, "match_knowledge retornou ≥1 doc").toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).toContain("reembolso");
    expect(rows[0].similarity).toBeGreaterThan(0.9);
  });

  test("#6 cron idempotência: guard detecta resumo de hoje existente (evita duplicata)", async () => {
    // Verifica a query do guard do cron-daily-summary contra dados reais (o E2E completo
    // do cron não roda por segurança — ele ENVIA ao WhatsApp). Cria grupo + um resumo de
    // hoje, e confirma que o filtro do guard retorna esse resumo (→ cron pularia).
    const chat = "cronidem-grupos-test@g.us";
    await rest(`/groups?whatsapp_group_id=eq.${encodeURIComponent(chat)}`, { method: "DELETE" }, "grupos");
    const g = await restJson<Array<{ id: string }>>(`/groups`, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: OWNER_ID, whatsapp_group_id: chat, name: "cron idem", is_active: true }),
    }, "grupos");
    const gid = g[0].id;
    const startUtc = new Date(Date.now() - 3 * 3600_000).toISOString();
    await rest(`/summaries`, {
      method: "POST",
      body: JSON.stringify({ group_id: gid, period_type: "today", period_start: startUtc, period_end: new Date().toISOString(), summary_text: "x", is_auto_generated: true, sent_to_group: false }),
    }, "grupos");

    // Mesmo filtro do guard no cron-daily-summary.
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const found = await restJson<Array<{ id: string }>>(
      `/summaries?select=id&group_id=eq.${gid}&period_type=eq.today&period_start=gte.${todayStart.toISOString()}&limit=1`,
      {}, "grupos"
    );
    expect(found.length, "guard deve achar o resumo de hoje → cron pularia").toBe(1);
    await rest(`/groups?id=eq.${gid}`, { method: "DELETE" }, "grupos").catch(() => {});
  });

  test.afterAll(async () => {
    if (groupId) await rest(`/groups?id=eq.${groupId}`, { method: "DELETE" }, "grupos").catch(() => {});
  });
});
