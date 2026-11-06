-- Dellyvery3: endurecimento final das funcoes SECURITY DEFINER.
--
-- Escopo:
--   * normaliza search_path de todas as funcoes SECURITY DEFINER em public e
--     dellyvery_private, com pg_temp por ultimo;
--   * qualifica tipos/funcoes publicas que ainda estavam sem schema;
--   * reduz a superficie de resolve_reseller_client_invite sem quebrar o fluxo
--     usado pela UI/Edge Function;
--   * aplica default privileges restritivos para funcoes futuras;
--   * instala event trigger fail-closed para revogar EXECUTE de PUBLIC/API em
--     toda funcao nova ou substituida em public/dellyvery_private;
--   * revoga TRUNCATE/REFERENCES/TRIGGER de PUBLIC/anon/authenticated em
--     tabelas de public, preservando postgres/service_role.
--
-- Dependencias: 20261113000000 (allowlist/defaults) e 20261114000000/1.
-- Executar como postgres/supabase_admin em runner transacional.
--
-- Importante: o PostgreSQL 17 mantem o grant embutido de EXECUTE para PUBLIC
-- em funcoes mesmo com ALTER DEFAULT PRIVILEGES ... REVOKE. Por isso a protecao
-- efetiva para funcoes futuras e o event trigger abaixo. Um CREATE OR REPLACE
-- futuro tambem dispara o trigger e exige GRANT explicito posterior.

-- =========================
-- 0. Preflight
-- =========================
do $preflight$
declare
  v_bad text;
begin
  if current_user::text not in ('postgres', 'supabase_admin') then
    raise exception 'Migration deve rodar como postgres/supabase_admin; atual=%', current_user;
  end if;

  if to_regprocedure('public.is_reseller_write_context_active(text,uuid,uuid,uuid)') is null
     or to_regclass('dellyvery_private.reseller_write_context') is null then
    raise exception 'Dependencia de 20261112000000 ausente';
  end if;

  if to_regprocedure('public.resolve_reseller_client_invite(text)') is null
     or to_regprocedure('public.claim_reseller_client_invite(text)') is null then
    raise exception 'Dependencia de convites de revenda ausente';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Roles anon/authenticated/service_role ausentes';
  end if;

  if not has_schema_privilege('postgres', 'dellyvery_private', 'CREATE') then
    raise exception 'postgres sem CREATE em dellyvery_private';
  end if;

  select string_agg(format('%s (owner=%s)', p.oid::regprocedure, pg_get_userbyid(p.proowner)), ', ' order by p.oid)
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and p.prosecdef
    and not (
      current_user::text in ('postgres', 'supabase_admin')
      or p.proowner = current_user::regrole
      or pg_has_role(current_user, pg_get_userbyid(p.proowner), 'MEMBER')
    );

  if v_bad is not null then
    raise exception 'Sem ownership/membership para endurecer: %', v_bad;
  end if;

  raise notice 'Preflight ok: roles, dependencias e ownership';
end
$preflight$;

