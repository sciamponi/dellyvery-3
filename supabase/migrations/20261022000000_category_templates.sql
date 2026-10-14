-- DELLVERY 3 — Categorias padrão + grupos por categoria + modo de dependência (local only)
--
-- 1. Categorias padrão por restaurante (isoladas por empresa, sem tabela
--    global): slug estável + unique (company_id, slug); seed idempotente
--    (ON CONFLICT DO NOTHING) via trigger em novas empresas + backfill das
--    existentes. Padrões: Lanches 🍔, Acompanhamentos 🍟, Sobremesas 🍦,
--    Bebidas 🍷, Combos 📦. Personalizadas (slug NULL) e produtos intactos.
-- 2. Grupos de montagem por categoria: product_config_steps ganha
--    category_id (exatamente um entre product_id/category_id); herança
--    opt-in por produto (products.use_category_steps, default true).
--    Efetivo do produto = passos da categoria + passos próprios.
-- 3. Modo de dependência por produto: products.dependency_mode
--    ('any' = basta um exigido [padrão, Gate 3]; 'all' = todos exigidos,
--    para combos com componentes obrigatórios).
-- 4. Funções recriadas: config_selection_total (união categoria+produto),
--    get_storefront_by_slug (config herdada com 'inherited' + campo
--    dependency_mode), check_order_dependencies (modo all), create_order
--    (v_has_cfg e obrigatoriedade sem config incluem passos herdados),
--    manage_order (v_has_cfg do ramo V2 inclui passos herdados).
--    Assinaturas e grants intactos.
-- Sem DROP TABLE, sem reescrita de histórico. Para produção requer
-- autorização (fora desta etapa).

-- =========================
-- 1. Categorias padrão
-- =========================
alter table public.categories
  add column if not exists slug text;

alter table public.categories
  drop constraint if exists uq_category_company_slug;
alter table public.categories
  add constraint uq_category_company_slug unique (company_id, slug);

create index if not exists idx_categories_company_slug
  on public.categories (company_id, slug);

