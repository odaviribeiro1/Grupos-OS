# CLAUDE.md — GrupOS

## Visão Geral

GrupOS é uma ferramenta interna da Agentise para gestão e análise inteligente de grupos do WhatsApp. Monitora mensagens em tempo real via webhook da UAZAPI, armazena no Supabase, e gera resumos automáticos com IA (OpenAI GPT-4.1 Mini) incluindo análise de sentimento, pendências, tópicos discutidos e métricas de engajamento. Os resumos são exibidos no dashboard e enviados automaticamente no próprio grupo do WhatsApp.

## Stack Técnico

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Edge Functions + Storage + pgvector)
- **Hosting:** Vercel (frontend) + Supabase Cloud (backend)
- **WhatsApp API:** UAZAPI (webhook para receber mensagens, endpoints para enviar)
- **LLM:** OpenAI GPT-4.1 Mini
- **Transcrição de áudio:** OpenAI Whisper
- **RAG:** pgvector no Supabase para Knowledge Base
- **Cron:** Supabase pg_cron ou Edge Function scheduled para resumos diários à meia-noite

## Design System

Padrão Agentise — dark-only:
- Background: `#0A0A0F`
- Cards: glassmorphism (blur 40px, `rgba` blue borders 0.25 opacity, radius 16px, inset top glow)
- Azuis: `#3B82F6` / `#60A5FA` / `#1E3A8A` / `#2563EB`
- Botões: gradient 135deg `#1E3A8A → #3B82F6`
- Texto: `#F8FAFC` (primário) / `#94A3B8` (secundário) / `#CBD5E1` (terciário)
- Verde: `#10B981` | Vermelho: `#EF4444`
- Font: Inter
- Hover: blue glow 30–60px, transition 0.4s cubic-bezier
- Sem light mode

## Arquitetura

### Schema Supabase: `grupos`

Tabelas principais:

#### `users`
- `id` (uuid, PK)
- `email`, `name`, `avatar_url`
- `role` (enum: `admin`, `editor`)
- `created_at`, `updated_at`

#### `uazapi_config`
- `id` (uuid, PK)
- `user_id` (FK → users)
- `api_url` (text) — URL da instância UAZAPI
- `api_token` (text, encrypted)
- `instance_id` (text) — ID da instância criada
- `instance_connected` (boolean) — QR code escaneado
- `openai_api_key` (text, encrypted)
- `onboarding_completed` (boolean)
- `created_at`, `updated_at`

#### `groups`
- `id` (uuid, PK)
- `user_id` (FK → users)
- `uazapi_config_id` (FK → uazapi_config)
- `whatsapp_group_id` (text) — chatId do grupo no WhatsApp
- `name` (text)
- `participant_count` (integer)
- `is_active` (boolean)
- `created_at`, `updated_at`

#### `group_rules`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `rule_text` (text) — regra em linguagem natural injetada no prompt
- `created_at`

#### `group_participants`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `jid` (text) — JID do participante
- `lid` (text)
- `phone_number` (text)
- `display_name` (text)
- `is_admin` (boolean)
- `is_super_admin` (boolean)
- `updated_at`

#### `messages`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `uazapi_message_id` (text) — `messageid` do payload
- `chat_id` (text)
- `sender_jid` (text)
- `sender_name` (text)
- `message_type` (text) — tipo do conteúdo (text, audio, image, etc)
- `text` (text) — texto original ou transcrição de áudio
- `original_audio_url` (text) — fileURL quando é áudio
- `is_transcribed` (boolean, default false)
- `quoted_message_id` (text) — ID da mensagem citada
- `from_me` (boolean)
- `was_sent_by_api` (boolean)
- `message_timestamp` (timestamptz)
- `ai_metadata` (jsonb) — campo vindo da UAZAPI
- `raw_payload` (jsonb) — payload completo para debug
- `created_at`

Filtro nos resumos: mensagens com `from_me = true` E `was_sent_by_api = true` são excluídas da análise.

#### `knowledge_base`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `title` (text)
- `content` (text)
- `embedding` (vector(1536)) — pgvector, modelo text-embedding-3-small
- `file_url` (text, nullable) — arquivo original no Storage
- `created_at`

