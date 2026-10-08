-- DELLVERY 3 — PDV mesas: infraestrutura (FASE 3B, local only)
--
-- Escopo ESTRITO 3B (sem UI, sem 3C/3D, sem F4):
--  1. dining_tables (+ unique parcial de nome entre ativas + RLS padrão)
--  2. orders.table_id (nullable, FK SET NULL, índice, trigger mesma-company)
--  3. Backfill de mesas a partir de orders.table_number (normalizado)
--  4. create_order passa a PERSISTIR payment_method (estrutura p/ 3C; sem pay)
--  5. orders.change_for (nullable; regra de Dinheiro fica p/ 3C)
--  6. delivery_zones.neighborhoods + is_fallback (+ unique parcial; sem matcher)
--  7. orders.archived_at (nullable; sem uso na UI nesta fase)
--  8. NADA de ingredients/product_option_*/allow_repeat (reservado p/ F4)
--  9. RLS padrão + realtime p/ dining_tables
-- table_number é PRESERVADO como display/legado.

-- =========================
-- 1. dining_tables
-- =========================
create table if not exists dining_tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_table_name_not_empty check (btrim(name) <> '')
);

-- Nome único por empresa ENTRE ATIVAS (case-insensitive): "Joice" vs "joice"
-- colidem; inativas liberam o nome para reuso.
create unique index if not exists uq_tables_company_name_active
  on dining_tables (company_id, lower(btrim(name))) where active = true;
create index if not exists idx_tables_company_sort
  on dining_tables (company_id, sort_order);

drop trigger if exists trg_dining_tables_updated_at on dining_tables;
create trigger trg_dining_tables_updated_at
  before update on dining_tables
  for each row execute function set_updated_at();

drop trigger if exists trg_immutable_company on dining_tables;
create trigger trg_immutable_company
  before update on dining_tables
  for each row execute function prevent_company_id_change();

alter table dining_tables enable row level security;

drop policy if exists dining_tables_select_member on dining_tables;
create policy dining_tables_select_member on dining_tables
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists dining_tables_insert_mgr on dining_tables;
create policy dining_tables_insert_mgr on dining_tables
  for insert to authenticated
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists dining_tables_update_mgr on dining_tables;
create policy dining_tables_update_mgr on dining_tables
  for update to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists dining_tables_delete_mgr on dining_tables;
create policy dining_tables_delete_mgr on dining_tables
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

-- =========================
-- 2. orders.table_id
-- =========================
alter table orders add column if not exists table_id uuid
  references dining_tables(id) on delete set null;

create index if not exists idx_orders_company_table
  on orders (company_id, table_id);

-- mesma company: estende o verificador padrão (cobre INSERT e UPDATE de table_id)
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
  if new.table_id is not null and (old.table_id is distinct from new.table_id or TG_OP = 'INSERT') then
    select company_id into v_company from public.dining_tables where id = new.table_id;
    if v_company is null then
      raise exception 'table not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'table belongs to another company';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_order_company_refs() from public, anon, authenticated;

drop trigger if exists trg_orders_company_refs on orders;
create trigger trg_orders_company_refs
  before insert or update of customer_id, delivery_zone_id, driver_id, table_id on orders
  for each row execute function enforce_order_company_refs();

-- =========================
-- 3. Backfill de mesas a partir de orders.table_number
-- Normalização p/ dedupe: trim + lower; numéricos ignoram zeros à esquerda
-- ("02","2"," 02 " -> mesma mesa). Display preserva o 1º valor original.
-- =========================
create or replace function normalize_table_key(p_raw text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_raw, '')));
begin
  if v = '' then
    return '';
  end if;
  if v ~ '^[0-9]+$' then
    v := ltrim(v, '0');
    if v = '' then
      v := '0';
    end if;
  end if;
  return v;
end;
$$;

revoke all on function normalize_table_key(text) from public, anon;
grant execute on function normalize_table_key(text) to authenticated;

do $$
declare
  r record;
  v_key text;
  v_table_id uuid;
  v_max_sort int;
