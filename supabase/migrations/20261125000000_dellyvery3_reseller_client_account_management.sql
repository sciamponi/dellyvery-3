-- DELLVERY 3 - Gestao do vinculo entre carteira de revenda e conta real.
--
-- Objetivos:
--   * o revendedor enxerga o estado real da conta (empresa + assinatura),
--     sem depender apenas do rotulo "Ativo" da carteira;
--   * editar dados publicos do estabelecimento vinculado, com whitelist;
--   * suspender a operacao sem apagar dados e sem alterar o vinculo;
--   * Master (PLATFORM_ADMIN) audita qualquer carteira e corrige vinculos.
--
-- Regras:
--   * nenhuma funcao aceita reseller_id vindo do frontend;
--   * o vinculo so muda por ativacao ou pela correcao explicita do Master;
--   * 1 credito continua concedendo a duracao configurada no plano
--     (padrao de 30 dias nesta fase);
--   * suspender nao remove dados, apenas bloqueia a operacao.

-- =========================
-- Duracao padrao: 1 credito = 30 dias
-- =========================
alter table public.plans
  alter column access_days set default 30;

update public.plans
set access_days = 30
where access_days is null;

-- =========================
-- Helpers internos
-- =========================
create or replace function public.reseller_client_account_state(p_client_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client public.reseller_clients%rowtype;
  v_sub public.subscriptions%rowtype;
begin
  select * into v_client
  from public.reseller_clients
  where id = p_client_id;

  if not found then
    return null;
  end if;

  if v_client.company_id is null then
    return case when v_client.user_id is null then 'unlinked' else 'awaiting_activation' end;
  end if;

  select * into v_sub
  from public.subscriptions
  where company_id = v_client.company_id;

  if not found then
    return 'incomplete';
  end if;

  if v_sub.status = 'suspenso' then
    return 'suspended';
  end if;
  if v_sub.status = 'cancelado' then
    return 'cancelled';
  end if;
  if v_sub.status = 'expirado' then
    return 'expired';
  end if;
  if v_sub.expires_at is null or v_sub.expires_at <= now() then
    return 'expired';
  end if;

  return 'active';
end;
$$;

alter function public.reseller_client_account_state(uuid) owner to postgres;
revoke all on function public.reseller_client_account_state(uuid)
  from public, anon, authenticated, service_role;

-- =========================
-- Lista da carteira com o estado real da conta
-- =========================
create or replace function public.list_reseller_client_accounts(
  p_reseller_id uuid default null
)
returns table (
  client_id uuid,
  reseller_id uuid,
  name text,
  trade_name text,
  status text,
  email text,
  phone text,
  city text,
  state text,
  document text,
  notes text,
  has_user boolean,
  company_id uuid,
  company_name text,
  company_slug text,
  company_active boolean,
  plan_id uuid,
  plan_name text,
  access_days integer,
  subscription_status text,
  subscription_expires_at timestamptz,
  activated_at timestamptz,
  access_expires_at timestamptz,
  account_state text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_is_master boolean := public.is_platform_admin();
  v_own_reseller uuid := public.current_reseller_id();
  v_filter uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if v_is_master then
    v_filter := p_reseller_id;
  else
    if v_own_reseller is null then
      raise exception 'Acesso de revenda inativo';
    end if;
    v_filter := v_own_reseller;
  end if;

  return query
  select
    rc.id as client_id,
    rc.reseller_id,
    rc.name,
    coalesce(rc.trade_name, '') as trade_name,
    rc.status,
    coalesce(rc.email, '') as email,
    coalesce(rc.phone, '') as phone,
    coalesce(rc.city, '') as city,
    coalesce(rc.state, '') as state,
    coalesce(rc.document, '') as document,
    coalesce(rc.notes, '') as notes,
    rc.user_id is not null as has_user,
    rc.company_id,
    co.name as company_name,
    co.slug as company_slug,
    co.active as company_active,
    pl.id as plan_id,
    pl.name as plan_name,
    pl.access_days,
    s.status::text as subscription_status,
    s.expires_at as subscription_expires_at,
    rc.activated_at,
    rc.access_expires_at,
    public.reseller_client_account_state(rc.id) as account_state,
    rc.created_at,
    rc.updated_at
  from public.reseller_clients rc
  left join public.companies co on co.id = rc.company_id
  left join public.subscriptions s on s.company_id = rc.company_id
  left join public.plans pl on pl.id = s.plan_id
  where (v_filter is null or rc.reseller_id = v_filter)
  order by rc.created_at desc;
end;
$$;

alter function public.list_reseller_client_accounts(uuid) owner to postgres;
revoke all on function public.list_reseller_client_accounts(uuid) from public, anon;
grant execute on function public.list_reseller_client_accounts(uuid)
  to authenticated, service_role;

-- =========================
-- Detalhes da conta real vinculada
-- =========================
create or replace function public.get_reseller_client_account(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_is_master boolean := public.is_platform_admin();
  v_own_reseller uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_company public.companies%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_has_company boolean;
  v_has_sub boolean;
  v_state text;
  v_activation_history jsonb;
  v_recent_events jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;

  select * into v_client
  from public.reseller_clients
  where id = p_client_id;

  if not found then
    raise exception 'Cliente nao encontrado';
  end if;

  if not v_is_master and v_client.reseller_id is distinct from v_own_reseller then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;

  v_has_company := v_client.company_id is not null;
  v_has_sub := false;

  if v_has_company then
    select * into v_company
    from public.companies
    where id = v_client.company_id;

    select * into v_sub
    from public.subscriptions
    where company_id = v_client.company_id;
    v_has_sub := found;

    if v_has_sub then
      select * into v_plan
      from public.plans
      where id = v_sub.plan_id;
    end if;
  end if;

  v_state := public.reseller_client_account_state(v_client.id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ra.id,
      'plan_id', ra.plan_id,
      'plan_name', ra.plan_name,
      'credits', ra.credits,
      'access_days', ra.access_days,
      'kind', ra.kind,
      'status', ra.status,
      'starts_on', ra.starts_on,
      'expires_on', ra.expires_on,
      'previous_expires_at', ra.previous_expires_at,
      'new_expires_at', ra.new_expires_at,
      'created_at', ra.created_at
    ) order by ra.created_at desc
  ), '[]'::jsonb)
  into v_activation_history
  from (
    select *
    from public.reseller_activations
    where client_id = v_client.id
    order by created_at desc
    limit 20
  ) ra;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'action', al.action,
      'created_at', al.created_at,
      'metadata', al.metadata
    ) order by al.created_at desc
  ), '[]'::jsonb)
  into v_recent_events
  from (
    select *
    from public.audit_logs
    where entity = 'reseller_client'
      and entity_id = v_client.id
    order by created_at desc
    limit 20
  ) al;

  return jsonb_build_object(
    'client', jsonb_build_object(
      'id', v_client.id,
      'reseller_id', v_client.reseller_id,
      'name', v_client.name,
      'trade_name', coalesce(v_client.trade_name, ''),
      'document', coalesce(v_client.document, ''),
      'phone', coalesce(v_client.phone, ''),
      'email', coalesce(v_client.email, ''),
      'city', coalesce(v_client.city, ''),
      'state', coalesce(v_client.state, ''),
      'notes', coalesce(v_client.notes, ''),
      'status', v_client.status,
      'has_user', v_client.user_id is not null,
      'company_linked', v_has_company,
      'activated_at', v_client.activated_at,
      'access_expires_at', v_client.access_expires_at,
      'created_at', v_client.created_at,
      'updated_at', v_client.updated_at
    ),
    'company', case when v_has_company then jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'slug', v_company.slug,
      'description', coalesce(v_company.description, ''),
      'phone', coalesce(v_company.phone, ''),
      'email', coalesce(v_company.email, ''),
      'address', coalesce(v_company.address, ''),
      'city', coalesce(v_company.city, ''),
      'state', coalesce(v_company.state, ''),
      'zip_code', coalesce(v_company.zip_code, ''),
      'whatsapp', coalesce(v_company.whatsapp, ''),
      'logo_url', coalesce(v_company.logo_url, ''),
      'cover_url', coalesce(v_company.cover_url, ''),
      'active', v_company.active,
      'created_at', v_company.created_at,
      'updated_at', v_company.updated_at
    ) else null end,
    'subscription', case when v_has_sub then jsonb_build_object(
      'id', v_sub.id,
      'status', v_sub.status::text,
      'started_at', v_sub.started_at,
      'expires_at', v_sub.expires_at,
      'plan_id', v_sub.plan_id,
      'plan_name', coalesce(v_plan.name, ''),
      'access_days', v_plan.access_days
    ) else null end,
    'account_state', v_state,
    'activation_history', v_activation_history,
    'recent_events', v_recent_events,
    'permissions', jsonb_build_object(
      'is_master', v_is_master,
      'can_edit_company', v_has_company,
      'can_activate', v_client.user_id is not null,
      'can_suspend', v_has_sub
        and v_sub.status not in ('suspenso', 'cancelado'),
      'can_reactivate', v_has_sub
        and v_sub.status in ('suspenso', 'cancelado', 'expirado'),
      'can_correct_link', v_is_master
    )
  );