-- =========================
-- 1. Funcoes com tipos/chamadas publicas ainda sem qualificacao
-- =========================
create or replace function public.delete_table_if_unused(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_row record;
  v_total int;
  v_active_list text;
begin
  if p_table_id is null then
    raise exception 'Mesa não identificada';
  end if;
  select * into v_row from public.dining_tables where id = p_table_id for update;
  if not found then
    raise exception 'Mesa não encontrada';
  end if;
  if not (public.is_company_member(v_row.company_id)
    and public.member_role(v_row.company_id) in ('OWNER', 'ADMIN')) then
    raise exception 'Somente OWNER/ADMIN podem excluir mesas';
  end if;
  select count(*) into v_total from public.orders where table_id = p_table_id;
  if v_total > 0 then
    select string_agg('#' || order_number::text, ', ' order by order_number)
      into v_active_list
    from public.orders
    where table_id = p_table_id and status not in ('finalizado', 'cancelado');
    raise exception 'Mesa possui histórico e não pode ser apagada (%)',
      coalesce(nullif(v_active_list, ''), v_total || ' pedido(s) concluído(s). Desative a mesa.');
  end if;
  delete from public.dining_tables where id = p_table_id;
  return jsonb_build_object('deleted', true);
end;
$function$;

create or replace function public.enforce_company_members_rbac()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.company_role;
  v_owner_count int;
begin
  -- PLATFORM_ADMIN: permite (auditoria externa); policies ja restringem o resto.
  if public.is_platform_admin() then
    return coalesce(new, old);
  end if;

  -- Manutencao via superuser local (seed/cleanup da suite, sem JWT): permite.
  -- anon/authenticated sem JWT continuam bloqueados abaixo (current_user anon/authenticated).
  if v_actor is null then
    if current_user in ('postgres','supabase_admin','service_role') then
      return coalesce(new, old);
    end if;
    raise exception 'not authenticated';
  end if;

  if TG_OP = 'UPDATE' then
    select role into v_actor_role from public.company_members
    where company_id = old.company_id and user_id = v_actor and active = true limit 1;

    if v_actor_role is null then
      raise exception 'not a company member';
    end if;

    -- usuario comum (abaixo de ADMIN) nao altera membros
    if v_actor_role not in ('OWNER','ADMIN') then
      raise exception 'insufficient privilege: members update requires OWNER or ADMIN';
    end if;

    -- ADMIN nao toca no OWNER (nem role, nem active, nem nada)
    if v_actor_role = 'ADMIN' and old.role = 'OWNER' then
      raise exception 'insufficient privilege: ADMIN cannot modify OWNER';
    end if;
    if v_actor_role = 'ADMIN' and new.role = 'OWNER' then
      raise exception 'insufficient privilege: ADMIN cannot promote to OWNER';
    end if;

    -- ninguem pode transferir membro de empresa via UPDATE (imutabilidade, reforco)
    if new.company_id is distinct from old.company_id then
      raise exception 'company_id is immutable';
    end if;

    -- impedir que empresa fique sem OWNER (democao ou desativacao do ultimo OWNER)
    if old.role = 'OWNER' and (new.role <> 'OWNER' or new.active = false) then
      select count(*) into v_owner_count from public.company_members
      where company_id = old.company_id and role = 'OWNER' and active = true
        and id <> old.id;
      if v_owner_count = 0 then
        raise exception 'cannot remove last OWNER of company';
      end if;
    end if;
    return new;
  elsif TG_OP = 'DELETE' then
    select role into v_actor_role from public.company_members
    where company_id = old.company_id and user_id = v_actor and active = true limit 1;

    if v_actor_role is null then
      raise exception 'not a company member';
    end if;

    -- somente OWNER pode remover membros (ADMIN ja bloqueado na policy; trigger reforca)
    if v_actor_role <> 'OWNER' then
      raise exception 'insufficient privilege: member delete requires OWNER';
    end if;

    if old.role = 'OWNER' then
      select count(*) into v_owner_count from public.company_members
      where company_id = old.company_id and role = 'OWNER' and active = true
        and id <> old.id;
      if v_owner_count = 0 then
        raise exception 'cannot remove last OWNER of company';
      end if;
    end if;
    return old;
  end if;
  return coalesce(new, old);
end;
$function$;

create or replace function public.manage_order(
  p_order_id uuid,
  p_action text,
  p_status text default null,
  p_cancel_reason text default null,
  p_items jsonb default null,
  p_discount numeric default null,
  p_address jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_order record;
  v_item jsonb;
  v_prod record;
  v_qty int;
  v_unit numeric;
  v_comp jsonb;
  v_group jsonb;
  v_opt jsonb;
  v_opt_qty int;
  v_opt_price numeric;
  v_valid_comps jsonb;
  v_comp_total numeric;
  v_subtotal numeric;
  v_new_discount numeric;
  v_new_total numeric;
  v_old_status public.order_status;
  v_new_status public.order_status;
  v_valid_statuses public.order_status[] := array['novo','confirmado','em_preparo','aguardando_retirada','saiu_entrega','finalizado','cancelado'];
  v_has_cfg boolean;
  v_use_v2 boolean;
  v_cfgres jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if p_action not in ('status', 'cancel', 'edit') then
    raise exception 'Ação inválida';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Pedido não encontrado ou sem permissão';
  end if;
  if not exists (select 1 from public.company_members
      where company_id = v_order.company_id and user_id = v_actor and active = true) then
    raise exception 'Pedido não encontrado ou sem permissão';
  end if;

  -- STATUS
  if p_action = 'status' then
    if p_status is null
       or not (p_status = any (array['novo','confirmado','em_preparo','aguardando_retirada','saiu_entrega','finalizado','cancelado'])) then
      raise exception 'Status inválido';
    end if;
    v_new_status := p_status::public.order_status;
    if v_order.status = 'cancelado' then
      raise exception 'Pedido cancelado não pode ser alterado';
    end if;
    if v_order.status = v_new_status then
      return to_jsonb(v_order);
    end if;
    v_old_status := v_order.status;
    update public.orders set status = v_new_status, updated_at = now() where id = p_order_id
    returning * into v_order;
    insert into public.order_status_history (order_id, old_status, new_status, changed_by)
    values (p_order_id, v_old_status, v_new_status, v_actor);
    insert into public.audit_logs (company_id, user_id, action, entity, entity_id, metadata)
    values (v_order.company_id, v_actor, 'status_change', 'order', p_order_id,
      jsonb_build_object('from', v_old_status, 'to', v_new_status));
    insert into public.notifications (company_id, order_id, status, message, order_number, tracking_token, link)
    values (v_order.company_id, p_order_id, v_new_status,
      public.order_status_message(v_order.order_number, v_new_status),
      v_order.order_number, v_order.tracking_token,
      '/acompanhar/' || v_order.tracking_token::text)
    on conflict (order_id, status) do nothing;
    select * into v_order from public.orders where id = p_order_id;
    return to_jsonb(v_order);
  end if;

  -- CANCEL
  if p_action = 'cancel' then
    if p_cancel_reason is null or btrim(p_cancel_reason) = '' then
      raise exception 'Motivo do cancelamento é obrigatório';
    end if;
    if v_order.status = 'cancelado' then
      raise exception 'Pedido já está cancelado';
    end if;
    if v_order.status = 'finalizado' then
      raise exception 'Pedido finalizado não pode ser cancelado';
    end if;
    v_old_status := v_order.status;
    update public.orders set status = 'cancelado', cancel_reason = btrim(p_cancel_reason), updated_at = now()
    where id = p_order_id returning * into v_order;
    insert into public.order_status_history (order_id, old_status, new_status, changed_by, notes)
    values (p_order_id, v_old_status, 'cancelado', v_actor, btrim(p_cancel_reason));
    insert into public.audit_logs (company_id, user_id, action, entity, entity_id, metadata)
    values (v_order.company_id, v_actor, 'cancel_order', 'order', p_order_id,
      jsonb_build_object('reason', btrim(p_cancel_reason)));
    insert into public.notifications (company_id, order_id, status, message, order_number, tracking_token, link)
    values (v_order.company_id, p_order_id, 'cancelado',
      public.order_status_message(v_order.order_number, 'cancelado'),
      v_order.order_number, v_order.tracking_token,
      '/acompanhar/' || v_order.tracking_token::text)
    on conflict (order_id, status) do nothing;
    select * into v_order from public.orders where id = p_order_id;
    return to_jsonb(v_order);
  end if;

  -- EDIT
  if v_order.status in ('cancelado', 'finalizado') then
    raise exception 'Pedido não pode ser editado neste status';
  end if;
  if p_address is not null and jsonb_typeof(p_address) = 'object' then
    update public.orders set delivery_address = coalesce(delivery_address, '{}'::jsonb) || p_address
    where id = p_order_id;
  end if;
  if p_notes is not null then
    update public.orders set notes = p_notes where id = p_order_id;
  end if;
  if p_discount is not null then
    if p_discount < 0 or p_discount > v_order.subtotal then
      raise exception 'Desconto inválido';
    end if;
    update public.orders set discount = p_discount where id = p_order_id;
    v_order.discount := p_discount;
  end if;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    v_subtotal := 0;
    delete from public.order_items where order_id = p_order_id;
    for v_item in select * from jsonb_array_elements(p_items) loop
      select * into v_prod from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_order.company_id;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
      v_unit := coalesce(v_prod.promotional_price, v_prod.price);
      v_qty := (v_item ->> 'quantity')::int;
      if v_qty is null or v_qty < 1 then
        raise exception 'Quantidade inválida';
      end if;
      v_valid_comps := '[]'::jsonb;
      v_comp_total := 0;
      -- Ramo V2 (estrito): config + produto com passos ativos
      -- (próprios ou herdados da categoria).
      select exists(
        select 1 from public.product_config_steps
        where company_id = v_order.company_id and active
          and (product_id = v_prod.id
               or (coalesce(v_prod.use_category_steps, true) and v_prod.category_id is not null
                   and category_id = v_prod.category_id and product_id is null))
      ) into v_has_cfg;
      v_use_v2 := v_item ? 'config' and jsonb_typeof(v_item -> 'config') = 'object'
        and jsonb_typeof(coalesce(v_item -> 'config' -> 'steps', '[]'::jsonb)) = 'array'
        and jsonb_array_length(coalesce(v_item -> 'config' -> 'steps', '[]'::jsonb)) > 0;
      if v_use_v2 then
        if not v_has_cfg then
          raise exception 'Produto "%" sem montagem configurada', v_prod.name;
        end if;
        v_cfgres := public.config_selection_total(v_order.company_id, v_prod.id, v_item -> 'config');
        v_valid_comps := v_cfgres -> 'comps';
        v_comp_total := coalesce((v_cfgres ->> 'total')::numeric, 0);
      else
        if v_item ? 'complements' and jsonb_typeof(v_item -> 'complements') = 'array' then
          for v_comp in select * from jsonb_array_elements(v_item -> 'complements') loop
            select g into v_group from jsonb_array_elements(coalesce(v_prod.options, '[]'::jsonb)) g
            where g ->> 'name' = (v_comp ->> 'group_name') limit 1;
            if v_group is null then continue; end if;
            select o into v_opt from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb)) o
            where o ->> 'name' = (v_comp ->> 'option_name') limit 1;
            if v_opt is null then continue; end if;
            v_opt_qty := coalesce((v_comp ->> 'quantity')::int, 1);
            v_opt_price := coalesce((v_opt ->> 'price')::numeric, 0);
            v_valid_comps := v_valid_comps || jsonb_build_object(
              'group_name', v_group ->> 'name', 'option_name', v_opt ->> 'name',
              'price', v_opt_price, 'quantity', v_opt_qty);
            v_comp_total := v_comp_total + v_opt_price * v_opt_qty;
          end loop;
        end if;
      end if;
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, total, options, notes)
      values (p_order_id, v_prod.id, v_prod.name, v_qty, v_unit,
        v_unit * v_qty + v_comp_total, v_valid_comps, coalesce(v_item ->> 'notes', ''));
      v_subtotal := v_subtotal + v_unit * v_qty + v_comp_total;
    end loop;
    -- Dependências entre produtos (regras ativas da empresa).
    perform public.check_order_dependencies(v_order.company_id, p_items);
    v_new_discount := coalesce(p_discount, v_order.discount, 0);
    v_new_total := v_subtotal + coalesce(v_order.delivery_fee, 0) - v_new_discount;
    update public.orders set subtotal = v_subtotal, discount = v_new_discount, total = v_new_total
    where id = p_order_id;
  elsif p_discount is not null then
    update public.orders
    set total = subtotal + coalesce(delivery_fee, 0) - p_discount
    where id = p_order_id;
  end if;
  insert into public.audit_logs (company_id, user_id, action, entity, entity_id, metadata)
  values (v_order.company_id, v_actor, 'edit_order', 'order', p_order_id,
    jsonb_build_object('detail', 'Pedido editado'));
  select * into v_order from public.orders where id = p_order_id;
  return to_jsonb(v_order);