begin
  for r in
    select distinct company_id, btrim(table_number) as display
    from public.orders
    where order_type = 'mesa' and btrim(coalesce(table_number, '')) <> ''
    order by company_id, display
  loop
    v_key := public.normalize_table_key(r.display);
    select id into v_table_id from public.dining_tables
    where company_id = r.company_id
      and (
        public.normalize_table_key(name) = v_key
        or (not active and lower(btrim(name)) = lower(btrim(r.display)))
      )
    limit 1;
    if v_table_id is null then
      select coalesce(max(sort_order), -1) + 1 into v_max_sort
      from public.dining_tables where company_id = r.company_id;
      insert into public.dining_tables (company_id, name, sort_order, active)
      values (r.company_id, r.display, v_max_sort, true)
      returning id into v_table_id;
    end if;
    update public.orders set table_id = v_table_id
    where company_id = r.company_id
      and order_type = 'mesa'
      and public.normalize_table_key(table_number) = v_key
      and table_id is distinct from v_table_id;
  end loop;
end;
$$;

-- =========================
-- 4. create_order PERSISTE payment_method (estrutura p/ 3C; sem ação pay)
-- Corpo idêntico ao da migration anterior; única diferença: a coluna
-- payment_method no INSERT (antes descartada). Sem DROP (mesma assinatura).
-- =========================
create or replace function create_order(
  p_company_slug text,
  p_order_type text default 'delivery',
  p_table_number text default null,
  p_items jsonb default '[]',
  p_customer jsonb default '{}',
  p_delivery_zone_id uuid default null,
  p_payment_method text default null,
  p_notes text default null,
  p_source text default 'online'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_active boolean;
  v_company_open boolean;
  v_order_type text := coalesce(p_order_type, 'delivery');
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'online');
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
  v_subtotal numeric := 0;
  v_fee numeric := 0;
  v_zone_fee numeric;
  v_zone_min numeric;
  v_cust_name text;
  v_cust_phone text;
  v_customer_id uuid;
  v_existing record;
  v_addr jsonb;
  v_order_number int;
  v_tracking uuid := gen_random_uuid();
  v_order_id uuid;
  v_total numeric;
