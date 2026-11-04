alter table public.platform_settings
  add column if not exists credit_order_expiry_days integer;

alter table public.platform_settings
  drop constraint if exists platform_settings_credit_order_expiry_days_check;

alter table public.platform_settings
  add constraint platform_settings_credit_order_expiry_days_check
  check (credit_order_expiry_days is null or credit_order_expiry_days > 0);

update public.platform_settings
set credit_order_expiry_days = 1
where id = true and credit_order_expiry_days is null;

alter table public.platform_settings
  alter column credit_order_expiry_days set default 1;

create or replace function public.set_credit_order_expiry_days(p_days integer)
returns public.platform_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old integer;
  v_row public.platform_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas PLATFORM_ADMIN pode alterar a validade dos pedidos';
  end if;
  if p_days is not null and p_days <= 0 then
    raise exception 'Dias de validade devem ser um inteiro maior que zero';
  end if;

  select credit_order_expiry_days into v_old
  from public.platform_settings
  where id = true
  for update;

  update public.platform_settings
  set credit_order_expiry_days = p_days,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'credit_order_expiry_days_updated', 'platform_settings', null,
    jsonb_build_object('old_days', v_old, 'new_days', p_days)
  );

  return v_row;
end;
$$;

alter table public.reseller_credit_orders
  add column if not exists confirmed_amount numeric(10,2);

alter table public.reseller_credit_orders
  add column if not exists pending_expires_at timestamptz;

alter table public.reseller_credit_orders
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null;

alter table public.reseller_credit_orders
  add column if not exists rejected_at timestamptz;

alter table public.reseller_credit_orders
  add column if not exists rejection_reason text not null default '';

alter table public.reseller_credit_orders
  add column if not exists expired_at timestamptz;

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_confirmed_amount_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_confirmed_amount_check
  check (confirmed_amount is null or confirmed_amount >= 0);

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_status_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_status_check
  check (status in ('pendente', 'creditado', 'cancelado', 'rejeitado', 'expirado'));

update public.reseller_credit_orders
set confirmed_amount = amount
where status = 'creditado' and confirmed_amount is null;

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_credited_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_credited_check
  check (
    status <> 'creditado'
    or (paid_at is not null and credited_at is not null and confirmed_amount is not null)
  );

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_rejected_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_rejected_check
  check (
    status <> 'rejeitado'
    or (rejected_by is not null and rejected_at is not null and btrim(rejection_reason) <> '')
  );

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_expired_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_expired_check
  check (status <> 'expirado' or expired_at is not null);

update public.reseller_credit_orders o
set pending_expires_at = o.created_at + make_interval(days => s.credit_order_expiry_days)
from public.platform_settings s
where s.id = true
  and s.credit_order_expiry_days is not null
  and o.status = 'pendente'
  and o.pending_expires_at is null;

do $$
begin
  if exists (
    select 1
    from public.reseller_credit_orders
    where status = 'pendente'
    group by reseller_id
    having count(*) > 1
  ) then
    raise exception 'Existem pedidos pendentes duplicados por revendedor; resolva antes de aplicar a constraint';
  end if;
end;
$$;

create unique index if not exists uq_reseller_credit_orders_pending_reseller
  on public.reseller_credit_orders (reseller_id)
  where status = 'pendente';

create index if not exists idx_reseller_credit_orders_pending_expiry
  on public.reseller_credit_orders (pending_expires_at)
  where status = 'pendente';

