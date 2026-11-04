-- Endurecimento de seguranca da revenda.
--
-- Corrige, sem editar as migrations historicas:
--   1. escrita direta de campos de vinculo/empresa em reseller_clients;
--   2. ativacao/renovacao de cliente sem convite aceito ou sem vinculo real
--      com a empresa;
--   3. cancelamento de pedido de credito por usuario sem revenda.
--
-- A autorizacao reutiliza os mecanismos existentes: auth.uid(),
-- is_platform_admin(), current_reseller_id(), convites aceitos e
-- company_members. Nao confia apenas em current_user ou no nome da role.

-- =========================
-- 1. Protecao de escrita em reseller_clients
-- =========================
create or replace function public.guard_reseller_client_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trusted boolean;
begin
  v_trusted := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role'
    or public.is_platform_admin();

  if tg_op = 'INSERT' then
    if not v_trusted then
      if new.created_by is distinct from auth.uid() then
        raise exception 'Autor do cadastro nao pode ser alterado';
      end if;
      if new.user_id is not null
         or new.company_id is not null
         or new.activated_at is not null
         or new.access_expires_at is not null then
        raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
      end if;
    end if;
    return new;
  end if;

  if new.reseller_id is distinct from old.reseller_id then
    raise exception 'Revendedor do cliente nao pode ser alterado';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Autor do cadastro nao pode ser alterado';
  end if;

  if not v_trusted and (
    new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id
    or new.activated_at is distinct from old.activated_at
    or new.access_expires_at is distinct from old.access_expires_at
  ) then
    raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reseller_client_guard on public.reseller_clients;
drop function if exists public.guard_reseller_client_update();

create trigger trg_reseller_client_guard
before insert or update on public.reseller_clients
for each row execute function public.guard_reseller_client_write();

revoke all on function public.guard_reseller_client_write() from public, anon, authenticated;

-- =========================
-- 2. Ativacao/renovacao: preserva o corpo atual em uma funcao interna
--    e valida o fluxo autorizado antes de executar.
-- =========================
do $$
begin
  if to_regprocedure('public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)') is null
     and to_regprocedure('public.activate_reseller_client_v2(uuid,uuid,uuid)') is not null then
    execute 'alter function public.activate_reseller_client_v2(uuid,uuid,uuid) rename to activate_reseller_client_v2_legacy';
  end if;
end;
$$;

revoke all on function public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.activate_reseller_client_v2(
  p_client_id uuid,
  p_plan_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;
  if p_plan_id is null then
    raise exception 'Plano nao informado';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotencia obrigatoria';
  end if;

  -- Replay idempotente deve continuar retornando o resultado original,
  -- mesmo que o cliente tenha sido alterado depois da ativacao.
  if exists (
    select 1
    from public.reseller_activations
    where reseller_id = v_reseller_id
      and idempotency_key = p_idempotency_key
  ) then
    return public.activate_reseller_client_v2_legacy(
      p_client_id, p_plan_id, p_idempotency_key
    );
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = p_client_id
    and reseller_id = v_reseller_id;

  if not found then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;
  if v_client.user_id is null then
    raise exception 'O cliente ainda nao aceitou o convite e criou a conta';
  end if;

  -- O cliente precisa ter aceitado um convite deste mesmo revendedor,
  -- ou ter sido cadastrado por um PLATFORM_ADMIN.
  if not exists (
    select 1
    from public.reseller_client_invites i
    where i.client_id = v_client.id
      and i.reseller_id = v_reseller_id
      and i.status = 'accepted'
      and i.accepted_by = v_client.user_id
  ) and not exists (
    select 1
    from public.profiles p
    where p.id = v_client.created_by
      and p.platform_role = 'PLATFORM_ADMIN'
  ) then
    raise exception 'Cliente sem convite aceito para ativacao';
  end if;

  -- Se a empresa ja existe, o usuario do cliente precisa ser membro ativo
  -- dela. Isso bloqueia ativacao/renovacao de empresa de terceiros.
  if v_client.company_id is not null and not exists (
    select 1
    from public.company_members cm
    where cm.company_id = v_client.company_id
      and cm.user_id = v_client.user_id
      and cm.active = true
  ) then
    raise exception 'Empresa nao pertence ao cliente do revendedor';
  end if;

  return public.activate_reseller_client_v2_legacy(
    p_client_id, p_plan_id, p_idempotency_key
  );
end;
$$;

revoke all on function public.activate_reseller_client_v2(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.activate_reseller_client_v2(uuid,uuid,uuid)
  to authenticated;

-- =========================
-- 3. Cancelamento de pedido: bloqueia usuario sem revenda
-- =========================
do $$
begin
  if to_regprocedure('public.cancel_reseller_credit_order_legacy(uuid,text)') is null
     and to_regprocedure('public.cancel_reseller_credit_order(uuid,text)') is not null then
    execute 'alter function public.cancel_reseller_credit_order(uuid,text) rename to cancel_reseller_credit_order_legacy';
  end if;
end;
$$;

revoke all on function public.cancel_reseller_credit_order_legacy(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.cancel_reseller_credit_order(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_is_admin boolean := public.is_platform_admin();
begin
  if v_is_admin is not true and v_reseller_id is null then
    raise exception 'Pedido nao encontrado ou sem permissao';
  end if;

  return public.cancel_reseller_credit_order_legacy(p_order_id, p_reason);
end;
$$;

revoke all on function public.cancel_reseller_credit_order(uuid,text)
  from public, anon;
grant execute on function public.cancel_reseller_credit_order(uuid,text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
