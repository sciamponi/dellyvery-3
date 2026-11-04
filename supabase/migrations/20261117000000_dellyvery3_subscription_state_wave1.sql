-- DELLVERY 3 - Onda 1 de assinatura: estado, duracao, trial 0, plano gratuito,
-- carencia configuravel e permissoes Master.
--
-- Aditiva e segura:
--   - nao edita migrations historicas;
--   - o gate novo fica desligado por padrao (platform_settings.subscription_gate_enabled);
--   - enquanto o gate estiver desligado, company_has_active_access mantem o
--     comportamento anterior para nao bloquear empresas legadas;
--   - nenhum valor comercial e inventado: carencia inicial = 0, definida no Master.

-- =========================
-- 1. Plano gratuito explicito (nao inferir por preco)
-- =========================
alter table public.plans
  add column if not exists is_free boolean not null default false;

-- =========================
-- 2. Estado de cancelamento
-- =========================
alter table public.subscriptions
  add column if not exists canceled_at timestamptz;

update public.subscriptions
set canceled_at = coalesce(canceled_at, updated_at)
where status = 'cancelado'
  and canceled_at is null;

create or replace function public.set_subscription_canceled_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelado' then
      new.canceled_at := coalesce(new.canceled_at, now());
    end if;
  elsif new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
  elsif new.status <> 'cancelado' then
    new.canceled_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_subscriptions_canceled_at on public.subscriptions;
create trigger trg_subscriptions_canceled_at
before insert or update on public.subscriptions
for each row execute function public.set_subscription_canceled_at();

-- =========================
-- 3. Configuracao global de assinatura
-- =========================
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  subscription_grace_days integer not null default 0
    check (subscription_grace_days >= 0),
  subscription_gate_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.platform_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists trg_platform_settings_updated_at on public.platform_settings;
create trigger trg_platform_settings_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_select_admin on public.platform_settings;
create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated
  using (public.is_platform_admin());

revoke all on table public.platform_settings from public, anon;
grant select on table public.platform_settings to authenticated, service_role;

-- =========================
-- 4. Concessoes de carencia com snapshot
-- =========================
create table if not exists public.company_grace_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  grace_days integer not null check (grace_days >= 0),
  grace_until timestamptz not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  reason text,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_company_grace_grants_company
  on public.company_grace_grants(company_id, grace_until desc);

create unique index if not exists uq_company_grace_grants_open
  on public.company_grace_grants(company_id)
  where revoked_at is null;

alter table public.company_grace_grants enable row level security;

drop policy if exists company_grace_grants_select_member on public.company_grace_grants;
create policy company_grace_grants_select_member on public.company_grace_grants
  for select to authenticated
  using (
    public.is_platform_admin()
    or public.is_company_member_raw(company_id)
  );

revoke all on table public.company_grace_grants from public, anon;
grant select on table public.company_grace_grants to authenticated, service_role;

