-- DELLVERY 3 - Cliente final da revenda: convite, conta, empresa e ativacao.
--
-- Regras desta fase:
--   * convite por link de 7 dias, com token armazenado somente como hash;
--   * o cliente cria a propria senha e precisa ter e-mail confirmado;
--   * aceitar o convite nao cria empresa nem consome credito;
--   * a ativacao/renovacao consome exatamente 1 credito e usa a duracao do
--     plano configurada pelo Master (plans.access_days);
--   * empresa, membership OWNER e assinatura sao criadas no backend;
--   * renovacao ativa soma ao vencimento atual; vencida comeca em now();
--   * a RPC antiga (creditos/datas livres) e removida.

-- =========================
-- Vinculo do cliente com conta e empresa
-- =========================
alter table public.reseller_clients
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists activated_at timestamptz,
  add column if not exists access_expires_at timestamptz;

create unique index if not exists uq_reseller_clients_user
  on public.reseller_clients (user_id)
  where user_id is not null;

create unique index if not exists uq_reseller_clients_company
  on public.reseller_clients (company_id)
  where company_id is not null;

-- Conta/empresa so podem ser definidas pelas RPCs SECURITY DEFINER abaixo.
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
  if (
    new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id
    or new.activated_at is distinct from old.activated_at
    or new.access_expires_at is distinct from old.access_expires_at
  )
  and current_user not in ('postgres', 'supabase_admin')
  and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
  end if;
  return new;
end;
$$;

-- =========================
-- Historico de ativacoes: snapshot da duracao, empresa e idempotencia
-- =========================
alter table public.reseller_activations
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists access_days integer,
  add column if not exists previous_expires_at timestamptz,
  add column if not exists new_expires_at timestamptz,
  add column if not exists idempotency_key uuid,
  add column if not exists kind text not null default 'legacy';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reseller_activations_access_days_check'
      and conrelid = 'public.reseller_activations'::regclass
  ) then
    alter table public.reseller_activations
      add constraint reseller_activations_access_days_check
      check (access_days is null or access_days > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reseller_activations_kind_check'
      and conrelid = 'public.reseller_activations'::regclass
  ) then
    alter table public.reseller_activations
      add constraint reseller_activations_kind_check
      check (kind in ('first_activation', 'renewal', 'legacy'));
  end if;
end $$;

create unique index if not exists uq_reseller_activations_idempotency
  on public.reseller_activations (reseller_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_reseller_activations_company
  on public.reseller_activations (company_id, created_at desc);

-- =========================
-- Convites de cliente final
-- =========================
create table if not exists public.reseller_client_invites (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  client_id uuid not null,
  token_hash text not null unique check (length(token_hash) = 64),
  invited_email text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reseller_client_invites_client_fk
    foreign key (client_id, reseller_id)
    references public.reseller_clients (id, reseller_id)
    on delete cascade
);

create unique index if not exists uq_reseller_client_invites_pending
  on public.reseller_client_invites (client_id)
  where status = 'pending';

create index if not exists idx_reseller_client_invites_reseller
  on public.reseller_client_invites (reseller_id, created_at desc);

drop trigger if exists trg_reseller_client_invites_updated_at on public.reseller_client_invites;
create trigger trg_reseller_client_invites_updated_at
before update on public.reseller_client_invites
for each row execute function public.set_updated_at();

alter table public.reseller_client_invites enable row level security;

-- Nenhum acesso direto: token_hash nao e exposto. Leitura/escrita via RPC.
revoke all on table public.reseller_client_invites from public, anon, authenticated;
grant all on table public.reseller_client_invites to service_role;

-- =========================
-- Convite: criar / revogar / listar / resolver
-- =========================
create or replace function public.create_reseller_client_invite(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_token text;
  v_hash text;
  v_expires timestamptz;
  v_invite_id uuid;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = p_client_id
    and reseller_id = v_reseller_id
  for update;

  if not found then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;
  if v_client.user_id is not null or v_client.company_id is not null then
    raise exception 'Cliente ja possui conta vinculada';
  end if;
  if btrim(coalesce(v_client.email, '')) = '' then
    raise exception 'Cadastre o e-mail do cliente antes de gerar o convite';
  end if;

  update public.reseller_client_invites
  set status = 'revoked',
      revoked_at = now()
  where client_id = v_client.id
    and status = 'pending';

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.reseller_client_invites (
    reseller_id, client_id, token_hash, invited_email, expires_at, created_by
  )
  values (
    v_reseller_id, v_client.id, v_hash, lower(btrim(v_client.email)), v_expires, auth.uid()
  )
  returning id into v_invite_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_client_invite_created', 'reseller_client', v_client.id,
    jsonb_build_object(
      'invite_id', v_invite_id,
      'reseller_id', v_reseller_id,
      'email', lower(btrim(v_client.email)),
      'expires_at', v_expires
    )
  );

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'client_id', v_client.id,
    'token', v_token,
    'invited_email', lower(btrim(v_client.email)),
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.revoke_reseller_client_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_invite public.reseller_client_invites%rowtype;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_invite_id is null then
    raise exception 'Convite nao informado';
  end if;

  select *
  into v_invite
  from public.reseller_client_invites
  where id = p_invite_id
    and reseller_id = v_reseller_id
  for update;

  if not found then
    raise exception 'Convite nao encontrado ou sem permissao';
  end if;

  if v_invite.status = 'revoked' then
    return jsonb_build_object('invite_id', v_invite.id, 'status', 'revoked', 'reused', true);
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Convite nao pode mais ser revogado';
  end if;

  update public.reseller_client_invites
  set status = 'revoked',
      revoked_at = now()
  where id = v_invite.id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_client_invite_revoked', 'reseller_client', v_invite.client_id,
    jsonb_build_object('invite_id', v_invite.id, 'reseller_id', v_reseller_id)
  );

  return jsonb_build_object('invite_id', v_invite.id, 'status', 'revoked', 'reused', false);