#### `summaries`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `period_type` (enum: `6h`, `12h`, `today`, `yesterday`, `custom`)
- `period_start` (timestamptz)
- `period_end` (timestamptz)
- `summary_text` (text) — resumo em markdown formatado
- `summary_json` (jsonb) — dados estruturados (ver abaixo)
- `message_count` (integer)
- `participant_count` (integer)
- `peak_hour` (text)
- `avg_response_time_minutes` (integer)
- `sentiment` (jsonb) — `{ positive: number, neutral: number, negative: number }`
- `is_auto_generated` (boolean)
- `sent_to_group` (boolean, default false)
- `created_at`

#### `discussions`
- `id` (uuid, PK)
- `summary_id` (FK → summaries)
- `title` (text)
- `description` (text)
- `status` (enum: `resolved`, `pending`)
- `message_count` (integer)
- `related_message_ids` (text[])
- `created_at`

#### `pending_items`
- `id` (uuid, PK)
- `summary_id` (FK → summaries)
- `description` (text)
- `assigned_participant_jid` (text, nullable)
- `assigned_participant_name` (text, nullable)
- `created_at`

#### `chat_sessions`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `user_id` (FK → users)
- `context_period_start` (timestamptz)
- `context_period_end` (timestamptz)
- `messages` (jsonb) — array de { role, content }
- `created_at`, `updated_at`

### Índices importantes
- `messages`: index em `(group_id, message_timestamp)` e `(group_id, created_at)`
- `messages`: index em `sender_jid` para cálculos de contribuição
- `knowledge_base`: ivfflat index em `embedding` para busca vetorial
- `summaries`: index em `(group_id, period_start)`

## Edge Functions

### `webhook-uazapi`
- **Trigger:** POST da UAZAPI a cada mensagem
- **Lógica:**
  1. Valida payload e extrai campos do schema UAZAPI
  2. Verifica se `isGroup = true`, caso contrário ignora
  3. Se `messageType = audio`, baixa arquivo de `fileURL`, envia para Whisper, armazena transcrição em `text` e marca `is_transcribed = true`
  4. Ignora campos `reaction`, `vote`, `convertOptions`
  5. Insere na tabela `messages`

### `generate-summary`
- **Trigger:** Cron à meia-noite (resumo diário) + on-demand via dashboard
- **Lógica:**
  1. Busca mensagens do período, filtrando `from_me = true AND was_sent_by_api = true`
  2. Busca participantes do grupo para mapear admins (badge "Mentor")
  3. Busca regras de análise do grupo
  4. Busca knowledge base relevante via similarity search (pgvector)
  5. Monta prompt com: mensagens, regras, knowledge base, instruções de formato
  6. Chama GPT-4.1 Mini pedindo JSON estruturado
  7. Salva em `summaries`, `discussions`, `pending_items`
  8. Se auto-gerado (cron), envia resumo formatado no grupo via UAZAPI

### `send-summary-to-group`
- **Trigger:** Chamado pelo `generate-summary` ou botão no dashboard
- **Envia resumo formatado via UAZAPI** no formato WhatsApp markdown (bold com *, itálico com _, etc.)

### `chat-with-context`
- **Trigger:** Chat no dashboard
- **Lógica:**
  1. Busca mensagens do período selecionado
  2. Busca knowledge base relevante via RAG
  3. Injeta regras de análise
  4. Mantém histórico da sessão em `chat_sessions`
  5. Chama GPT-4.1 Mini com contexto completo

### `list-groups`
- **Trigger:** Tela de seleção de grupos no wizard/dashboard
- **Chama endpoint UAZAPI** para listar grupos disponíveis da instância

### `sync-participants`
- **Trigger:** Após conectar grupo + periodicamente
- **Busca participantes do grupo via UAZAPI** e atualiza `group_participants`

### `upload-knowledge`
- **Trigger:** Upload de arquivo na seção Knowledge
- **Lógica:**
  1. Salva arquivo no Supabase Storage
  2. Extrai texto (PDF → text)
  3. Gera embedding via OpenAI text-embedding-3-small
  4. Salva em `knowledge_base` com embedding

## Prompt do Resumo (template)

