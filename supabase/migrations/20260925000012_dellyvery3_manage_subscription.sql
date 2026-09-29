-- DELLVERY 3 — manage_subscription RPC (ONDA 3, local only)
-- Migration só-função: nenhuma tabela/coluna/policy/dado alterado.
-- A empresa NUNCA é confiada do frontend: deriva de auth.uid() +
-- company_members ativos com role OWNER/ADMIN. Somente essas roles podem
-- alterar assinatura; demais membros têm leitura via RLS (member read).
-- expires_at/created_at/company_id nunca são recalculados pela troca de
-- plano: sem evidência de que o fluxo antigo o fazia, a validade atual é
-- preservada (cancelamento mantém acesso até expires_at).
create or replace function manage_subscription(p_action text, p_plan_id uuid default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_member_count int;
  v_sub public.subscriptions%rowtype;
  v_plan_active boolean;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if p_action is null or p_action not in ('upgrade', 'cancel', 'reactivate') then
    raise exception 'Ação inválida';
  end if;

  select company_id into v_company_id
  from public.company_members
  where user_id = v_actor and active = true and role in ('OWNER', 'ADMIN')
  limit 1;

  if v_company_id is null then
    -- Distingue sem-membership de sem-permissão sem vazar dados.
    perform 1 from public.company_members
    where user_id = v_actor and active = true limit 1;
    if found then
      raise exception 'Apenas OWNER ou ADMIN pode alterar a assinatura';
    else
      raise exception 'Empresa não encontrada ou sem permissão';
    end if;
  end if;

  -- Múltiplas empresas com poder de assinatura: sem escolha vinda do
  -- frontend, não há como decidir — erro controlado em vez de adivinhar.
  select count(*) into v_member_count
  from public.company_members
  where user_id = v_actor and active = true and role in ('OWNER', 'ADMIN');
  if v_member_count > 1 then
    raise exception 'Múltiplas empresas: selecione a empresa antes de alterar a assinatura';
  end if;

  select * into v_sub
  from public.subscriptions
  where company_id = v_company_id;

  if not found then
    raise exception 'Assinatura não encontrada';
  end if;

  if p_action = 'upgrade' then
    if p_plan_id is null then
      raise exception 'Plano não informado';
    end if;
    select active into v_plan_active
    from public.plans
    where id = p_plan_id;
    if not found then
      raise exception 'Plano não encontrado';
    end if;
    if not v_plan_active then
      raise exception 'Plano indisponível';
    end if;
    update public.subscriptions
    set plan_id = p_plan_id,
        status = case when status = 'trial' then 'ativo'::public.subscription_status else status end
    where company_id = v_company_id
    returning * into v_sub;
  elsif p_action = 'cancel' then
    if v_sub.status = 'cancelado' then
      raise exception 'Assinatura já cancelada';
    end if;
    if v_sub.status not in ('trial', 'ativo', 'pendente') then
      raise exception 'Assinatura não pode ser cancelada neste estado';
    end if;
    update public.subscriptions
    set status = 'cancelado'
    where company_id = v_company_id
    returning * into v_sub;
  else -- reactivate
    if v_sub.status <> 'cancelado' then
      raise exception 'Somente assinatura cancelada pode ser reativada';
    end if;
    if v_sub.expires_at is not null and v_sub.expires_at <= now() then
      raise exception 'Assinatura expirada não pode ser reativada';
    end if;
    update public.subscriptions
    set status = 'ativo'
    where company_id = v_company_id
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

revoke all on function manage_subscription(text, uuid) from public;
-- Default privileges do banco concedem EXECUTE a anon em funções novas;
-- revogar explicitamente (sem acesso anon).
revoke all on function manage_subscription(text, uuid) from anon;
grant execute on function manage_subscription(text, uuid) to authenticated;
