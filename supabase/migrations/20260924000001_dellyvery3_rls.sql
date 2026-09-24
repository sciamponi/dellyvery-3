-- DELLVERY 3 — RLS migration (local only)
-- Ativa RLS e cria helpers + policies. Nao cria bypass generico para PLATFORM_ADMIN.
-- Helpers SECURITY DEFINER com search_path seguro.

-- =========================
-- Helpers
-- =========================
create or replace function is_company_member(p_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id
      and user_id = auth.uid()
      and active = true
  );
$$;

create or replace function member_role(p_company_id uuid)
returns company_role
language sql
security definer
set search_path = public
as $$
  select role from company_members
  where company_id = p_company_id
    and user_id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and platform_role = 'PLATFORM_ADMIN'
  );
$$;

-- =========================
-- Funcao segura de onboarding: cria company + OWNER + subscription trial
-- Nao aceita user_id arbitrario, usa sempre auth.uid()
-- =========================
create or replace function create_company_with_owner(
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
set search_path = public
as $$
declare
  v_company_id uuid;
  v_slug text;
  v_plan_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
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

  -- slug UNIQUE sera validado pela constraint, mas checagem previa para mensagem clara
  if exists (select 1 from companies where slug = v_slug) then
    raise exception 'slug already exists';
  end if;

  -- criar company
  insert into companies (name, slug, segment_id, description, phone, email, address)
  values (btrim(p_name), v_slug, p_segment_id, p_description, p_phone, p_email, p_address)
  returning id into v_company_id;

  -- criar primeiro OWNER (sempre auth.uid(), nunca parametro)
  insert into company_members (company_id, user_id, role, active)
  values (v_company_id, auth.uid(), 'OWNER', true);

  -- criar subscription trial (plan solo)
  select id into v_plan_id from plans where slug = 'solo' limit 1;
  if v_plan_id is not null then
    insert into subscriptions (company_id, plan_id, status, started_at, expires_at)
    values (v_company_id, v_plan_id, 'trial', now(), now() + interval '7 days')
    on conflict (company_id) do nothing;
  end if;

  -- inicializar contador de order_number
  insert into company_order_seq (company_id, last_number) values (v_company_id, 0)
  on conflict (company_id) do nothing;

  -- criar settings/themes vazios para consistencia
  insert into company_settings (company_id, settings) values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;
  insert into store_themes (company_id) values (v_company_id)
  on conflict (company_id) do nothing;

  return v_company_id;
end;
$$;

revoke all on function create_company_with_owner(text,text,uuid,text,text,text,text) from public;
grant execute on function create_company_with_owner(text,text,uuid,text,text,text,text) to authenticated;

-- Revoke direct helper execution from anon where not needed
revoke all on function is_company_member(uuid) from public;
grant execute on function is_company_member(uuid) to authenticated;
revoke all on function member_role(uuid) from public;
grant execute on function member_role(uuid) to authenticated;
revoke all on function is_platform_admin() from public;
grant execute on function is_platform_admin() to authenticated;

-- =========================
-- Enable RLS
-- =========================
alter table profiles enable row level security;
alter table business_segments enable row level security;
alter table companies enable row level security;
alter table company_members enable row level security;
alter table company_settings enable row level security;
alter table store_themes enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table delivery_zones enable row level security;
alter table delivery_drivers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table cash_registers enable row level security;
alter table cash_movements enable row level security;
alter table whatsapp_connections enable row level security;
alter table whatsapp_messages enable row level security;
alter table company_order_seq enable row level security;

-- =========================
-- profiles (usuario so le proprio; PLATFORM_ADMIN especifico; sem escalada platform_role)
-- =========================
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select to authenticated
  using (id = auth.uid() or is_platform_admin());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and platform_role = (select platform_role from profiles where id = auth.uid())
  );

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (id = auth.uid() and platform_role = 'USER');

-- PLATFORM_ADMIN pode atualizar qualquer profile (admin especifico, nao bypass generico)
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- =========================
-- business_segments (leitura publica para onboarding, escrita so PLATFORM_ADMIN)
-- =========================
drop policy if exists business_segments_select_all on business_segments;
create policy business_segments_select_all on business_segments
  for select to authenticated using (true);

drop policy if exists business_segments_admin_write on business_segments;
create policy business_segments_admin_write on business_segments
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- =========================
-- plans (leitura publica, escrita so PLATFORM_ADMIN)
-- =========================
drop policy if exists plans_select_all on plans;
create policy plans_select_all on plans
  for select to authenticated using (true);
-- anon tambem pode ler plans para landing (opcional)
drop policy if exists plans_select_anon on plans;
create policy plans_select_anon on plans
  for select to anon using (true);

drop policy if exists plans_admin_write on plans;
create policy plans_admin_write on plans
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- =========================
-- companies
-- =========================
drop policy if exists companies_select_member on companies;
create policy companies_select_member on companies
  for select to authenticated
  using (is_company_member(id) or is_platform_admin());