-- =========================
-- 5. Estado derivado de acesso
-- =========================
create or replace function public.subscription_access_state(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_has_sub boolean := false;
  v_plan_free boolean := false;
  v_has_grace boolean := false;
begin
  if p_company_id is null then
    return 'blocked';
  end if;

  if public.is_platform_admin() then
    return 'platform_admin';
  end if;

  select * into v_sub
  from public.subscriptions
  where company_id = p_company_id;
  v_has_sub := found;

  if v_has_sub then
    select coalesce(p.is_free, false)
    into v_plan_free
    from public.plans p
    where p.id = v_sub.plan_id;
    v_plan_free := coalesce(v_plan_free, false);
  end if;

  select exists (
    select 1
    from public.company_grace_grants g
    where g.company_id = p_company_id
      and g.revoked_at is null
      and g.grace_until > now()
  ) into v_has_grace;

  if not v_has_sub then
    return case when v_has_grace then 'grace' else 'blocked' end;
  end if;

  if v_sub.status = 'suspenso' then
    return 'suspended';
  end if;

  if v_sub.status = 'pendente' then
    return 'payment_pending';
  end if;

  if v_plan_free and v_sub.status in ('ativo', 'trial') then
    return 'free_active';
  end if;

  if v_sub.status = 'trial' then
    if v_sub.expires_at is not null and v_sub.expires_at > now() then
      return 'trial_active';
    end if;
    return case when v_has_grace then 'grace' else 'trial_expired' end;
  end if;

  if v_sub.status = 'ativo' then
    if v_sub.expires_at is not null and v_sub.expires_at > now() then
      return 'paid_active';
    end if;
    return case when v_has_grace then 'grace' else 'expired' end;
  end if;

  if v_sub.status = 'cancelado' then
    if v_sub.expires_at is not null and v_sub.expires_at > now() then
      return 'canceled_until_end';
    end if;
    return case when v_has_grace then 'grace' else 'canceled' end;
  end if;

  if v_sub.status = 'expirado' then
    return case when v_has_grace then 'grace' else 'expired' end;
  end if;

  return 'blocked';
end;
$$;

revoke all on function public.subscription_access_state(uuid)
  from public, anon, authenticated;
grant execute on function public.subscription_access_state(uuid)
  to service_role;

-- =========================
-- 6. Gate de acesso com chave de rollout
-- =========================
create or replace function public.company_has_active_access(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_gate boolean := false;
  v_state text;
begin
  if p_company_id is null then
    return false;
  end if;

  if public.is_platform_admin() then
    return true;
  end if;

  select coalesce(subscription_gate_enabled, false)
  into v_gate
  from public.platform_settings
  where id = true;
  v_gate := coalesce(v_gate, false);

  -- Rollout seguro: sem o gate ligado, preserva o comportamento anterior.
  if not v_gate then
    if not exists (
      select 1
      from public.reseller_clients rc
      where rc.company_id = p_company_id
    ) then
      return true;
    end if;

    return exists (
      select 1
      from public.reseller_clients rc
      join public.subscriptions s on s.company_id = rc.company_id
      where rc.company_id = p_company_id
        and s.expires_at is not null
        and s.expires_at > now()
        and s.status not in ('cancelado', 'suspenso', 'expirado')
    );
  end if;

  v_state := public.subscription_access_state(p_company_id);
  return v_state in (
    'trial_active',
    'paid_active',
    'free_active',
    'grace',
    'canceled_until_end'
  );
end;
$$;

revoke all on function public.company_has_active_access(uuid) from public, anon;
grant execute on function public.company_has_active_access(uuid)
  to authenticated, service_role;

-- =========================
-- 7. RPCs de configuracao (somente PLATFORM_ADMIN)
-- =========================
create or replace function public.set_subscription_grace_days(p_days integer)
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
    raise exception 'Apenas PLATFORM_ADMIN pode alterar a carencia';
  end if;

  if p_days is null or p_days < 0 then
    raise exception 'Dias de carencia invalidos';
  end if;

  select subscription_grace_days into v_old
  from public.platform_settings
  where id = true
  for update;

  update public.platform_settings
  set subscription_grace_days = p_days,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'subscription_grace_days_updated', 'platform_settings', null,
    jsonb_build_object('old_days', v_old, 'new_days', p_days)
  );

  return v_row;
end;
$$;

revoke all on function public.set_subscription_grace_days(integer)
  from public, anon;
grant execute on function public.set_subscription_grace_days(integer)
  to authenticated, service_role;

create or replace function public.set_subscription_gate_enabled(p_enabled boolean)
returns public.platform_settings
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old boolean;
  v_row public.platform_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas PLATFORM_ADMIN pode alterar o gate';
  end if;

  if p_enabled is null then
    raise exception 'Estado do gate invalido';
  end if;

  select subscription_gate_enabled into v_old
  from public.platform_settings
  where id = true
  for update;

  update public.platform_settings
  set subscription_gate_enabled = p_enabled,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'subscription_gate_updated', 'platform_settings', null,
    jsonb_build_object('old_enabled', v_old, 'new_enabled', p_enabled)
  );

  return v_row;
end;
$$;

revoke all on function public.set_subscription_gate_enabled(boolean)
  from public, anon;
grant execute on function public.set_subscription_gate_enabled(boolean)
  to authenticated, service_role;