end;
$$;

create or replace function public.list_reseller_client_invites()
returns table (
  invite_id uuid,
  client_id uuid,
  invited_email text,
  status text,
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.client_id,
    i.invited_email,
    case
      when i.status = 'pending' and i.expires_at <= now() then 'expired'
      else i.status
    end,
    i.expires_at,
    i.accepted_at,
    i.created_at
  from public.reseller_client_invites i
  where i.reseller_id = public.current_reseller_id()
  order by i.created_at desc;
$$;

create or replace function public.resolve_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invite public.reseller_client_invites%rowtype;
  v_client public.reseller_clients%rowtype;
  v_reseller_name text;
  v_status text;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite nao encontrado';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.reseller_client_invites
  where token_hash = v_hash;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = v_invite.client_id
    and reseller_id = v_invite.reseller_id;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  select coalesce(nullif(btrim(p.name), ''), 'Revendedor')
  into v_reseller_name
  from public.resellers r
  left join public.profiles p on p.id = r.user_id
  where r.id = v_invite.reseller_id;

  v_status := case
    when v_invite.status = 'pending' and v_invite.expires_at <= now() then 'expired'
    else v_invite.status
  end;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'client_id', v_client.id,
    'client_name', coalesce(nullif(btrim(v_client.trade_name), ''), v_client.name),
    'reseller_name', coalesce(v_reseller_name, 'Revendedor'),
    'invited_email', v_invite.invited_email,
    'status', v_status,
    'expires_at', v_invite.expires_at
  );
end;
$$;

-- =========================
-- Aceite do convite pelo cliente final
-- =========================
create or replace function public.claim_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_auth record;
  v_hash text;
  v_invite public.reseller_client_invites%rowtype;
  v_client public.reseller_clients%rowtype;
  v_auth_email text;
  v_profile_name text;
