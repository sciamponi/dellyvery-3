-- DELLVERY 3 — Token público de mesa + QR Code + exclusão segura (FASE A2, local only)
--
-- 1. dining_tables.public_token: aleatório (12 hex), único, estável (sem
--    regen em updates comuns), backfill p/ existentes.
-- 2. resolve_table_token(p_token): RPC pública (anon) — valida existência,
--    mesa ativa e retorna SOMENTE company_slug + table_name. Sem IDs.
-- 3. delete_table_if_unused(p_table_id): RPC OWNER/ADMIN — trava a linha
--    (FOR UPDATE), bloqueia se houver QUALQUER pedido referenciando (lista
--    ativas no erro), deleta em transação. Sem cascata em pedidos.
-- 4. DELETE direto de mesas restrito a OWNER/ADMIN no RLS (MANAGER edita e
--    desativa, não apaga).
-- 5. create_order ganha p_table_token (default null, último = compatível):
--    resolve+valida no servidor; se p_table_id vier junto e divergir do
--    token, rejeita (anti-tamper). Fluxo público usa token; PDV usa table_id.
--    DROP da assinatura anterior (11 args) antes do CREATE (padrão do projeto
--    p/ assinatura única no PostgREST). Lógica de produção 11 args preservada.
-- Sem DROP TABLE, sem DELETE de dados, sem reescrita de histórico.

alter table public.dining_tables
  add column if not exists public_token text;

create unique index if not exists uq_tables_public_token
  on dining_tables (public_token) where public_token is not null;

update public.dining_tables
  set public_token = substring(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where public_token is null;

-- Novas mesas já nascem com token (estável: updates comuns não tocam a coluna).
alter table public.dining_tables
  alter column public_token
  set default substring(replace(gen_random_uuid()::text, '-', ''), 1, 12);

-- =========================
-- Resolução pública (anon): só slug + nome, nunca IDs internos.
-- =========================
create or replace function resolve_table_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_active boolean;
  v_slug text;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'Mesa não identificada';
  end if;
  select t.name, t.active, c.slug into v_name, v_active, v_slug
  from public.dining_tables t
  join public.companies c on c.id = t.company_id
  where t.public_token = btrim(p_token);
  if not found then
    raise exception 'Mesa não encontrada';
  end if;
  if coalesce(v_active, true) = false then
    raise exception 'Mesa indisponível no momento';
  end if;
  return jsonb_build_object('company_slug', v_slug, 'table_name', v_name);
end;
$$;

revoke all on function resolve_table_token(text) from public;
grant execute on function resolve_table_token(text) to anon, authenticated;

-- =========================
-- Exclusão segura: só OWNER/ADMIN, só sem nenhum pedido referenciando.
-- Trava a linha (FOR UPDATE): referência concorrente espera a transação,
-- impedindo a condição de corrida entre checar e apagar.
-- =========================
create or replace function delete_table_if_unused(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if not (is_company_member(v_row.company_id)
    and member_role(v_row.company_id) in ('OWNER', 'ADMIN')) then
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
$$;

revoke all on function delete_table_if_unused(uuid) from public, anon;
grant execute on function delete_table_if_unused(uuid) to authenticated;

-- DELETE direto restrito a OWNER/ADMIN (MANAGER edita/ativa, não apaga).
drop policy if exists dining_tables_delete_mgr on dining_tables;
drop policy if exists dining_tables_delete_owner_admin on dining_tables;
create policy dining_tables_delete_owner_admin on dining_tables
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER', 'ADMIN'))
    or is_platform_admin()
  );

alter table public.dining_tables
  add column if not exists code text;
alter table public.dining_tables
  add column if not exists notes text;

drop function if exists
  create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid);

