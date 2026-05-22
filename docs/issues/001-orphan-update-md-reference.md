# Issue 001 — Referência órfã a `UPDATE.md`

- **Severidade:** 🟡 menor (documentação)
- **Origem:** Auditoria Prompt 3 (achado B.2)
- **Escopo:** fora do Prompt 4 (não é segurança) — registrado para correção posterior
- **Status:** aberto

## Problema

`src/customizations/README.md:7` referencia `UPDATE.md`, um arquivo de fluxo legacy
que foi removido na refatoração do Prompt 2. A referência ficou pendurada:

> Quando você puxa atualizações do upstream (via `UPDATE.md`), o Git tenta mesclar...

Como `UPDATE.md` não existe mais, o leitor é mandado para um arquivo inexistente.

## Evidência

```
$ grep -rn -i "update\.md" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .
src/customizations/README.md:7:... (via `UPDATE.md`) ...
```

## Correção sugerida

Reescrever a frase em `src/customizations/README.md` para apontar ao fluxo atual de
atualização (painel Agentise / processo de pull do template) em vez de `UPDATE.md`,
ou remover a parêntese se não houver substituto direto.

## Critério de pronto

`grep -rn -i "update\.md\|start\.md\|setup\.md" --exclude-dir=node_modules .` → zero
matches em arquivos ativos.
