-- DELLVERY 3 — Dependências entre produtos (Gate 3, local only)
--
-- Regra comercial opt-in: produto pode exigir a presença de outro(s) no
-- mesmo pedido (OR entre linhas do mesmo produto). Sem regra ativa, nada
-- muda. Conteúdo = migration 20261020000000 na íntegra + :
--  1. product_dependencies (pares; tenant via trigger; RLS por papel).
--  2. check_order_dependencies(company, items): helper interno (sem grant).
--  3. create_order: perform após validar os itens (1ª passada).
--  4. manage_order/edit: perform após o loop (itens substituídos).
--  5. storefront: produtos ganham 'requires' (só regras ativas, id+nome).
-- Sem DROP TABLE, sem reescrita de histórico. Para produção requer
-- autorização (fora deste gate).

-- =========================
-- 1. Tabela + tenant + RLS
-- =========================
create table if not exists public.product_dependencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  requires_product_id uuid not null references public.products(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_dependency_different check (product_id <> requires_product_id),
  constraint uq_dependency_pair unique (product_id, requires_product_id)
);

create index if not exists idx_dependencies_company_product
  on public.product_dependencies (company_id, product_id);
create index if not exists idx_dependencies_requires
  on public.product_dependencies (requires_product_id);

create or replace function public.enforce_dependency_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_c1 uuid;
  v_c2 uuid;
begin
  select company_id into v_c1 from public.products where id = new.product_id;
  select company_id into v_c2 from public.products where id = new.requires_product_id;
  if v_c1 is null or v_c2 is null then
    raise exception 'Produto não encontrado';
  end if;
  if v_c1 is distinct from new.company_id or v_c2 is distinct from new.company_id then
    raise exception 'Dependência só entre produtos da mesma empresa';
  end if;
  return new;
end;
$func$;

revoke all on function public.enforce_dependency_tenant() from public, anon, authenticated;

drop trigger if exists trg_dependencies_tenant on public.product_dependencies;
create trigger trg_dependencies_tenant
  before insert or update of product_id, requires_product_id, company_id on public.product_dependencies
  for each row execute function public.enforce_dependency_tenant();

drop trigger if exists trg_immutable_company on public.product_dependencies;
create trigger trg_immutable_company
  before update on public.product_dependencies
  for each row execute function public.prevent_company_id_change();

alter table public.product_dependencies enable row level security;

drop policy if exists dependencies_select_member on public.product_dependencies;
create policy dependencies_select_member on public.product_dependencies
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists dependencies_write_mgr on public.product_dependencies;
create policy dependencies_write_mgr on public.product_dependencies
  for all to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

