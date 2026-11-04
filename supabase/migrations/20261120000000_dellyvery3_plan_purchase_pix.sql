alter table public.platform_settings
  add column if not exists plan_purchase_expiry_days integer;

update public.platform_settings
set plan_purchase_expiry_days = 1
where id = true and plan_purchase_expiry_days is null;

alter table public.platform_settings
  alter column plan_purchase_expiry_days set default 1;

alter table public.platform_settings
  drop constraint if exists platform_settings_plan_purchase_expiry_days_check;

alter table public.platform_settings
  add constraint platform_settings_plan_purchase_expiry_days_check
  check (plan_purchase_expiry_days is null or plan_purchase_expiry_days > 0);

create table if not exists public.platform_pix_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  pix_key_type text,
  pix_key text,
  receiver_name text,
  qr_image_url text,
  qr_payload text,
  instructions text,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint platform_pix_settings_key_type_check
    check (pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random'))
);

insert into public.platform_pix_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists trg_platform_pix_settings_updated_at on public.platform_pix_settings;
create trigger trg_platform_pix_settings_updated_at
before update on public.platform_pix_settings
for each row execute function public.set_updated_at();

alter table public.platform_pix_settings enable row level security;

create table if not exists public.plan_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete restrict,
  plan_name_snapshot text not null,
  plan_slug_snapshot text not null,
  price_snapshot numeric(10,2) not null,
  currency_snapshot text not null default 'BRL',
  billing_cycle_snapshot text not null,
  access_days_snapshot integer not null,
  is_free_snapshot boolean not null default false,
  status text not null default 'pendente',
  payment_method text not null default 'pix',
  payment_reference text not null default '',
  proof_url text,
  payer_name text,
  confirmed_amount numeric(10,2),
  confirmed_currency text,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  canceled_by uuid references public.profiles(id) on delete set null,
  canceled_at timestamptz,
  expired_at timestamptz,
  reason text,
  idempotency_key uuid not null,
  pending_expires_at timestamptz,
  pix_settings_version integer,
  activated_at timestamptz,
  provider text,
  provider_charge_id text,
  provider_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_purchase_requests_status_check
    check (status in ('pendente', 'confirmada', 'rejeitada', 'cancelada', 'expirada')),
  constraint plan_purchase_requests_payment_method_check
    check (payment_method = 'pix'),
  constraint plan_purchase_requests_price_check
    check (price_snapshot >= 0),
  constraint plan_purchase_requests_access_days_check
    check (access_days_snapshot > 0),
  constraint plan_purchase_requests_currency_check
    check (currency_snapshot ~ '^[A-Z]{3}$'),
  constraint plan_purchase_requests_paid_check
    check (is_free_snapshot = false),
  constraint plan_purchase_requests_confirmed_check
    check (
      status <> 'confirmada'
      or (
        confirmed_by is not null
        and confirmed_at is not null
        and confirmed_amount is not null
        and confirmed_currency is not null
        and activated_at is not null
      )
    ),
  constraint plan_purchase_requests_rejected_check
    check (
      status <> 'rejeitada'
      or (rejected_by is not null and rejected_at is not null and btrim(coalesce(reason, '')) <> '')
    ),
  constraint plan_purchase_requests_canceled_check
    check (status <> 'cancelada' or (canceled_by is not null and canceled_at is not null)),
  constraint plan_purchase_requests_expired_check
    check (status <> 'expirada' or expired_at is not null),
  constraint plan_purchase_requests_pending_reason_check
    check (status <> 'pendente' or coalesce(reason, '') = ''),
  constraint plan_purchase_requests_confirmed_exclusive_check
    check (
      status = 'confirmada'
      or (
        confirmed_by is null
        and confirmed_at is null
        and confirmed_amount is null
        and confirmed_currency is null
        and activated_at is null
      )
    ),
  constraint plan_purchase_requests_rejected_exclusive_check
    check (status = 'rejeitada' or (rejected_by is null and rejected_at is null)),
  constraint plan_purchase_requests_canceled_exclusive_check
    check (status = 'cancelada' or (canceled_by is null and canceled_at is null)),
  constraint plan_purchase_requests_expired_exclusive_check
    check (status = 'expirada' or expired_at is null)
);

drop trigger if exists trg_plan_purchase_requests_updated_at on public.plan_purchase_requests;
create trigger trg_plan_purchase_requests_updated_at
before update on public.plan_purchase_requests
for each row execute function public.set_updated_at();

create unique index if not exists uq_plan_purchase_requests_idempotency
  on public.plan_purchase_requests (company_id, idempotency_key);

create unique index if not exists uq_plan_purchase_requests_pending_company
  on public.plan_purchase_requests (company_id)
  where status = 'pendente';

create index if not exists idx_plan_purchase_requests_queue
  on public.plan_purchase_requests (status, created_at desc);

create index if not exists idx_plan_purchase_requests_company
  on public.plan_purchase_requests (company_id, created_at desc);

create index if not exists idx_plan_purchase_requests_pending_expiry
  on public.plan_purchase_requests (pending_expires_at)
  where status = 'pendente';