create or replace function public.seed_default_categories(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if p_company_id is null then
    return;
  end if;
  insert into public.categories
    (company_id, name, icon, description, sort_order, active, slug)
  values
    (p_company_id, 'Lanches', '🍔', 'Hambúrgueres e sanduíches', 0, true, 'lanches'),
    (p_company_id, 'Acompanhamentos', '🍟', 'Porções e acompanhamentos', 1, true, 'acompanhamentos'),
    (p_company_id, 'Sobremesas', '🍦', 'Doces e sobremesas', 2, true, 'sobremesas'),
    (p_company_id, 'Bebidas', '🍷', 'Bebidas e refrigerantes', 3, true, 'bebidas'),
    (p_company_id, 'Combos', '📦', 'Combos e promoções', 4, true, 'combos')
  on conflict (company_id, slug) do nothing;
end;
$func$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

create or replace function public.trg_seed_categories_for_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$func$;

revoke all on function public.trg_seed_categories_for_new_company() from public, anon, authenticated;

drop trigger if exists trg_companies_seed_categories on public.companies;
create trigger trg_companies_seed_categories
  after insert on public.companies
  for each row execute function public.trg_seed_categories_for_new_company();

-- Backfill idempotente das empresas existentes (não toca em personalizadas).
select public.seed_default_categories(id) from public.companies;

-- =========================
-- 2. Grupos por categoria + flags do produto
-- =========================
alter table public.product_config_steps
  add column if not exists category_id uuid references public.categories(id) on delete cascade;

alter table public.product_config_steps
  alter column product_id drop not null;

alter table public.product_config_steps
  drop constraint if exists chk_step_scope;
alter table public.product_config_steps
  add constraint chk_step_scope check ((product_id is null) <> (category_id is null));

alter table public.product_config_steps
  drop constraint if exists uq_step_category_position;
alter table public.product_config_steps
  add constraint uq_step_category_position unique (category_id, position);

create index if not exists idx_steps_company_category
  on public.product_config_steps (company_id, category_id);

alter table public.products
  add column if not exists use_category_steps boolean not null default true;

alter table public.products
  add column if not exists dependency_mode text not null default 'any';

alter table public.products
  drop constraint if exists chk_dependency_mode;
alter table public.products
  add constraint chk_dependency_mode check (dependency_mode in ('any', 'all'));

-- Tenant do passo: produto OU categoria, sempre da mesma empresa.
create or replace function public.enforce_config_step_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_company uuid;
begin
  if TG_OP = 'INSERT'
     or new.product_id is distinct from old.product_id
     or new.category_id is distinct from old.category_id
     or new.company_id is distinct from old.company_id then
    if new.product_id is not null and new.category_id is not null then
      raise exception 'Etapa de produto ou categoria (somente um)';
    end if;
    if new.product_id is null and new.category_id is null then
      raise exception 'Etapa sem produto ou categoria';
    end if;
    if new.product_id is not null then
      select company_id into v_company from public.products where id = new.product_id;
      if v_company is null then
        raise exception 'product not found';
      end if;
      if v_company is distinct from new.company_id then
        raise exception 'product belongs to another company';
      end if;
    else
      select company_id into v_company from public.categories where id = new.category_id;
      if v_company is null then
        raise exception 'Categoria não encontrada';
      end if;
      if v_company is distinct from new.company_id then
        raise exception 'Categoria de outra empresa';
      end if;
    end if;
  end if;
  return new;
end;
$func$;

revoke all on function public.enforce_config_step_tenant() from public, anon, authenticated;

drop trigger if exists trg_config_steps_tenant on public.product_config_steps;
create trigger trg_config_steps_tenant
  before insert or update of product_id, category_id, company_id on public.product_config_steps
  for each row execute function public.enforce_config_step_tenant();

-- =========================
-- 3. Helper de validação + precificação V2 (com herança da categoria)
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
  -- Herança da categoria (opt-in por produto, default ligado).
  v_cat uuid;
  v_use_cat boolean := false;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'Montagem inválida';
  end if;
  v_steps := coalesce(p_config -> 'steps', '[]'::jsonb);
  if jsonb_typeof(v_steps) <> 'array' then
    raise exception 'Montagem inválida';
  end if;

  select category_id, coalesce(use_category_steps, true)
  into v_cat, v_use_cat
  from public.products
  where id = p_product_id and company_id = p_company_id;
  v_use_cat := coalesce(v_use_cat, false);

  -- Passos enviados: todos devem pertencer ao produto/categoria/empresa e estar ativos.
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
    where id = v_opt_id and company_id = p_company_id
      and (product_id = p_product_id
           or (v_use_cat and v_cat is not null and category_id = v_cat));
    if not found then
      raise exception 'Etapa inválida para este produto';
    end if;
    if coalesce(v_srow.active, true) = false then
      raise exception 'Etapa "%" indisponível', v_srow.title;
    end if;
  end loop;

  -- Passos configurados: categoria (herdados) + próprios; required/min/max/single + precificação.
  for v_srow in
    select * from (
      select s.*, 0 as src from public.product_config_steps s
      where s.company_id = p_company_id and s.active
        and v_use_cat and v_cat is not null
        and s.category_id = v_cat and s.product_id is null
      union all
      select s.*, 1 as src from public.product_config_steps s
      where s.company_id = p_company_id and s.active
        and s.product_id = p_product_id
    ) u
    order by src, position loop
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
-- 4. Dependências com modo any/all (OR padrão; ALL para combos)
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
  v_mode text;
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
    select coalesce(p.dependency_mode, 'any') into v_mode
    from public.products p where p.id = v_dep_id;
    v_mode := coalesce(v_mode, 'any');
    if v_mode = 'all' then
      -- Todos os exigidos precisam estar presentes.
      if exists (
        select 1 from public.product_dependencies d
        where d.company_id = p_company_id and d.active
          and d.product_id = v_dep_id
          and d.requires_product_id not in (
            select (y ->> 'product_id')::uuid from jsonb_array_elements(p_items) y
            where (y ->> 'product_id') is not null
          )
      ) then
        select p.name into v_dep_name from public.products p where p.id = v_dep_id;
        select string_agg(pr.name, ', ' order by pr.name) into v_req_names
        from public.product_dependencies d
        join public.products pr on pr.id = d.requires_product_id
        where d.company_id = p_company_id and d.active and d.product_id = v_dep_id
          and d.requires_product_id not in (
            select (y ->> 'product_id')::uuid from jsonb_array_elements(p_items) y
            where (y ->> 'product_id') is not null
          );
        raise exception '% exige % no pedido',
          coalesce(v_dep_name, 'Produto'), coalesce(v_req_names, 'outros itens');
      end if;
    else
      -- Basta ao menos um dos exigidos (OR).
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
    end if;
  end loop;
end;
$func$;

revoke all on function public.check_order_dependencies(uuid, jsonb) from public, anon, authenticated;

-- =========================
-- 5. Storefront: config herdada + modo de dependência
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
-- 6. create_order com herança da categoria (mesma assinatura 12 args)
-- =========================
-- Réplica fiel da migration anterior, exceto: v_has_cfg e a checagem de
-- obrigatoriedade sem config consideram também os passos herdados da
-- categoria (quando use_category_steps). Segunda passada, totais,
-- dependências e snapshots intactos.
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
-- 7. manage_order/edit com herança da categoria
-- =========================
-- Réplica fiel da migration anterior, exceto: v_has_cfg do ramo V2
-- considera também os passos herdados (mesmo critério do create_order).
-- Status/cancel, legado tolerante, dependências e totais intactos.
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
      -- Ramo V2 (estrito): config + produto com passos ativos
      -- (próprios ou herdados da categoria).
      select exists(
        select 1 from public.product_config_steps
        where company_id = v_order.company_id and active
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
