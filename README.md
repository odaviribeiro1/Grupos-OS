# GrupOS

Plataforma self-hosted para análise de grupos do WhatsApp. Recebe mensagens via UAZAPI, gera resumos com OpenAI e responde dúvidas sobre o conteúdo dos grupos via busca semântica.

## O que você consegue fazer

- Monitorar grupos do WhatsApp em tempo real.
- Resumir conversas por período com OpenAI.
- Enviar resumos de volta para o grupo.
- Conversar com o histórico do grupo usando RAG.
- Manter uma knowledge base com PDFs/textos.
- Convidar membros para o painel.

## Setup Para Alunos

O setup não usa terminal, edição de arquivos ou Claude Code.

1. Acesse o painel Agentise e siga o fluxo para copiar o template para seu GitHub.
2. Importe o projeto na Vercel.
3. Abra a URL deployada.
4. Siga o wizard em `/setup`.

O wizard coleta as credenciais, aplica migrations no Supabase, faz deploy das Edge Functions, configura as envs core na Vercel, dispara redeploy e salva as credenciais da aplicação criptografadas no Supabase do aluno.

Mais detalhes ficam no painel Agentise.

## Variáveis de Ambiente

Em produção, as envs core são preenchidas automaticamente pelo wizard:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRYPTO_KEY`

Não coloque credenciais de aplicação na Vercel. OpenAI, UAZAPI, Resend e similares ficam em `app_settings`, criptografadas com `CRYPTO_KEY`.

Não delete `CRYPTO_KEY` manualmente na Vercel. Sem essa chave, as credenciais já salvas em `app_settings` não podem ser decriptadas.

## Desenvolvimento Local

```bash
npm install
npm run dev
```

Para desenvolvimento local, você pode preencher `.env.local` com as quatro envs core acima.

## Stack

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Supabase Postgres, Auth, Storage e Edge Functions
- Deploy: Vercel
- WhatsApp: UAZAPI
- IA: OpenAI

## Estrutura

```text
grupOS/
├── api/                   # Vercel Serverless Functions
├── src/                   # App React
├── supabase/
│   ├── migrations/        # SQL do schema e infra de setup
│   └── functions/         # Edge Functions Deno
├── setup.config.ts        # Manifesto de credenciais da ferramenta
└── .env.example           # Template das envs core
```

## Licença

MIT