create table if not exists public.plan_purchase_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.plan_purchase_requests(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint plan_purchase_events_type_check
    check (event_type in ('created', 'payment_submitted', 'confirmed', 'rejected', 'canceled', 'expired'))
);

create index if not exists idx_plan_purchase_events_request
  on public.plan_purchase_events (request_id, created_at);

create unique index if not exists uq_plan_purchase_events_confirmed
  on public.plan_purchase_events (request_id)
  where event_type = 'confirmed';

alter table public.plan_purchase_requests enable row level security;
alter table public.plan_purchase_events enable row level security;

create or replace function public.can_manage_company_billing(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    p_company_id is not null
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.active = true
        and cm.role in ('OWNER', 'ADMIN')
    );
$$;

create or replace function public.can_view_plan_purchase(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.plan_purchase_requests r
    where r.id = p_request_id
      and (
        public.is_platform_admin()
        or public.can_manage_company_billing(r.company_id)
      )
  );
$$;

drop policy if exists plan_purchase_requests_select_billing on public.plan_purchase_requests;
create policy plan_purchase_requests_select_billing on public.plan_purchase_requests
  for select to authenticated
  using (
    public.is_platform_admin()
    or public.can_manage_company_billing(company_id)
  );

drop policy if exists plan_purchase_events_select_billing on public.plan_purchase_events;
create policy plan_purchase_events_select_billing on public.plan_purchase_events
  for select to authenticated
  using (public.can_view_plan_purchase(request_id));

revoke all on table public.platform_pix_settings from public, anon, authenticated;
grant all on table public.platform_pix_settings to service_role;

revoke all on table public.plan_purchase_requests from public, anon, authenticated;
grant select on table public.plan_purchase_requests to authenticated;
grant all on table public.plan_purchase_requests to service_role;

revoke all on table public.plan_purchase_events from public, anon, authenticated;
grant select on table public.plan_purchase_events to authenticated;
grant all on table public.plan_purchase_events to service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.platform_settings from public, anon, authenticated;
grant select on table public.platform_settings to authenticated, service_role;

create or replace function public.set_plan_purchase_expiry_days(p_days integer)
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
    raise exception 'Apenas PLATFORM_ADMIN pode alterar a validade das compras';
  end if;

  if p_days is not null and p_days <= 0 then
    raise exception 'Dias de validade devem ser um inteiro maior que zero';
  end if;

  select plan_purchase_expiry_days into v_old
  from public.platform_settings
  where id = true
  for update;

  update public.platform_settings
  set plan_purchase_expiry_days = p_days,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'plan_purchase_expiry_days_updated', 'platform_settings', null,
    jsonb_build_object('old_days', v_old, 'new_days', p_days)
  );

  return v_row;
end;
$$;