-- =========================
-- 2. Helper interno de checagem (sem grant público)
-- =========================
create or replace function public.check_order_dependencies(p_company_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_dep_id uuid;
  v_dep_name text;
  v_req_names text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;
  for v_dep_id in
    select distinct (x ->> 'product_id')::uuid
    from jsonb_array_elements(p_items) x
    where (x ->> 'product_id') is not null
      and exists (
        select 1 from public.product_dependencies d
        where d.company_id = p_company_id and d.active
          and d.product_id = (x ->> 'product_id')::uuid
      )
  loop
    if not exists (
      select 1 from public.product_dependencies d
      where d.company_id = p_company_id and d.active
        and d.product_id = v_dep_id
        and d.requires_product_id in (
          select (y ->> 'product_id')::uuid from jsonb_array_elements(p_items) y
          where (y ->> 'product_id') is not null
        )
    ) then
      select p.name into v_dep_name from public.products p where p.id = v_dep_id;
      select string_agg(pr.name, ' ou ' order by pr.name) into v_req_names
      from public.product_dependencies d
      join public.products pr on pr.id = d.requires_product_id
      where d.company_id = p_company_id and d.active and d.product_id = v_dep_id;
      raise exception '% exige % no pedido',
        coalesce(v_dep_name, 'Produto'), coalesce(v_req_names, 'outro item');
    end if;
  end loop;
end;
$func$;

revoke all on function public.check_order_dependencies(uuid, jsonb) from public, anon, authenticated;

-- =========================
-- 1. Helper de validação + precificação V2
-- =========================
create or replace function public.config_selection_total(p_company_id uuid, p_product_id uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_steps jsonb;
  v_step jsonb;
  v_sub jsonb;
  v_srow record;
  v_it jsonb;
  v_orow record;
  v_min int; v_max int; v_free int; v_mode text; v_req boolean;
  v_total_qty int;
  v_distinct int;
  v_comps jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_seen uuid[];
  v_opt_id uuid; v_opt_qty int;
  v_portions jsonb := '[]'::jsonb;
  v_step_comps jsonb; v_step_total numeric;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'Montagem inválida';
  end if;
  v_steps := coalesce(p_config -> 'steps', '[]'::jsonb);
  if jsonb_typeof(v_steps) <> 'array' then
    raise exception 'Montagem inválida';
  end if;

  -- Passos enviados: todos devem pertencer ao produto/empresa e estar ativos.
  for v_step in select * from jsonb_array_elements(v_steps) loop
    if (v_step ->> 'step_id') is null then
      raise exception 'Etapa não identificada';
    end if;
    begin
      v_opt_id := (v_step ->> 'step_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Etapa inválida para este produto';
    end;
    select * into v_srow from public.product_config_steps
    where id = v_opt_id and product_id = p_product_id and company_id = p_company_id;
    if not found then
      raise exception 'Etapa inválida para este produto';
    end if;
    if coalesce(v_srow.active, true) = false then
      raise exception 'Etapa "%" indisponível', v_srow.title;
    end if;
  end loop;

  -- Passos configurados: required/min/max/single + precificação.
  for v_srow in select * from public.product_config_steps
    where product_id = p_product_id and company_id = p_company_id and active
    order by position loop
    select x into v_step from jsonb_array_elements(v_steps) x
    where (x ->> 'step_id') = v_srow.id::text limit 1;
    v_sub := case when v_step is null then '[]'::jsonb
                  else coalesce(v_step -> 'items', '[]'::jsonb) end;
    if jsonb_typeof(v_sub) <> 'array' then
      raise exception 'Montagem inválida';
    end if;
    v_mode := coalesce(v_srow.select_mode::text, 'multi');
    v_min := coalesce(v_srow.min_select, 0);
    v_max := coalesce(v_srow.max_select, 1);
    v_free := greatest(coalesce(v_srow.free_qty, 0), 0);
    v_req := coalesce(v_srow.required, false);
    if v_min < 0 or v_max < 1 then
      raise exception 'Etapa "%" com máximo inválido', v_srow.title;
    end if;
    select count(distinct (y ->> 'option_id')) into v_distinct
    from jsonb_array_elements(v_sub) y;
    if v_mode = 'single' and coalesce(v_distinct, 0) > 1 then
      raise exception 'Etapa "%" permite apenas 1 escolha', v_srow.title;
    end if;
    v_seen := '{}';
    v_total_qty := 0;
    v_portions := '[]'::jsonb;
    for v_it in select * from jsonb_array_elements(v_sub) loop
      if (v_it ->> 'option_id') is null then
        raise exception 'Opção não identificada';
      end if;
      begin
        v_opt_id := (v_it ->> 'option_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Opção inválida para esta etapa';
      end;
      v_opt_qty := coalesce((v_it ->> 'quantity')::int, 1);
      if v_opt_qty is null or v_opt_qty < 1 then
        raise exception 'Quantidade inválida para adicional';
      end if;
      select o.*, coalesce(i.active, true) as ing_active,
             coalesce(pr.active, true) as prod_active,
             coalesce(pr.out_of_stock, false) as prod_oos
      into v_orow from public.product_config_options o
      left join public.ingredients i on i.id = o.ingredient_id
      left join public.products pr on pr.id = o.product_id
      where o.id = v_opt_id and o.step_id = v_srow.id;
      if not found then
        raise exception 'Opção inválida para esta etapa';
      end if;
      if coalesce(v_orow.active, true) = false or v_orow.ing_active = false
         or v_orow.prod_active = false or v_orow.prod_oos = true then
        raise exception 'Opção "%" indisponível', v_orow.name;
      end if;
      if v_opt_id = any(v_seen) and coalesce(v_srow.allow_repeat, false) = false then
        raise exception 'Opção repetida na mesma etapa';
      end if;
      v_seen := v_seen || v_opt_id;
      if coalesce(v_srow.allow_repeat, false) = false and v_opt_qty <> 1 then
        raise exception 'Quantidade inválida para adicional';
      end if;
      v_total_qty := v_total_qty + v_opt_qty;
      v_portions := v_portions || jsonb_build_object(
        'grp', v_srow.title, 'oid', v_opt_id, 'sid', v_srow.id, 'name', v_orow.name,
        'price', coalesce(v_orow.price, 0), 'so', coalesce(v_orow.sort_order, 0),
        'qty', v_opt_qty);
    end loop;
    if v_req and v_total_qty < greatest(v_min, 1) then
      raise exception 'Etapa "%" é obrigatória', v_srow.title;
    end if;
    if (not v_req) and v_total_qty < v_min then
      raise exception 'Etapa "%" exige no mínimo % escolha(s)', v_srow.title, v_min;
    end if;
    if v_total_qty > v_max then
      raise exception 'Etapa "%" permite no máximo % escolha(s)', v_srow.title, v_max;
    end if;
    -- Precificação: porções (unidades) ordenadas por (preço, ordem, id);
    -- as N mais baratas saem grátis (linhas price 0 separadas). Snapshot em
    -- formato legado + step_id/option_id (rebuild no PDV; leitores legados
    -- ignoram as chaves extras).
    select coalesce(jsonb_agg(jsonb_build_object(
             'group_name', grp, 'option_name', name,
             'price', line_price, 'quantity', line_qty,
             'step_id', sid, 'option_id', oid)
             order by grp, name), '[]'::jsonb),
           coalesce(sum(line_price * line_qty), 0)
    into v_step_comps, v_step_total
    from (
      select grp, oid, sid, name, price,
             case when rn <= least(v_free, v_max) then 0 else price end as line_price,
             count(*) as line_qty
      from (
        select x.grp, x.oid, x.sid, x.name, x.price,
               row_number() over (order by x.price, x.so, x.oid) as rn
        from jsonb_to_recordset(v_portions) as x(grp text, oid uuid, sid uuid, name text, price numeric, so int, qty int)
        cross join lateral generate_series(1, greatest(x.qty, 0)) g
      ) units
      group by grp, oid, sid, name, price, (case when rn <= least(v_free, v_max) then 0 else price end)
    ) lines;
    v_comps := v_comps || v_step_comps;
    v_total := v_total + v_step_total;
  end loop;

  return jsonb_build_object('comps', v_comps, 'total', v_total);
end;
$$;

revoke all on function public.config_selection_total(uuid, uuid, jsonb) from public, anon, authenticated;

-- =========================
-- 2. create_order com ramo V2 (mesma assinatura 12 args)
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

    -- Montagem V2: config {steps:[...]} + produto COM passos ativos.
    select exists(
      select 1 from public.product_config_steps
      where product_id = v_prod.id and company_id = v_company_id and active
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
        -- Sem config enviada: obrigatoriedade continua valendo.
        select title, min_select, required into v_req_title, v_req_min, v_req_flag
        from public.product_config_steps
        where product_id = v_prod.id and company_id = v_company_id and active
          and (required or coalesce(min_select, 0) > 0)
        order by position limit 1;
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

revoke all on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text) from public;
grant execute on function create_order(text, text, text, jsonb, jsonb, uuid, text, text, text, numeric, uuid, text) to anon, authenticated;

-- =========================
-- 3. Storefront: config V2 por produto (só passos/opções ATIVOS)
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
    'icon', icon, 'image_url', image_url
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
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', o.id, 'step_id', o.step_id, 'ingredient_id', o.ingredient_id,
            'product_id', o.product_id, 'name', o.name, 'description', o.description,
            'price', o.price
          ) order by o.sort_order, o.name), '[]'::jsonb)
          from public.product_config_options o
          where o.step_id = s.id and o.active = true
        )
      ) order by s.position), '[]'::jsonb)
      from public.product_config_steps s
      where s.product_id = p.id and s.company_id = v_company.id and s.active = true
    )
    ) order by p.sort_order, p.name), '[]'::jsonb)
  into v_prods from public.products p
  where p.company_id = v_company.id
    and p.active = true
    and coalesce(p.out_of_stock, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'fee', fee, 'estimated_time', estimated_time
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

-- =========================
-- 4. manage_order/edit com ramo V2 (estrito; legado tolerante intacto)
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
      -- Ramo V2 (estrito): config + produto com passos ativos.
      select exists(
        select 1 from public.product_config_steps
        where product_id = v_prod.id and company_id = v_order.company_id and active
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
$$;
