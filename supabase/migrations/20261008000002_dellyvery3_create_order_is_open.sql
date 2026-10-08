-- DELLVERY 3 — create_order respeita companies.is_open (FASE 2, local only)
--
-- Regra de negócio:
--  - active=true AND is_open=true   -> pedidos online/whatsapp criados normalmente.
--  - active=true AND is_open=false  -> restaurante fechado: bloqueia pedidos
--    online/whatsapp com erro controlado, ANTES de criar customer,
--    order_number, itens ou notification.
--  - source='balcao' (PDV interno)  -> NUNCA bloqueado por is_open; exige
--    apenas active (empresa suspensa não vende nem no balcão).
--  - company inactive               -> bloqueia todas as origens (mensagem
--    legada preservada).
-- Validação no BANCO (o frontend pode estar desatualizado -> race condition
-- coberta: o erro da RPC é exibido no Checkout).
-- Assinatura: adiciona p_source (default 'online', preserva chamadas antigas
-- que não enviam a origem). DROP da assinatura anterior antes do CREATE
-- (overload acidental poluiria o catálogo da função).

drop function if exists create_order(text, text, text, jsonb, jsonb, uuid, text, text);

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
  -- FASE 2: gate operacional. Balcão (PDV interno) nunca é bloqueado por
  -- is_open; online/whatsapp são. Antes de qualquer efeito colateral.
  if v_source in ('online', 'whatsapp') and not coalesce(v_company_open, true) then
    raise exception 'Estamos fechados no momento e não estamos recebendo pedidos online.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Seu carrinho está vazio';
  end if;

  -- monta itens com preços do banco (nunca do frontend)
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

  -- taxa e mínimo
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

  -- cliente
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

  -- número + total
  v_order_number := public.next_order_number(v_company_id);
  v_total := v_subtotal + v_fee;

  -- pedido
  insert into public.orders (
    company_id, order_number, tracking_token, customer_id, delivery_zone_id,
    order_type, table_number, status, payment_status, subtotal, delivery_fee,
    discount, total,
    customer_data, delivery_address, notes, source
  ) values (
    v_company_id, v_order_number, v_tracking, v_customer_id, p_delivery_zone_id,
    v_order_type::public.order_type, nullif(btrim(coalesce(p_table_number, '')), ''), 'novo', 'pending',
    v_subtotal, v_fee, 0, v_total,
    jsonb_build_object('name', v_cust_name, 'phone', v_cust_phone,
      'email', nullif(btrim(coalesce(p_customer ->> 'email', '')), '')),
    v_addr, nullif(p_notes, ''), v_source
  ) returning id into v_order_id;

  -- itens (segunda passada, snapshots do banco)
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

  -- notification 'novo' idempotente (unique order_id+status)
  insert into public.notifications (company_id, order_id, status, message, order_number, tracking_token, link)
  values (v_company_id, v_order_id, 'novo',
    v_cust_name || ' realizou um novo pedido de R$ ' || v_total::text || '.',
    v_order_number, v_tracking, '/acompanhar/' || v_tracking::text)
  on conflict (order_id, status) do nothing;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'tracking_token', v_tracking);
end;
$$;

revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text) from public;
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text) to anon, authenticated;