```
Você é um analista de comunidades. Analise as mensagens do grupo de WhatsApp e gere um resumo estruturado.

REGRAS DE ANÁLISE DO GRUPO:
{rules}

KNOWLEDGE BASE (contexto adicional):
{relevant_knowledge}

PARTICIPANTES ADMIN DO GRUPO (badge "Mentor"):
{admin_list}

MENSAGENS DO PERÍODO ({period}):
{messages}

Gere um JSON com a seguinte estrutura:
{
  "resumo_geral": "texto do resumo do dia",
  "topicos": [
    {
      "titulo": "título do tópico",
      "descricao": "resumo da discussão",
      "status": "resolved" | "pending",
      "mensagens_relacionadas": ["id1", "id2"],
      "quantidade_mensagens": number
    }
  ],
  "participantes_ativos": [
    {
      "jid": "jid",
      "nome": "nome",
      "mensagens": number,
      "respostas": number,
      "badge": "mentor" | "super_engajado" | "engajado" | null
    }
  ],
  "pendencias": [
    {
      "descricao": "texto",
      "responsavel_jid": "jid ou null",
      "responsavel_nome": "nome ou null"
    }
  ],
  "sentimento": {
    "positivo": number (0-100),
    "neutro": number (0-100),
    "negativo": number (0-100)
  },
  "destaques": ["destaque 1", "destaque 2"],
  "recursos_compartilhados": [
    { "titulo": "nome", "url": "link" }
  ],
  "insight_do_dia": "texto",
  "estatisticas": {
    "total_mensagens": number,
    "participantes_ativos": number,
    "midias": { "imagens": number, "audios": number, "documentos": number }
  }
}

REGRAS DE BADGE:
- "mentor": participante que consta como Admin do grupo
- "engajado": 4 a 10 mensagens no período
- "super_engajado": 11+ mensagens no período

REGRAS DE RESOLUÇÃO:
- Uma dúvida é "resolved" se uma pergunta recebeu resposta(s) na thread (campo quoted)
- Caso contrário, é "pending"

Para cálculo de tempo médio de resposta:
- Identifique mensagens que são perguntas
- Encontre a primeira resposta (quoted ou resposta temporal)
- Calcule a diferença em minutos
```

## Formato do Resumo para WhatsApp

O resumo enviado no grupo segue o formato markdown do WhatsApp:

```
📋 *RESUMO DO GRUPO - {nome_do_grupo}*
🗓️ {dia_da_semana}, {data}
🔢 {total_mensagens} mensagens analisadas

---

*📌 RESUMO DO DIA*
> {resumo_geral}

---

*💬 PRINCIPAIS TÓPICOS*

*{topico_1_titulo}*
→ {topico_1_descricao}

*{topico_2_titulo}*
→ {topico_2_descricao}

---

*🗣️ PARTICIPANTES ATIVOS*
• *{nome}* - {descrição da participação}

---

*✅ DECISÕES E ENCAMINHAMENTOS*
• {decisao_1}
• {decisao_2}

---

*❓ PENDÊNCIAS*
• {pendencia_1}
• {pendencia_2}

---

*🔗 RECURSOS COMPARTILHADOS*
• *{titulo}*: {url}

---

*📊 ESTATÍSTICAS*
• Mensagens: {total} | Participantes Ativos: ~{count}
• Mídias: {imagens} imagens, {audios} áudios

---

*💡 INSIGHT DO DIA*
> {insight}
```

## Wizard de Onboarding (6 steps)

1. **Credenciais UAZAPI** — URL da API + Token de autenticação
2. **Criar Instância** — Cria instância na UAZAPI via API
3. **Conectar QR Code** — Exibe QR code para conectar o WhatsApp
4. **API OpenAI** — Chave da API da OpenAI
5. **Conectar Grupo** — Lista grupos da instância, usuário seleciona pelo menos 1
6. **Revisão** — Checklist com status de cada item anterior, botão "Concluir"

## Features do Dashboard

### Página: Grupos
- Lista de grupos monitorados com status (ativo/inativo)
- Botão "+ Adicionar" abre seletor de grupos da instância UAZAPI
- Busca de grupos por nome
- Cada card mostra: nome, qtd participantes, qtd mensagens

