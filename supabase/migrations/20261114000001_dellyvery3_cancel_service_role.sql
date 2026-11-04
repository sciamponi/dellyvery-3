-- Preserva o acesso legítimo de service_role ao cancelamento de pedidos de
-- credito, mantendo fechado o bypass de NULL para usuarios authenticated sem
-- revenda.
--
-- Antes: o wrapper rejeitava qualquer chamada sem platform admin ou revenda,
-- inclusive service_role (backend), apesar do grant historico preservado.
-- Depois: service_role (claim do JWT) continua autorizado; authenticated sem
-- revenda continua bloqueado; platform admin continua autorizado.

begin;

create or replace function public.cancel_reseller_credit_order(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_is_admin boolean := public.is_platform_admin();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if v_is_admin is not true
     and v_reseller_id is null
     and v_is_service is not true then
    raise exception 'Pedido nao encontrado ou sem permissao';
  end if;

  return public.cancel_reseller_credit_order_legacy(p_order_id, p_reason);
end;
$$;

alter function public.cancel_reseller_credit_order(uuid,text) owner to postgres;

revoke all on function public.cancel_reseller_credit_order(uuid,text)
  from public, anon, authenticated;
grant execute on function public.cancel_reseller_credit_order(uuid,text)
  to authenticated, service_role;

do $$
begin
  if has_function_privilege('public', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'cancel_reseller_credit_order ainda executavel por PUBLIC';
  end if;
  if has_function_privilege('anon', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'cancel_reseller_credit_order ainda executavel por anon';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'authenticated perdeu EXECUTE em cancel_reseller_credit_order';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'service_role perdeu EXECUTE em cancel_reseller_credit_order';
  end if;
end;
$$;

commit;
