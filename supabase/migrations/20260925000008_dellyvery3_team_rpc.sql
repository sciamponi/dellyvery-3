-- DELLVERY 3 — Team listing RPC (FASE 5.5 ETAPA B1, local only)
-- Migration só-função: nenhuma tabela/coluna/policy alterada.
-- A empresa NUNCA é confiada do frontend: deriva de auth.uid() +
-- company_members ativos. p_company_id opcional só filtra dentro das
-- empresas do próprio usuário; qualquer outra é rejeitada.
-- Retorna somente membros + profile básico das PRÓPRIAS empresas.
-- profiles_select_own intacta; sem acesso anon.
create or replace function list_team(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_ids uuid[];
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(array_agg(distinct company_id), '{}') into v_company_ids
  from public.company_members
  where user_id = v_actor and active = true;

  if p_company_id is not null then
    if not (p_company_id = any (v_company_ids)) then
      raise exception 'Empresa não encontrada ou sem permissão';
    end if;
    v_company_ids := array[p_company_id];
  end if;

  if v_company_ids = '{}' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'company_id', m.company_id,
      'user_id', m.user_id,
      'role', m.role,
      'active', m.active,
      'created_at', m.created_at,
      'name', p.name,
      'email', p.email,
      'phone', p.phone
    ) order by m.created_at)
    from public.company_members m
    left join public.profiles p on p.id = m.user_id
    where m.company_id = any (v_company_ids)
  ), '[]'::jsonb);
end;
$$;

revoke all on function list_team(uuid) from public;
-- Default privileges do banco concedem EXECUTE a anon em funções novas;
-- revogar explicitamente (sem acesso anon).
revoke all on function list_team(uuid) from anon;
grant execute on function list_team(uuid) to authenticated;