begin
  if p_company_slug is null or btrim(p_company_slug) = '' then
    raise exception 'Empresa não identificada';
  end if;
  if v_order_type not in ('delivery', 'retirada', 'mesa') then
    raise exception 'Tipo de pedido inválido';
  end if;
  if v_source not in ('online', 'whatsapp', 'balcao') then
    raise exception 'Origem do pedido inválida';
  end if;

  select id, active, is_open into v_company_id, v_company_active, v_company_open
  from public.companies where slug = p_company_slug;
  if v_company_id is null then
    raise exception 'Empresa não encontrada';
  end if;
  if not coalesce(v_company_active, false) then
    raise exception 'Estabelecimento fechado no momento';
  end if;
  if v_source in ('online', 'whatsapp') and not coalesce(v_company_open, true) then
    raise exception 'Estamos fechados no momento e não estamos recebendo pedidos online.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Seu carrinho está vazio';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item ->> 'product_id') is null then
      raise exception 'Produto inválido no carrinho';
    end if;
    select * into v_prod from public.products
    where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id;
    if not found then
      raise exception 'Produto não encontrado: %', (v_item ->> 'product_id');
    end if;
    if not coalesce(v_prod.active, true) or coalesce(v_prod.out_of_stock, false) then
      raise exception 'Produto indisponível: %', v_prod.name;
    end if;
    v_qty := (v_item ->> 'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'Quantidade inválida para %', v_prod.name;
    end if;

    v_unit := coalesce(v_prod.promotional_price, v_prod.price);
    v_valid_comps := '[]'::jsonb;
    v_comp_total := 0;

    if v_item ? 'complements' and jsonb_typeof(v_item -> 'complements') = 'array'
       and jsonb_array_length(v_item -> 'complements') > 0 then
      if v_prod.options is null or jsonb_typeof(v_prod.options) <> 'array'
         or jsonb_array_length(v_prod.options) = 0 then
        raise exception 'Produto "%" não possui adicionais', v_prod.name;
      end if;
      for v_comp in select * from jsonb_array_elements(v_item -> 'complements') loop
        select g into v_group from jsonb_array_elements(v_prod.options) g
        where g ->> 'name' = (v_comp ->> 'group_name') limit 1;
        if v_group is null then
          raise exception 'Adicional inválido: %', (v_comp ->> 'group_name');
        end if;
        select o into v_opt from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb)) o
        where o ->> 'name' = (v_comp ->> 'option_name') limit 1;
        if v_opt is null then
          raise exception 'Opção inválida: %', (v_comp ->> 'option_name');
        end if;
        v_opt_qty := coalesce((v_comp ->> 'quantity')::int, 1);
        if v_opt_qty < 1 then
          raise exception 'Quantidade inválida para adicional';
        end if;
        if (v_group ->> 'max_select')::int is not null and v_opt_qty > (v_group ->> 'max_select')::int then
          raise exception 'Máximo de % para %', (v_group ->> 'max_select'), (v_group ->> 'name');
        end if;
        v_opt_price := coalesce((v_opt ->> 'price')::numeric, 0);
        v_valid_comps := v_valid_comps || jsonb_build_object(
          'group_name', v_group ->> 'name', 'option_name', v_opt ->> 'name',
          'price', v_opt_price, 'quantity', v_opt_qty);
        v_comp_total := v_comp_total + v_opt_price * v_opt_qty;
      end loop;
    end if;

    v_subtotal := v_subtotal + v_unit * v_qty + v_comp_total;
  end loop;

  if v_order_type = 'delivery' then
    if p_delivery_zone_id is not null then
      select fee, minimum_order into v_zone_fee, v_zone_min
      from public.delivery_zones where id = p_delivery_zone_id and company_id = v_company_id;
      if not found then
        raise exception 'Zona de entrega inválida';
      end if;
      v_fee := coalesce(v_zone_fee, 0);
      if coalesce(v_zone_min, 0) > 0 and v_subtotal < v_zone_min then
        raise exception 'Pedido mínimo para esta zona: R$ %', v_zone_min;
      end if;
    else
      v_fee := 0;
    end if;
  end if;
  if v_order_type = 'mesa' and (p_table_number is null or btrim(p_table_number) = '') then
    raise exception 'Número da mesa é obrigatório';
  end if;

  v_cust_name := btrim(coalesce(p_customer ->> 'name', ''));
  v_cust_phone := btrim(coalesce(p_customer ->> 'phone', ''));
  if v_cust_name = '' then
    raise exception 'Nome do cliente é obrigatório';
  end if;
  if v_cust_phone = '' then
    raise exception 'Telefone é obrigatório';
  end if;
  v_addr := jsonb_build_object(
    'street', coalesce(p_customer ->> 'address', ''),
    'number', coalesce(p_customer ->> 'number', ''),
    'complement', coalesce(p_customer ->> 'complement', ''),
    'neighborhood', coalesce(p_customer ->> 'neighborhood', ''),
    'city', coalesce(p_customer ->> 'city', ''),
    'zip_code', coalesce(p_customer ->> 'zip_code', ''));
  if v_order_type = 'delivery' and btrim(coalesce(p_customer ->> 'address', '')) = '' then
    raise exception 'Endereço é obrigatório para delivery';
  end if;

  select * into v_existing from public.customers
  where company_id = v_company_id and whatsapp = v_cust_phone limit 1;
  if found then
    v_customer_id := v_existing.id;
    update public.customers set
      name = v_cust_name,
      phone = v_cust_phone,
      email = case when btrim(coalesce(p_customer ->> 'email', '')) <> '' then btrim(p_customer ->> 'email') else email end,
      address = coalesce(address, '{}'::jsonb) || v_addr
    where id = v_customer_id;
  else
    insert into public.customers (company_id, name, whatsapp, phone, email, address)
    values (v_company_id, v_cust_name, v_cust_phone, v_cust_phone,
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''), v_addr)
    returning id into v_customer_id;
  end if;

  v_order_number := public.next_order_number(v_company_id);
  v_total := v_subtotal + v_fee;

  insert into public.orders (
    company_id, order_number, tracking_token, customer_id, delivery_zone_id,
    order_type, table_number, status, payment_status, payment_method, subtotal, delivery_fee,
    discount, total,
    customer_data, delivery_address, notes, source
  ) values (
    v_company_id, v_order_number, v_tracking, v_customer_id, p_delivery_zone_id,
    v_order_type::public.order_type, nullif(btrim(coalesce(p_table_number, '')), ''), 'novo', 'pending',
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    v_subtotal, v_fee, 0, v_total,
    jsonb_build_object('name', v_cust_name, 'phone', v_cust_phone,
      'email', nullif(btrim(coalesce(p_customer ->> 'email', '')), '')),
    v_addr, nullif(p_notes, ''), v_source
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.products
    where id = (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::int;
    v_unit := coalesce(v_prod.promotional_price, v_prod.price);
    v_valid_comps := '[]'::jsonb;
    v_comp_total := 0;
    if v_item ? 'complements' and jsonb_typeof(v_item -> 'complements') = 'array' then
      for v_comp in select * from jsonb_array_elements(v_item -> 'complements') loop
        select g into v_group from jsonb_array_elements(v_prod.options) g
        where g ->> 'name' = (v_comp ->> 'group_name') limit 1;
        select o into v_opt from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb)) o
        where o ->> 'name' = (v_comp ->> 'option_name') limit 1;
        v_opt_qty := coalesce((v_comp ->> 'quantity')::int, 1);
        v_opt_price := coalesce((v_opt ->> 'price')::numeric, 0);
        v_valid_comps := v_valid_comps || jsonb_build_object(
          'group_name', v_group ->> 'name', 'option_name', v_opt ->> 'name',
          'price', v_opt_price, 'quantity', v_opt_qty);
        v_comp_total := v_comp_total + v_opt_price * v_opt_qty;
      end loop;
    end if;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, total, options, notes)
    values (v_order_id, v_prod.id, v_prod.name, v_qty, v_unit,
      v_unit * v_qty + v_comp_total, v_valid_comps, coalesce(v_item ->> 'notes', ''));
  end loop;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by)
  values (v_order_id, null, 'novo', auth.uid());

  insert into public.notifications (company_id, order_id, status, message, order_number, tracking_token, link)
  values (v_company_id, v_order_id, 'novo',
    v_cust_name || ' realizou um novo pedido de R$ ' || v_total::text || '.',
    v_order_number, v_tracking, '/acompanhar/' || v_tracking::text)
  on conflict (order_id, status) do nothing;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'tracking_token', v_tracking);
end;
$$;

-- grants da assinatura (inalterados)
revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text) from public;
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text) to anon, authenticated;

-- =========================
-- 5. orders.change_for (estrutura; regra de Dinheiro = 3C)
-- =========================
alter table orders add column if not exists change_for numeric null;

-- =========================
-- 6. delivery_zones: neighborhoods + is_fallback (sem matcher; F6)
-- =========================
alter table delivery_zones add column if not exists neighborhoods text[] not null default '{}';
alter table delivery_zones add column if not exists is_fallback boolean not null default false;

-- no máximo UMA região fallback ativa por empresa (nunca escolha silenciosa)
create unique index if not exists uq_zones_company_fallback
  on delivery_zones (company_id) where is_fallback = true and active = true;

-- =========================
-- 7. orders.archived_at (sem uso na UI nesta fase)
-- =========================
alter table orders add column if not exists archived_at timestamptz null;
create index if not exists idx_orders_company_archived
  on orders (company_id, archived_at);

-- =========================
-- 10. Realtime p/ dining_tables (PDV 3D)
-- =========================
alter publication supabase_realtime add table dining_tables;
alter table dining_tables replica identity full;