### Página: Grupo Individual
- Header: nome do grupo, participantes, mensagens totais
- Filtros de período: Últimas 6h, 12h, Hoje, Ontem, Personalizar
- Botão "Analisar" — gera análise on-demand do período selecionado
- Cards de discussões identificadas com status (resolved ✅ / pending ⏳)
- Expansão de discussão mostra mensagens originais agrupadas
- "Chat com contexto" — abre chat com LLM usando mensagens + knowledge + regras
- Configurações do grupo (accordion): regras de análise, knowledge base

### Página: Resumos
- Resumos diários por grupo com navegação por data
- Seletor de grupo no header
- Seções: resumo geral, métricas (mensagens, participantes, pico, resp. média), resolução de dúvidas (%), sentimento (barras), atividade por hora (gráfico de barras), top contribuidores (com badges), tópicos discutidos, pendências (informativo), destaques, recursos compartilhados
- Botão "Regerar" para regerar resumo

### Página: Knowledge Base
- Upload de arquivos (PDF, docs) por grupo
- Lista de documentos com título, data de upload
- Processamento: extração de texto → embedding → pgvector
- Delete de documentos

### Página: Equipe
- Gerenciamento de usuários
- Roles: Admin (acesso total), Editor (pode ver e analisar, não configura integrações)

### Página: Configurações
- Configurações da instância UAZAPI
- API key da OpenAI
- Preferências gerais

## Cálculos no Backend (SQL/Edge Functions)

### Atividade por Hora
```sql
SELECT
  EXTRACT(HOUR FROM message_timestamp) as hour,
  COUNT(*) as count
FROM messages
WHERE group_id = $1
  AND message_timestamp BETWEEN $2 AND $3
  AND NOT (from_me = true AND was_sent_by_api = true)
GROUP BY hour
ORDER BY hour;
```

### Tempo Médio de Resposta
1. Identifica mensagens que são perguntas (heurística: termina com `?` ou LLM classifica)
2. Busca primeira mensagem que cita (`quoted_message_id`) essa pergunta
3. Calcula diferença em minutos entre timestamps
4. Média de todos os pares pergunta-resposta do período

### Pico de Atividade
Hora com maior contagem de mensagens no período.

### Contagem de Participantes
```sql
SELECT COUNT(DISTINCT sender_jid)
FROM messages
WHERE group_id = $1
  AND message_timestamp BETWEEN $2 AND $3
  AND NOT (from_me = true AND was_sent_by_api = true);
```

## Convenções de Código

- Supabase multi-schema: `.schema('grupos')` no frontend
- Edge Functions em TypeScript (Deno)
- Frontend: componentes em PascalCase, hooks em camelCase com `use` prefix
- Supabase client via `@supabase/supabase-js`
- OpenAI client via `openai` npm package
- Variáveis de ambiente no Supabase: `OPENAI_API_KEY`, `UAZAPI_BASE_URL`, `UAZAPI_TOKEN`
- RLS habilitado em todas as tabelas com policies por `user_id`
- PRD completo em `docs/PRD.md`

## Fluxo de Dados Principal

```
WhatsApp Group Message
  → UAZAPI Webhook
    → Edge Function `webhook-uazapi`
      → [Se áudio] Whisper transcrição
      → INSERT messages
        → [Meia-noite] Cron `generate-summary`
          → Fetch messages do dia
          → Fetch rules + knowledge (RAG)
          → GPT-4.1 Mini → JSON estruturado
          → INSERT summaries/discussions/pending_items
          → Send resumo formatado no grupo via UAZAPI
```

## Implementação por Módulos

A implementação segue uma ordem sequencial onde cada módulo depende do anterior. Cada módulo tem testes de validação que DEVEM passar antes de avançar para o próximo.

---

### Módulo 1 — Fundação (Schema + Auth + Layout)

**Escopo:**
- Criar schema `grupos` no Supabase com todas as tabelas, enums, índices e RLS policies
- Habilitar extensão `vector` (pgvector)
- Setup do projeto React+Vite+Tailwind+shadcn com design system Agentise
- Auth via Supabase Auth (email/password)
- Layout base: sidebar com navegação (Grupos, Resumos, Knowledge, Equipe, Configurações)
- Tabela `users` com campo `role` (admin/editor)
- Página de login