create or replace function public.get_platform_pix_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.platform_pix_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  select * into v_row
  from public.platform_pix_settings
  where id = true;

  if not found then
    return jsonb_build_object(
      'active', false,
      'pix_key_type', null,
      'pix_key', null,
      'receiver_name', null,
      'qr_image_url', null,
      'qr_payload', null,
      'instructions', null,
      'version', null,
      'updated_at', null,
      'updated_by', null
    );
  end if;

  return jsonb_build_object(
    'active', v_row.active,
    'pix_key_type', v_row.pix_key_type,
    'pix_key', v_row.pix_key,
    'receiver_name', v_row.receiver_name,
    'qr_image_url', v_row.qr_image_url,
    'qr_payload', v_row.qr_payload,
    'instructions', v_row.instructions,
    'version', v_row.version,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
end;
$$;

create or replace function public.set_platform_pix_settings(
  p_active boolean default false,
  p_pix_key_type text default null,
  p_pix_key text default null,
  p_receiver_name text default null,
  p_qr_image_url text default null,
  p_qr_payload text default null,
  p_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_version integer := 0;
  v_new_version integer;
  v_active boolean := coalesce(p_active, false);
  v_key_type text := nullif(btrim(p_pix_key_type), '');
  v_key text := nullif(btrim(p_pix_key), '');
  v_receiver text := nullif(btrim(p_receiver_name), '');
  v_qr_url text := nullif(btrim(p_qr_image_url), '');
  v_qr_payload text := nullif(btrim(p_qr_payload), '');
  v_instructions text := nullif(btrim(p_instructions), '');
  v_row public.platform_pix_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if v_key_type is not null and v_key_type not in ('cpf', 'cnpj', 'email', 'phone', 'random') then
    raise exception 'Tipo de chave Pix invalido';
  end if;

  if v_active and v_key is null then
    raise exception 'Informe a chave Pix para ativar as instrucoes';
  end if;

  if v_key is not null and char_length(v_key) > 500 then
    raise exception 'Chave Pix muito longa';
  end if;

  if v_receiver is not null and char_length(v_receiver) > 200 then
    raise exception 'Nome do recebedor muito longo';
  end if;

  if v_qr_url is not null and char_length(v_qr_url) > 1000 then
    raise exception 'URL do QR Code muito longa';
  end if;

  if v_qr_payload is not null and char_length(v_qr_payload) > 4000 then
    raise exception 'Payload do QR Code muito longo';
  end if;

  if v_instructions is not null and char_length(v_instructions) > 2000 then
    raise exception 'Instrucoes muito longas';
  end if;

  insert into public.platform_pix_settings (id)
  values (true)
  on conflict (id) do nothing;

  select version into v_old_version
  from public.platform_pix_settings
  where id = true
  for update;

  v_new_version := coalesce(v_old_version, 0) + 1;

  update public.platform_pix_settings
  set active = v_active,
      pix_key_type = v_key_type,
      pix_key = v_key,
      receiver_name = v_receiver,
      qr_image_url = v_qr_url,
      qr_payload = v_qr_payload,
      instructions = v_instructions,
      version = v_new_version,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'platform_pix_settings_updated', 'platform_pix_settings', null,
    jsonb_build_object(
      'old_version', v_old_version,
      'new_version', v_new_version,
      'active', v_row.active,
      'pix_key_type', v_row.pix_key_type,
      'has_pix_key', v_row.pix_key is not null,
      'has_qr_image_url', v_row.qr_image_url is not null,
      'has_qr_payload', v_row.qr_payload is not null,
      'has_instructions', v_row.instructions is not null
    )
  );

  return jsonb_build_object(
    'active', v_row.active,
    'pix_key_type', v_row.pix_key_type,
    'pix_key', v_row.pix_key,
    'receiver_name', v_row.receiver_name,
    'qr_image_url', v_row.qr_image_url,
    'qr_payload', v_row.qr_payload,
    'instructions', v_row.instructions,
    'version', v_row.version,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
end;
$$;

create or replace function public.expire_plan_purchase_requests()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_count integer := 0;
begin
  for v_request in
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where status = 'pendente'
      and pending_expires_at is not null
      and pending_expires_at <= now()
    returning *
  loop
    insert into public.plan_purchase_events (
      request_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      v_request.id, 'expired', 'pendente', 'expirada', null,
      jsonb_build_object(
        'pending_expires_at', v_request.pending_expires_at,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot
      )
    );

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      v_request.company_id, null, 'plan_purchase_expired', 'plan_purchase_request', v_request.id,
      jsonb_build_object(
        'request_id', v_request.id,
        'company_id', v_request.company_id,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot,
        'status_anterior', 'pendente',
        'status_novo', 'expirada',
        'pending_expires_at', v_request.pending_expires_at
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.create_plan_purchase_request(
  p_company_id uuid,
  p_plan_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_plan public.plans%rowtype;
  v_request public.plan_purchase_requests%rowtype;
  v_existing public.plan_purchase_requests%rowtype;
  v_pending public.plan_purchase_requests%rowtype;
  v_expiry_days integer;
  v_pending_expires_at timestamptz;
  v_pix_version integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_company_id is null then
    raise exception 'Empresa nao informada';
  end if;

  if p_plan_id is null then
    raise exception 'Plano nao informado';
  end if;

  if p_idempotency_key is null then
    raise exception 'Chave de idempotencia obrigatoria';
  end if;

  if not public.can_manage_company_billing(p_company_id) then
    raise exception 'Apenas OWNER ou ADMIN pode comprar planos';
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa nao encontrada';
  end if;

  if exists (select 1 from public.reseller_clients where company_id = p_company_id) then
    raise exception 'Esta assinatura e gerenciada pelo revendedor. Fale com o revendedor para renovar';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_existing
  from public.plan_purchase_requests
  where company_id = p_company_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.plan_id <> p_plan_id then
      raise exception 'Chave de idempotencia ja usada para outro plano';
    end if;

    return jsonb_build_object(
      'request_id', v_existing.id,
      'company_id', v_existing.company_id,
      'plan_id', v_existing.plan_id,
      'plan_name', v_existing.plan_name_snapshot,
      'plan_slug', v_existing.plan_slug_snapshot,
      'price', v_existing.price_snapshot,
      'currency', v_existing.currency_snapshot,
      'billing_cycle', v_existing.billing_cycle_snapshot,
      'access_days', v_existing.access_days_snapshot,
      'status', v_existing.status,
      'payment_method', v_existing.payment_method,
      'pending_expires_at', v_existing.pending_expires_at,
      'pix_settings_version', v_existing.pix_settings_version,
      'created_at', v_existing.created_at,
      'reused', true
    );
  end if;

  select * into v_pending
  from public.plan_purchase_requests
  where company_id = p_company_id
    and status = 'pendente'
  for update;

  if found then
    if v_pending.plan_id = p_plan_id then
      return jsonb_build_object(
        'request_id', v_pending.id,
        'company_id', v_pending.company_id,
        'plan_id', v_pending.plan_id,
        'plan_name', v_pending.plan_name_snapshot,
        'plan_slug', v_pending.plan_slug_snapshot,
        'price', v_pending.price_snapshot,
        'currency', v_pending.currency_snapshot,
        'billing_cycle', v_pending.billing_cycle_snapshot,
        'access_days', v_pending.access_days_snapshot,
        'status', v_pending.status,
        'payment_method', v_pending.payment_method,
        'pending_expires_at', v_pending.pending_expires_at,
        'pix_settings_version', v_pending.pix_settings_version,
        'created_at', v_pending.created_at,
        'reused', true
      );
    end if;

    raise exception 'Ja existe uma solicitacao pendente para esta empresa';
  end if;

  select * into v_plan
  from public.plans
  where id = p_plan_id
  for share;

  if not found then
    raise exception 'Plano nao encontrado';
  end if;

  if not v_plan.active then
    raise exception 'Plano indisponivel';
  end if;

  if coalesce(v_plan.is_free, false) then
    raise exception 'Plano gratuito nao gera compra';
  end if;

  if v_plan.access_days is null or v_plan.access_days <= 0 then
    raise exception 'Plano sem duracao de acesso configurada';
  end if;

  select plan_purchase_expiry_days into v_expiry_days
  from public.platform_settings
  where id = true;

  v_pending_expires_at := case
    when v_expiry_days is null then null
    else now() + make_interval(days => v_expiry_days)
  end;

  select version into v_pix_version
  from public.platform_pix_settings
  where id = true;

  begin
    insert into public.plan_purchase_requests (
      company_id, requested_by, plan_id,
      plan_name_snapshot, plan_slug_snapshot, price_snapshot, currency_snapshot,
      billing_cycle_snapshot, access_days_snapshot, is_free_snapshot,
      status, payment_method, idempotency_key, pending_expires_at, pix_settings_version
    ) values (
      p_company_id, auth.uid(), v_plan.id,
      v_plan.name, v_plan.slug, round(v_plan.price, 2)::numeric(10,2), 'BRL',
      v_plan.billing_cycle::text, v_plan.access_days, false,
      'pendente', 'pix', p_idempotency_key, v_pending_expires_at, v_pix_version
    )
    returning * into v_request;
  exception when unique_violation then
    select * into v_existing
    from public.plan_purchase_requests
    where company_id = p_company_id
      and idempotency_key = p_idempotency_key;

    if found then
      if v_existing.plan_id <> p_plan_id then
        raise exception 'Chave de idempotencia ja usada para outro plano';
      end if;

      return jsonb_build_object(
        'request_id', v_existing.id,
        'company_id', v_existing.company_id,
        'plan_id', v_existing.plan_id,
        'plan_name', v_existing.plan_name_snapshot,
        'plan_slug', v_existing.plan_slug_snapshot,
        'price', v_existing.price_snapshot,
        'currency', v_existing.currency_snapshot,
        'billing_cycle', v_existing.billing_cycle_snapshot,
        'access_days', v_existing.access_days_snapshot,
        'status', v_existing.status,
        'payment_method', v_existing.payment_method,
        'pending_expires_at', v_existing.pending_expires_at,
        'pix_settings_version', v_existing.pix_settings_version,
        'created_at', v_existing.created_at,
        'reused', true
      );
    end if;

    select * into v_pending
    from public.plan_purchase_requests
    where company_id = p_company_id
      and status = 'pendente';

    if found then
      if v_pending.plan_id = p_plan_id then
        return jsonb_build_object(
          'request_id', v_pending.id,
          'company_id', v_pending.company_id,
          'plan_id', v_pending.plan_id,
          'plan_name', v_pending.plan_name_snapshot,
          'plan_slug', v_pending.plan_slug_snapshot,
          'price', v_pending.price_snapshot,
          'currency', v_pending.currency_snapshot,
          'billing_cycle', v_pending.billing_cycle_snapshot,
          'access_days', v_pending.access_days_snapshot,
          'status', v_pending.status,
          'payment_method', v_pending.payment_method,
          'pending_expires_at', v_pending.pending_expires_at,
          'pix_settings_version', v_pending.pix_settings_version,
          'created_at', v_pending.created_at,
          'reused', true
        );
      end if;

      raise exception 'Ja existe uma solicitacao pendente para esta empresa';
    end if;

    raise;
  end;

  insert into public.plan_purchase_events (
    request_id, event_type, from_status, to_status, actor_id, metadata
  ) values (
    v_request.id, 'created', null, 'pendente', auth.uid(),
    jsonb_build_object(
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'pix_settings_version', v_request.pix_settings_version
    )
  );

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_request.company_id, auth.uid(), 'plan_purchase_requested', 'plan_purchase_request', v_request.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'status_anterior', null,
      'status_novo', 'pendente',
      'pix_settings_version', v_request.pix_settings_version
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'company_id', v_request.company_id,
    'plan_id', v_request.plan_id,
    'plan_name', v_request.plan_name_snapshot,
    'plan_slug', v_request.plan_slug_snapshot,
    'price', v_request.price_snapshot,
    'currency', v_request.currency_snapshot,
    'billing_cycle', v_request.billing_cycle_snapshot,
    'access_days', v_request.access_days_snapshot,
    'status', v_request.status,
    'payment_method', v_request.payment_method,
    'pending_expires_at', v_request.pending_expires_at,
    'pix_settings_version', v_request.pix_settings_version,
    'created_at', v_request.created_at,
    'reused', false
  );
end;
$$;

create or replace function public.submit_plan_purchase_payment(
  p_request_id uuid,
  p_payment_reference text,
  p_proof_url text default null,
  p_payer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_reference text;
  v_proof_url text;
  v_payer_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if not public.can_manage_company_billing(v_request.company_id) then
    raise exception 'Sem permissao';
  end if;

  if v_request.status = 'expirada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_request.status <> 'pendente' then
    raise exception 'Somente solicitacoes pendentes podem receber pagamento';
  end if;

  if v_request.pending_expires_at is not null and v_request.pending_expires_at <= now() then
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where id = v_request.id
    returning * into v_request;

    insert into public.plan_purchase_events (
      request_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      v_request.id, 'expired', 'pendente', 'expirada', null,
      jsonb_build_object(
        'pending_expires_at', v_request.pending_expires_at,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot
      )
    );

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      v_request.company_id, null, 'plan_purchase_expired', 'plan_purchase_request', v_request.id,
      jsonb_build_object(
        'request_id', v_request.id,
        'company_id', v_request.company_id,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot,
        'status_anterior', 'pendente',
        'status_novo', 'expirada',
        'pending_expires_at', v_request.pending_expires_at
      )
    );

    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  v_reference := nullif(btrim(p_payment_reference), '');
  if v_reference is null then
    raise exception 'Referencia de pagamento obrigatoria';
  end if;
  if char_length(v_reference) > 200 then
    raise exception 'Referencia de pagamento muito longa';
  end if;

  v_proof_url := nullif(btrim(p_proof_url), '');
  if v_proof_url is not null and char_length(v_proof_url) > 1000 then
    raise exception 'URL do comprovante muito longa';
  end if;

  v_payer_name := nullif(btrim(p_payer_name), '');
  if v_payer_name is not null and char_length(v_payer_name) > 200 then
    raise exception 'Nome do pagador muito longo';
  end if;

  update public.plan_purchase_requests
  set payment_reference = v_reference,
      proof_url = v_proof_url,
      payer_name = v_payer_name
  where id = v_request.id
  returning * into v_request;

  insert into public.plan_purchase_events (
    request_id, event_type, from_status, to_status, actor_id, metadata
  ) values (
    v_request.id, 'payment_submitted', 'pendente', 'pendente', auth.uid(),
    jsonb_build_object(
      'has_payment_reference', v_request.payment_reference <> '',
      'has_proof_url', v_request.proof_url is not null,
      'has_payer_name', v_request.payer_name is not null,
      'pending_expires_at', v_request.pending_expires_at
    )
  );

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_request.company_id, auth.uid(), 'plan_purchase_payment_submitted', 'plan_purchase_request', v_request.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'status_anterior', 'pendente',
      'status_novo', 'pendente',
      'has_payment_reference', v_request.payment_reference <> '',
      'has_proof_url', v_request.proof_url is not null,
      'has_payer_name', v_request.payer_name is not null
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'payment_reference', v_request.payment_reference,
    'proof_url', v_request.proof_url,
    'payer_name', v_request.payer_name,
    'pending_expires_at', v_request.pending_expires_at,
    'updated_at', v_request.updated_at,
    'reused', false
  );
end;
$$;

create or replace function public.cancel_plan_purchase_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if not public.can_manage_company_billing(v_request.company_id) then
    raise exception 'Sem permissao';
  end if;

  if v_request.status = 'cancelada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'reason', v_request.reason,
      'canceled_at', v_request.canceled_at,
      'reused', true
    );
  end if;

  if v_request.status = 'expirada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_request.status <> 'pendente' then
    raise exception 'Somente solicitacoes pendentes podem ser canceladas';
  end if;

  if v_request.pending_expires_at is not null and v_request.pending_expires_at <= now() then
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where id = v_request.id
    returning * into v_request;

    insert into public.plan_purchase_events (
      request_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      v_request.id, 'expired', 'pendente', 'expirada', null,
      jsonb_build_object(
        'pending_expires_at', v_request.pending_expires_at,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot
      )
    );

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      v_request.company_id, null, 'plan_purchase_expired', 'plan_purchase_request', v_request.id,
      jsonb_build_object(
        'request_id', v_request.id,
        'company_id', v_request.company_id,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot,
        'status_anterior', 'pendente',
        'status_novo', 'expirada',
        'pending_expires_at', v_request.pending_expires_at
      )
    );

    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Motivo muito longo';
  end if;

  update public.plan_purchase_requests
  set status = 'cancelada',
      canceled_by = auth.uid(),
      canceled_at = now(),
      reason = v_reason
  where id = v_request.id
  returning * into v_request;

  insert into public.plan_purchase_events (
    request_id, event_type, from_status, to_status, actor_id, reason, metadata
  ) values (
    v_request.id, 'canceled', 'pendente', 'cancelada', auth.uid(), v_request.reason,
    jsonb_build_object(
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot
    )
  );

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_request.company_id, auth.uid(), 'plan_purchase_canceled', 'plan_purchase_request', v_request.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'status_anterior', 'pendente',
      'status_novo', 'cancelada',
      'reason', v_request.reason
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'reason', v_request.reason,
    'canceled_at', v_request.canceled_at,
    'reused', false
  );