end;
$function$;

create or replace function public.rbac_actor_role(p_company_id uuid)
returns public.company_role
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select role from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid()
    and active = true
  limit 1;
$function$;

create or replace function public.set_lead_status(p_lead_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_new public.lead_status;
  v_count int;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à administração';
  end if;
  if p_status is null
     or not (p_status = any (array['novo','em_contato','aguardando_dados','proposta_enviada','contratado','descartado'])) then
    raise exception 'Status inválido';
  end if;
  v_new := p_status::public.lead_status;
  update public.leads set status = v_new, updated_at = now()
  where id = p_lead_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Cadastro não encontrado';
  end if;
  return (select to_jsonb(l) from public.leads l where l.id = p_lead_id);
end;
$function$;

-- Minimiza a resposta publica: o client_id interno nao e usado pela UI nem
-- pela Edge Function. O token continua sendo o segredo de acesso.
create or replace function public.resolve_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_hash text;
  v_invite public.reseller_client_invites%rowtype;
  v_client public.reseller_clients%rowtype;
  v_reseller_name text;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite nao encontrado';
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

  if v_invite.status = 'pending' and v_invite.expires_at <= now() then
    update public.reseller_client_invites
    set status = 'expired'
    where id = v_invite.id
      and status = 'pending';

    if found then
      v_invite.status := 'expired';
    end if;
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

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'client_name', coalesce(nullif(btrim(v_client.trade_name), ''), v_client.name),
    'reseller_name', coalesce(v_reseller_name, 'Revendedor'),
    'invited_email', v_invite.invited_email,
    'status', v_invite.status,
    'expires_at', v_invite.expires_at
  );
