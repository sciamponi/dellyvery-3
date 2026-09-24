-- DELLVERY 3 — Foundation migration (local only)
-- Preserva contratos do codigo funcional:
-- ORDER_STATUSES: novo, confirmado, em_preparo, aguardando_retirada, saiu_entrega, finalizado, cancelado
-- PAID_STATUS: finalizado
-- order_type: delivery, retirada, mesa
-- tracking_token: UUID unique
-- order_number: seguro via next_order_number(company_id)

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Enums (criar apenas se nao existir)
do $$ begin
  create type order_status as enum ('novo','confirmado','em_preparo','aguardando_retirada','saiu_entrega','finalizado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_type as enum ('delivery','retirada','mesa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending','paid','failed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type company_role as enum ('OWNER','ADMIN','MANAGER','OPERATOR','CASHIER','ATTENDANT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type platform_role as enum ('USER','PLATFORM_ADMIN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type driver_status as enum ('ativo','inativo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_register_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_movement_type as enum ('sale','entrada','saida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type whatsapp_provider as enum ('evolution','cloud','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type whatsapp_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type whatsapp_status as enum ('pending','sent','delivered','read','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_cycle as enum ('monthly','yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trial','ativo','pendente','cancelado','suspenso','expirado');
exception when duplicate_object then null; end $$;

-- Helper: updated_at trigger
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles (FK auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  phone text,
  avatar_url text,
  platform_role platform_role not null default 'USER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated_at before update on profiles for each row execute function set_updated_at();
create index if not exists idx_profiles_email on profiles(email);
create index if not exists idx_profiles_platform_role on profiles(platform_role);

-- business_segments
create table if not exists business_segments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  icon text,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- companies
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  segment_id uuid references business_segments(id) on delete set null,
  logo_url text,
  cover_url text,
  description text,
  phone text,
  email text,
  address text,
  settings jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_companies_updated_at before update on companies for each row execute function set_updated_at();
create index if not exists idx_companies_segment on companies(segment_id);
create index if not exists idx_companies_slug on companies(slug);

-- company_members
create table if not exists company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role company_role not null default 'ADMIN',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, user_id)
);
create trigger trg_company_members_updated_at before update on company_members for each row execute function set_updated_at();
create index if not exists idx_company_members_company on company_members(company_id);
create index if not exists idx_company_members_user on company_members(user_id);

-- company_settings
create table if not exists company_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_company_settings_updated_at before update on company_settings for each row execute function set_updated_at();

-- store_themes
create table if not exists store_themes (
  company_id uuid primary key references companies(id) on delete cascade,
  colors jsonb not null default '{}'::jsonb,
  fonts jsonb not null default '{}'::jsonb,
  banners jsonb not null default '{}'::jsonb,
  layout jsonb not null default '{}'::jsonb,
  custom_css text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_store_themes_updated_at before update on store_themes for each row execute function set_updated_at();

-- plans
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  price numeric(10,2) not null default 0,
  billing_cycle billing_cycle not null default 'monthly',
  features jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_plans_updated_at before update on plans for each row execute function set_updated_at();
create index if not exists idx_plans_slug on plans(slug);

-- subscriptions
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  status subscription_status not null default 'trial',
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);
create trigger trg_subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();
create index if not exists idx_subscriptions_company on subscriptions(company_id);
create index if not exists idx_subscriptions_plan on subscriptions(plan_id);

-- categories
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_categories_updated_at before update on categories for each row execute function set_updated_at();
create index if not exists idx_categories_company on categories(company_id);
create index if not exists idx_categories_company_sort on categories(company_id, sort_order);

-- products
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  description text,
  image_url text,
  price numeric(10,2) not null,
  active boolean not null default true,
  sort_order int not null default 0,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_products_updated_at before update on products for each row execute function set_updated_at();
create index if not exists idx_products_company on products(company_id);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_company_active on products(company_id, active);

-- customers
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  document text,
  address jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_customers_updated_at before update on customers for each row execute function set_updated_at();
create index if not exists idx_customers_company on customers(company_id);
create index if not exists idx_customers_company_phone on customers(company_id, phone);
create index if not exists idx_customers_company_email on customers(company_id, email);

-- delivery_zones
create table if not exists delivery_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  fee numeric(10,2) not null default 0,
  minimum_order numeric(10,2) not null default 0,
  estimated_time int not null default 30,
  polygon jsonb,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_delivery_zones_updated_at before update on delivery_zones for each row execute function set_updated_at();
create index if not exists idx_delivery_zones_company on delivery_zones(company_id);

-- delivery_drivers
create table if not exists delivery_drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  document text,
  vehicle_type text,
  vehicle_plate text,
  photo_url text,
  notes text,
  status driver_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_delivery_drivers_updated_at before update on delivery_drivers for each row execute function set_updated_at();
create index if not exists idx_delivery_drivers_company on delivery_drivers(company_id);
create index if not exists idx_delivery_drivers_status on delivery_drivers(company_id, status);

-- company_order_seq (contador seguro para order_number)
create table if not exists company_order_seq (
  company_id uuid primary key references companies(id) on delete cascade,
  last_number int not null default 0,
  updated_at timestamptz not null default now()
);

-- Funcao segura para proximo order_number (advisory lock por company_id)
create or replace function next_order_number(p_company_id uuid)
returns int
language plpgsql
as $$
declare
  v int;
begin
  -- lock transacional por company_id para evitar corrida
  perform pg_advisory_xact_lock(hashtext(p_company_id::text));
  insert into company_order_seq(company_id, last_number)
    values (p_company_id, 1)
    on conflict (company_id) do update set last_number = company_order_seq.last_number + 1, updated_at = now()
    returning last_number into v;
  -- se insert ocorreu, v ja e 1; se update, v e incrementado
  -- para caso de insert, o returning acima ja retorna 1; garantir
  if v is null then
    select last_number into v from company_order_seq where company_id = p_company_id;
  end if;
  return v;
end;
$$;

-- orders
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_number int not null,
  tracking_token uuid not null unique default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  delivery_zone_id uuid references delivery_zones(id) on delete set null,
  driver_id uuid references delivery_drivers(id) on delete set null,
  order_type order_type not null default 'delivery',
  status order_status not null default 'novo',
  payment_method text,
  payment_status payment_status not null default 'pending',
  subtotal numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  customer_data jsonb not null default '{}'::jsonb,
  delivery_address jsonb not null default '{}'::jsonb,
  notes text,
  source text not null default 'online',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, order_number)
);
create trigger trg_orders_updated_at before update on orders for each row execute function set_updated_at();
create index if not exists idx_orders_company on orders(company_id);
create index if not exists idx_orders_company_created on orders(company_id, created_at desc);
create index if not exists idx_orders_company_status on orders(company_id, status);
create index if not exists idx_orders_tracking_token on orders(tracking_token);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_driver on orders(driver_id);

-- order_items
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  total numeric(10,2) not null,
  options jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

-- order_status_history
create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  old_status order_status,
  new_status order_status not null,
  changed_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_status_history_order on order_status_history(order_id, created_at);

-- notifications (idempotencia por order_id+status quando aplicavel)
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  status order_status,
  message text not null,
  order_number int,
  read boolean not null default false,
  tracking_token uuid,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(order_id, status)
);
create index if not exists idx_notifications_company_created on notifications(company_id, created_at desc);
create index if not exists idx_notifications_company_read on notifications(company_id, read);
create index if not exists idx_notifications_order on notifications(order_id);

