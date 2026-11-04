create table if not exists public.reseller_clients (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  trade_name text not null default '',
  document text not null default '',
  phone text not null default '',
  email text not null default '',
  city text not null default '',
  state text not null default '',
  notes text not null default '',
  status text not null default 'prospecto'
    check (status in ('prospecto', 'ativo', 'inativo')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, reseller_id)
);

create index if not exists idx_reseller_clients_reseller
  on public.reseller_clients (reseller_id, created_at desc);
create index if not exists idx_reseller_clients_status
  on public.reseller_clients (reseller_id, status);
create index if not exists idx_reseller_clients_phone
  on public.reseller_clients (phone);

drop trigger if exists trg_reseller_clients_updated_at on public.reseller_clients;
create trigger trg_reseller_clients_updated_at
before update on public.reseller_clients
for each row execute function public.set_updated_at();

create or replace function public.guard_reseller_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reseller_id is distinct from old.reseller_id then
    raise exception 'Revendedor do cliente nao pode ser alterado';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Autor do cadastro nao pode ser alterado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_client_guard on public.reseller_clients;
create trigger trg_reseller_client_guard
before update on public.reseller_clients
for each row execute function public.guard_reseller_client_update();

create table if not exists public.reseller_activations (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  client_id uuid not null,
  client_name text not null default '',
  plan_id uuid not null references public.plans(id) on delete restrict,
  plan_name text not null default '',
  credits integer not null default 0 check (credits >= 0),
  starts_on date not null default current_date,
  expires_on date not null,
  status text not null default 'ativa'
    check (status in ('ativa', 'cancelada')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint reseller_activations_dates check (expires_on >= starts_on),
  constraint reseller_activations_client_fk
    foreign key (client_id, reseller_id)
    references public.reseller_clients (id, reseller_id)
    on delete restrict
);

create index if not exists idx_reseller_activations_reseller
  on public.reseller_activations (reseller_id, created_at desc);
create index if not exists idx_reseller_activations_client
  on public.reseller_activations (client_id, created_at desc);
create index if not exists idx_reseller_activations_expiry
  on public.reseller_activations (reseller_id, expires_on);

create table if not exists public.reseller_credit_entries (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  activation_id uuid references public.reseller_activations(id) on delete restrict,
  kind text not null check (kind in ('credito', 'ajuste', 'ativacao', 'estorno')),
  amount integer not null check (amount <> 0),
  reason text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_reseller_credit_entries_reseller
  on public.reseller_credit_entries (reseller_id, created_at desc);
create index if not exists idx_reseller_credit_entries_activation
  on public.reseller_credit_entries (activation_id);

create or replace function public.guard_reseller_credit_ledger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Extrato de creditos e imutavel';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_credit_ledger_immutable on public.reseller_credit_entries;
create trigger trg_reseller_credit_ledger_immutable
before update or delete on public.reseller_credit_entries
for each row execute function public.guard_reseller_credit_ledger();

alter table public.reseller_clients enable row level security;
alter table public.reseller_activations enable row level security;
alter table public.reseller_credit_entries enable row level security;

drop policy if exists reseller_clients_select_own on public.reseller_clients;
create policy reseller_clients_select_own on public.reseller_clients
for select to authenticated
using (reseller_id = public.current_reseller_id() or public.is_platform_admin());

drop policy if exists reseller_clients_insert_own on public.reseller_clients;
create policy reseller_clients_insert_own on public.reseller_clients
for insert to authenticated
with check (reseller_id = public.current_reseller_id() or public.is_platform_admin());

drop policy if exists reseller_clients_update_own on public.reseller_clients;
create policy reseller_clients_update_own on public.reseller_clients
for update to authenticated
using (reseller_id = public.current_reseller_id() or public.is_platform_admin())
with check (reseller_id = public.current_reseller_id() or public.is_platform_admin());

drop policy if exists reseller_activations_select_own on public.reseller_activations;
create policy reseller_activations_select_own on public.reseller_activations
for select to authenticated
using (reseller_id = public.current_reseller_id() or public.is_platform_admin());

drop policy if exists reseller_credit_entries_select_own on public.reseller_credit_entries;
create policy reseller_credit_entries_select_own on public.reseller_credit_entries
for select to authenticated
using (reseller_id = public.current_reseller_id() or public.is_platform_admin());

revoke all on table public.reseller_clients from public, anon, authenticated;
revoke all on table public.reseller_activations from public, anon, authenticated;
revoke all on table public.reseller_credit_entries from public, anon, authenticated;

grant select, insert, update on table public.reseller_clients to authenticated;
grant select on table public.reseller_activations to authenticated;
grant select on table public.reseller_credit_entries to authenticated;
grant all on table public.reseller_clients to service_role;
grant all on table public.reseller_activations to service_role;
grant all on table public.reseller_credit_entries to service_role;

create or replace function public.reseller_credit_balance(p_reseller_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := p_reseller_id;
  v_balance integer;
begin
  if public.is_platform_admin() then
    if v_reseller_id is null then
      raise exception 'Revendedor nao informado';
    end if;
  else
    v_reseller_id := public.current_reseller_id();
    if v_reseller_id is null then
      raise exception 'Acesso de revenda inativo';
    end if;
    if p_reseller_id is not null and p_reseller_id <> v_reseller_id then
      raise exception 'Sem permissao';
    end if;
  end if;

  select coalesce(sum(amount), 0)::integer
  into v_balance
  from public.reseller_credit_entries
  where reseller_id = v_reseller_id;

  return coalesce(v_balance, 0);
end;
$$;

create or replace function public.grant_reseller_credits(
  p_reseller_id uuid,
  p_amount integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_balance integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;
  if p_reseller_id is null then
    raise exception 'Revendedor nao informado';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe uma quantidade de creditos maior que zero';
  end if;

  perform 1 from public.resellers where id = p_reseller_id for update;
  if not found then
    raise exception 'Revendedor nao encontrado';
  end if;

  insert into public.reseller_credit_entries (
    reseller_id, kind, amount, reason, created_by
  )
  values (
    p_reseller_id, 'credito', p_amount,
    coalesce(nullif(btrim(p_reason), ''), 'Credito manual do Master'),
    auth.uid()
  )
  returning id into v_entry_id;

  select coalesce(sum(amount), 0)::integer
  into v_balance
  from public.reseller_credit_entries
  where reseller_id = p_reseller_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credits_granted', 'reseller', p_reseller_id,
    jsonb_build_object('entry_id', v_entry_id, 'amount', p_amount, 'balance', v_balance)
  );

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'amount', p_amount,
    'balance', v_balance
  );
end;
$$;

create or replace function public.activate_reseller_client(
  p_client_id uuid,
  p_plan_id uuid,
  p_credits integer,
  p_starts_on date default current_date,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_plan public.plans%rowtype;
  v_credits integer := coalesce(p_credits, 0);
  v_starts_on date := coalesce(p_starts_on, current_date);
  v_balance integer;
  v_activation_id uuid;
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
  if v_credits < 0 then
    raise exception 'Creditos nao podem ser negativos';
  end if;
  if p_expires_on is null then
    raise exception 'Informe a data de vencimento';
  end if;
  if p_expires_on < v_starts_on then
    raise exception 'Vencimento nao pode ser anterior ao inicio';
  end if;

  perform 1 from public.resellers where id = v_reseller_id for update;

  select *
  into v_client
  from public.reseller_clients
  where id = p_client_id
    and reseller_id = v_reseller_id;

  if not found then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;

  select *
  into v_plan
  from public.plans
  where id = p_plan_id
    and active = true;

  if not found then
    raise exception 'Plano indisponivel';
  end if;

  select coalesce(sum(amount), 0)::integer
  into v_balance
  from public.reseller_credit_entries
  where reseller_id = v_reseller_id;

  if v_credits > v_balance then
    raise exception 'Saldo insuficiente. Disponivel: % creditos', v_balance;
  end if;

  insert into public.reseller_activations (
    reseller_id, client_id, client_name, plan_id, plan_name, credits,
    starts_on, expires_on, created_by
  )
  values (
    v_reseller_id, v_client.id, v_client.name, v_plan.id, v_plan.name, v_credits,
    v_starts_on, p_expires_on, auth.uid()
  )
  returning id into v_activation_id;

  if v_credits > 0 then
    insert into public.reseller_credit_entries (
      reseller_id, activation_id, kind, amount, reason, created_by
    )
    values (
      v_reseller_id, v_activation_id, 'ativacao', -v_credits,
      'Ativacao de ' || v_client.name || ' no plano ' || v_plan.name,
      auth.uid()
    );
    v_balance := v_balance - v_credits;
  end if;

  update public.reseller_clients
  set status = 'ativo'
  where id = v_client.id
    and reseller_id = v_reseller_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_activation_created', 'reseller_activation', v_activation_id,
    jsonb_build_object(
      'reseller_id', v_reseller_id,
      'client_id', v_client.id,
      'plan_id', v_plan.id,
      'credits', v_credits,
      'starts_on', v_starts_on,
      'expires_on', p_expires_on
    )
  );

  return jsonb_build_object(
    'activation_id', v_activation_id,
    'balance', v_balance,
    'status', 'ativa'
  );
end;
$$;

revoke all on function public.reseller_credit_balance(uuid) from public, anon;
revoke all on function public.grant_reseller_credits(uuid, integer, text) from public, anon;
revoke all on function public.activate_reseller_client(uuid, uuid, integer, date, date) from public, anon;
revoke all on function public.guard_reseller_client_update() from public, anon, authenticated;
revoke all on function public.guard_reseller_credit_ledger() from public, anon, authenticated;

grant execute on function public.reseller_credit_balance(uuid) to authenticated, service_role;
grant execute on function public.grant_reseller_credits(uuid, integer, text) to authenticated, service_role;
grant execute on function public.activate_reseller_client(uuid, uuid, integer, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