end;
$function$;

-- Reaplica os grants historicos das funcoes substituidas (CREATE OR REPLACE
-- preserva ACL, mas o event trigger e fail-closed por desenho).
revoke all on function public.delete_table_if_unused(uuid) from public, anon;
grant execute on function public.delete_table_if_unused(uuid) to authenticated, service_role;

revoke all on function public.enforce_company_members_rbac() from public, anon, authenticated, service_role;

revoke all on function public.manage_order(uuid,text,text,text,jsonb,numeric,jsonb,text) from public, anon;
grant execute on function public.manage_order(uuid,text,text,text,jsonb,numeric,jsonb,text) to authenticated, service_role;

revoke all on function public.rbac_actor_role(uuid) from public, anon;
grant execute on function public.rbac_actor_role(uuid) to authenticated, service_role;

revoke all on function public.set_lead_status(uuid,text) from public, anon;
grant execute on function public.set_lead_status(uuid,text) to authenticated, service_role;

revoke all on function public.resolve_reseller_client_invite(text) from public;
grant execute on function public.resolve_reseller_client_invite(text) to anon, authenticated, service_role;

-- =========================
-- 2. search_path deterministico em funcoes SECURITY DEFINER e nas
--    SECURITY INVOKER que ainda usavam search_path=public
-- =========================
-- Guard critico e SECURITY INVOKER; ainda assim precisa de pg_temp no fim.
alter function public.guard_reseller_client_write()
  set search_path = pg_catalog, public, pg_temp;