**Testes de Validação:**
1. `[DB]` Conectar no Supabase e confirmar que todas as tabelas existem no schema `grupos` com colunas corretas
2. `[DB]` Confirmar extensão `vector` ativa: `SELECT * FROM pg_extension WHERE extname = 'vector'`
3. `[DB]` Confirmar RLS habilitado em todas as tabelas: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'grupos'`
4. `[AUTH]` Criar usuário via signup, fazer login, confirmar token JWT válido
5. `[AUTH]` Acessar rota protegida sem token → redirect para login
6. `[UI]` Renderizar layout com sidebar, todas as rotas navegam corretamente
7. `[UI]` Verificar design system: background `#0A0A0F`, cards com glassmorphism, cores corretas
8. `[RLS]` Inserir dado como user A, tentar ler como user B → retorno vazio

---

### Módulo 2 — Onboarding Wizard

**Escopo:**
- Componente wizard de 6 steps com stepper visual
- Step 1: Form para URL + Token UAZAPI → salva em `uazapi_config`
- Step 2: Botão "Criar Instância" → chama endpoint UAZAPI para criar instância → salva `instance_id`
- Step 3: Exibe QR code da UAZAPI via polling, detecta conexão → marca `instance_connected = true`
- Step 4: Form para OpenAI API key → salva encrypted
- Step 5: Lista grupos via UAZAPI → usuário seleciona 1+ → insere em `groups`
- Step 6: Checklist de revisão com status verde/vermelho para cada step → botão "Concluir"
- Marcar `onboarding_completed = true`

**Testes de Validação:**
1. `[WIZARD]` Navegar step 1 → 6 sequencialmente, cada step só avança com dados válidos
2. `[WIZARD]` Step 1: submeter URL inválida → mensagem de erro, não avança
3. `[WIZARD]` Step 1: submeter credenciais válidas → registro criado em `uazapi_config`
4. `[API]` Step 2: confirmar que instância foi criada na UAZAPI (mock ou sandbox)
5. `[API]` Step 3: simular scan de QR → `instance_connected` atualiza para `true`
6. `[WIZARD]` Step 4: salvar API key → confirmar que está encrypted no banco (não plaintext)
7. `[API]` Step 5: listar grupos da UAZAPI → exibir com nome e qtd participantes
8. `[WIZARD]` Step 5: tentar avançar sem selecionar grupo → bloqueado
9. `[WIZARD]` Step 6: todos os checks verdes → botão "Concluir" habilitado
10. `[DB]` Após concluir: `onboarding_completed = true`, pelo menos 1 grupo em `groups`

---

### Módulo 3 — Webhook + Ingestão de Mensagens

**Escopo:**
- Edge Function `webhook-uazapi` que recebe POST da UAZAPI
- Validação do payload (campos obrigatórios, `isGroup = true`)
- Parsing dos campos do schema UAZAPI → INSERT em `messages`
- Transcrição de áudio: se `messageType = audio`, baixa `fileURL`, envia para Whisper, salva transcrição
- Ignora `reaction`, `vote`, `convertOptions`
- Armazena `raw_payload` como jsonb para debug
- Sync de participantes: Edge Function `sync-participants` que busca participantes do grupo via UAZAPI e atualiza `group_participants`

**Testes de Validação:**
1. `[WEBHOOK]` Enviar payload de mensagem de texto válida → registro criado em `messages` com todos os campos mapeados
2. `[WEBHOOK]` Enviar payload com `isGroup = false` → ignorado, nenhum insert
3. `[WEBHOOK]` Enviar payload com campos obrigatórios faltando → retorna 400, nenhum insert
4. `[WEBHOOK]` Enviar payload de áudio com `fileURL` → `text` contém transcrição, `is_transcribed = true`, `original_audio_url` preenchido
5. `[WEBHOOK]` Enviar payload com `reaction` → ignorado
6. `[WEBHOOK]` Enviar 3 mensagens seguidas → 3 registros distintos em `messages`, sem duplicata
7. `[WEBHOOK]` Verificar `raw_payload` contém o JSON original completo
8. `[WEBHOOK]` Enviar mensagem com `quoted` preenchido → `quoted_message_id` mapeado corretamente
9. `[SYNC]` Chamar `sync-participants` → tabela `group_participants` atualizada com `is_admin` correto
10. `[PERF]` Enviar 50 mensagens em sequência rápida → todas processadas sem perda

---

### Módulo 4 — Página de Grupos + Grupo Individual