end;
$$;

create or replace function public.get_my_plan_purchase_requests(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_company_id is null then
    raise exception 'Empresa nao informada';
  end if;

  if not public.can_manage_company_billing(p_company_id) then
    raise exception 'Sem permissao';
  end if;

  perform public.expire_plan_purchase_requests();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      r.id,
      r.company_id,
      r.requested_by,
      r.plan_id,
      r.plan_name_snapshot,
      r.plan_slug_snapshot,
      r.price_snapshot,
      r.currency_snapshot,
      r.billing_cycle_snapshot,
      r.access_days_snapshot,
      r.status,
      r.payment_method,
      r.payment_reference,
      (r.proof_url is not null) as has_proof,
      r.payer_name,
      r.confirmed_amount,
      r.confirmed_currency,
      r.confirmed_at,
      r.rejected_at,
      r.canceled_at,
      r.expired_at,
      r.reason,
      r.pending_expires_at,
      r.pix_settings_version,
      r.activated_at,
      r.created_at,
      r.updated_at
    from public.plan_purchase_requests r
    where r.company_id = p_company_id
    order by r.created_at desc
    limit 100
  ) x;

  return v_result;
end;
$$;

create or replace function public.get_plan_purchase_pix_instructions(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_active boolean := false;
  v_key_type text;
  v_key text;
  v_receiver text;
  v_qr_url text;
  v_qr_payload text;
  v_instructions text;
  v_version integer;
  v_configured boolean := false;
  v_available boolean := false;
  v_version_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if not (
    public.is_platform_admin()
    or public.can_manage_company_billing(v_request.company_id)
  ) then
    raise exception 'Sem permissao';
  end if;

  select active, pix_key_type, pix_key, receiver_name, qr_image_url, qr_payload, instructions, version
  into v_active, v_key_type, v_key, v_receiver, v_qr_url, v_qr_payload, v_instructions, v_version
  from public.platform_pix_settings
  where id = true;

  v_configured := v_key is not null and btrim(v_key) <> '';
  v_available := v_request.status = 'pendente' and v_active and v_configured;
  v_version_changed :=
    v_request.pix_settings_version is not null
    and v_version is not null
    and v_request.pix_settings_version <> v_version;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'plan_name', v_request.plan_name_snapshot,
    'price', v_request.price_snapshot,
    'currency', v_request.currency_snapshot,
    'pending_expires_at', v_request.pending_expires_at,
    'configured', v_configured,
    'active', v_active,
    'available', v_available,
    'pix_key_type', case when v_available then v_key_type else null end,
    'pix_key', case when v_available then v_key else null end,
    'receiver_name', case when v_available then v_receiver else null end,
    'qr_image_url', case when v_available then v_qr_url else null end,
    'qr_payload', case when v_available then v_qr_payload else null end,
    'instructions', case when v_available then v_instructions else null end,
    'version', v_version,
    'request_version', v_request.pix_settings_version,
    'version_changed', v_version_changed
  );