drop policy if exists companies_insert_via_function on companies;
create policy companies_insert_via_function on companies
  for insert to authenticated
  with check (false); -- criacao somente via create_company_with_owner (security definer) ou PLATFORM_ADMIN

drop policy if exists companies_admin_insert on companies;
create policy companies_admin_insert on companies
  for insert to authenticated
  with check (is_platform_admin());

drop policy if exists companies_update_owner_admin on companies;
create policy companies_update_owner_admin on companies
  for update to authenticated
  using ((is_company_member(id) and member_role(id) in ('OWNER','ADMIN')) or is_platform_admin())
  with check ((is_company_member(id) and member_role(id) in ('OWNER','ADMIN')) or is_platform_admin());

drop policy if exists companies_delete_owner_admin on companies;
create policy companies_delete_owner_admin on companies
  for delete to authenticated
  using ((is_company_member(id) and member_role(id) = 'OWNER') or is_platform_admin());

-- =========================
-- company_members (INSERT direto bloqueado, exceto PLATFORM_ADMIN; primeiro OWNER via funcao)
-- =========================
drop policy if exists company_members_select_member on company_members;
create policy company_members_select_member on company_members
  for select to authenticated
  using (is_company_member(company_id) or user_id = auth.uid() or is_platform_admin());

drop policy if exists company_members_insert_blocked on company_members;
create policy company_members_insert_blocked on company_members
  for insert to authenticated
  with check (false);

drop policy if exists company_members_admin_insert on company_members;
create policy company_members_admin_insert on company_members
  for insert to authenticated
  with check (is_platform_admin());

drop policy if exists company_members_update_owner_admin on company_members;
create policy company_members_update_owner_admin on company_members
  for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());

drop policy if exists company_members_delete_owner_admin on company_members;
create policy company_members_delete_owner_admin on company_members
  for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) = 'OWNER') or is_platform_admin());

-- =========================
-- company_settings / store_themes (PK company_id)
-- =========================
drop policy if exists company_settings_select_member on company_settings;
create policy company_settings_select_member on company_settings
  for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists company_settings_upsert_member on company_settings;
create policy company_settings_upsert_member on company_settings
  for all to authenticated
  using (is_company_member(company_id) or is_platform_admin())
  with check (is_company_member(company_id) or is_platform_admin());

drop policy if exists store_themes_select_member on store_themes;
create policy store_themes_select_member on store_themes
  for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists store_themes_upsert_member on store_themes;
create policy store_themes_upsert_member on store_themes
  for all to authenticated
  using (is_company_member(company_id) or is_platform_admin())
  with check (is_company_member(company_id) or is_platform_admin());

-- =========================
-- company_order_seq (usado por next_order_number, acesso via funcao)
-- =========================
drop policy if exists company_order_seq_member on company_order_seq;
create policy company_order_seq_member on company_order_seq
  for all to authenticated
  using (is_company_member(company_id) or is_platform_admin())
  with check (is_company_member(company_id) or is_platform_admin());

-- =========================
-- Helper macro: tabelas com company_id direto
-- =========================
-- subscriptions (member read, admin write)
drop policy if exists subscriptions_select_member on subscriptions;
create policy subscriptions_select_member on subscriptions
  for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists subscriptions_admin_write on subscriptions;
