-- match_knowledge: busca por similaridade pgvector na base de conhecimento, usada por
-- generate-summary e chat-with-context (supabase.rpc("match_knowledge", {...})).
-- Sem esta função o RAG da base de conhecimento falhava silenciosamente (function not
-- found → try/catch → contexto vazio). O cliente envia query_embedding como string JSON
-- (JSON.stringify(embedding)), então o parâmetro é text e é convertido para vector.

create or replace function grupos.match_knowledge(
  query_embedding text,
  match_group_id uuid,
  match_threshold double precision default 0.5,
  match_count integer default 3
)
returns table (
  id uuid,
  title text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    kb.id,
    kb.title,
    kb.content,
    1 - (kb.embedding <=> query_embedding::vector) as similarity
  from grupos.knowledge_base kb
  where kb.group_id = match_group_id
    and kb.embedding is not null
    and 1 - (kb.embedding <=> query_embedding::vector) > match_threshold
  order by kb.embedding <=> query_embedding::vector
  limit greatest(match_count, 1);
$$;