do $search_path$
declare
  v_fn record;
  v_count int := 0;
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_current_oid oid := (select oid from pg_roles where rolname = current_user);
begin
  for v_fn in
    select p.oid, p.oid::regprocedure as signature, n.nspname, p.proname, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and p.prosecdef
    order by p.oid
  loop
    if not v_is_super and v_fn.proowner <> v_current_oid then
      raise notice 'search_path: ignorando % (owner %) sem ownership', v_fn.signature, pg_get_userbyid(v_fn.proowner);
      continue;
    end if;

    if v_fn.nspname = 'dellyvery_private'
       or (v_fn.nspname = 'public' and v_fn.proname = 'is_reseller_write_context_active') then
      execute format(
        'alter function %s set search_path = pg_catalog, dellyvery_private, pg_temp',
        v_fn.signature
      );
    else
      execute format(
        'alter function %s set search_path = pg_catalog, public, pg_temp',
        v_fn.signature
      );
    end if;
    v_count := v_count + 1;
  end loop;

  raise notice 'search_path normalizado em % funcoes SECURITY DEFINER', v_count;
end
$search_path$;

do $invoker_search_path$
declare
  v_fn record;
  v_count int := 0;
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_current_oid oid := (select oid from pg_roles where rolname = current_user);
begin
  for v_fn in
    select p.oid::regprocedure as signature, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not p.prosecdef
      and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=public'
    order by p.oid
  loop
    if not v_is_super and v_fn.proowner <> v_current_oid then
      raise notice 'search_path invoker: ignorando % (owner %) sem ownership', v_fn.signature, pg_get_userbyid(v_fn.proowner);
      continue;
    end if;

    execute format(
      'alter function %s set search_path = pg_catalog, public, pg_temp',
      v_fn.signature
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'search_path normalizado em % funcoes SECURITY INVOKER', v_count;
end
$invoker_search_path$;

-- =========================
-- 3. Default privileges restritivos
-- =========================
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

do $supabase_admin_defaults$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and (
       current_user::text = 'supabase_admin'
       or coalesce((select rolsuper from pg_roles where rolname = current_user), false)
       or pg_has_role(current_user, 'supabase_admin', 'MEMBER')
     ) then
    execute 'alter default privileges for role supabase_admin in schema public '
         || 'revoke execute on functions from public, anon, authenticated, service_role';
  else
    raise notice 'supabase_admin ausente ou sem membership; defaults public aplicados apenas a postgres';
  end if;
end
$supabase_admin_defaults$;

-- =========================
-- 4. Event trigger fail-closed para funcoes futuras
-- =========================
do $revoke_function$
declare
  v_fn oid := to_regprocedure('dellyvery_private.revoke_api_function_acl()');
  v_owner oid;
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_current_oid oid := (select oid from pg_roles where rolname = current_user);
begin
  if v_fn is null then
    execute $create_fn$
      create function dellyvery_private.revoke_api_function_acl()
      returns event_trigger
      language plpgsql
      security definer
      set search_path = pg_catalog, pg_temp
      as $function$
      declare
        v_cmd record;
      begin
        for v_cmd in
          select schema_name, object_identity
          from pg_event_trigger_ddl_commands()
          where object_type = 'function'
            and schema_name in ('public', 'dellyvery_private')
        loop
          execute format(
            'revoke all on function %s from public, anon, authenticated, service_role',
            v_cmd.object_identity
          );
        end loop;
      end;
      $function$;
    $create_fn$;

    v_fn := to_regprocedure('dellyvery_private.revoke_api_function_acl()');
  end if;

  select proowner into v_owner from pg_proc where oid = v_fn;

  if v_is_super or v_owner = v_current_oid then
    execute $replace_fn$
      create or replace function dellyvery_private.revoke_api_function_acl()
      returns event_trigger
      language plpgsql
      security definer
      set search_path = pg_catalog, pg_temp
      as $function$
      declare
        v_cmd record;
      begin
        for v_cmd in
          select schema_name, object_identity
          from pg_event_trigger_ddl_commands()
          where object_type = 'function'
            and schema_name in ('public', 'dellyvery_private')
        loop
          execute format(
            'revoke all on function %s from public, anon, authenticated, service_role',
            v_cmd.object_identity
          );
        end loop;
      end;
      $function$;
    $replace_fn$;

    execute 'revoke all on function dellyvery_private.revoke_api_function_acl() '
         || 'from public, anon, authenticated, service_role';
  else
    raise notice 'revoke_api_function_acl existente (%); owner=% sem ownership, usando a funcao atual', v_fn::regprocedure, pg_get_userbyid(v_owner);
  end if;
end
$revoke_function$;

do $event_trigger$
declare
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_owner oid;
  v_enabled "char";
begin
  if exists (
    select 1 from pg_event_trigger
    where evtname = 'dellyvery3_revoke_new_function_acl'
  ) then
    select evtowner, evtenabled
      into v_owner, v_enabled
    from pg_event_trigger
    where evtname = 'dellyvery3_revoke_new_function_acl';

    if v_enabled in ('O', 'A') then
      raise notice 'Event trigger dellyvery3_revoke_new_function_acl ja habilitado';
    elsif v_is_super
       or v_owner = (select oid from pg_roles where rolname = current_user) then
      execute 'alter event trigger dellyvery3_revoke_new_function_acl enable';
      raise notice 'Event trigger dellyvery3_revoke_new_function_acl habilitado';
    else
      raise notice 'PENDENTE: event trigger dellyvery3_revoke_new_function_acl existe desabilitado, mas role % nao pode habilita-lo; owner=%', current_user, pg_get_userbyid(v_owner);
    end if;
  elsif v_is_super then
    execute 'create event trigger dellyvery3_revoke_new_function_acl '
         || 'on ddl_command_end when tag in (''CREATE FUNCTION'') '
         || 'execute function dellyvery_private.revoke_api_function_acl()';
    raise notice 'Event trigger dellyvery3_revoke_new_function_acl criado';
  else
    raise notice 'PENDENTE: event trigger dellyvery3_revoke_new_function_acl nao criado; role % nao e superuser. Default ACL e postflight de search_path continuam ativos.', current_user;
  end if;
end
$event_trigger$;

-- =========================
-- 5. Remove privilegios nao-DML expostos a PUBLIC/anon/authenticated
-- =========================
do $table_privileges$
declare
  v_tbl record;
  v_count int := 0;
begin
  for v_tbl in
    select c.oid, c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format(
      'revoke truncate, references, trigger on table public.%I from public, anon, authenticated',
      v_tbl.relname
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'TRUNCATE/REFERENCES/TRIGGER revogados de PUBLIC/API em % tabelas', v_count;
end
$table_privileges$;

-- =========================
-- 6. Postflight
-- =========================
do $postflight$
declare
  v_bad text;
  v_probe text := 'public.__dellyvery_acl_probe_20261115()';
  v_probe_oid oid;
begin
  if not exists (
    select 1 from pg_event_trigger
    where evtname = 'dellyvery3_revoke_new_function_acl'
      and evtenabled in ('O', 'A')
  ) then
    raise notice 'PENDENTE: event trigger dellyvery3_revoke_new_function_acl ausente/desabilitado; instalar como supabase_admin';
  end if;

  select string_agg(format('%s (%s)', p.oid::regprocedure, coalesce(array_to_string(p.proconfig, ','), '<null>')), ', ' order by p.oid)
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and p.prosecdef
    and not (
      coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%'
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%'
    );

  if v_bad is not null then
    raise exception 'search_path inseguro remanescente: %', v_bad;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'Funcao ainda executavel por PUBLIC';
  end if;

  if has_schema_privilege('public', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'dellyvery_private com USAGE exposto a PUBLIC/API';
  end if;

  if exists (
    select 1
    from pg_class c
    cross join lateral (
      values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) p(privilege_name)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('public', c.oid, p.privilege_name)
        or has_table_privilege('anon', c.oid, p.privilege_name)
        or has_table_privilege('authenticated', c.oid, p.privilege_name)
      )
  ) then
    raise exception 'Tabela public com TRUNCATE/REFERENCES/TRIGGER exposto a PUBLIC/API';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'f'
      and pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
      and (a.grantee = 0 or a.grantee = any (array[
        'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole
      ]))
  ) then
    raise exception 'Default ACL de funcoes em public contem grants para PUBLIC/API';
  end if;

  if has_schema_privilege(current_user, 'public', 'CREATE') then
    execute 'drop function if exists ' || v_probe;
    execute 'create function ' || v_probe || ' returns integer language sql as ''select 1''';
    v_probe_oid := v_probe::regprocedure::oid;

    if has_function_privilege('public', v_probe_oid, 'EXECUTE')
       or has_function_privilege('anon', v_probe_oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_probe_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_probe_oid, 'EXECUTE') then
      raise exception 'Funcao futura em public nasceu executavel por PUBLIC/API';
    end if;

    execute 'drop function ' || v_probe;
    raise notice 'Probe ok: funcao futura em public nasce sem EXECUTE para PUBLIC/API';
  else
    raise notice 'Probe de funcao futura ignorado: current_user sem CREATE em public';
  end if;

  raise notice 'Postflight ok: search_path, private schema, TRUNCATE/REFERENCES/TRIGGER e defaults';
end
$postflight$;

notify pgrst, 'reload schema';
