import { test, expect } from "@playwright/test";
import { STEP2, APP_CREDS, BASE_URL, missingFor } from "../env";
import { signInOwner, rest, restJson, callEdge, SUPABASE_URL, ANON, SERVICE } from "../helpers/supabase";

/**
 * Integração ao vivo (nível API/Edge Functions): salva creds (AES-GCM), requireOwner,
 * conexão UAZAPI, webhook→persistência, geração de resumo (OpenAI gpt-4.1-mini) e RAG.
 * NÃO envia mensagem ao WhatsApp (não chama send-summary-to-group / cron-daily-summary).
 * Servidor local deve rodar com CRYPTO_KEY = chave do bootstrap (creds salvas aqui são
 * decriptadas pelas Edge Functions).
 */
const OWNER_ID = "60adf863-aa84-4e39-bd5e-fdcefe93f213";
const CHAT_ID = "intgrp-grupos-test@g.us";
let ownerToken = "";
let groupId = "";

test.describe.serial("Integração ao vivo", () => {
  test.beforeAll(() => {
    const miss = missingFor("integration");
    test.skip(miss.length > 0, `Faltam vars: ${miss.join(", ")}`);
  });

  test("owner autentica via Supabase", async () => {
    ownerToken = await signInOwner();
    expect(ownerToken.length).toBeGreaterThan(20);
  });

  test("salva app credentials criptografadas (AES-256-GCM) via /api/credentials", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { credentials: APP_CREDS },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.success).toBeTruthy();

    // Verifica persistência cifrada no formato iv:tag:cipher (hex).
    const rows = await restJson<Array<{ key: string; value_encrypted: string }>>(
      `/app_settings?select=key,value_encrypted&key=eq.openai_api_key`, {}, "public"
    );
    expect(rows.length).toBe(1);
    expect(rows[0].value_encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
    // Nunca em texto puro: não deve conter o prefixo sk- da chave.
    expect(rows[0].value_encrypted).not.toContain("sk-");
  });

  test("requireOwner: sem token → 401; token inválido → 401", async ({ request }) => {
    const noTok = await request.post(`${BASE_URL}/api/credentials`, { data: { credentials: {} } });
    expect(noTok.status()).toBe(401);
    const bad = await request.post(`${BASE_URL}/api/credentials`, {
      headers: { Authorization: "Bearer not.a.jwt" }, data: { credentials: {} },
    });
    expect(bad.status()).toBe(401);
  });

  test("requireOwner: usuário não-owner é bloqueado (403) [best-effort]", async ({ request }) => {
    // Cria um usuário comum via Auth admin; se o trigger de convite bloquear, pula.
    const email = `member-${OWNER_ID.slice(0, 8)}@teste.com`;
    const password = "Member@123";
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: "member" } }),
    });
    const created = await create.json();
    test.skip(!create.ok || !created.id, `criação de membro bloqueada pelo trigger: ${JSON.stringify(created).slice(0, 120)}`);
    // Garante role member (caso o trigger tenha definido outro).
    await rest(`/users?id=eq.${created.id}`, { method: "PATCH", body: JSON.stringify({ role: "member" }) }, "grupos");
    const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const lj = await login.json();
    const res = await request.post(`${BASE_URL}/api/credentials`, {
      headers: { Authorization: `Bearer ${lj.access_token}` }, data: { credentials: { openai_api_key: "x" } },
    });
    expect(res.status(), "não-owner deve receber 403").toBe(403);
    // cleanup
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, {
      method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  });

  test("conexão UAZAPI: /api/uazapi lista grupos da instância (status real)", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/uazapi`, {
      headers: { Authorization: `Bearer ${ownerToken}` }, timeout: 30_000,
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(Array.isArray(body.groups), "resposta deve ter array groups").toBeTruthy();
    console.log(`[uazapi] instância retornou ${body.groups.length} grupos`);
  });

  test("seed: grupo monitorado + mensagens de hoje", async () => {
    // Limpa execução anterior e cria grupo ativo do owner.
    await rest(`/groups?whatsapp_group_id=eq.${encodeURIComponent(CHAT_ID)}`, { method: "DELETE" }, "grupos");
    const g = await restJson<Array<{ id: string }>>(`/groups`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: OWNER_ID, whatsapp_group_id: CHAT_ID, name: "Grupo Integração", participant_count: 4, is_active: true }),
    }, "grupos");
    groupId = g[0].id;
    expect(groupId).toBeTruthy();

    const now = Date.now();
    const mk = (i: number, sender: string, who: string, txt: string) => ({
      group_id: groupId, uazapi_message_id: `seed-${i}`, chat_id: CHAT_ID,
      sender_jid: `${sender}@s.whatsapp.net`, sender_name: who, message_type: "text",
      text: txt, from_me: false, was_sent_by_api: false,
      message_timestamp: new Date(now - (10 - i) * 60_000).toISOString(),
    });
    await rest(`/messages`, {
      method: "POST",
      body: JSON.stringify([
        mk(1, "5511001", "João", "Bom dia! O pedido 123 do cliente Acme já saiu para entrega?"),
        mk(2, "5511002", "Maria", "Saiu sim, João. Previsão de chegada às 14h na zona sul."),
        mk(3, "5511003", "Carlos", "Pessoal, o estoque de vodka está acabando, precisamos repor."),
        mk(4, "5511001", "João", "Anotado Carlos. Faço o pedido ao fornecedor hoje ainda."),
        mk(5, "5511002", "Maria", "Faturamento da semana subiu 12%, ótimo trabalho time!"),
        mk(6, "5511004", "Ana", "O sistema de rastreamento voltou ao ar, problema resolvido."),
      ]),
    }, "grupos");
    const cnt = await restJson<Array<{ count: number }>>(`/messages?select=count&group_id=eq.${groupId}`, {
      headers: { Prefer: "count=exact" },
    }, "grupos");
    console.log(`[seed] grupo ${groupId} com mensagens`);
  });

  test("webhook UAZAPI: mensagem de grupo simulada persiste (sem embedding — N/A neste schema)", async () => {
    const payload = {
      EventType: "messages",
      chat: { id: CHAT_ID, wa_chatid: CHAT_ID, wa_isGroup: true },
      message: {
        messageid: "wh-int-001", chatId: CHAT_ID, messageType: "Conversation",
        text: "Chegou o boleto do fornecedor de gelo? Precisamos pagar até sexta.",
        sender: "5511005@s.whatsapp.net", senderName: "Pedro", fromMe: false,
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    };
    const r = await callEdge("webhook-uazapi", payload);
    expect(r.status, r.text).toBe(200);
    expect(r.json?.status === "ok" || r.json?.message_id, JSON.stringify(r.json)).toBeTruthy();

    const rows = await restJson<Array<{ id: string; text: string }>>(
      `/messages?select=id,text&uazapi_message_id=eq.wh-int-001`, {}, "grupos"
    );
    expect(rows.length, "mensagem do webhook persistida").toBe(1);
    expect(rows[0].text).toContain("boleto");
    console.log(`[webhook] persistido message id=${rows[0].id}`);
  });

  test("resumo: generate-summary gera resumo via OpenAI (gpt-4.1-mini) — SEM enviar", async () => {
    test.setTimeout(90_000);
    const r = await callEdge("generate-summary", { group_id: groupId, period_type: "today" }, ownerToken);
    expect(r.status, r.text.slice(0, 500)).toBe(200);
    // Deve ter criado uma linha em summaries para o grupo.
    const sums = await restJson<Array<{ id: string; sent_to_group: boolean }>>(
      `/summaries?select=id,sent_to_group&group_id=eq.${groupId}&order=created_at.desc&limit=1`, {}, "grupos"
    );
    expect(sums.length, "summary criado").toBe(1);
    expect(sums[0].sent_to_group ?? false, "NÃO deve ter sido enviado ao grupo").toBeFalsy();
    console.log(`[summary] id=${sums[0].id} status=${r.status}`);
  });

  test("RAG: chat-with-context responde ancorado no conteúdo do grupo", async () => {
    test.setTimeout(90_000);
    const r = await callEdge(
      "chat-with-context",
      { group_id: groupId, user_id: OWNER_ID, message: "Qual o status do pedido 123 e a previsão de entrega?", period_type: "today" },
      ownerToken
    );
    expect(r.status, r.text.slice(0, 500)).toBe(200);
    // chat-with-context responde em streaming SSE: linhas `data: {"content":"..."}`.
    const answer = r.text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => {
        try { return JSON.parse(l.slice(5).trim())?.content ?? ""; } catch { return ""; }
      })
      .join("")
      .toLowerCase();
    expect(answer.length, "resposta não-vazia").toBeGreaterThan(0);
    // Ancorado no contexto do grupo (zona sul / 14h / entrega / acme / pedido 123).
    expect(answer).toMatch(/14h|zona sul|entrega|acme|pedido 123/);
    console.log(`[rag] resposta ancorada: "${answer.slice(0, 80)}…"`);
  });
});