-- audit_logs
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_company on audit_logs(company_id, created_at desc);
create index if not exists idx_audit_logs_entity on audit_logs(entity, entity_id);

-- cash_registers
create table if not exists cash_registers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  operator_id uuid references profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(10,2) not null default 0,
  closing_amount numeric(10,2),
  status cash_register_status not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cash_registers_updated_at before update on cash_registers for each row execute function set_updated_at();
create index if not exists idx_cash_registers_company on cash_registers(company_id, status);

-- cash_movements
create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references cash_registers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  operator_id uuid references profiles(id) on delete set null,
  type cash_movement_type not null,
  amount numeric(10,2) not null,
  description text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_movements_register on cash_movements(cash_register_id);
create index if not exists idx_cash_movements_company on cash_movements(company_id);

-- whatsapp_connections
create table if not exists whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider whatsapp_provider not null default 'evolution',
  phone text,
  status text not null default 'disconnected',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);
create trigger trg_whatsapp_connections_updated_at before update on whatsapp_connections for each row execute function set_updated_at();
create index if not exists idx_whatsapp_connections_company on whatsapp_connections(company_id);

-- whatsapp_messages
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid references whatsapp_connections(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  direction whatsapp_direction not null,
  message text not null,
  status whatsapp_status not null default 'pending',
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_messages_company on whatsapp_messages(company_id, created_at desc);
create index if not exists idx_whatsapp_messages_connection on whatsapp_messages(connection_id);