end;
$$;

create or replace function public.list_plan_purchase_requests(p_status text default 'pendente')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if p_status is not null
     and p_status <> 'todas'
     and p_status not in ('pendente', 'confirmada', 'rejeitada', 'cancelada', 'expirada') then
    raise exception 'Status invalido';
  end if;

  perform public.expire_plan_purchase_requests();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.queue_order, x.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      r.id,
      r.company_id,
      c.name as company_name,
      c.slug as company_slug,
      r.requested_by,
      p.name as requested_by_name,
      p.email as requested_by_email,
      r.plan_id,
      r.plan_name_snapshot,
      r.plan_slug_snapshot,
      r.price_snapshot,
      r.currency_snapshot,
      r.billing_cycle_snapshot,
      r.access_days_snapshot,
      r.status,
      r.payment_method,
      r.payment_reference,
      r.proof_url,
      r.payer_name,
      r.confirmed_amount,
      r.confirmed_currency,
      r.confirmed_at,
      r.rejected_at,
      r.canceled_at,
      r.expired_at,
      r.reason,
      r.pending_expires_at,
      r.pix_settings_version,
      r.activated_at,
      r.created_at,
      r.updated_at,
      case when r.status = 'pendente' then 0 else 1 end as queue_order
    from public.plan_purchase_requests r
    join public.companies c on c.id = r.company_id
    left join public.profiles p on p.id = r.requested_by
    where p_status is null
       or p_status = 'todas'
       or r.status = p_status
    order by case when r.status = 'pendente' then 0 else 1 end, r.created_at desc
    limit 200
  ) x;

  return v_result;
