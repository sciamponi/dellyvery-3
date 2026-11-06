-- Correcoes locais dos bloqueadores do Gate 4.
-- Nao abre BEGIN/COMMIT: o runner deve executar a migration em transacao.
-- Nao altera migrations historicas ja aplicadas.

do $preflight$
declare
  v_bad text;
begin
  if current_user::text not in ('postgres', 'supabase_admin') then
    raise exception 'Migration deve rodar como postgres/supabase_admin; atual=%', current_user;
  end if;

  if to_regclass('public.plan_purchase_requests') is null
     or to_regclass('public.reseller_credit_orders') is null
     or to_regclass('public.platform_pix_settings') is null then
    raise exception 'Dependencias esperadas ausentes';
  end if;

  select string_agg(format('%s (%s)', norm, cnt), ', ' order by norm)
    into v_bad
  from (
    select lower(btrim(payment_reference)) as norm, count(*) as cnt
    from public.plan_purchase_requests
    where btrim(payment_reference) <> ''
    group by 1
    having count(*) > 1
  ) s;

  if v_bad is not null then
    raise exception 'payment_reference duplicada em plan_purchase_requests: %', v_bad;
  end if;

  select string_agg(format('%s (%s)', norm, cnt), ', ' order by norm)
    into v_bad
  from (
    select lower(btrim(payment_reference)) as norm, count(*) as cnt
    from public.reseller_credit_orders
    where payment_reference is not null
      and btrim(payment_reference) <> ''
    group by 1
    having count(*) > 1
  ) s;

  if v_bad is not null then
    raise exception 'payment_reference duplicada em reseller_credit_orders: %', v_bad;
  end if;

  select string_agg(norm, ', ' order by norm)
    into v_bad
  from (
    select lower(btrim(payment_reference)) as norm
    from public.plan_purchase_requests
    where status = 'confirmada'
      and btrim(payment_reference) <> ''
    union all
    select lower(btrim(payment_reference)) as norm
    from public.reseller_credit_orders
    where status = 'creditado'
      and payment_reference is not null
      and btrim(payment_reference) <> ''
  ) s
  group by norm
  having count(*) > 1;

  if v_bad is not null then
    raise exception 'payment_reference ja confirmada em mais de uma compra: %', v_bad;
  end if;

  if exists (
    select 1
    from public.plan_purchase_requests
    where proof_url is not null
      and (
        char_length(proof_url) > 1000
        or proof_url !~* '^https?://[^[:space:]]+$'
      )
  ) then
    raise exception 'proof_url invalida em plan_purchase_requests';
  end if;
end
$preflight$;

create unique index if not exists uq_plan_purchase_requests_payment_reference_norm
  on public.plan_purchase_requests (lower(btrim(payment_reference)))
  where btrim(payment_reference) <> '';

create unique index if not exists uq_reseller_credit_orders_payment_reference_norm
  on public.reseller_credit_orders (lower(btrim(payment_reference)))
  where payment_reference is not null
    and btrim(payment_reference) <> '';

alter table public.plan_purchase_requests
  drop constraint if exists plan_purchase_requests_rejected_by_fkey;

alter table public.plan_purchase_requests
  add constraint plan_purchase_requests_rejected_by_fkey
  foreign key (rejected_by) references public.profiles(id) on delete restrict;

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_rejected_by_fkey;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_rejected_by_fkey
  foreign key (rejected_by) references public.profiles(id) on delete restrict;

create table if not exists dellyvery_private.payment_reference_claims (
  reference_normalized text primary key,
  reference_original text not null,
  source_table text not null,
  source_id uuid not null,
  claimed_by uuid,
  claimed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_reference_claims_source_table_check
    check (source_table in ('plan_purchase_requests', 'reseller_credit_orders'))
);

create unique index if not exists uq_payment_reference_claims_source
  on dellyvery_private.payment_reference_claims (source_table, source_id);

alter table dellyvery_private.payment_reference_claims enable row level security;

revoke all on table dellyvery_private.payment_reference_claims
  from public, anon, authenticated, service_role;

