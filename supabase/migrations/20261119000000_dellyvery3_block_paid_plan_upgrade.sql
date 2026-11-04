-- DELLVERY 3 — bloqueia upgrade direto para plano pago.
-- Planos pagos só podem ser ativados pela compra com Pix e confirmação manual
-- do Master. `cancel`, `reactivate` e upgrade para plano gratuito continuam.
create or replace function public.manage_subscription(p_action text, p_plan_id uuid default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_member_count int;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
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
    perform 1 from public.company_members
    where user_id = v_actor and active = true limit 1;
    if found then
      raise exception 'Apenas OWNER ou ADMIN pode alterar a assinatura';
    else
      raise exception 'Empresa não encontrada ou sem permissão';
    end if;
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where company_id = v_company_id
  ) then
    raise exception 'Esta assinatura e gerenciada pelo revendedor. Fale com o revendedor para renovar';
  end if;

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

    select * into v_plan
    from public.plans
    where id = p_plan_id;

    if not found then
      raise exception 'Plano não encontrado';
    end if;
    if not v_plan.active then
      raise exception 'Plano indisponível';
    end if;
    if not coalesce(v_plan.is_free, false) then
      raise exception 'O plano % e pago. Use a compra com Pix e confirmacao de pagamento.', v_plan.name;
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
  else
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

revoke all on function public.manage_subscription(text, uuid) from public;
revoke all on function public.manage_subscription(text, uuid) from anon;
grant execute on function public.manage_subscription(text, uuid) to authenticated;
