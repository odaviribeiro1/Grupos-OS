-- ============================================================================
-- Migration 0004: config compartilhada
--
-- Mudanças:
--   1. Troca a RLS policy de "cada user vê só a sua config" para "qualquer
--      user autenticado vê e edita a config compartilhada". O modelo evoluiu
--      para uma única config por instância da aplicação, compartilhada por
--      toda a equipe (owner + admins + editors + members).
-- ============================================================================

set search_path to grupos, public;

-- 2. RLS: substituir policy por uma compartilhada
drop policy if exists uazapi_config_owner_all on grupos.uazapi_config;
drop policy if exists uazapi_config_team_all on grupos.uazapi_config;

create policy uazapi_config_team_all on grupos.uazapi_config
  for all
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