end;
$$;

alter function public.get_reseller_client_account(uuid) owner to postgres;
revoke all on function public.get_reseller_client_account(uuid) from public, anon;
grant execute on function public.get_reseller_client_account(uuid)
  to authenticated, service_role;

-- =========================
-- Edicao dos dados publicos do estabelecimento
-- =========================
create or replace function public.update_reseller_client_company(
  p_client_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_is_master boolean := public.is_platform_admin();
  v_own_reseller uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_unknown text[];
  v_changed text[];
  v_name text;
  v_description text;
  v_phone text;
  v_email text;
  v_address text;
  v_city text;
  v_state text;
  v_zip_code text;
  v_whatsapp text;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados invalidos';
  end if;

  select * into v_client
  from public.reseller_clients
  where id = p_client_id;

  if not found then
    raise exception 'Cliente nao encontrado';
  end if;
  if not v_is_master and v_client.reseller_id is distinct from v_own_reseller then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;
  if v_client.company_id is null then
    raise exception 'Cliente ainda nao possui empresa vinculada';
  end if;

  select coalesce(array_agg(k), '{}'::text[])
  into v_unknown
  from jsonb_object_keys(p_data) as k
  where k not in (
    'name', 'description', 'phone', 'email', 'address',
    'city', 'state', 'zip_code', 'whatsapp'
  );

  if cardinality(v_unknown) > 0 then
    raise exception 'Campos nao permitidos: %', array_to_string(v_unknown, ', ');
  end if;

  select coalesce(array_agg(k), '{}'::text[])
  into v_changed
  from jsonb_object_keys(p_data) as k;

  if p_data ? 'name' then
    v_name := nullif(btrim(coalesce(p_data ->> 'name', '')), '');
    if v_name is null then
      raise exception 'Informe o nome do estabelecimento';
    end if;
    if length(v_name) > 120 then
      raise exception 'Nome do estabelecimento muito longo';
    end if;
  end if;

  if p_data ? 'description' then
    v_description := nullif(btrim(coalesce(p_data ->> 'description', '')), '');
    if length(v_description) > 2000 then
      raise exception 'Descricao muito longa';
    end if;
  end if;

  if p_data ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_data ->> 'phone', '')), '');
    if length(v_phone) > 40 then
      raise exception 'Telefone invalido';
    end if;
  end if;

  if p_data ? 'whatsapp' then
    v_whatsapp := nullif(btrim(coalesce(p_data ->> 'whatsapp', '')), '');
    if length(v_whatsapp) > 40 then
      raise exception 'WhatsApp invalido';
    end if;
  end if;

  if p_data ? 'email' then
    v_email := nullif(btrim(coalesce(p_data ->> 'email', '')), '');
    if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'E-mail invalido';
    end if;
    if length(v_email) > 254 then
      raise exception 'E-mail muito longo';
    end if;
  end if;

  if p_data ? 'address' then
    v_address := nullif(btrim(coalesce(p_data ->> 'address', '')), '');
    if length(v_address) > 255 then
      raise exception 'Endereco muito longo';
    end if;
  end if;

  if p_data ? 'city' then
    v_city := nullif(btrim(coalesce(p_data ->> 'city', '')), '');
    if length(v_city) > 120 then
      raise exception 'Cidade invalida';
    end if;
  end if;

  if p_data ? 'state' then
    v_state := nullif(upper(btrim(coalesce(p_data ->> 'state', ''))), '');
    if v_state is not null and length(v_state) <> 2 then
      raise exception 'UF deve ter 2 letras';
    end if;
  end if;

  if p_data ? 'zip_code' then
    v_zip_code := nullif(btrim(coalesce(p_data ->> 'zip_code', '')), '');
    if length(v_zip_code) > 20 then
      raise exception 'CEP invalido';
    end if;
  end if;

  update public.companies co
  set
    name = case when p_data ? 'name' then v_name else co.name end,
    description = case when p_data ? 'description' then v_description else co.description end,
    phone = case when p_data ? 'phone' then v_phone else co.phone end,
    email = case when p_data ? 'email' then v_email else co.email end,
    address = case when p_data ? 'address' then v_address else co.address end,
    city = case when p_data ? 'city' then v_city else co.city end,
    state = case when p_data ? 'state' then v_state else co.state end,
    zip_code = case when p_data ? 'zip_code' then v_zip_code else co.zip_code end,
    whatsapp = case when p_data ? 'whatsapp' then v_whatsapp else co.whatsapp end,
    updated_at = now()
  where co.id = v_client.company_id;

  update public.reseller_clients rc
  set
    name = case when p_data ? 'name' then v_name else rc.name end,
    phone = case when p_data ? 'phone' then v_phone else rc.phone end,
    email = case when p_data ? 'email' then v_email else rc.email end,
    city = case when p_data ? 'city' then v_city else rc.city end,
    state = case when p_data ? 'state' then v_state else rc.state end,
    updated_at = now()
  where rc.id = v_client.id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    v_client.company_id,
    v_actor,
    'reseller_client_company_updated',
    'reseller_client',
    v_client.id,
    jsonb_build_object(
      'reseller_id', v_client.reseller_id,
      'company_id', v_client.company_id,
      'fields', to_jsonb(v_changed),
      'actor_role', case when v_is_master then 'PLATFORM_ADMIN' else 'RESELLER' end
    )
  );

  return jsonb_build_object(
    'changed_fields', to_jsonb(v_changed),
    'account', public.get_reseller_client_account(v_client.id)
  );