**Escopo:**
- Página `/groups`: lista de grupos monitorados, botão "+ Adicionar", busca por nome
- Card de grupo: nome, participantes, qtd mensagens, status ativo/inativo
- Botão "+ Adicionar" abre modal com seletor de grupos da UAZAPI (reutiliza lógica do step 5 do wizard)
- Página `/groups/:id`: header com info do grupo, filtros de período
- Configurações do grupo (accordion): gerenciar regras de análise (CRUD), sugestões de regras
- Toggle ativar/desativar grupo

**Testes de Validação:**
1. `[UI]` Página de grupos lista todos os grupos do usuário logado
2. `[UI]` Busca por nome filtra corretamente
3. `[UI]` "+ Adicionar" lista grupos da UAZAPI que ainda não foram adicionados
4. `[UI]` Adicionar grupo → aparece na lista com status ativo
5. `[UI]` Página individual mostra header com nome, participantes, mensagens
6. `[UI]` Filtros de período (6h, 12h, Hoje, Ontem, Personalizar) alteram range de dados
7. `[CRUD]` Adicionar regra de análise → salva em `group_rules`
8. `[CRUD]` Deletar regra → removida do banco
9. `[CRUD]` Clicar em sugestão de regra → preenche campo e salva
10. `[UI]` Toggle desativar grupo → webhook ignora mensagens desse grupo

---

### Módulo 5 — Geração de Resumos (LLM)

**Escopo:**
- Edge Function `generate-summary` que:
  1. Busca mensagens do período filtrando `from_me AND was_sent_by_api`
  2. Busca admins de `group_participants` para badge "Mentor"
  3. Busca regras de `group_rules`
  4. Monta prompt com template definido no CLAUDE.md
  5. Chama GPT-4.1 Mini → JSON estruturado
  6. Salva em `summaries`, `discussions`, `pending_items`
- Cálculos SQL: atividade por hora, participantes ativos, pico, contagem
- Cálculo de tempo médio de resposta via `quoted_message_id`
- Cálculo de badges: Mentor (admin), Engajado (4-10 msgs), Super Engajado (11+)
- Botão "Analisar" no dashboard chama on-demand
- Botão "Regerar" no dashboard regenera resumo existente

**Testes de Validação:**
1. `[LLM]` Enviar 20 mensagens de teste (mix de perguntas, respostas, links) → `generate-summary` retorna JSON válido com todos os campos
2. `[LLM]` JSON retornado contém `topicos` com status correto (pergunta com resposta = resolved, sem = pending)
3. `[LLM]` Badges corretos: admin do grupo = "mentor", 5 mensagens = "engajado", 15 mensagens = "super_engajado"
4. `[SQL]` Atividade por hora retorna 24 slots com contagens corretas
5. `[SQL]` Contagem de participantes exclui mensagens `from_me AND was_sent_by_api`
6. `[SQL]` Tempo médio de resposta: inserir pergunta às 10:00, resposta (quoted) às 10:04 → média = 4min
7. `[DB]` Após gerar: registro em `summaries`, registros em `discussions`, registros em `pending_items`
8. `[LLM]` Sentimento retorna 3 valores que somam 100
9. `[UI]` Botão "Analisar" no dashboard dispara geração e exibe resultado
10. `[UI]` Botão "Regerar" sobrescreve resumo anterior mantendo mesmo `period_start/end`
11. `[LLM]` Regras de análise do grupo alteram o foco do resumo (ex: regra "foque em vendas" → tópicos de vendas priorizados)

---

### Módulo 6 — Dashboard de Resumos

**Escopo:**
- Página `/summaries`: resumos diários com navegação por data e seletor de grupo
- Seção de resumo geral (texto)
- Cards de métricas: mensagens, participantes, pico, resp. média
- Barra de resolução de dúvidas (% com progresso)
- Barras de sentimento (positivo/neutro/negativo)
- Gráfico de atividade por hora (barras)
- Top contribuidores com badges e contagens
- Lista de tópicos discutidos com contagem de mensagens
- Pendências (informativo, sem ação)
- Destaques e recursos compartilhados
- Toast "Resumo gerado com sucesso!"

