-- DELLVERY 3 — RLS hardening incremental (FASE 4.2, local only)
-- Arquivo: supabase/migrations/20260925000000_dellyvery3_rls_hardening.sql
-- NAO edita migrations anteriores. Apenas DROP+CREATE de policies, ALTER de funcoes,
-- REVOKE/GRANT, triggers BEFORE UPDATE/DELETE. Sem db push remoto.
--
-- Decisoes aplicadas (autorizadas):
--  1. DELETE orders/notifications: somente OWNER/ADMIN + PLATFORM_ADMIN (MANAGER bloqueado).
--  2. DELETE cash_registers/cash_movements: somente OWNER/ADMIN + PLATFORM_ADMIN.
--  3. DELETE demais entidades criticas: OWNER/ADMIN/MANAGER + PLATFORM_ADMIN;
--     OPERATOR/CASHIER/ATTENDANT sem DELETE critico.
--  4. plans: anon e membros veem somente active=true; PLATFORM_ADMIN ve tudo.
--  5. business_segments: sem anon; authenticated ve somente active=true; PLATFORM_ADMIN ve tudo.
-- Comportamento preservado: next_order_number() continua funcionando via SECURITY DEFINER;
-- audit legitimo continua (user_id = auth.uid()); nenhuma funcionalidade operacional bloqueada
-- alem do necessario (INSERT/UPDATE operacionais mantidos onde o produto exige).

-- =========================
-- 0. Helpers de RBAC (para triggers, SECURITY DEFINER, search_path seguro)
-- =========================
create or replace function rbac_actor_role(p_company_id uuid)
returns company_role
language sql
security definer
set search_path = public
as $$
  select role from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid()
    and active = true
  limit 1;
$$;

revoke all on function rbac_actor_role(uuid) from public;
grant execute on function rbac_actor_role(uuid) to authenticated;

-- =========================
-- 1. COMPANY MEMBERS / RBAC
-- ADMIN nao promove para OWNER; ADMIN nao altera/desativa/remove OWNER;
-- usuario comum nao altera membros; PLATFORM_ADMIN mantido; nunca sem OWNER.
-- =========================

-- 1a. Policies: UPDATE restrito com distincao alvo (OLD.role via USING, NEW.role via WITH CHECK)
drop policy if exists company_members_update_owner_admin on company_members;
create policy company_members_update_owner_admin on company_members
  for update to authenticated
  using (
    is_platform_admin()
    or (is_company_member(company_id) and member_role(company_id) = 'OWNER')
    or (is_company_member(company_id) and member_role(company_id) = 'ADMIN' and role <> 'OWNER')
  )
  with check (
    is_platform_admin()
    or (is_company_member(company_id) and member_role(company_id) = 'OWNER')
    or (is_company_member(company_id) and member_role(company_id) = 'ADMIN' and role <> 'OWNER')
  );

-- 1b. DELETE: mantem OWNER + PLATFORM_ADMIN (ADMIN ja era bloqueado; reforco explicito).
-- Nao remove policy sem substituir: recria equivalente.
drop policy if exists company_members_delete_owner_admin on company_members;
create policy company_members_delete_owner_admin on company_members
  for delete to authenticated
  using (
    is_platform_admin()
    or (is_company_member(company_id) and member_role(company_id) = 'OWNER')
  );

-- 1c. Trigger BEFORE UPDATE/DELETE: defesa em profundidade (vale mesmo se policy mudar;
-- service_role bypassa RLS mas nao trigger). Impede escalada via UPDATE.
create or replace function enforce_company_members_rbac()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role company_role;
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
$$;

drop trigger if exists trg_company_members_rbac_update on company_members;
create trigger trg_company_members_rbac_update
  before update on company_members
  for each row execute function enforce_company_members_rbac();

drop trigger if exists trg_company_members_rbac_delete on company_members;
create trigger trg_company_members_rbac_delete
  before delete on company_members
  for each row execute function enforce_company_members_rbac();

