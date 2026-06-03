# Suíte E2E (Playwright) — grupOS

Testa o wizard `/setup`, o bootstrap real, e (na fase live) ingestão via webhook,
RAG e geração de resumo. **Não envia mensagem WhatsApp** (o passo `send-summary-to-group`
/ `cron-daily-summary` é só inspecionado, nunca disparado).

## Pré-requisitos

```bash
npm i -D @playwright/test vercel && npx playwright install chromium
```

Adicionar ao `.env.test` (além do que já existe):

```
SUPABASE_PAT=sbp_...        # token pessoal Supabase (migrations/functions/secrets)
VERCEL_TOKEN=...            # vercel.com/account/tokens
VERCEL_PROJECT_ID=prj_...
VERCEL_ORG_ID=team_... | <user id>
```

## Dois server configs (as rotas /api são serverless Vercel — `vite` puro não as serve)

`vite dev` não serve `/api/*`. Use `vercel dev`. Há duas configurações:

- **Config A — instância fresca** (para o wizard renderizar do zero): inicia `vercel dev`
  SEM `VITE_SUPABASE_*`, então `isSupabaseConfigured=false` e o app mostra `/setup`.
  Cobre specs 01/02/03 (Steps 1–3 + bootstrap real + visual/responsivo).

- **Config B — app logado** (full-env): inicia `vercel dev` COM `SUPABASE_*`,
  `CRYPTO_KEY` e `VITE_SUPABASE_*`. Cobre Step 4 (login + salvar app creds via
  `/api/credentials`), conexão UAZAPI, e os specs de integração.

O servidor é iniciado manualmente por fase (a config Playwright usa
`reuseExistingServer`). Rodar:

```bash
npm run test:e2e            # roda specs em tests/specs
npm run test:report         # abre o relatório HTML
```

Screenshots em `tests/screenshots/`, relatório em `tests/report/`.