insert into dellyvery_private.payment_reference_claims (
  reference_normalized, reference_original, source_table, source_id,
  claimed_by, claimed_at, metadata
)
select
  lower(btrim(payment_reference)),
  payment_reference,
  'plan_purchase_requests',
  id,
  confirmed_by,
  coalesce(confirmed_at, now()),
  jsonb_strip_nulls(jsonb_build_object(
    'company_id', company_id,
    'status', status
  ))
from public.plan_purchase_requests
where status = 'confirmada'
  and btrim(payment_reference) <> ''
union all
select
  lower(btrim(payment_reference)),
  payment_reference,
  'reseller_credit_orders',
  id,
  confirmed_by,
  coalesce(credited_at, now()),
  jsonb_strip_nulls(jsonb_build_object(
    'reseller_id', reseller_id,
    'status', status
  ))
from public.reseller_credit_orders
where status = 'creditado'
  and payment_reference is not null
  and btrim(payment_reference) <> ''
on conflict do nothing;

create or replace function dellyvery_private.claim_confirmed_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dellyvery_private, pg_temp
as $function$
declare
  v_ref text := lower(btrim(coalesce(new.payment_reference, '')));
  v_existing_ref text;
  v_count integer := 0;
begin
  if v_ref = '' then
    return new;
  end if;

  insert into dellyvery_private.payment_reference_claims (
    reference_normalized, reference_original, source_table, source_id,
    claimed_by, claimed_at, metadata
  ) values (
    v_ref,
    new.payment_reference,
    TG_TABLE_NAME,
    new.id,
    auth.uid(),
    now(),
    jsonb_strip_nulls(jsonb_build_object(
      'company_id', to_jsonb(new) ->> 'company_id',
      'reseller_id', to_jsonb(new) ->> 'reseller_id',
      'status', new.status
    ))
  )
  on conflict do nothing;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    select c.reference_normalized
      into v_existing_ref
    from dellyvery_private.payment_reference_claims c
    where c.source_table = TG_TABLE_NAME
      and c.source_id = new.id;

    if found then
      if v_existing_ref = v_ref then
        return new;
      end if;
      raise exception 'Compra % ja possui outra referencia confirmada', new.id
        using errcode = '23505';
    end if;

    raise exception 'Referencia de pagamento % ja confirmada em outra compra', v_ref
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke all on function dellyvery_private.claim_confirmed_payment_reference()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_claim_plan_purchase_payment_reference
  on public.plan_purchase_requests;

create trigger trg_claim_plan_purchase_payment_reference
  after insert or update of status, payment_reference
  on public.plan_purchase_requests
  for each row
  when (
    new.status = 'confirmada'
    and btrim(coalesce(new.payment_reference, '')) <> ''
  )
  execute function dellyvery_private.claim_confirmed_payment_reference();

drop trigger if exists trg_claim_reseller_credit_payment_reference
  on public.reseller_credit_orders;

create trigger trg_claim_reseller_credit_payment_reference
  after insert or update of status, payment_reference
  on public.reseller_credit_orders
  for each row
  when (
    new.status = 'creditado'
    and btrim(coalesce(new.payment_reference, '')) <> ''
  )
  execute function dellyvery_private.claim_confirmed_payment_reference();

create or replace function public.expire_plan_purchase_requests()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_count integer := 0;
  v_is_admin boolean := public.is_platform_admin();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if auth.uid() is null and not v_is_service then
    raise exception 'not authenticated';
  end if;

  for v_request in
    update public.plan_purchase_requests
    set status = 'expirada',
        expired_at = now()
    where status = 'pendente'
      and pending_expires_at is not null
      and pending_expires_at <= now()
      and (
        v_is_service
        or v_is_admin
        or public.can_manage_company_billing(company_id)
      )
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
$function$;

create or replace function public.expire_reseller_credit_orders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_order public.reseller_credit_orders%rowtype;
  v_count integer := 0;
  v_is_admin boolean := public.is_platform_admin();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_reseller_id uuid := public.current_reseller_id();