create or replace function public.expire_reseller_credit_orders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.reseller_credit_orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    update public.reseller_credit_orders
    set status = 'expirado',
        expired_at = now()
    where status = 'pendente'
      and pending_expires_at is not null
      and pending_expires_at <= now()
    returning *
  loop
    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      null, null, 'reseller_credit_order_expired', 'reseller_credit_order', v_order.id,
      jsonb_build_object(
        'reseller_id', v_order.reseller_id,
        'previous_status', 'pendente',
        'new_status', 'expirado',
        'pending_expires_at', v_order.pending_expires_at
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.create_reseller_credit_order(
  p_package_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_package public.reseller_credit_packages%rowtype;
  v_order public.reseller_credit_orders%rowtype;
  v_pending public.reseller_credit_orders%rowtype;
  v_snapshot jsonb;
  v_expiry_days integer;
  v_pending_expires_at timestamptz;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_package_id is null then
    raise exception 'Pacote nao informado';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotencia obrigatoria';
  end if;

  perform public.expire_reseller_credit_orders();

  select *
  into v_order
  from public.reseller_credit_orders
  where reseller_id = v_reseller_id
    and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'package_id', v_order.package_id,
      'package_name', v_order.package_name,
      'pending_expires_at', v_order.pending_expires_at,
      'reused', true
    );
  end if;

  select *
  into v_pending
  from public.reseller_credit_orders
  where reseller_id = v_reseller_id
    and status = 'pendente'
  for update;

  if found then
    raise exception 'Ja existe um pedido pendente para este revendedor';
  end if;

  select *
  into v_package
  from public.reseller_credit_packages
  where id = p_package_id
    and active = true
  for share;

  if not found then
    raise exception 'Pacote indisponivel';
  end if;

  select credit_order_expiry_days into v_expiry_days
  from public.platform_settings
  where id = true;

  v_pending_expires_at := case
    when v_expiry_days is null then null
    else now() + make_interval(days => v_expiry_days)
  end;

  v_snapshot := jsonb_build_object(
    'id', v_package.id,
    'name', v_package.name,
    'description', v_package.description,
    'credits', v_package.credits,
    'price', v_package.price,
    'currency', v_package.currency,
    'captured_at', now()
  );

  begin
    insert into public.reseller_credit_orders (
      reseller_id, package_id, package_name, package_snapshot,
      credits, amount, currency, idempotency_key, pending_expires_at, created_by
    )
    values (
      v_reseller_id, v_package.id, v_package.name, v_snapshot,
      v_package.credits, v_package.price, v_package.currency,
      p_idempotency_key, v_pending_expires_at, auth.uid()
    )
    returning * into v_order;
  exception when unique_violation then
    select *
    into v_order
    from public.reseller_credit_orders
    where reseller_id = v_reseller_id
      and idempotency_key = p_idempotency_key;

    if found then
      return jsonb_build_object(
        'order_id', v_order.id,
        'status', v_order.status,
        'credits', v_order.credits,
        'amount', v_order.amount,
        'currency', v_order.currency,
        'package_id', v_order.package_id,
        'package_name', v_order.package_name,
        'pending_expires_at', v_order.pending_expires_at,
        'reused', true
      );
    end if;

    select *
    into v_pending
    from public.reseller_credit_orders
    where reseller_id = v_reseller_id
      and status = 'pendente';

    if found then
      raise exception 'Ja existe um pedido pendente para este revendedor';
    end if;

    raise;
  end;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_order_created', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', v_reseller_id,
      'package_id', v_order.package_id,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'pending_expires_at', v_order.pending_expires_at
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'credits', v_order.credits,
    'amount', v_order.amount,
    'currency', v_order.currency,
    'package_id', v_order.package_id,
    'package_name', v_order.package_name,
    'pending_expires_at', v_order.pending_expires_at,
    'reused', false
  );
end;
$$;

drop function if exists public.confirm_reseller_credit_order(uuid, text);

