-- DELLVERY 3 — Zonas por polígono no checkout (local only)
--
-- 1. point_in_polygon + resolve_delivery_zone (ray casting sobre GeoJSON;
--    sobreposição: menor taxa, desempate nome/id — determinístico).
-- 2. create_order com p_lat/p_lng (assinatura 12 -> 14 args; overload
--    anterior removido como na Fase A): com coordenadas + áreas ativas,
--    resolve a zona e cobra SUA taxa (zone_id declarado e divergente é
--    rejeitado); sem coordenadas e com áreas, exige zona explícita;
--    sem áreas, fluxo legado intacto (retirada/mesa/PDV inalterados).
--    Demais lógicas de create_order/manage_order intactas.
-- 3. get_storefront_by_slug: delivery_zones ganham 'has_polygon'.
-- Gerado por transformação verificada da migration 20261022 (âncoras
-- com ocorrência exata). Sem DROP de dados. Sem aplicação remota.

-- =========================
-- 1. Geometria no servidor
-- =========================
create or replace function public.point_in_polygon(p_lng numeric, p_lat numeric, p_ring jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $func$
declare
  v_inside boolean := false;
  v_n int;
  v_i int;
  v_j int;
  v_xi numeric; v_yi numeric; v_xj numeric; v_yj numeric;
begin
  if p_lng is null or p_lat is null then
    return false;
  end if;
  if p_ring is null or jsonb_typeof(p_ring) <> 'array' then
    return false;
  end if;
  v_n := jsonb_array_length(p_ring);
  if v_n < 3 then
    return false;
  end if;
  v_j := v_n - 1;
  for v_i in 0..v_n - 1 loop
    begin
      v_xi := (p_ring -> v_i ->> 0)::numeric;
      v_yi := (p_ring -> v_i ->> 1)::numeric;
      v_xj := (p_ring -> v_j ->> 0)::numeric;
      v_yj := (p_ring -> v_j ->> 1)::numeric;
    exception when others then
      v_xi := null; v_yi := null; v_xj := null; v_yj := null;
    end;
    if v_xi is null or v_yi is null or v_xj is null or v_yj is null then
      v_j := v_i;
      continue;
    end if;
    if (v_yi > p_lat) <> (v_yj > p_lat)
       and p_lng < (v_xj - v_xi) * (p_lat - v_yi) / (v_yj - v_yi) + v_xi then
      v_inside := not v_inside;
    end if;
    v_j := v_i;
  end loop;
  return v_inside;
end;
$func$;

revoke all on function public.point_in_polygon(numeric, numeric, jsonb) from public, anon, authenticated;

create or replace function public.resolve_delivery_zone(p_company_id uuid, p_lng numeric, p_lat numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_zone uuid;
begin
  if p_company_id is null or p_lng is null or p_lat is null then
    return null;
  end if;
  select z.id into v_zone
  from public.delivery_zones z
  where z.company_id = p_company_id and z.active = true and z.polygon is not null
    and z.polygon ->> 'type' = 'Polygon'
    and jsonb_typeof(z.polygon -> 'coordinates') = 'array'
    and public.point_in_polygon(p_lng, p_lat, z.polygon -> 'coordinates' -> 0)
  order by coalesce(z.fee, 0), z.name, z.id
  limit 1;
  return v_zone;
end;
$func$;

revoke all on function public.resolve_delivery_zone(uuid, numeric, numeric) from public, anon, authenticated;

-- =========================
-- 2. create_order 14 args (remove overload de 12)
-- =========================
drop function if exists public.create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text);

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
  p_table_token text default null,
  p_lat numeric default null,
  p_lng numeric default null
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
  v_zone_id uuid;
  v_has_poly boolean;
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
  -- Montagem V2.
  v_has_cfg boolean;
  v_use_v2 boolean;
  v_cfgres jsonb;
  v_req_title text;
  v_req_min int;
  v_req_flag boolean;
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

    -- Montagem V2: config {steps:[...]} + produto COM passos ativos
    -- (próprios ou herdados da categoria).
    select exists(
      select 1 from public.product_config_steps
      where company_id = v_company_id and active
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
      v_cfgres := public.config_selection_total(v_company_id, v_prod.id, v_item -> 'config');
      v_valid_comps := v_cfgres -> 'comps';
      v_comp_total := coalesce((v_cfgres ->> 'total')::numeric, 0);
    else
      if v_has_cfg then
        -- Sem config enviada: obrigatoriedade continua valendo (próprios + herdados).
        select title, min_select, required into v_req_title, v_req_min, v_req_flag
        from public.product_config_steps
        where company_id = v_company_id and active
          and (required or coalesce(min_select, 0) > 0)
          and (product_id = v_prod.id
               or (coalesce(v_prod.use_category_steps, true) and v_prod.category_id is not null
                   and category_id = v_prod.category_id and product_id is null))
        order by (product_id is null), position limit 1;
        if found then
          if coalesce(v_req_flag, false) then
            raise exception 'Etapa "%" é obrigatória', v_req_title;
          else
            raise exception 'Etapa "%" exige no mínimo % escolha(s)', v_req_title, v_req_min;
          end if;
        end if;
      end if;
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
          if v_opt_qty is null or v_opt_qty < 1 then
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
    end if;

    v_subtotal := v_subtotal + v_unit * v_qty + v_comp_total;
  end loop;

  -- Dependências entre produtos (regras ativas da empresa).
  perform public.check_order_dependencies(v_company_id, p_items);

  if v_order_type = 'delivery' then
    -- Resolução por polígono (coordenadas + áreas ativas da empresa).
    v_zone_id := null;
    if p_lat is not null or p_lng is not null then
      if p_lat is null or p_lng is null
         or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
        raise exception 'Coordenadas inválidas para entrega';
      end if;
      select exists(
        select 1 from public.delivery_zones
        where company_id = v_company_id and active = true and polygon is not null
      ) into v_has_poly;
      if v_has_poly then
        v_zone_id := public.resolve_delivery_zone(v_company_id, p_lng, p_lat);
        if v_zone_id is null then
          raise exception 'Endereço fora da área de entrega';
        end if;
        if p_delivery_zone_id is not null and p_delivery_zone_id is distinct from v_zone_id then
          raise exception 'Zona de entrega incompatível com o endereço';
        end if;
        select fee, minimum_order into v_zone_fee, v_zone_min
        from public.delivery_zones where id = v_zone_id;
        v_fee := coalesce(v_zone_fee, 0);
        if coalesce(v_zone_min, 0) > 0 and v_subtotal < v_zone_min then
          raise exception 'Pedido mínimo para esta zona: R$ %', v_zone_min;
        end if;
      end if;
    end if;
    -- Legado: sem coordenadas. Com áreas ativas, exige zona explícita
    -- (nunca aprova taxa zero automática); sem áreas, fluxo original.
    if v_zone_id is null then
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
        select exists(
          select 1 from public.delivery_zones
          where company_id = v_company_id and active = true and polygon is not null
        ) into v_has_poly;
        if v_has_poly then
          raise exception 'Escolha a zona de entrega ou informe um endereço localizável';
        end if;
        v_fee := 0;
      end if;
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
    -- Ramo V2 também na persistência (determinístico: mesma entrada,
    -- mesma validação e mesmos valores da 1ª passada).
    v_use_v2 := v_item ? 'config' and jsonb_typeof(v_item -> 'config') = 'object'
      and jsonb_typeof(coalesce(v_item -> 'config' -> 'steps', '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(v_item -> 'config' -> 'steps', '[]'::jsonb)) > 0;
    if v_use_v2 then
      v_cfgres := public.config_selection_total(v_company_id, v_prod.id, v_item -> 'config');
      v_valid_comps := v_cfgres -> 'comps';
      v_comp_total := coalesce((v_cfgres ->> 'total')::numeric, 0);
    else
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

revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text, numeric, numeric) from public;
-- service_role explícito: o DROP acima apaga todos os grants da v12
-- vigente (que inclui service_role); sem ele, chamadas administrativas
-- via service_role quebrariam. Privilégio mínimo mantido: só EXECUTE.
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text, numeric, numeric) to anon, authenticated, service_role;

-- =========================
-- 3. Storefront: has_polygon nas zonas
-- =========================
create or replace function get_storefront_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company record;
  v_theme record;
  v_cats jsonb;
  v_prods jsonb;
  v_zones jsonb;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'Loja não encontrada';
  end if;
  select * into v_company from public.companies where slug = p_slug;
  if not found then
    raise exception 'Loja não encontrada';
  end if;

  select * into v_theme from public.store_themes where company_id = v_company.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'description', description,
    'icon', icon, 'image_url', image_url, 'slug', slug
    ) order by sort_order, name), '[]'::jsonb)
  into v_cats from public.categories
  where company_id = v_company.id and active = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'category_id', p.category_id, 'name', p.name,
    'description', p.description, 'price', p.price,
    'promotional_price', p.promotional_price, 'image_url', p.image_url,
    'complements', coalesce(p.options, '[]'::jsonb),
    'is_featured', coalesce(p.is_featured, false),
    'is_bestseller', coalesce(p.is_bestseller, false),
    'is_made_to_order', coalesce(p.is_made_to_order, false),
    'preparation_time', p.preparation_time,
    'ingredients', p.ingredients, 'nutritional_info', p.nutritional_info,
    'sort_order', p.sort_order,
    'dependency_mode', coalesce(p.dependency_mode, 'any'),
    'requires', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'name', pr.name
      ) order by pr.name), '[]'::jsonb)
      from public.product_dependencies d
      join public.products pr on pr.id = d.requires_product_id
      where d.product_id = p.id and d.company_id = v_company.id and d.active = true
    ),
    'config', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'product_id', s.product_id, 'company_id', s.company_id,
        'title', s.title, 'description', s.description,
        'select_mode', s.select_mode, 'min_select', s.min_select,
        'max_select', s.max_select, 'free_qty', s.free_qty,
        'required', s.required,
        'inherited', (s.product_id is null),
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', o.id, 'step_id', o.step_id, 'ingredient_id', o.ingredient_id,
            'product_id', o.product_id, 'name', o.name, 'description', o.description,
            'price', o.price
          ) order by o.sort_order, o.name), '[]'::jsonb)
          from public.product_config_options o
          where o.step_id = s.id and o.active = true
        )
      ) order by (s.product_id is null) desc, s.position), '[]'::jsonb)
      from public.product_config_steps s
      where s.company_id = v_company.id and s.active = true
        and (s.product_id = p.id
             or (coalesce(p.use_category_steps, true) and p.category_id is not null
                 and s.category_id = p.category_id and s.product_id is null))
    )
    ) order by p.sort_order, p.name), '[]'::jsonb)
  into v_prods from public.products p
  where p.company_id = v_company.id
    and p.active = true
    and coalesce(p.out_of_stock, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'fee', fee, 'estimated_time', estimated_time,
    'has_polygon', (polygon is not null)
    ) order by name), '[]'::jsonb)
  into v_zones from public.delivery_zones
  where company_id = v_company.id and active = true;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'slug', v_company.slug,
      'logo_url', v_company.logo_url, 'cover_url', v_company.cover_url,
      'description', v_company.description, 'slogan', v_company.slogan,
      'primary_color', v_company.primary_color, 'accent_color', v_company.accent_color,
      'phone', v_company.phone, 'estimated_delivery_time', v_company.estimated_delivery_time,
      'address', v_company.address, 'city', v_company.city, 'state', v_company.state,
      'zip_code', v_company.zip_code, 'is_open', v_company.is_open,
      'minimum_order', v_company.minimum_order, 'delivery_fee', v_company.delivery_fee
    ),
    'theme', case when v_theme is null then '{}'::jsonb else jsonb_build_object(
      'colors', v_theme.colors, 'fonts', v_theme.fonts, 'banners', v_theme.banners,
      'layout', v_theme.layout, 'custom_css', v_theme.custom_css
    ) end,
    'categories', v_cats,
    'products', v_prods,
    'delivery_zones', v_zones
  );
end;
$$;

revoke all on function get_storefront_by_slug(text) from public;
grant execute on function get_storefront_by_slug(text) to anon, authenticated;
