-- DELLVERY 3 — Orders RPCs (FASE 5.4 ETAPA B2, local only)
-- Funções SECURITY DEFINER com search_path fixo e grants mínimos.
-- Espelham base44/functions/{createOrder,manageOrder,getOrderByToken}.
-- Divergências documentadas (sem inventar regra):
--  D1. Company.is_open não existe no schema -> gate usa companies.active.
--  D2. Company.delivery_fee/minimum_order não existem -> taxa = zone.fee
--      (0 sem zona); minimum = zone.minimum_order (0 = sem mínimo).
--  D3. Customer stats (orders_count/total_spent/last_order_date) fora do
--      schema (decisão 5.3) -> não atualizados.
--  D4. Notification.title/customer_* derivados na hora (sem colunas novas).
--  D5. Transições: backend aceita qualquer status válido não-terminal,
--      como o Base44 (fluxo guiado pelo frontend getNextStatus); cancelado
--      é imutável; cancel bloqueia finalizado/cancelado.

-- =========================
-- Helpers internos (sem grant público)
-- =========================
create or replace function order_status_message(p_order_number int, p_status order_status)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'confirmado' then 'Seu pedido #' || p_order_number || ' foi confirmado pelo restaurante.'
    when 'em_preparo' then 'Seu pedido #' || p_order_number || ' está sendo preparado.'
    when 'aguardando_retirada' then 'Seu pedido #' || p_order_number || ' está pronto para retirada.'
    when 'saiu_entrega' then 'Seu pedido #' || p_order_number || ' saiu para entrega.'
    when 'finalizado' then 'Seu pedido #' || p_order_number || ' foi finalizado. Obrigado!'
    when 'cancelado' then 'Seu pedido #' || p_order_number || ' foi cancelado.'
    else 'Seu pedido #' || p_order_number || ' foi atualizado.'
  end;
$$;

revoke all on function order_status_message(int, order_status) from public, anon, authenticated;

-- =========================
-- 1. create_order (pública: Checkout anon)
-- p_items: [{product_id, quantity, complements:[{group_name,option_name,quantity}], notes}]
-- p_customer: {name, phone, email, address, number, complement, neighborhood, city, zip_code}
-- =========================
create or replace function create_order(
  p_company_slug text,
  p_order_type text default 'delivery',
  p_table_number text default null,
  p_items jsonb default '[]',
  p_customer jsonb default '{}',
  p_delivery_zone_id uuid default null,
  p_payment_method text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_active boolean;
  v_order_type text := coalesce(p_order_type, 'delivery');
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

  select id, active into v_company_id, v_company_active
  from public.companies where slug = p_company_slug;
  if v_company_id is null then
    raise exception 'Empresa não encontrada';
  end if;
  if not coalesce(v_company_active, false) then
    raise exception 'Estabelecimento fechado no momento';
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

  -- taxa e mínimo (D2)
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
    v_addr, nullif(p_notes, ''), 'online'
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

revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text) from public;
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text) to anon, authenticated;

-- =========================
-- 2. manage_order (autenticada: painel)
-- p_action: status | cancel | edit
-- p_items: [{product_id, quantity, complements:[...], notes}] (edit)
-- p_address: {street,number,complement,neighborhood,...} (edit)
-- =========================
create or replace function manage_order(
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
set search_path = public
as $$
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
  v_old_status order_status;
  v_new_status order_status;
  v_valid_statuses order_status[] := array['novo','confirmado','em_preparo','aguardando_retirada','saiu_entrega','finalizado','cancelado'];
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
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, total, options, notes)
      values (p_order_id, v_prod.id, v_prod.name, v_qty, v_unit,
        v_unit * v_qty + v_comp_total, v_valid_comps, coalesce(v_item ->> 'notes', ''));
      v_subtotal := v_subtotal + v_unit * v_qty + v_comp_total;
    end loop;
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
$$;

drop function if exists manage_order(uuid, text, order_status, text, jsonb, numeric, jsonb, text);
revoke all on function manage_order(uuid, text, text, text, jsonb, numeric, jsonb, text) from public;
-- Privilégios default do banco concedem EXECUTE a anon em funções novas;
-- revogar explicitamente (manage_order é só painel autenticado).
revoke all on function manage_order(uuid, text, text, text, jsonb, numeric, jsonb, text) from anon;
grant execute on function manage_order(uuid, text, text, text, jsonb, numeric, jsonb, text) to authenticated;
-- Endurecer função de onboarding (fase 2): anon chamaria e cairia em
-- 'not authenticated', mas sem EXECUTE fica explícito e à prova de mudança.
revoke all on function create_company_with_owner(text, text, uuid, text, text, text, text) from anon;

-- =========================
-- 3. get_order_by_token (pública: tracking anon)
-- Retorna SOMENTE campos seguros. Sem SELECT anon em orders.
-- =========================
create or replace function get_order_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_items jsonb;
  v_history jsonb;
begin
  if p_token is null then
    raise exception 'Token não fornecido';
  end if;
  select * into v_order from public.orders where tracking_token = p_token;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  -- Formato Base44 esperado pelo OrderTracking: {name,quantity,price,notes,complements[]}
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', product_name, 'quantity', quantity, 'unit_price', unit_price,
    'price', total, 'notes', notes, 'complements', coalesce(options, '[]'::jsonb)
    ) order by created_at), '[]'::jsonb)
  into v_items from public.order_items where order_id = v_order.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'status', new_status, 'timestamp', created_at
    ) order by created_at), '[]'::jsonb)
  into v_history from public.order_status_history where order_id = v_order.id;
  return jsonb_build_object(
    'order_number', v_order.order_number,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'customer_name', coalesce(v_order.customer_data ->> 'name', ''),
    'items', v_items,
    'subtotal', v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'discount', v_order.discount,
    'total', v_order.total,
    'status', v_order.status,
    'status_history', v_history,
    'payment_method', v_order.payment_method,
    'notes', v_order.notes,
    'created_at', v_order.created_at,
    'source', v_order.source
  );
end;
$$;

revoke all on function get_order_by_token(uuid) from public;
grant execute on function get_order_by_token(uuid) to anon, authenticated;