-- =========================
-- 2. DELETE menor privilegio
-- Documentacao de negocio:
--  - orders/notifications DELETE: OWNER/ADMIN apenas (MANAGER bloqueado por decisao).
--  - cash_registers/cash_movements DELETE: OWNER/ADMIN apenas.
--  - catalogo (categories/products/delivery_zones/drivers), customers,
--    whatsapp_connections/messages, order_items DELETE: OWNER/ADMIN/MANAGER.
--  - OPERATOR/CASHIER/ATTENDANT: sem DELETE critico (podem INSERT/UPDATE operacional
--    onde o produto exige; DELETE bloqueado).
--  - order_status_history/audit_logs DELETE: ja restritos (platform), mantidos.
-- =========================

-- orders DELETE: OWNER/ADMIN + platform (MANAGER sem DELETE)
drop policy if exists orders_delete_member on orders;
create policy orders_delete_owner_admin on orders
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN'))
    or is_platform_admin()
  );

-- notifications DELETE: OWNER/ADMIN + platform
drop policy if exists notifications_delete_member on notifications;
create policy notifications_delete_owner_admin on notifications
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN'))
    or is_platform_admin()
  );

-- cash_registers DELETE: OWNER/ADMIN + platform
drop policy if exists cash_registers_delete_member on cash_registers;
create policy cash_registers_delete_owner_admin on cash_registers
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN'))
    or is_platform_admin()
  );

-- cash_movements DELETE: OWNER/ADMIN + platform (mantem vinculo register mesma empresa)
drop policy if exists cash_movements_delete_member on cash_movements;
create policy cash_movements_delete_owner_admin on cash_movements
  for delete to authenticated
  using (
    (
      is_company_member(company_id)
      and member_role(company_id) in ('OWNER','ADMIN')
      and exists (select 1 from cash_registers cr where cr.id = cash_register_id and cr.company_id = cash_movements.company_id)
    )
    or is_platform_admin()
  );

-- categories/products/customers/delivery_zones/drivers/whatsapp_* /order_items DELETE: OWNER/ADMIN/MANAGER
drop policy if exists categories_delete_member on categories;
create policy categories_delete_mgr on categories for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists products_delete_member on products;
create policy products_delete_mgr on products for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists customers_delete_member on customers;
create policy customers_delete_mgr on customers for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists delivery_zones_delete_member on delivery_zones;
create policy delivery_zones_delete_mgr on delivery_zones for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists delivery_drivers_delete_member on delivery_drivers;
create policy delivery_drivers_delete_mgr on delivery_drivers for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists whatsapp_connections_delete_member on whatsapp_connections;
create policy whatsapp_connections_delete_mgr on whatsapp_connections for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists whatsapp_messages_delete_member on whatsapp_messages;
create policy whatsapp_messages_delete_mgr on whatsapp_messages for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists order_items_delete_member on order_items;
create policy order_items_delete_mgr on order_items for delete to authenticated
  using (
    (exists (select 1 from orders o where o.id = order_id and is_company_member(o.company_id) and member_role(o.company_id) in ('OWNER','ADMIN','MANAGER')))
    or is_platform_admin()
  );

-- =========================
-- 3. COMPANY SETTINGS / STORE THEMES: separar leitura de escrita
-- Leitura: membros + platform (mantido). Escrita: OWNER/ADMIN + platform.
-- =========================
drop policy if exists company_settings_upsert_member on company_settings;
-- leitura mantida via company_settings_select_member (nao tocada)
drop policy if exists company_settings_insert_owner_admin on company_settings;
create policy company_settings_insert_owner_admin on company_settings
  for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());
drop policy if exists company_settings_update_owner_admin on company_settings;
create policy company_settings_update_owner_admin on company_settings
  for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());
drop policy if exists company_settings_delete_owner_admin on company_settings;
create policy company_settings_delete_owner_admin on company_settings
  for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());

drop policy if exists store_themes_upsert_member on store_themes;
-- leitura mantida via store_themes_select_member (nao tocada)
drop policy if exists store_themes_insert_owner_admin on store_themes;
create policy store_themes_insert_owner_admin on store_themes
  for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());