begin
  if v_actor is null then
    raise exception 'Entre na sua conta para aceitar o convite';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite nao encontrado';
  end if;

  select id, email, email_confirmed_at, raw_user_meta_data
  into v_auth
  from auth.users
  where id = v_actor;

  if not found then
    raise exception 'Usuario nao encontrado';
  end if;

  v_auth_email := lower(btrim(coalesce(v_auth.email, '')));
  if v_auth_email = '' then
    raise exception 'Sua conta nao possui e-mail';
  end if;
  if v_auth.email_confirmed_at is null then
    raise exception 'Confirme seu e-mail antes de aceitar o convite';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.reseller_client_invites
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = v_invite.client_id
    and reseller_id = v_invite.reseller_id
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  if v_invite.status = 'accepted' then
    if v_invite.accepted_by = v_actor then
      return jsonb_build_object(
        'client_id', v_client.id,
        'reseller_id', v_invite.reseller_id,
        'status', 'accepted',
        'reused', true
      );
    end if;
    raise exception 'Convite ja utilizado por outra conta';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Convite nao esta mais disponivel';
  end if;
  if v_invite.expires_at <= now() then
    update public.reseller_client_invites
    set status = 'expired'
    where id = v_invite.id;
    raise exception 'Convite expirado. Solicite um novo link ao revendedor';
  end if;
  if v_invite.invited_email <> v_auth_email then
    raise exception 'Entre com o e-mail que recebeu o convite (%)', v_invite.invited_email;
  end if;
  if v_client.user_id is not null and v_client.user_id <> v_actor then
    raise exception 'Cliente ja vinculado a outra conta';
  end if;

  if exists (
    select 1
    from public.company_members
    where user_id = v_actor
      and active = true
  ) then
    raise exception 'Esta conta ja possui uma empresa. Use uma conta sem empresa para aceitar o convite';
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where user_id = v_actor
      and id <> v_client.id
  ) then
    raise exception 'Esta conta ja esta vinculada a outro cliente de revenda';
  end if;

  v_profile_name := coalesce(
    nullif(btrim(v_auth.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(v_client.name), ''),
    split_part(v_auth_email, '@', 1)
  );

  insert into public.profiles (id, email, name, platform_role)
  values (v_actor, v_auth_email, v_profile_name, 'USER')
  on conflict (id) do update
  set email = excluded.email,
      name = coalesce(public.profiles.name, excluded.name),
      updated_at = now();

  update public.reseller_clients
  set user_id = v_actor
  where id = v_client.id
    and reseller_id = v_invite.reseller_id;

  update public.reseller_client_invites
  set status = 'accepted',
      accepted_by = v_actor,
      accepted_at = now()
  where id = v_invite.id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, v_actor, 'reseller_client_invite_accepted', 'reseller_client', v_client.id,
    jsonb_build_object(
      'invite_id', v_invite.id,
      'reseller_id', v_invite.reseller_id,
      'email', v_auth_email
    )
  );

  return jsonb_build_object(
    'client_id', v_client.id,
    'reseller_id', v_invite.reseller_id,
    'status', 'accepted',
    'reused', false
  );
end;
$$;

-- =========================
-- Estado de acesso do proprio cliente (para onboarding/aguardando/vencido)
-- =========================
create or replace function public.get_my_reseller_client_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.reseller_clients%rowtype;
  v_reseller_name text;
  v_company_name text;
  v_plan_name text;
  v_sub_status text;
  v_sub_expires timestamptz;
  v_status text;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select c.*
  into v_client
  from public.reseller_clients c
  where c.user_id = v_actor
  order by c.activated_at desc nulls last, c.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(nullif(btrim(p.name), ''), 'Revendedor')
  into v_reseller_name
  from public.resellers r
  left join public.profiles p on p.id = r.user_id
  where r.id = v_client.reseller_id;

  if v_client.company_id is not null then
    select co.name
    into v_company_name
    from public.companies co
    where co.id = v_client.company_id;

    select s.status::text, s.expires_at, pl.name
    into v_sub_status, v_sub_expires, v_plan_name
    from public.subscriptions s
    left join public.plans pl on pl.id = s.plan_id
    where s.company_id = v_client.company_id;
  end if;

  v_status := case
    when v_client.company_id is null then 'pending'
    when coalesce(v_sub_expires, v_client.access_expires_at) is null then 'expired'
    when coalesce(v_sub_expires, v_client.access_expires_at) <= now() then 'expired'
    when coalesce(v_sub_status, 'ativo') in ('cancelado', 'suspenso', 'expirado') then 'expired'
    else 'active'
  end;

  return jsonb_build_object(
    'client_id', v_client.id,
    'reseller_id', v_client.reseller_id,
    'reseller_name', coalesce(v_reseller_name, 'Revendedor'),
    'client_name', coalesce(nullif(btrim(v_client.trade_name), ''), v_client.name),
    'company_id', v_client.company_id,
    'company_name', v_company_name,
    'plan_name', v_plan_name,
    'status', v_status,
    'activated_at', v_client.activated_at,
    'access_expires_at', coalesce(v_sub_expires, v_client.access_expires_at)
  );
end;
$$;

