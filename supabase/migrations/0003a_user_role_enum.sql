-- ============================================================================
-- Migration 0003a: adicionar valores 'owner' e 'member' ao enum user_role
--
-- Precisa estar em um arquivo separado porque Postgres exige que novos
-- valores de enum sejam commitados antes de poderem ser usados em queries
-- posteriores (DDL/DML que referenciam o valor). A migração 0003b usa
-- 'member'/'owner' em DEFAULT e em policies — por isso a divisão.
-- ============================================================================

alter type grupos.user_role add value if not exists 'owner';
alter type grupos.user_role add value if not exists 'member';