end;
$$;

create or replace function public.confirm_plan_purchase_request(
  p_request_id uuid,
  p_confirmed_amount numeric,
  p_payment_reference text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_subscription_id uuid;
  v_new_expires_at timestamptz;
  v_reference text;
  v_reason text;
  v_event_metadata jsonb;
  v_replay_expires_at timestamptz;
  v_replay_subscription_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
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
  if char_length(v_reference) > 200 then
    raise exception 'Referencia de pagamento muito longa';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Motivo muito longo';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if v_request.status = 'confirmada' then
    select metadata into v_event_metadata
    from public.plan_purchase_events
    where request_id = v_request.id
      and event_type = 'confirmed'
    order by created_at desc
    limit 1;

    v_replay_subscription_id := nullif(v_event_metadata ->> 'subscription_id', '')::uuid;
    v_replay_expires_at := nullif(v_event_metadata ->> 'expires_at', '')::timestamptz;

    if v_replay_expires_at is null then
      select id, expires_at
      into v_replay_subscription_id, v_replay_expires_at
      from public.subscriptions
      where company_id = v_request.company_id;
    end if;

    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'subscription_id', v_replay_subscription_id,
      'plan_id', v_request.plan_id,
      'plan_name', v_request.plan_name_snapshot,
      'activated_at', v_request.activated_at,
      'expires_at', v_replay_expires_at,
      'confirmed_amount', v_request.confirmed_amount,
      'currency', v_request.confirmed_currency,
      'reused', true
    );
  end if;

  if v_request.status = 'expirada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_request.status <> 'pendente' then
    raise exception 'Somente solicitacoes pendentes podem ser confirmadas';
  end if;

  if v_request.pending_expires_at is not null and v_request.pending_expires_at <= now() then
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where id = v_request.id
    returning * into v_request;

    insert into public.plan_purchase_events (
      request_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      v_request.id, 'expired', 'pendente', 'expirada', null,
      jsonb_build_object(
        'pending_expires_at', v_request.pending_expires_at,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot
      )
    );

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      v_request.company_id, null, 'plan_purchase_expired', 'plan_purchase_request', v_request.id,
      jsonb_build_object(
        'request_id', v_request.id,
        'company_id', v_request.company_id,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot,
        'status_anterior', 'pendente',
        'status_novo', 'expirada',
        'pending_expires_at', v_request.pending_expires_at
      )
    );

    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  if p_confirmed_amount <> v_request.price_snapshot then
    raise exception 'Valor confirmado divergente do valor da solicitacao';
  end if;

  select * into v_subscription
  from public.subscriptions
  where company_id = v_request.company_id
  for update;

  if found then
    update public.subscriptions
    set plan_id = v_request.plan_id,
        status = 'ativo',
        started_at = coalesce(started_at, now()),
        expires_at = greatest(now(), coalesce(expires_at, now()))
          + make_interval(days => v_request.access_days_snapshot),
        canceled_at = null
    where id = v_subscription.id
    returning id, expires_at into v_subscription_id, v_new_expires_at;
  else
    insert into public.subscriptions (
      company_id, plan_id, status, started_at, expires_at
    ) values (
      v_request.company_id, v_request.plan_id, 'ativo', now(),
      now() + make_interval(days => v_request.access_days_snapshot)
    )
    returning id, expires_at into v_subscription_id, v_new_expires_at;
  end if;

  update public.plan_purchase_requests
  set status = 'confirmada',
      payment_reference = v_reference,
      confirmed_amount = p_confirmed_amount,
      confirmed_currency = v_request.currency_snapshot,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      activated_at = now(),
      reason = v_reason
  where id = v_request.id
  returning * into v_request;

  insert into public.plan_purchase_events (
    request_id, event_type, from_status, to_status, actor_id, reason, metadata
  ) values (
    v_request.id, 'confirmed', 'pendente', 'confirmada', auth.uid(), v_request.reason,
    jsonb_build_object(
      'subscription_id', v_subscription_id,
      'expires_at', v_new_expires_at,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'confirmed_amount', v_request.confirmed_amount,
      'pix_settings_version', v_request.pix_settings_version
    )
  );

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_request.company_id, auth.uid(), 'plan_purchase_confirmed', 'plan_purchase_request', v_request.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'status_anterior', 'pendente',
      'status_novo', 'confirmada',
      'confirmed_amount', v_request.confirmed_amount,
      'subscription_id', v_subscription_id,
      'expires_at', v_new_expires_at,
      'pix_settings_version', v_request.pix_settings_version
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'subscription_id', v_subscription_id,
    'plan_id', v_request.plan_id,
    'plan_name', v_request.plan_name_snapshot,
    'activated_at', v_request.activated_at,
    'expires_at', v_new_expires_at,
    'confirmed_amount', v_request.confirmed_amount,
    'currency', v_request.confirmed_currency,
    'reused', false
  );