create or replace function public.confirm_reseller_credit_order(
  p_order_id uuid,
  p_confirmed_amount numeric,
  p_payment_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.reseller_credit_orders%rowtype;
  v_entry_id uuid;
  v_balance integer;
  v_reference text;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;
  if p_order_id is null then
    raise exception 'Pedido nao informado';
  end if;
  if p_confirmed_amount is null then
    raise exception 'Valor confirmado obrigatorio';
  end if;
  if p_confirmed_amount < 0 then
    raise exception 'Valor confirmado invalido';
  end if;

  v_reference := nullif(btrim(p_payment_reference), '');
  if v_reference is null then
    raise exception 'Referencia de pagamento obrigatoria';
  end if;

  perform public.expire_reseller_credit_orders();

  select *
  into v_order
  from public.reseller_credit_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido nao encontrado';
  end if;

  if v_order.status = 'creditado' then
    select id
    into v_entry_id
    from public.reseller_credit_entries
    where purchase_order_id = v_order.id;

    select coalesce(sum(amount), 0)::integer
    into v_balance
    from public.reseller_credit_entries
    where reseller_id = v_order.reseller_id;

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'entry_id', v_entry_id,
      'credits', v_order.credits,
      'confirmed_amount', v_order.confirmed_amount,
      'balance', coalesce(v_balance, 0),
      'reused', true
    );
  end if;

  if v_order.status = 'expirado' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_order.status <> 'pendente' then
    raise exception 'Somente pedidos pendentes podem ser confirmados';
  end if;

  if v_order.pending_expires_at is not null and v_order.pending_expires_at <= now() then
    update public.reseller_credit_orders
    set status = 'expirado',
        expired_at = now()
    where id = v_order.id
    returning * into v_order;

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      null, null, 'reseller_credit_order_expired', 'reseller_credit_order', v_order.id,
      jsonb_build_object(
        'reseller_id', v_order.reseller_id,
        'previous_status', 'pendente',
        'new_status', 'expirado',
        'pending_expires_at', v_order.pending_expires_at
      )
    );

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'expired', true,
      'reused', false
    );
  end if;

  if p_confirmed_amount <> v_order.amount then
    raise exception 'Valor confirmado divergente do valor do pedido';
  end if;

  insert into public.reseller_credit_entries (
    reseller_id, purchase_order_id, kind, amount, reason, created_by
  )
  values (
    v_order.reseller_id, v_order.id, 'compra', v_order.credits,
    'Compra de ' || v_order.credits || ' creditos - ' || v_order.package_name,
    auth.uid()
  )
  returning id into v_entry_id;

  update public.reseller_credit_orders
  set status = 'creditado',
      payment_reference = v_reference,
      confirmed_amount = p_confirmed_amount,
      confirmed_by = auth.uid(),
      paid_at = now(),
      credited_at = now()
  where id = v_order.id
  returning * into v_order;

  select coalesce(sum(amount), 0)::integer
  into v_balance
  from public.reseller_credit_entries
  where reseller_id = v_order.reseller_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_order_confirmed', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', v_order.reseller_id,
      'entry_id', v_entry_id,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'confirmed_amount', v_order.confirmed_amount,
      'currency', v_order.currency,
      'balance', v_balance,
      'payment_reference', v_order.payment_reference
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'entry_id', v_entry_id,
    'credits', v_order.credits,
    'confirmed_amount', v_order.confirmed_amount,
    'balance', v_balance,
    'reused', false
  );
end;
$$;

create or replace function public.reject_reseller_credit_order(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.reseller_credit_orders%rowtype;
  v_reason text;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;
  if p_order_id is null then
    raise exception 'Pedido nao informado';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'Motivo da rejeicao obrigatorio';
  end if;

  perform public.expire_reseller_credit_orders();

  select *
  into v_order
  from public.reseller_credit_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido nao encontrado';
  end if;

  if v_order.status = 'rejeitado' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'rejection_reason', v_order.rejection_reason,
      'reused', true
    );
  end if;

  if v_order.status = 'expirado' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_order.status <> 'pendente' then
    raise exception 'Somente pedidos pendentes podem ser rejeitados';
  end if;

  if v_order.pending_expires_at is not null and v_order.pending_expires_at <= now() then
    update public.reseller_credit_orders
    set status = 'expirado',
        expired_at = now()
    where id = v_order.id
    returning * into v_order;

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      null, null, 'reseller_credit_order_expired', 'reseller_credit_order', v_order.id,
      jsonb_build_object(
        'reseller_id', v_order.reseller_id,
        'previous_status', 'pendente',
        'new_status', 'expirado',
        'pending_expires_at', v_order.pending_expires_at
      )
    );

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'expired', true,
      'reused', false
    );
  end if;

  update public.reseller_credit_orders
  set status = 'rejeitado',
      rejected_by = auth.uid(),
      rejected_at = now(),
      rejection_reason = v_reason
  where id = v_order.id
  returning * into v_order;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_order_rejected', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', v_order.reseller_id,
      'previous_status', 'pendente',
      'new_status', 'rejeitado',
      'reason', v_order.rejection_reason
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'rejection_reason', v_order.rejection_reason,
    'reused', false
  );
end;
$$;

revoke all on function public.create_reseller_credit_order(uuid, uuid)
  from public, anon;
grant execute on function public.create_reseller_credit_order(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.set_credit_order_expiry_days(integer)
  from public, anon;
grant execute on function public.set_credit_order_expiry_days(integer)
  to authenticated, service_role;

revoke all on function public.expire_reseller_credit_orders()
  from public, anon;
grant execute on function public.expire_reseller_credit_orders()
  to authenticated, service_role;

revoke all on function public.confirm_reseller_credit_order(uuid, numeric, text)
  from public, anon;
grant execute on function public.confirm_reseller_credit_order(uuid, numeric, text)
  to authenticated, service_role;

revoke all on function public.reject_reseller_credit_order(uuid, text)
  from public, anon;
grant execute on function public.reject_reseller_credit_order(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