create policy subscriptions_admin_write on subscriptions
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- categories
drop policy if exists categories_select_member on categories;
create policy categories_select_member on categories for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists categories_insert_member on categories;
create policy categories_insert_member on categories for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists categories_update_member on categories;
create policy categories_update_member on categories for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists categories_delete_member on categories;
create policy categories_delete_member on categories for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- products
drop policy if exists products_select_member on products;
create policy products_select_member on products for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists products_insert_member on products;
create policy products_insert_member on products for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists products_update_member on products;
create policy products_update_member on products for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists products_delete_member on products;
create policy products_delete_member on products for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- customers
drop policy if exists customers_select_member on customers;
create policy customers_select_member on customers for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists customers_insert_member on customers;
create policy customers_insert_member on customers for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists customers_update_member on customers;
create policy customers_update_member on customers for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists customers_delete_member on customers;
create policy customers_delete_member on customers for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- delivery_zones
drop policy if exists delivery_zones_select_member on delivery_zones;
create policy delivery_zones_select_member on delivery_zones for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_zones_insert_member on delivery_zones;
create policy delivery_zones_insert_member on delivery_zones for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_zones_update_member on delivery_zones;
create policy delivery_zones_update_member on delivery_zones for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_zones_delete_member on delivery_zones;
create policy delivery_zones_delete_member on delivery_zones for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- delivery_drivers
drop policy if exists delivery_drivers_select_member on delivery_drivers;
create policy delivery_drivers_select_member on delivery_drivers for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_drivers_insert_member on delivery_drivers;
create policy delivery_drivers_insert_member on delivery_drivers for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_drivers_update_member on delivery_drivers;
create policy delivery_drivers_update_member on delivery_drivers for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists delivery_drivers_delete_member on delivery_drivers;
create policy delivery_drivers_delete_member on delivery_drivers for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- orders
drop policy if exists orders_select_member on orders;
create policy orders_select_member on orders for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists orders_insert_member on orders;
create policy orders_insert_member on orders for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists orders_update_member on orders;
create policy orders_update_member on orders for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists orders_delete_member on orders;
create policy orders_delete_member on orders for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- notifications
drop policy if exists notifications_select_member on notifications;
create policy notifications_select_member on notifications for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists notifications_insert_member on notifications;
create policy notifications_insert_member on notifications for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists notifications_update_member on notifications;
create policy notifications_update_member on notifications for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists notifications_delete_member on notifications;
create policy notifications_delete_member on notifications for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- cash_registers
drop policy if exists cash_registers_select_member on cash_registers;
create policy cash_registers_select_member on cash_registers for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists cash_registers_insert_member on cash_registers;
create policy cash_registers_insert_member on cash_registers for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists cash_registers_update_member on cash_registers;
create policy cash_registers_update_member on cash_registers for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists cash_registers_delete_member on cash_registers;
create policy cash_registers_delete_member on cash_registers for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- whatsapp_connections
drop policy if exists whatsapp_connections_select_member on whatsapp_connections;
create policy whatsapp_connections_select_member on whatsapp_connections for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_connections_insert_member on whatsapp_connections;
create policy whatsapp_connections_insert_member on whatsapp_connections for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_connections_update_member on whatsapp_connections;
create policy whatsapp_connections_update_member on whatsapp_connections for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_connections_delete_member on whatsapp_connections;
create policy whatsapp_connections_delete_member on whatsapp_connections for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- whatsapp_messages
drop policy if exists whatsapp_messages_select_member on whatsapp_messages;
create policy whatsapp_messages_select_member on whatsapp_messages for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_messages_insert_member on whatsapp_messages;
create policy whatsapp_messages_insert_member on whatsapp_messages for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_messages_update_member on whatsapp_messages;
create policy whatsapp_messages_update_member on whatsapp_messages for update to authenticated using (is_company_member(company_id) or is_platform_admin()) with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists whatsapp_messages_delete_member on whatsapp_messages;
create policy whatsapp_messages_delete_member on whatsapp_messages for delete to authenticated using (is_company_member(company_id) or is_platform_admin());

-- audit_logs (select member, insert member, no delete for comum)
drop policy if exists audit_logs_select_member on audit_logs;
create policy audit_logs_select_member on audit_logs for select to authenticated using (is_company_member(company_id) or is_platform_admin());
drop policy if exists audit_logs_insert_member on audit_logs;
create policy audit_logs_insert_member on audit_logs for insert to authenticated with check (is_company_member(company_id) or is_platform_admin());
drop policy if exists audit_logs_admin_delete on audit_logs;
create policy audit_logs_admin_delete on audit_logs for delete to authenticated using (is_platform_admin());

-- =========================
-- cash_movements (valida company_id E cash_register_id pertencente a mesma empresa)
-- =========================
drop policy if exists cash_movements_select_member on cash_movements;
create policy cash_movements_select_member on cash_movements
  for select to authenticated
  using (
    is_company_member(company_id)
    and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = cash_movements.company_id)
    or is_platform_admin()
  );

drop policy if exists cash_movements_insert_member on cash_movements;
create policy cash_movements_insert_member on cash_movements
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = company_id)
    or is_platform_admin()
  );

drop policy if exists cash_movements_update_member on cash_movements;
create policy cash_movements_update_member on cash_movements
  for update to authenticated
  using (
    is_company_member(company_id)
    and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = cash_movements.company_id)
    or is_platform_admin()
  )
  with check (
    is_company_member(company_id)
    and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = company_id)
    or is_platform_admin()
  );

drop policy if exists cash_movements_delete_member on cash_movements;
create policy cash_movements_delete_member on cash_movements
  for delete to authenticated
  using (
    is_company_member(company_id)
    and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = cash_movements.company_id)
    or is_platform_admin()
  );

-- =========================
-- order_items / order_status_history (via orders.company_id)
-- =========================
drop policy if exists order_items_select_member on order_items;
create policy order_items_select_member on order_items
  for select to authenticated
  using (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_items_insert_member on order_items;
create policy order_items_insert_member on order_items
  for insert to authenticated
  with check (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_items_update_member on order_items;
create policy order_items_update_member on order_items
  for update to authenticated
  using (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  )
  with check (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_items_delete_member on order_items;
create policy order_items_delete_member on order_items
  for delete to authenticated
  using (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_status_history_select_member on order_status_history;
create policy order_status_history_select_member on order_status_history
  for select to authenticated
  using (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_status_history_insert_member on order_status_history;
create policy order_status_history_insert_member on order_status_history
  for insert to authenticated
  with check (
    exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id))
    or is_platform_admin()
  );

drop policy if exists order_status_history_delete_member on order_status_history;
create policy order_status_history_delete_member on order_status_history
  for delete to authenticated
  using (is_platform_admin());

-- =========================
-- Subscriptions ja tratadas acima (admin write); garantir updated_at trigger ja existe
-- =========================
