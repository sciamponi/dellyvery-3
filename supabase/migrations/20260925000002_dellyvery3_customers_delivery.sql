-- DELLVERY 3 — Customers + delivery integrity (FASE 5.3 ETAPA B, local only)
-- Migration incremental: apenas ADD COLUMN + triggers mesma-empresa.
-- Não edita migrations anteriores. Não apaga/renomeia nada existente.
-- Mapa ETAPA A validado antes desta migration.
-- orders_count/total_spent ficam FORA do schema (agregados de Pedidos, não migrado).

-- =========================
-- 1. customers: campos do formulário/importação
-- =========================
alter table customers add column if not exists whatsapp text;
alter table customers add column if not exists tags jsonb not null default '[]'::jsonb;
alter table customers add column if not exists is_favorite boolean not null default false;
alter table customers add column if not exists is_blocked boolean not null default false;

-- Índice de deduplicação por whatsapp (padrão dos índices phone/email existentes)
create index if not exists idx_customers_company_whatsapp on customers(company_id, whatsapp);

-- address permanece jsonb: adapter transforma
-- Base44 {address(street),number,complement,neighborhood,city,zip_code}
-- <-> Supabase address {street,number,complement,neighborhood,city,zip_code}

-- =========================
-- 2. Integridade cross-company: orders (customer/zone/driver)
-- Dados existentes verificados consistentes antes da criação.
-- NULLs sempre permitidos (SET NULL); mesma company exigida.
-- =========================
create or replace function enforce_order_company_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if new.customer_id is not null and (old.customer_id is distinct from new.customer_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.customers where id = new.customer_id;
    if v_company is null then
      raise exception 'customer not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'customer belongs to another company';
    end if;
  end if;
  if new.delivery_zone_id is not null and (old.delivery_zone_id is distinct from new.delivery_zone_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.delivery_zones where id = new.delivery_zone_id;
    if v_company is null then
      raise exception 'delivery zone not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'delivery zone belongs to another company';
    end if;
  end if;
  if new.driver_id is not null and (old.driver_id is distinct from new.driver_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.delivery_drivers where id = new.driver_id;
    if v_company is null then
      raise exception 'driver not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'driver belongs to another company';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_order_company_refs() from public, anon, authenticated;

drop trigger if exists trg_orders_company_refs on orders;
create trigger trg_orders_company_refs
  before insert or update of customer_id, delivery_zone_id, driver_id on orders
  for each row execute function enforce_order_company_refs();

-- =========================
-- 3. Integridade cross-company: whatsapp_messages (connection/customer)
-- =========================
create or replace function enforce_whatsapp_message_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if new.connection_id is not null and (old.connection_id is distinct from new.connection_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.whatsapp_connections where id = new.connection_id;
    if v_company is null then
      raise exception 'whatsapp connection not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'whatsapp connection belongs to another company';
    end if;
  end if;
  if new.customer_id is not null and (old.customer_id is distinct from new.customer_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.customers where id = new.customer_id;
    if v_company is null then
      raise exception 'customer not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'customer belongs to another company';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_whatsapp_message_company() from public, anon, authenticated;

drop trigger if exists trg_whatsapp_messages_company on whatsapp_messages;
create trigger trg_whatsapp_messages_company
  before insert or update of connection_id, customer_id on whatsapp_messages
  for each row execute function enforce_whatsapp_message_company();