begin
  if auth.uid() is null and not v_is_service then
    raise exception 'not authenticated';
  end if;

  for v_order in
    update public.reseller_credit_orders
    set status = 'expirado',
        expired_at = now()
    where status = 'pendente'
      and pending_expires_at is not null
      and pending_expires_at <= now()
      and (
        v_is_service
        or v_is_admin
        or (v_reseller_id is not null and reseller_id = v_reseller_id)
      )
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
$function$;

revoke all on function public.expire_plan_purchase_requests()
  from public, anon;
grant execute on function public.expire_plan_purchase_requests()
  to authenticated, service_role;

revoke all on function public.expire_reseller_credit_orders()
  from public, anon;
grant execute on function public.expire_reseller_credit_orders()
  to authenticated, service_role;

alter table public.plan_purchase_requests
  drop constraint if exists plan_purchase_requests_proof_url_check;

alter table public.plan_purchase_requests
  add constraint plan_purchase_requests_proof_url_check
  check (
    proof_url is null
    or (
      char_length(proof_url) <= 1000
      and proof_url ~* '^https?://[^[:space:]]+$'
    )
  );

create or replace function public.patch_platform_pix_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_old public.platform_pix_settings%rowtype;
  v_new jsonb;
  v_active boolean;
  v_key_type text;
  v_key text;
  v_receiver text;
  v_qr_url text;
  v_qr_path text;
  v_qr_payload text;
  v_instructions text;
  v_old_qr_path text;
  v_unknown text;
  v_new_version integer;
  v_row public.platform_pix_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb then
    raise exception 'Nenhum campo informado';
  end if;

  select string_agg(k, ', ' order by k)
    into v_unknown
  from jsonb_object_keys(p_patch) as k
  where k not in (
    'active', 'pix_key_type', 'pix_key', 'receiver_name',
    'qr_image_url', 'qr_payload', 'instructions'
  );

  if v_unknown is not null then
    raise exception 'Campos nao suportados: %', v_unknown;
  end if;

  insert into public.platform_pix_settings (id)
  values (true)
  on conflict (id) do nothing;

  select *
    into v_old
  from public.platform_pix_settings
  where id = true
  for update;

  v_old_qr_path := v_old.qr_image_path;
  v_new := to_jsonb(v_old) || p_patch;

  v_active := coalesce((v_new ->> 'active')::boolean, false);
  v_key_type := nullif(btrim(v_new ->> 'pix_key_type'), '');
  v_key := nullif(btrim(v_new ->> 'pix_key'), '');
  v_receiver := nullif(btrim(v_new ->> 'receiver_name'), '');
  v_qr_payload := nullif(btrim(v_new ->> 'qr_payload'), '');
  v_instructions := nullif(btrim(v_new ->> 'instructions'), '');

  if p_patch ? 'qr_image_url' then
    v_qr_url := nullif(btrim(v_new ->> 'qr_image_url'), '');
    v_qr_path := public.platform_asset_path_from_url(v_qr_url);

    if v_qr_url is not null and v_qr_path is null then
      raise exception 'QR Code deve ser enviado pelo armazenamento do sistema';
    end if;

    if v_qr_path is not null
       and (v_qr_path not like 'pix-qr/%' or v_qr_path like '%..%') then
      raise exception 'Caminho do QR Code invalido';
    end if;
  else
    v_qr_url := v_old.qr_image_url;
    v_qr_path := v_old.qr_image_path;
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

  v_new_version := coalesce(v_old.version, 0) + 1;

  update public.platform_pix_settings
  set active = v_active,
      pix_key_type = v_key_type,
      pix_key = v_key,
      receiver_name = v_receiver,
      qr_image_url = v_qr_url,
      qr_image_path = v_qr_path,
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
      'old_version', v_old.version,
      'new_version', v_new_version,
      'active', v_row.active,
      'pix_key_type', v_row.pix_key_type,
      'has_pix_key', v_row.pix_key is not null,
      'has_qr_image_url', v_row.qr_image_url is not null,
      'has_qr_image_path', v_row.qr_image_path is not null,
      'qr_image_replaced', v_old_qr_path is distinct from v_row.qr_image_path,
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
    'qr_image_path', v_row.qr_image_path,
    'qr_payload', v_row.qr_payload,
    'instructions', v_row.instructions,
    'version', v_row.version,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by,
    'previous_qr_image_path', v_old_qr_path
  );
