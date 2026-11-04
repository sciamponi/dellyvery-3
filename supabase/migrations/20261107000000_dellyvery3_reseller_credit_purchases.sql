-- DELLVERY 3 — Fase 1 da compra de créditos da revenda.
--
-- Escopo:
--   * catálogo de pacotes gerenciado pelo Master;
--   * pedidos de compra com snapshot imutável do pacote;
--   * confirmação manual exclusiva do Master;
--   * lançamento atômico no ledger existente, com vínculo e idempotência.
--
-- Fora do escopo nesta migration: Pix automático, provedores, QR, webhook,
-- tentativas de cobrança, reembolso e validade de créditos. Nenhuma tabela de
-- ordens/comercial existente é reutilizada.

create table if not exists public.reseller_credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  credits integer not null check (credits > 0),
  price numeric(10,2) not null check (price >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reseller_credit_packages_active
  on public.reseller_credit_packages (active, sort_order, created_at desc);

drop trigger if exists trg_reseller_credit_packages_updated_at on public.reseller_credit_packages;
create trigger trg_reseller_credit_packages_updated_at
before update on public.reseller_credit_packages
for each row execute function public.set_updated_at();

create table if not exists public.reseller_credit_orders (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  package_id uuid not null references public.reseller_credit_packages(id) on delete restrict,
  package_name text not null,
  package_snapshot jsonb not null default '{}',
  credits integer not null check (credits > 0),
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pendente'
    check (status in ('pendente', 'creditado', 'cancelado')),
  idempotency_key uuid not null,
  payment_reference text not null default '',
  confirmed_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  credited_at timestamptz,
  canceled_by uuid references public.profiles(id) on delete set null,
  canceled_at timestamptz,
  cancel_reason text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reseller_credit_orders_idempotency_key
    unique (reseller_id, idempotency_key),
  constraint reseller_credit_orders_credited_check check (
    status <> 'creditado' or (paid_at is not null and credited_at is not null)
  ),
  constraint reseller_credit_orders_canceled_check check (
    status <> 'cancelado' or canceled_at is not null
  )
);

create index if not exists idx_reseller_credit_orders_reseller
  on public.reseller_credit_orders (reseller_id, created_at desc);
create index if not exists idx_reseller_credit_orders_status
  on public.reseller_credit_orders (status, created_at desc);
create index if not exists idx_reseller_credit_orders_package
  on public.reseller_credit_orders (package_id);

drop trigger if exists trg_reseller_credit_orders_updated_at on public.reseller_credit_orders;
create trigger trg_reseller_credit_orders_updated_at
before update on public.reseller_credit_orders
for each row execute function public.set_updated_at();

alter table public.reseller_credit_entries
  add column if not exists purchase_order_id uuid;

alter table public.reseller_credit_entries
  drop constraint if exists reseller_credit_entries_purchase_fk;
alter table public.reseller_credit_entries
  add constraint reseller_credit_entries_purchase_fk
  foreign key (purchase_order_id)
  references public.reseller_credit_orders(id)
  on delete restrict;

alter table public.reseller_credit_entries
  drop constraint if exists reseller_credit_entries_kind_check;
alter table public.reseller_credit_entries
  add constraint reseller_credit_entries_kind_check
  check (kind in ('credito', 'ajuste', 'ativacao', 'estorno', 'compra'));

create unique index if not exists uq_reseller_credit_entries_purchase
  on public.reseller_credit_entries (purchase_order_id)
  where purchase_order_id is not null;

alter table public.reseller_credit_packages enable row level security;
alter table public.reseller_credit_orders enable row level security;

drop policy if exists reseller_credit_packages_select on public.reseller_credit_packages;
create policy reseller_credit_packages_select on public.reseller_credit_packages
for select to authenticated
using (active = true or public.is_platform_admin());

drop policy if exists reseller_credit_packages_admin_write on public.reseller_credit_packages;
create policy reseller_credit_packages_admin_write on public.reseller_credit_packages
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists reseller_credit_orders_select on public.reseller_credit_orders;
create policy reseller_credit_orders_select on public.reseller_credit_orders
for select to authenticated
using (reseller_id = public.current_reseller_id() or public.is_platform_admin());

revoke all on table public.reseller_credit_packages from public, anon, authenticated;
revoke all on table public.reseller_credit_orders from public, anon, authenticated;

grant select, insert, update on table public.reseller_credit_packages to authenticated;
grant select on table public.reseller_credit_orders to authenticated;
grant all on table public.reseller_credit_packages to service_role;
grant all on table public.reseller_credit_orders to service_role;

create or replace function public.create_reseller_credit_order(
  p_package_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_package public.reseller_credit_packages%rowtype;
  v_order public.reseller_credit_orders%rowtype;
  v_snapshot jsonb;
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
      'reused', true
    );
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
      credits, amount, currency, idempotency_key, created_by
    )
    values (
      v_reseller_id, v_package.id, v_package.name, v_snapshot,
      v_package.credits, v_package.price, v_package.currency,
      p_idempotency_key, auth.uid()
    )
    returning * into v_order;
  exception when unique_violation then
    select *
    into v_order
    from public.reseller_credit_orders
    where reseller_id = v_reseller_id
      and idempotency_key = p_idempotency_key;

    if not found then
      raise;
    end if;

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'package_id', v_order.package_id,
      'package_name', v_order.package_name,
      'reused', true
    );
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
      'currency', v_order.currency
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
    'reused', false
  );
end;
$$;

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
  v_order public.reseller_credit_orders%rowtype;
begin
  if p_order_id is null then
    raise exception 'Pedido nao informado';
  end if;

  select *
  into v_order
  from public.reseller_credit_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido nao encontrado';
  end if;

  if not v_is_admin and v_order.reseller_id <> v_reseller_id then
    raise exception 'Pedido nao encontrado ou sem permissao';
  end if;

  if v_order.status = 'cancelado' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'reused', true
    );
  end if;

  if v_order.status <> 'pendente' then
    raise exception 'Somente pedidos pendentes podem ser cancelados';
  end if;

  update public.reseller_credit_orders
  set status = 'cancelado',
      canceled_by = auth.uid(),
      canceled_at = now(),
      cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Cancelado pelo usuario')
  where id = v_order.id
  returning * into v_order;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_order_canceled', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', v_order.reseller_id,
      'reason', v_order.cancel_reason
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'reused', false
  );
end;
$$;

create or replace function public.confirm_reseller_credit_order(
  p_order_id uuid,
  p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.reseller_credit_orders%rowtype;
  v_entry_id uuid;
  v_balance integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;
  if p_order_id is null then
    raise exception 'Pedido nao informado';
  end if;

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
      'balance', coalesce(v_balance, 0),
      'reused', true
    );
  end if;

  if v_order.status <> 'pendente' then
    raise exception 'Somente pedidos pendentes podem ser confirmados';
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
      payment_reference = coalesce(nullif(btrim(p_payment_reference), ''), ''),
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
    'balance', v_balance,
    'reused', false
  );
end;
$$;

revoke all on function public.create_reseller_credit_order(uuid, uuid) from public, anon;
revoke all on function public.cancel_reseller_credit_order(uuid, text) from public, anon;
revoke all on function public.confirm_reseller_credit_order(uuid, text) from public, anon;

grant execute on function public.create_reseller_credit_order(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_reseller_credit_order(uuid, text) to authenticated, service_role;
grant execute on function public.confirm_reseller_credit_order(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