**Testes de Validação:**
1. `[UI]` Navegar entre datas → carrega resumo correto
2. `[UI]` Seletor de grupo filtra resumos por grupo
3. `[UI]` Data sem resumo → exibe empty state "Nenhum resumo disponível"
4. `[UI]` Cards de métricas exibem valores do `summary_json`
5. `[UI]` Barras de sentimento: larguras proporcionais, cores corretas (verde/cinza/vermelho)
6. `[UI]` Gráfico de atividade por hora renderiza 24 barras
7. `[UI]` Top contribuidores: badges "Mentor" (ícone coroa), "Engajado" (ícone fogo), "Super Engajado" exibidos corretamente
8. `[UI]` Pendências listadas com nome do responsável quando atribuído
9. `[UI]` Recursos compartilhados com links clicáveis
10. `[UI]` Layout responsivo: mobile mantém legibilidade

---

### Módulo 7 — Análise de Grupo Individual (Discussões)

**Escopo:**
- Na página `/groups/:id`, exibir discussões identificadas pelo LLM
- Card de discussão: título, descrição, status (resolved ✅ / pending ⏳), contagem de mensagens
- Expandir discussão → mostra mensagens originais do grupo agrupadas
- Mensagens exibem: avatar/iniciais do sender, nome, hora, texto, quote (se houver)
- Contador "X discussões · Y pendente(s)"

**Testes de Validação:**
1. `[UI]` Após análise, discussões aparecem como cards
2. `[UI]` Status resolved mostra ícone verde, pending mostra ícone amarelo
3. `[UI]` Expandir card → mensagens originais listadas em ordem cronológica
4. `[UI]` Mensagem com quote mostra referência visual à mensagem citada
5. `[UI]` Contador no topo reflete quantidade correta
6. `[UI]` Sem análise → empty state com botão "Analisar"

---

### Módulo 8 — Chat com Contexto

**Escopo:**
- Botão "Chat com contexto" na página de grupo individual
- Abre interface de chat (drawer ou modal)
- Contexto injetado: mensagens do período selecionado + knowledge base (RAG) + regras de análise
- Edge Function `chat-with-context`: recebe mensagem do user, busca contexto, chama GPT-4.1 Mini
- Histórico mantido em `chat_sessions` (jsonb com array de messages)
- Streaming da resposta (SSE)

**Testes de Validação:**
1. `[UI]` Botão "Chat com contexto" abre interface de chat
2. `[CHAT]` Enviar pergunta sobre o grupo → resposta relevante baseada nas mensagens do período
3. `[CHAT]` Resposta considera knowledge base (ex: perguntar sobre algo que está em documento uploaded)
4. `[CHAT]` Resposta considera regras de análise do grupo
5. `[CHAT]` Histórico de conversa mantido — segunda pergunta tem contexto da primeira
6. `[CHAT]` Fechar e reabrir chat → histórico preservado (sessão no banco)
7. `[STREAM]` Resposta aparece em streaming (palavra por palavra)
8. `[DB]` Sessão salva em `chat_sessions` com mensagens corretas

---

### Módulo 9 — Knowledge Base + RAG

**Escopo:**
- Página `/knowledge` com lista de documentos por grupo
- Upload de PDF/docs → Supabase Storage
- Edge Function `upload-knowledge`: extrai texto, gera embedding (text-embedding-3-small), salva com pgvector
- Busca por similaridade usado no `generate-summary` e `chat-with-context`
- Delete de documento (remove Storage + registro + embedding)

**Testes de Validação:**
1. `[UPLOAD]` Upload de PDF → arquivo no Storage, registro em `knowledge_base` com embedding preenchido
2. `[UPLOAD]` Upload de .txt → processado corretamente
3. `[RAG]` Query de similaridade retorna documentos relevantes (inserir doc sobre "vendas", buscar "vendas" → retorna)
4. `[RAG]` Query de similaridade NÃO retorna documentos irrelevantes
5. `[RAG]` Knowledge base aparece no contexto do resumo gerado
6. `[RAG]` Knowledge base aparece no contexto do chat
7. `[DELETE]` Deletar documento → removido do Storage, do banco e embedding
8. `[UI]` Lista de documentos mostra título, data, botão deletar
9. `[DB]` Embedding tem dimensão 1536 (text-embedding-3-small)

---

### Módulo 10 — Cron + Envio de Resumo no Grupo