end;
$function$;

create or replace function public.set_platform_pix_settings(
  p_active boolean default null,
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
as $function$
declare
  v_patch jsonb := '{}'::jsonb;
begin
  if p_active is not null then
    v_patch := v_patch || jsonb_build_object('active', p_active);
  end if;

  if p_pix_key_type is not null then
    v_patch := v_patch || jsonb_build_object('pix_key_type', p_pix_key_type);
  end if;

  if p_pix_key is not null then
    v_patch := v_patch || jsonb_build_object('pix_key', p_pix_key);
  end if;

  if p_receiver_name is not null then
    v_patch := v_patch || jsonb_build_object('receiver_name', p_receiver_name);
  end if;

  if p_qr_image_url is not null then
    v_patch := v_patch || jsonb_build_object('qr_image_url', p_qr_image_url);
  end if;

  if p_qr_payload is not null then
    v_patch := v_patch || jsonb_build_object('qr_payload', p_qr_payload);
  end if;

  if p_instructions is not null then
    v_patch := v_patch || jsonb_build_object('instructions', p_instructions);
  end if;

  return public.patch_platform_pix_settings(v_patch);
end;
$function$;

revoke all on function public.patch_platform_pix_settings(jsonb)
  from public, anon;
grant execute on function public.patch_platform_pix_settings(jsonb)
  to authenticated, service_role;

revoke all on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text)
  to authenticated, service_role;

do $event_trigger$
declare
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
begin
  if not exists (
    select 1 from pg_event_trigger
    where evtname = 'dellyvery3_revoke_new_function_acl'
  ) then
    if v_is_super then
      execute 'create event trigger dellyvery3_revoke_new_function_acl '
           || 'on ddl_command_end when tag in (''CREATE FUNCTION'') '
           || 'execute function dellyvery_private.revoke_api_function_acl()';
      raise notice 'Event trigger dellyvery3_revoke_new_function_acl criado';
    else
      raise notice 'PENDENTE: event trigger dellyvery3_revoke_new_function_acl ausente; instalar como supabase_admin';
    end if;
  end if;
end
$event_trigger$;

do $postflight$
begin
  if to_regclass('dellyvery_private.payment_reference_claims') is null then
    raise exception 'Registry de payment_reference ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_plan_purchase_requests_payment_reference_norm'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_reseller_credit_orders_payment_reference_norm'
  ) then
    raise exception 'Indices unicos de payment_reference ausentes';
  end if;

  if (
    select confdeltype
    from pg_constraint
    where conname = 'plan_purchase_requests_rejected_by_fkey'
      and conrelid = 'public.plan_purchase_requests'::regclass
  ) is distinct from 'r' then
    raise exception 'FK rejected_by de plan_purchase_requests nao esta ON DELETE RESTRICT';
  end if;

  if (
    select confdeltype
    from pg_constraint
    where conname = 'reseller_credit_orders_rejected_by_fkey'
      and conrelid = 'public.reseller_credit_orders'::regclass
  ) is distinct from 'r' then
    raise exception 'FK rejected_by de reseller_credit_orders nao esta ON DELETE RESTRICT';
  end if;

  if to_regprocedure('public.patch_platform_pix_settings(jsonb)') is null
     or to_regprocedure('public.expire_plan_purchase_requests()') is null
     or to_regprocedure('public.expire_reseller_credit_orders()') is null then
    raise exception 'Funcoes de correcao ausentes';
  end if;

  raise notice 'Postflight Gate 4 ok: refs unicas, claims, FKs RESTRICT, expiracao escopada e Pix parcial';
end
$postflight$;

notify pgrst, 'reload schema';
