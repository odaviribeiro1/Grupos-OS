# Contributing

Obrigado por contribuir com o GrupOS!

## Customizando sem conflitos

Toda customização que você fizer no seu fork deve ficar em `src/customizations/`. Esse diretório é "zona livre" — o upstream nunca edita nada lá. Garante que `git sync fork` (ou `git pull` do upstream) não gere conflito.

Para mais detalhes, leia [`src/customizations/README.md`](./src/customizations/README.md).

## Convenção de commits

Mensagens curtas, em pt-BR, lowercase, no máximo 50 caracteres, prefixadas pelo tipo:

| Tipo | Exemplo |
|---|---|
| Nova feature | `feat: chat realtime` |
| Bug fix | `fix: race condition no dispatcher` |
| Documentação | `docs: setup via claude code` |
| Refatoração | `refactor: extrai hook useTenant` |
| Teste | `test: smoke test e2e` |
| Chore (deps, config, infra) | `chore: atualiza deps` |

Sem corpo descritivo expandido na maioria dos casos. Corpo expandido apenas em commits de migração estrutural ou hotfixes complexos onde o "porquê" precisa ficar registrado.

## Pull requests

1. Fork o repositório.
2. Crie uma branch a partir de `main`: `git checkout -b feat/minha-feature`.
3. Faça suas mudanças com commits enxutos.
4. Rode `npm run typecheck` e `npm run build` localmente.
5. Abra PR no upstream com título e descrição claros.

## Reportar bugs

Abra issue no repositório upstream com:
- Versão do projeto (commit hash ou tag)
- Passos para reproduzir
- Comportamento esperado vs. observado
- Logs relevantes (Supabase Edge Function, Vercel, console do browser)