end;
$$;

create or replace function public.reject_plan_purchase_request(
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_reason text;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'Motivo da rejeicao obrigatorio';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Motivo muito longo';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if v_request.status = 'rejeitada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'reason', v_request.reason,
      'rejected_at', v_request.rejected_at,
      'reused', true
    );
  end if;

  if v_request.status = 'expirada' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  if v_request.status <> 'pendente' then
    raise exception 'Somente solicitacoes pendentes podem ser rejeitadas';
  end if;

  if v_request.pending_expires_at is not null and v_request.pending_expires_at <= now() then
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where id = v_request.id
    returning * into v_request;

    insert into public.plan_purchase_events (
      request_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      v_request.id, 'expired', 'pendente', 'expirada', null,
      jsonb_build_object(
        'pending_expires_at', v_request.pending_expires_at,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot
      )
    );

    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    ) values (
      v_request.company_id, null, 'plan_purchase_expired', 'plan_purchase_request', v_request.id,
      jsonb_build_object(
        'request_id', v_request.id,
        'company_id', v_request.company_id,
        'plan_id', v_request.plan_id,
        'price_snapshot', v_request.price_snapshot,
        'currency_snapshot', v_request.currency_snapshot,
        'access_days_snapshot', v_request.access_days_snapshot,
        'status_anterior', 'pendente',
        'status_novo', 'expirada',
        'pending_expires_at', v_request.pending_expires_at
      )
    );

    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'expired', true,
      'reused', false
    );
  end if;

  update public.plan_purchase_requests
  set status = 'rejeitada',
      rejected_by = auth.uid(),
      rejected_at = now(),
      reason = v_reason
  where id = v_request.id
  returning * into v_request;

  insert into public.plan_purchase_events (
    request_id, event_type, from_status, to_status, actor_id, reason, metadata
  ) values (
    v_request.id, 'rejected', 'pendente', 'rejeitada', auth.uid(), v_request.reason,
    jsonb_build_object(
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot
    )
  );

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_request.company_id, auth.uid(), 'plan_purchase_rejected', 'plan_purchase_request', v_request.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'plan_id', v_request.plan_id,
      'price_snapshot', v_request.price_snapshot,
      'currency_snapshot', v_request.currency_snapshot,
      'access_days_snapshot', v_request.access_days_snapshot,
      'status_anterior', 'pendente',
      'status_novo', 'rejeitada',
      'reason', v_request.reason
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'reason', v_request.reason,
    'rejected_at', v_request.rejected_at,
    'reused', false
  );