end;
$$;

alter function public.update_reseller_client_company(uuid, jsonb) owner to postgres;
revoke all on function public.update_reseller_client_company(uuid, jsonb)
  from public, anon;
grant execute on function public.update_reseller_client_company(uuid, jsonb)
  to authenticated, service_role;

-- =========================
-- Suspensao sem apagar dados
-- =========================
create or replace function public.suspend_reseller_client(
  p_client_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_is_master boolean := public.is_platform_admin();
  v_own_reseller uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_sub public.subscriptions%rowtype;
  v_previous_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reused boolean := false;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'Motivo muito longo';
  end if;

  select * into v_client
  from public.reseller_clients
  where id = p_client_id;

  if not found then
    raise exception 'Cliente nao encontrado';
  end if;
  if not v_is_master and v_client.reseller_id is distinct from v_own_reseller then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;

  if v_client.company_id is not null then
    select * into v_sub
    from public.subscriptions
    where company_id = v_client.company_id;

    if found then
      v_previous_status := v_sub.status::text;
      if v_sub.status = 'suspenso' then
        v_reused := true;
      else
        update public.subscriptions
        set status = 'suspenso'
        where id = v_sub.id;
      end if;
    end if;
  end if;

  update public.reseller_clients
  set status = 'inativo'
  where id = v_client.id
    and status is distinct from 'inativo';

  if not v_reused then
    insert into public.audit_logs (
      company_id, user_id, action, entity, entity_id, metadata
    )
    values (
      v_client.company_id,
      v_actor,
      'reseller_client_suspended',
      'reseller_client',
      v_client.id,
      jsonb_build_object(
        'reseller_id', v_client.reseller_id,
        'company_id', v_client.company_id,
        'previous_subscription_status', v_previous_status,
        'reason', v_reason,
        'actor_role', case when v_is_master then 'PLATFORM_ADMIN' else 'RESELLER' end
      )
    );
  end if;

  return jsonb_build_object(
    'suspended', true,
    'reused', v_reused,
    'company_linked', v_client.company_id is not null,
    'subscription_found', v_sub.id is not null,
    'previous_subscription_status', v_previous_status,
    'reason', v_reason,
    'account', public.get_reseller_client_account(v_client.id)
  );
end;
$$;

alter function public.suspend_reseller_client(uuid, text) owner to postgres;
revoke all on function public.suspend_reseller_client(uuid, text)
  from public, anon;
grant execute on function public.suspend_reseller_client(uuid, text)
  to authenticated, service_role;

-- =========================
-- Correcao de vinculo (somente Master)
-- =========================
create or replace function public.admin_relink_reseller_client(
  p_client_id uuid,
  p_company_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.reseller_clients%rowtype;
  v_company public.companies%rowtype;
  v_user uuid := p_user_id;
  v_sub public.subscriptions%rowtype;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Apenas PLATFORM_ADMIN pode corrigir vinculos';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;
  if p_company_id is null and v_user is null then
    raise exception 'Informe a empresa ou o usuario';
  end if;

  select * into v_client
  from public.reseller_clients
  where id = p_client_id
  for update;

  if not found then
    raise exception 'Cliente nao encontrado';
  end if;

  if p_company_id is not null then
    select * into v_company
    from public.companies
    where id = p_company_id;

    if not found then
      raise exception 'Empresa nao encontrada';
    end if;

    if v_user is null then
      select cm.user_id into v_user
      from public.company_members cm
      where cm.company_id = p_company_id
        and cm.role = 'OWNER'
        and cm.active = true
      order by cm.created_at
      limit 1;

      if v_user is null then
        raise exception 'Empresa sem OWNER ativo';
      end if;
    elsif not exists (
      select 1
      from public.company_members cm
      where cm.company_id = p_company_id
        and cm.user_id = v_user
        and cm.active = true
    ) then
      raise exception 'Usuario nao e membro ativo da empresa';
    end if;

    if exists (
      select 1
      from public.reseller_clients rc
      where rc.company_id = p_company_id
        and rc.id <> v_client.id
    ) then
      raise exception 'Empresa ja vinculada a outro cliente de revenda';
    end if;

    select * into v_sub
    from public.subscriptions
    where company_id = p_company_id;
  end if;

  if v_user is not null then
    if not exists (select 1 from auth.users u where u.id = v_user) then
      raise exception 'Usuario nao encontrado';
    end if;

    if exists (
      select 1
      from public.reseller_clients rc
      where rc.user_id = v_user
        and rc.id <> v_client.id
    ) then
      raise exception 'Usuario ja vinculado a outro cliente de revenda';
    end if;
  end if;

  update public.reseller_clients
  set user_id = v_user,
      company_id = p_company_id,
      activated_at = case
        when p_company_id is not null then coalesce(activated_at, now())
        else activated_at
      end,
      access_expires_at = case
        when p_company_id is not null then v_sub.expires_at
        else access_expires_at
      end,
      status = case
        when p_company_id is not null and coalesce(v_sub.status::text, 'ativo')
          not in ('suspenso', 'cancelado', 'expirado')
          and v_sub.expires_at is not null
          and v_sub.expires_at > now()
          then 'ativo'
        else status
      end,
      updated_at = now()
  where id = v_client.id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    p_company_id,
    v_actor,
    'reseller_client_link_corrected',
    'reseller_client',
    v_client.id,
    jsonb_build_object(
      'reseller_id', v_client.reseller_id,
      'previous_company_id', v_client.company_id,
      'previous_user_id', v_client.user_id,
      'company_id', p_company_id,
      'user_id', v_user
    )
  );

  return public.get_reseller_client_account(v_client.id);
end;
$$;

alter function public.admin_relink_reseller_client(uuid, uuid, uuid) owner to postgres;
revoke all on function public.admin_relink_reseller_client(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.admin_relink_reseller_client(uuid, uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