**Escopo:**
- pg_cron job ou Supabase scheduled Edge Function que roda à meia-noite (horário de Brasília)
- Para cada grupo ativo: chama `generate-summary` com `period_type = today`
- Após gerar, chama `send-summary-to-group` que formata em WhatsApp markdown e envia via UAZAPI
- Marca `sent_to_group = true` no resumo
- Edge Function `send-summary-to-group` também disponível via botão no dashboard

**Testes de Validação:**
1. `[CRON]` Simular execução do cron → resumo gerado para cada grupo ativo
2. `[CRON]` Grupo inativo → não gera resumo
3. `[CRON]` Grupo sem mensagens no dia → não gera resumo (ou gera com "Nenhuma atividade")
4. `[SEND]` Resumo enviado no grupo via UAZAPI com formatação WhatsApp correta (* para bold, _ para itálico)
5. `[SEND]` `sent_to_group` marcado como `true` após envio bem-sucedido
6. `[SEND]` Falha de envio → `sent_to_group` permanece `false`, erro logado
7. `[SEND]` Botão manual no dashboard → envia resumo e atualiza status
8. `[FORMAT]` Resumo enviado segue exatamente o template do CLAUDE.md (emojis, seções, formatação)
9. `[TZ]` Cron respeita fuso horário America/Sao_Paulo

---

### Módulo 11 — Equipe + Permissões

**Escopo:**
- Página `/team`: lista de membros, convite por email
- Roles: Admin (acesso total), Editor (ver resumos, analisar, chat — sem configurar integrações/equipe)
- Admin pode: CRUD membros, configurar UAZAPI, gerenciar grupos, tudo
- Editor pode: ver grupos, ver resumos, analisar, chat com contexto, gerenciar regras e knowledge
- Editor NÃO pode: configurar integrações (UAZAPI/OpenAI), gerenciar equipe

**Testes de Validação:**
1. `[AUTH]` Admin acessa página de equipe → lista membros
2. `[AUTH]` Editor acessa página de equipe → acesso negado ou redirect
3. `[AUTH]` Admin convida novo membro → email enviado, registro criado com role
4. `[AUTH]` Editor acessa configurações de UAZAPI → bloqueado
5. `[AUTH]` Editor acessa resumos e chat → permitido
6. `[AUTH]` Editor gerencia regras de análise → permitido
7. `[RLS]` Policies refletem roles: editor não consegue UPDATE em `uazapi_config`

---

### Módulo 12 — Polish + Edge Cases

**Escopo:**
- Loading states em todas as operações assíncronas
- Error handling com toasts informativos
- Empty states em todas as páginas
- Responsividade mobile
- Retry em falhas de API (UAZAPI, OpenAI)
- Rate limiting no webhook
- Sanitização de dados do webhook (XSS, injection)
- Logs de erro em tabela `error_logs` para debug

**Testes de Validação:**
1. `[UX]` Toda operação assíncrona mostra loading spinner/skeleton
2. `[UX]` Erro de API → toast com mensagem clara, não crash
3. `[UX]` Páginas sem dados → empty state com CTA relevante
4. `[UX]` Mobile: sidebar colapsa, tabelas scrollam horizontalmente
5. `[SEC]` Payload do webhook com `<script>` em `text` → sanitizado antes de exibir
6. `[SEC]` Webhook sem auth header válido → rejeitado com 401
7. `[RETRY]` Falha na OpenAI → retry 3x com backoff exponencial
8. `[PERF]` Dashboard com 1000+ mensagens → carrega em < 3s
9. `[LOG]` Erros logados em `error_logs` com timestamp, function_name, payload, error_message

---

### Ordem de Execução

```
Módulo 1  → Módulo 2  → Módulo 3  → Módulo 4
(fundação)  (onboarding) (webhook)   (UI grupos)
                                        ↓
Módulo 5  → Módulo 6  → Módulo 7  → Módulo 8
(LLM)      (dashboard)  (discussões) (chat)
                                        ↓
Módulo 9  → Módulo 10 → Módulo 11 → Módulo 12
(knowledge) (cron+envio) (equipe)    (polish)
```

**Regra:** NÃO avançar para o módulo seguinte até que TODOS os testes de validação do módulo atual passem.