-- =========================
-- 8. Concessao manual de carencia (snapshot)
-- =========================
create or replace function public.grant_company_grace(
  p_company_id uuid,
  p_days integer default null,
  p_reason text default null
)
returns public.company_grace_grants
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sub_id uuid;
  v_base timestamptz;
  v_until timestamptz;
  v_row public.company_grace_grants%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Apenas PLATFORM_ADMIN pode conceder carencia';
  end if;

  if p_company_id is null then
    raise exception 'Empresa nao informada';
  end if;

  if p_days is null then
    select subscription_grace_days into p_days
    from public.platform_settings
    where id = true;
  end if;

  if p_days is null or p_days < 0 then
    raise exception 'Dias de carencia invalidos';
  end if;

  perform 1
  from public.companies
  where id = p_company_id
  for update;

  if not found then
    raise exception 'Empresa nao encontrada';
  end if;

  select s.id, greatest(now(), coalesce(s.expires_at, now()))
  into v_sub_id, v_base
  from public.subscriptions s
  where s.company_id = p_company_id;

  if not found then
    v_sub_id := null;
    v_base := now();
  end if;

  update public.company_grace_grants
  set revoked_at = now()
  where company_id = p_company_id
    and revoked_at is null;

  v_until := v_base + make_interval(days => p_days);

  insert into public.company_grace_grants (
    company_id, subscription_id, grace_days, grace_until, granted_by, reason
  ) values (
    p_company_id, v_sub_id, p_days, v_until, auth.uid(), nullif(btrim(p_reason), '')
  )
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    p_company_id, auth.uid(), 'company_grace_granted', 'company_grace_grant', v_row.id,
    jsonb_build_object(
      'grace_days', p_days,
      'grace_until', v_until,
      'subscription_id', v_sub_id
    )
  );

  return v_row;
end;
$$;

revoke all on function public.grant_company_grace(uuid, integer, text)
  from public, anon;
grant execute on function public.grant_company_grace(uuid, integer, text)
  to authenticated, service_role;

-- =========================
-- 9. Estado seguro para a propria empresa
-- =========================
create or replace function public.get_company_subscription_state(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_company_id is null then
    return 'blocked';
  end if;

  if not (
    public.is_company_member_raw(p_company_id)
    or public.is_platform_admin()
  ) then
    raise exception 'sem permissao';
  end if;

  return public.subscription_access_state(p_company_id);
end;
$$;

revoke all on function public.get_company_subscription_state(uuid)
  from public, anon;
grant execute on function public.get_company_subscription_state(uuid)
  to authenticated, service_role;

-- =========================
-- 10. Onboarding usa plans.trial_days (inclusive 0) e plano gratuito explicito
-- =========================
create or replace function public.create_company_with_owner(
  p_name text,
  p_slug text,
  p_segment_id uuid,
  p_description text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_company_id uuid;
  v_slug text;
  v_plan_id uuid;
  v_trial_days integer;
  v_plan_free boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where user_id = auth.uid()
  ) then
    raise exception 'Sua empresa e gerenciada por um revendedor. Aguarde a ativacao do acesso';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug is required';
  end if;

  v_slug := lower(regexp_replace(btrim(p_slug), '[^a-z0-9]+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '(^-|-$)', '', 'g');
  if v_slug = '' then
    raise exception 'invalid slug';
  end if;

  if exists (select 1 from public.companies where slug = v_slug) then
    raise exception 'slug already exists';
  end if;

  insert into public.companies (name, slug, segment_id, description, phone, email, address)
  values (btrim(p_name), v_slug, p_segment_id, p_description, p_phone, p_email, p_address)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role, active)
  values (v_company_id, auth.uid(), 'OWNER', true);

  select id, coalesce(trial_days, 7), coalesce(is_free, false)
  into v_plan_id, v_trial_days, v_plan_free
  from public.plans
  where slug = 'solo'
  limit 1;

  if v_plan_id is not null then
    if v_plan_free then
      insert into public.subscriptions (
        company_id, plan_id, status, started_at, expires_at
      ) values (
        v_company_id, v_plan_id, 'ativo', now(), null
      )
      on conflict (company_id) do nothing;
    else
      insert into public.subscriptions (
        company_id, plan_id, status, started_at, expires_at
      ) values (
        v_company_id, v_plan_id, 'trial', now(), now() + make_interval(days => v_trial_days)
      )
      on conflict (company_id) do nothing;
    end if;
  end if;

  insert into public.company_order_seq (company_id, last_number)
  values (v_company_id, 0)
  on conflict (company_id) do nothing;

  insert into public.company_settings (company_id, settings)
  values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  insert into public.store_themes (company_id)
  values (v_company_id)
  on conflict (company_id) do nothing;

  return v_company_id;
end;
$$;

revoke all on function public.create_company_with_owner(text,text,uuid,text,text,text,text)
  from public, anon;
grant execute on function public.create_company_with_owner(text,text,uuid,text,text,text,text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