drop policy if exists store_themes_update_owner_admin on store_themes;
create policy store_themes_update_owner_admin on store_themes
  for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());
drop policy if exists store_themes_delete_owner_admin on store_themes;
create policy store_themes_delete_owner_admin on store_themes
  for delete to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN')) or is_platform_admin());

-- =========================
-- 4. COMPANY ORDER SEQ: remover acesso direto; fluxo via next_order_number() DEFINER
-- =========================
drop policy if exists company_order_seq_member on company_order_seq;
drop policy if exists company_order_seq_platform_read on company_order_seq;
create policy company_order_seq_platform_read on company_order_seq
  for select to authenticated
  using (is_platform_admin());

revoke all on table company_order_seq from public, anon, authenticated;
-- apenas SELECT via RLS (platform_admin); sem INSERT/UPDATE/DELETE direto para membros
grant select on table company_order_seq to authenticated;

-- next_order_number vira SECURITY DEFINER com search_path seguro (recriada abaixo no item 8).

-- =========================
-- 5. AUDIT LOGS: impedir falsificacao do user_id; sem UPDATE
-- INSERT exige user_id = auth.uid() (ou PLATFORM_ADMIN); DELETE ja era platform (mantido).
-- Nao existe policy de UPDATE -> continua negado por padrao (RLS deny).
-- =========================
drop policy if exists audit_logs_insert_member on audit_logs;
create policy audit_logs_insert_verified on audit_logs
  for insert to authenticated
  with check (
    (is_company_member(company_id) and user_id = auth.uid())
    or is_platform_admin()
  );
-- garantir que nao ha UPDATE liberado
drop policy if exists audit_logs_update_member on audit_logs;
drop policy if exists audit_logs_update_any on audit_logs;

-- =========================
-- 6. RBAC por modulo (INSERT/UPDATE): member_role() onde necessario
-- Catalogo sensivel (products/categories/zones/drivers/whatsapp_connections):
--   INSERT/UPDATE OWNER/ADMIN/MANAGER + platform.
-- Operacional (orders/customers/cash/whatsapp_messages/notifications/order_items/history):
--   INSERT/UPDATE mantido para membros ativos (produto exige OPERATOR/CASHIER/ATTENDANT
--   operando pedidos/clientes/caixa), DELETE ja restringido no item 2.
-- Documentado para nao bloquear funcionalidades existentes sem necessidade.
-- =========================
drop policy if exists categories_insert_member on categories;
create policy categories_insert_mgr on categories for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());
drop policy if exists categories_update_member on categories;
create policy categories_update_mgr on categories for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists products_insert_member on products;
create policy products_insert_mgr on products for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());
drop policy if exists products_update_member on products;
create policy products_update_mgr on products for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists delivery_zones_insert_member on delivery_zones;
create policy delivery_zones_insert_mgr on delivery_zones for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());
drop policy if exists delivery_zones_update_member on delivery_zones;
create policy delivery_zones_update_mgr on delivery_zones for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists delivery_drivers_insert_member on delivery_drivers;
create policy delivery_drivers_insert_mgr on delivery_drivers for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());
drop policy if exists delivery_drivers_update_member on delivery_drivers;
create policy delivery_drivers_update_mgr on delivery_drivers for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

