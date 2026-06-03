# Issue 002 — Wizard não hidrata de `_bootstrap_state` nem faz polling do redeploy

- **Severidade:** 🟡 atenção (UX / robustez do setup)
- **Origem:** Auditoria Prompt 3 (achados E.7 e I.3)
- **Escopo:** fora do Prompt 4 (é redesign do wizard, não as 3 correções de segurança)
- **Status:** aberto

## Problema

Dois gaps relacionados no wizard de setup (`src/pages/setup/SetupPage.tsx`):

1. **Step 3 não hidrata a timeline de `_bootstrap_state`.** A timeline de progresso é
   alimentada apenas pela resposta do `POST /api/bootstrap` (`data.steps_completed`).
   Não há `GET` que leia `_bootstrap_state`. Em refresh durante o Step 3, o wizard
   volta ao Step 1 (`initialStep` só honra `?step=4`) e a timeline zera — não há
   "retomar de onde parou com ✓".

2. **Sem polling do redeploy.** Após o bootstrap, o código faz
   `window.location.href = "/setup?step=4"` imediatamente, sem esperar o redeploy
   da Vercel ficar `READY`.

## Impacto (importante — condiciona o Step 4)

As envs do client são `VITE_*`, assadas no build. Na primeira execução, o app roda
com client placeholder e sem `AuthProvider` até o redeploy ficar live. Como o reload
para o Step 4 pode cair no deployment **antigo** (ainda sem envs), o login do Step 4
(`signInWithPassword`) só funciona quando o novo deployment está no ar e o aluno dá
refresh. Sem polling, o aluno pode ver erro de login transitório e precisar recarregar
manualmente.

> Nota: o fallback de login manual no Step 4 (adicionado no Prompt 4) já trata o caso
> "sem sessão" de forma amigável; o que falta é o wizard **aguardar/sinalizar** o
> redeploy e **retomar** o estado a partir de `_bootstrap_state`.

## Correção sugerida

- Expor um endpoint (ou reusar `/api/bootstrap` em modo leitura) que retorne os steps
  de `_bootstrap_state`; hidratar a timeline no mount do Step 3.
- Fazer o Step 3 fazer polling do deployment Vercel até `READY` antes de avançar; ou
  exibir "aguardando reinício" com retry/refresh automático.
- Persistir o step atual (não-sensível) para retomar após refresh.

## Critério de pronto

- Fechar a aba durante o Step 3 e reabrir `/setup` → timeline mostra ✓ nos steps já
  concluídos (lidos de `_bootstrap_state`) e retoma do pendente; senha do owner é
  re-solicitada (não persiste).
- Step 4 só é apresentado após o redeploy estar live (login funciona de primeira).