-- =========================
-- Ativacao/renovacao v2: 1 credito + duracao do plano
-- =========================
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
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_activation public.reseller_activations%rowtype;
  v_balance integer;
  v_company_id uuid;
  v_company_name text;
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
  v_segment_id uuid;
  v_previous_expires timestamptz;
  v_base timestamptz;
  v_new_expires timestamptz;
  v_kind text;
  v_activation_id uuid;
  v_is_first boolean;
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

  -- Serializa operacoes concorrentes do mesmo revendedor (saldo/credito).
  perform 1
  from public.resellers
  where id = v_reseller_id
  for update;

  select *
  into v_activation
  from public.reseller_activations
  where reseller_id = v_reseller_id
    and idempotency_key = p_idempotency_key;

  if found then
    select coalesce(sum(amount), 0)::integer
    into v_balance
    from public.reseller_credit_entries
    where reseller_id = v_reseller_id;

    return jsonb_build_object(
      'activation_id', v_activation.id,
      'client_id', v_activation.client_id,
      'company_id', v_activation.company_id,
      'plan_id', v_activation.plan_id,
      'plan_name', v_activation.plan_name,
      'access_days', v_activation.access_days,
      'previous_expires_at', v_activation.previous_expires_at,
      'new_expires_at', v_activation.new_expires_at,
      'expires_at', v_activation.new_expires_at,
      'credits', v_activation.credits,
      'kind', v_activation.kind,
      'balance', coalesce(v_balance, 0),
      'reused', true
    );
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = p_client_id
    and reseller_id = v_reseller_id
  for update;

  if not found then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;
  if v_client.user_id is null then
    raise exception 'O cliente ainda nao aceitou o convite e criou a conta';
  end if;

  select *
  into v_plan
  from public.plans
  where id = p_plan_id
    and active = true
  for share;

  if not found then
    raise exception 'Plano indisponivel';
  end if;
  if coalesce(v_plan.access_days, 0) <= 0 then
    raise exception 'Plano sem duracao de acesso configurada. O Master precisa configurar os dias do plano';
  end if;

  select coalesce(sum(amount), 0)::integer
  into v_balance
  from public.reseller_credit_entries
  where reseller_id = v_reseller_id;

  if v_balance < 1 then
    raise exception 'Saldo insuficiente. Disponivel: % creditos', v_balance;
  end if;

  v_is_first := v_client.company_id is null;
  v_company_id := v_client.company_id;
  v_previous_expires := null;

  if v_is_first then
    if exists (
      select 1
      from public.company_members
      where user_id = v_client.user_id
        and active = true
    ) then
      raise exception 'O cliente ja possui uma empresa. Nao e possivel criar outra automaticamente';
    end if;

    v_company_name := coalesce(nullif(btrim(v_client.trade_name), ''), v_client.name);
    v_slug_base := lower(translate(v_company_name,
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
    v_slug_base := trim(both '-' from regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g'));
    if v_slug_base = '' then
      v_slug_base := 'empresa';
    end if;
    v_slug_base := left(v_slug_base, 48);
    v_slug := v_slug_base;

    while exists (select 1 from public.companies where slug = v_slug) loop
      v_suffix := v_suffix + 1;
      v_slug := left(v_slug_base, 40) || '-' || v_suffix;
    end loop;

    select id
    into v_segment_id
    from public.business_segments
    where slug = 'restaurant'
    limit 1;

    insert into public.companies (
      name, slug, segment_id, description, phone, email, address, city, state
    )
    values (
      v_company_name,
      v_slug,
      v_segment_id,
      'Empresa criada pela ativacao do revendedor',
      nullif(btrim(v_client.phone), ''),
      nullif(btrim(v_client.email), ''),
      null,
      nullif(btrim(v_client.city), ''),
      nullif(btrim(v_client.state), '')
    )
    returning id into v_company_id;

    insert into public.company_members (company_id, user_id, role, active)
    values (v_company_id, v_client.user_id, 'OWNER', true);

    insert into public.company_order_seq (company_id, last_number)
    values (v_company_id, 0)
    on conflict (company_id) do nothing;

    insert into public.company_settings (company_id, settings)
    values (v_company_id, '{}'::jsonb)
    on conflict (company_id) do nothing;

    insert into public.store_themes (company_id)
    values (v_company_id)
    on conflict (company_id) do nothing;

    insert into public.subscriptions (
      company_id, plan_id, status, started_at, expires_at
    )
    values (
      v_company_id, v_plan.id, 'ativo', now(), now() + make_interval(days => v_plan.access_days)
    )
    returning * into v_sub;

    v_new_expires := v_sub.expires_at;
    v_kind := 'first_activation';
  else
    select *
    into v_sub
    from public.subscriptions
    where company_id = v_company_id
    for update;

    if found then
      v_previous_expires := coalesce(v_sub.expires_at, v_client.access_expires_at);
    else
      v_previous_expires := v_client.access_expires_at;
    end if;

    v_base := case
      when v_previous_expires is not null and v_previous_expires > now() then v_previous_expires
      else now()
    end;
    v_new_expires := v_base + make_interval(days => v_plan.access_days);
    v_kind := 'renewal';

    if found then
      update public.subscriptions
      set plan_id = v_plan.id,
          status = 'ativo',
          started_at = coalesce(started_at, now()),
          expires_at = v_new_expires
      where company_id = v_company_id
      returning * into v_sub;
    else
      insert into public.subscriptions (
        company_id, plan_id, status, started_at, expires_at
      )
      values (
        v_company_id, v_plan.id, 'ativo', now(), v_new_expires
      )
      returning * into v_sub;
    end if;
  end if;

  insert into public.reseller_activations (
    reseller_id, client_id, client_name, plan_id, plan_name, credits,
    starts_on, expires_on, status, created_by, company_id, access_days,
    previous_expires_at, new_expires_at, idempotency_key, kind
  )
  values (
    v_reseller_id,
    v_client.id,
    v_client.name,
    v_plan.id,
    v_plan.name,
    1,
    coalesce(v_previous_expires, now())::date,
    v_new_expires::date,
    'ativa',
    auth.uid(),
    v_company_id,
    v_plan.access_days,
    v_previous_expires,
    v_new_expires,
    p_idempotency_key,
    v_kind
  )
  returning id into v_activation_id;

  insert into public.reseller_credit_entries (
    reseller_id, activation_id, kind, amount, reason, created_by
  )
  values (
    v_reseller_id,
    v_activation_id,
    'ativacao',
    -1,
    case when v_kind = 'renewal'
      then 'Renovacao de ' || v_client.name || ' no plano ' || v_plan.name
      else 'Ativacao de ' || v_client.name || ' no plano ' || v_plan.name
    end,
    auth.uid()
  );

  update public.reseller_clients
  set status = 'ativo',
      company_id = v_company_id,
      activated_at = coalesce(activated_at, now()),
      access_expires_at = v_new_expires
  where id = v_client.id
    and reseller_id = v_reseller_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    v_company_id, auth.uid(), 'reseller_activation_created', 'reseller_activation', v_activation_id,
    jsonb_build_object(
      'reseller_id', v_reseller_id,
      'client_id', v_client.id,
      'plan_id', v_plan.id,
      'access_days', v_plan.access_days,
      'credits', 1,
      'kind', v_kind,
      'previous_expires_at', v_previous_expires,
      'new_expires_at', v_new_expires
    )
  );

  return jsonb_build_object(
    'activation_id', v_activation_id,
    'client_id', v_client.id,
    'company_id', v_company_id,
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'access_days', v_plan.access_days,
    'previous_expires_at', v_previous_expires,
    'new_expires_at', v_new_expires,
    'expires_at', v_new_expires,
    'credits', 1,
    'kind', v_kind,
    'balance', v_balance - 1,
    'reused', false
  );
end;
$$;

-- A assinatura antiga permitia 0 creditos e datas livres. Remover o caminho.
drop function if exists public.activate_reseller_client(uuid, uuid, integer, date, date);

-- =========================
-- Grants
-- =========================
revoke all on function public.create_reseller_client_invite(uuid) from public, anon;
revoke all on function public.revoke_reseller_client_invite(uuid) from public, anon;
revoke all on function public.list_reseller_client_invites() from public, anon;
revoke all on function public.resolve_reseller_client_invite(text) from public;
revoke all on function public.claim_reseller_client_invite(text) from public, anon;
revoke all on function public.get_my_reseller_client_access() from public, anon;
revoke all on function public.activate_reseller_client_v2(uuid, uuid, uuid) from public, anon;

grant execute on function public.create_reseller_client_invite(uuid) to authenticated;
grant execute on function public.revoke_reseller_client_invite(uuid) to authenticated;
grant execute on function public.list_reseller_client_invites() to authenticated;
grant execute on function public.resolve_reseller_client_invite(text) to anon, authenticated;
grant execute on function public.claim_reseller_client_invite(text) to authenticated;
grant execute on function public.get_my_reseller_client_access() to authenticated;
grant execute on function public.activate_reseller_client_v2(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