drop policy if exists whatsapp_connections_insert_member on whatsapp_connections;
create policy whatsapp_connections_insert_mgr on whatsapp_connections for insert to authenticated
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());
drop policy if exists whatsapp_connections_update_member on whatsapp_connections;
create policy whatsapp_connections_update_mgr on whatsapp_connections for update to authenticated
  using ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin())
  with check ((is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER')) or is_platform_admin());

-- =========================
-- 7. IMUTABILIDADE DE TENANT
-- company_id imutavel em todas as tabelas tenant; order_items.order_id e
-- cash_movements.cash_register_id imutaveis.
-- =========================
create or replace function prevent_company_id_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.company_id is distinct from new.company_id then
    raise exception 'company_id is immutable';
  end if;
  return new;
end;
$$;

create or replace function prevent_order_items_remap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.order_id is distinct from new.order_id then
    raise exception 'order_items.order_id is immutable';
  end if;
  return new;
end;
$$;

create or replace function prevent_cash_movement_remap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.cash_register_id is distinct from new.cash_register_id then
    raise exception 'cash_movements.cash_register_id is immutable';
  end if;
  if old.company_id is distinct from new.company_id then
    raise exception 'company_id is immutable';
  end if;
  return new;
end;
$$;

-- company_id: aplicar em todas as tabelas tenant (idempotente via DROP IF EXISTS)
drop trigger if exists trg_immutable_company on categories;
create trigger trg_immutable_company before update on categories for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on products;
create trigger trg_immutable_company before update on products for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on customers;
create trigger trg_immutable_company before update on customers for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on delivery_zones;
create trigger trg_immutable_company before update on delivery_zones for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on delivery_drivers;
create trigger trg_immutable_company before update on delivery_drivers for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on orders;
create trigger trg_immutable_company before update on orders for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on notifications;
create trigger trg_immutable_company before update on notifications for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on audit_logs;
create trigger trg_immutable_company before update on audit_logs for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on cash_registers;
create trigger trg_immutable_company before update on cash_registers for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on whatsapp_connections;
create trigger trg_immutable_company before update on whatsapp_connections for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on whatsapp_messages;
create trigger trg_immutable_company before update on whatsapp_messages for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on subscriptions;
create trigger trg_immutable_company before update on subscriptions for each row execute function prevent_company_id_change();
drop trigger if exists trg_immutable_company on company_members;
create trigger trg_immutable_company before update on company_members for each row execute function prevent_company_id_change();
-- companies e seq sao raiz (sem company_id transferivel); settings/themes tem PK company_id (imutavel por PK).

drop trigger if exists trg_order_items_immutable on order_items;
create trigger trg_order_items_immutable before update on order_items for each row execute function prevent_order_items_remap();

drop trigger if exists trg_cash_movements_immutable on cash_movements;
create trigger trg_cash_movements_immutable before update on cash_movements for each row execute function prevent_cash_movement_remap();

-- =========================
-- 8. HARDENING DAS FUNCTIONS: search_path seguro + qualificacao
-- =========================
-- set_updated_at: adiciona search_path seguro (mantem TRIGGER, nao vira DEFINER)
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- next_order_number: SECURITY DEFINER (para operar seq sem acesso direto dos membros)
-- + search_path seguro + refs qualificadas. Preserva advisory lock por company.
create or replace function next_order_number(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_company_id::text));
  insert into public.company_order_seq(company_id, last_number)
    values (p_company_id, 1)
    on conflict (company_id) do update set last_number = public.company_order_seq.last_number + 1, updated_at = now()
    returning last_number into v;
  if v is null then
    select last_number into v from public.company_order_seq where company_id = p_company_id;
  end if;
  return v;
end;
$$;

-- =========================
-- 9. next_order_number(): remover EXECUTE publico desnecessario
-- Somente authenticated (fluxo normal); anon bloqueado.
-- =========================
revoke all on function next_order_number(uuid) from public, anon;
grant execute on function next_order_number(uuid) to authenticated;
revoke all on function rbac_actor_role(uuid) from public, anon;
grant execute on function rbac_actor_role(uuid) to authenticated;

-- =========================
-- 10. BUSINESS SEGMENTS / PLANS: catalogo publico so ativos
-- segments: sem anon; authenticated active=true (platform ve tudo via admin_write).
-- plans: anon e authenticated active=true (platform ve tudo via admin_write).
-- =========================
drop policy if exists business_segments_select_all on business_segments;
create policy business_segments_select_active on business_segments
  for select to authenticated
  using (active = true or is_platform_admin());

drop policy if exists plans_select_all on plans;
create policy plans_select_active on plans
  for select to authenticated
  using (active = true or is_platform_admin());

drop policy if exists plans_select_anon on plans;
create policy plans_select_anon_active on plans
  for select to anon
  using (active = true);
-- plans_admin_write / business_segments_admin_write (FOR ALL + platform) mantidos: cobrem inativos p/ admin.