end;
$$;

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
  v_old_plan_id uuid;
  v_old_status public.subscription_status;
  v_audit_action text;
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

  v_old_plan_id := v_sub.plan_id;
  v_old_status := v_sub.status;

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

    v_audit_action := 'subscription_upgraded';
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

    v_audit_action := 'subscription_canceled';
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

    v_audit_action := 'subscription_reactivated';
  end if;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    v_company_id, v_actor, v_audit_action, 'subscription', v_sub.id,
    jsonb_build_object(
      'old_plan_id', v_old_plan_id,
      'new_plan_id', v_sub.plan_id,
      'old_status', v_old_status,
      'new_status', v_sub.status
    )
  );

  return v_sub;
end;
$$;

revoke all on function public.can_manage_company_billing(uuid) from public, anon;
grant execute on function public.can_manage_company_billing(uuid) to authenticated, service_role;

revoke all on function public.can_view_plan_purchase(uuid) from public, anon;
grant execute on function public.can_view_plan_purchase(uuid) to authenticated, service_role;

revoke all on function public.set_plan_purchase_expiry_days(integer) from public, anon;
grant execute on function public.set_plan_purchase_expiry_days(integer) to authenticated, service_role;

revoke all on function public.get_platform_pix_settings() from public, anon;
grant execute on function public.get_platform_pix_settings() to authenticated, service_role;

revoke all on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text) from public, anon;
grant execute on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text) to authenticated, service_role;

revoke all on function public.expire_plan_purchase_requests() from public, anon;
grant execute on function public.expire_plan_purchase_requests() to authenticated, service_role;

revoke all on function public.create_plan_purchase_request(uuid,uuid,uuid) from public, anon;
grant execute on function public.create_plan_purchase_request(uuid,uuid,uuid) to authenticated, service_role;

revoke all on function public.submit_plan_purchase_payment(uuid,text,text,text) from public, anon;
grant execute on function public.submit_plan_purchase_payment(uuid,text,text,text) to authenticated, service_role;

revoke all on function public.cancel_plan_purchase_request(uuid,text) from public, anon;
grant execute on function public.cancel_plan_purchase_request(uuid,text) to authenticated, service_role;

revoke all on function public.get_my_plan_purchase_requests(uuid) from public, anon;
grant execute on function public.get_my_plan_purchase_requests(uuid) to authenticated, service_role;

revoke all on function public.get_plan_purchase_pix_instructions(uuid) from public, anon;
grant execute on function public.get_plan_purchase_pix_instructions(uuid) to authenticated, service_role;

revoke all on function public.list_plan_purchase_requests(text) from public, anon;
grant execute on function public.list_plan_purchase_requests(text) to authenticated, service_role;

revoke all on function public.confirm_plan_purchase_request(uuid,numeric,text,text) from public, anon;
grant execute on function public.confirm_plan_purchase_request(uuid,numeric,text,text) to authenticated, service_role;

revoke all on function public.reject_plan_purchase_request(uuid,text) from public, anon;
grant execute on function public.reject_plan_purchase_request(uuid,text) to authenticated, service_role;

revoke all on function public.manage_subscription(text, uuid) from public, anon;
grant execute on function public.manage_subscription(text, uuid) to authenticated;

notify pgrst, 'reload schema';