create or replace function create_order(
  p_company_slug text,
  p_order_type text default 'delivery',
  p_table_number text default null,
  p_items jsonb default '[]',
  p_customer jsonb default '{}',
  p_delivery_zone_id uuid default null,
  p_payment_method text default null,
  p_notes text default null,
  p_source text default 'online',
  p_change_for numeric default null,
  p_table_id uuid default null,
  p_table_token text default null
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
  v_table record;
  v_table_found boolean := false;
  v_table_display text;
  v_table_id uuid := p_table_id;
  v_tok record;
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
  if p_change_for is not null and p_change_for <= 0 then
    raise exception 'Troco inválido';
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

  -- Mesa por ID: existente, ativa e da mesma empresa. Nome serve de display
  -- quando p_table_number vier vazio. Flag própria (record com campos
  -- nulos falha em IS NOT NULL — nunca testar nulidade do record).
  if p_table_id is not null then
    select * into v_table from public.dining_tables where id = p_table_id;
    if not found or v_table.company_id is distinct from v_company_id then
      raise exception 'Mesa inválida para esta empresa';
    end if;
    if coalesce(v_table.active, true) = false then
      raise exception 'Mesa inativa';
    end if;
    v_table_found := true;
  end if;
  v_table_display := nullif(btrim(coalesce(p_table_number, '')), '');
  if v_table_display is null and v_table_found then
    v_table_display := v_table.name;
  end if;

  -- Token público (fluxo QR): resolve no servidor; nunca confia em table_id
  -- cru do público. Se ambos vierem e divergirem, rejeita (anti-tamper).
  if nullif(btrim(coalesce(p_table_token, '')), '') is not null then
    select * into v_tok from public.dining_tables
    where public_token = btrim(p_table_token);
    if not found or v_tok.company_id is distinct from v_company_id then
      raise exception 'Mesa inválida para este pedido';
    end if;
    if coalesce(v_tok.active, true) = false then
      raise exception 'Mesa indisponível no momento';
    end if;
    if p_table_id is not null and p_table_id is distinct from v_tok.id then
      raise exception 'Divergência na identificação da mesa';
    end if;
    v_table_found := true;
    v_table := v_tok;
    v_table_id := v_tok.id;
    if v_table_display is null then
      v_table_display := v_tok.name;
    end if;
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
  if v_order_type = 'mesa' and v_table_display is null and p_table_id is null then
    raise exception 'Número da mesa é obrigatório';
  end if;

  v_cust_name := btrim(coalesce(p_customer ->> 'name', ''));
  v_cust_phone := btrim(coalesce(p_customer ->> 'phone', ''));
  -- Entrega exige identificação; mesa/retirada aceitam pedido avulso.
  if v_order_type = 'delivery' then
    if v_cust_name = '' then
      raise exception 'Nome do cliente é obrigatório';
    end if;
    if v_cust_phone = '' then
      raise exception 'Telefone é obrigatório';
    end if;
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

  -- Sem telefone não há chave de cadastro: pedido avulso, sem upsert,
  -- sem cliente fictício (customer_id permanece null).
  v_customer_id := null;
  if v_cust_phone <> '' then
    select * into v_existing from public.customers
    where company_id = v_company_id and whatsapp = v_cust_phone limit 1;
    if found then
      v_customer_id := v_existing.id;
      update public.customers set
        name = case when v_cust_name <> '' then v_cust_name else name end,
        phone = v_cust_phone,
        email = case when btrim(coalesce(p_customer ->> 'email', '')) <> '' then btrim(p_customer ->> 'email') else email end,
        address = coalesce(address, '{}'::jsonb) || v_addr
      where id = v_customer_id;
    else
      -- Nome pode ser vazio (pedido avulso com telefone): NOT NULL aceita ''.
      insert into public.customers (company_id, name, whatsapp, phone, email, address)
      values (v_company_id, v_cust_name, v_cust_phone, v_cust_phone,
        nullif(btrim(coalesce(p_customer ->> 'email', '')), ''), v_addr)
      returning id into v_customer_id;
    end if;
  end if;

  v_order_number := public.next_order_number(v_company_id);
  v_total := v_subtotal + v_fee;
  if p_change_for is not null and p_change_for < v_total then
    raise exception 'Troco deve cobrir o total do pedido';
  end if;

  insert into public.orders (
    company_id, order_number, tracking_token, customer_id, delivery_zone_id,
    order_type, table_number, table_id, status, payment_status, payment_method, subtotal, delivery_fee,
    discount, total, change_for,
    customer_data, delivery_address, notes, source
  ) values (
    v_company_id, v_order_number, v_tracking, v_customer_id, p_delivery_zone_id,
    v_order_type::public.order_type, v_table_display, v_table_id, 'novo', 'pending',
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    v_subtotal, v_fee, 0, v_total, p_change_for,
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
    coalesce(nullif(v_cust_name, ''), 'Pedido avulso') || ' — novo pedido de R$ ' || v_total::text || '.',
    v_order_number, v_tracking, '/acompanhar/' || v_tracking::text)
  on conflict (order_id, status) do nothing;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'tracking_token', v_tracking);
end;
$$;

revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text) from public;
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text) to anon, authenticated;
