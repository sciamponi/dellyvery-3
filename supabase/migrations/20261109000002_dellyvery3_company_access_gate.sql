-- DELLVERY 3 - Suspensao operacional de empresa gerenciada por revenda.
--
-- Empresas sem vinculo com revenda mantem o comportamento atual. Empresas
-- vinculadas dependem de assinatura vigente. O gate entra em is_company_member
-- (usado pela maioria das policies operacionais), mas a leitura basica de
-- companies/subscriptions usa o helper raw para a tela de acesso vencido.

create or replace function public.company_has_active_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_company_id is null then false
    when public.is_platform_admin() then true
    when not exists (
      select 1
      from public.reseller_clients rc
      where rc.company_id = p_company_id
    ) then true
    else exists (
      select 1
      from public.reseller_clients rc
      join public.subscriptions s on s.company_id = rc.company_id
      where rc.company_id = p_company_id
        and s.expires_at is not null
        and s.expires_at > now()
        and s.status not in ('cancelado', 'suspenso', 'expirado')
    )
  end;
$$;

create or replace function public.is_company_member_raw(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members
    where company_id = p_company_id
      and user_id = auth.uid()
      and active = true
  );
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_member_raw(p_company_id)
    and (
      public.is_platform_admin()
      or public.company_has_active_access(p_company_id)
    );
$$;

revoke all on function public.company_has_active_access(uuid) from public, anon;
revoke all on function public.is_company_member_raw(uuid) from public, anon;
revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.company_has_active_access(uuid) to authenticated;
grant execute on function public.is_company_member_raw(uuid) to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;

-- Leitura basica continua disponivel para clientes vencidos (estado da conta),
-- mas todas as policies de escrita/operacao seguem usando is_company_member.
drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies
  for select to authenticated
  using (public.is_company_member_raw(id) or public.is_platform_admin());

drop policy if exists subscriptions_select_member on public.subscriptions;
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (public.is_company_member_raw(company_id) or public.is_platform_admin());

-- =========================
-- Onboarding direto bloqueado para cliente de revenda
-- =========================
create or replace function public.create_company_with_owner(
  p_name text,
  p_slug text,
  p_segment_id uuid,
  p_description text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_slug text;
  v_plan_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where user_id = auth.uid()
  ) then
    raise exception 'Sua empresa e gerenciada por um revendedor. Aguarde a ativacao do acesso';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug is required';
  end if;

  v_slug := lower(regexp_replace(btrim(p_slug), '[^a-z0-9]+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '(^-|-$)', '', 'g');
  if v_slug = '' then
    raise exception 'invalid slug';
  end if;

  if exists (select 1 from public.companies where slug = v_slug) then
    raise exception 'slug already exists';
  end if;

  insert into public.companies (name, slug, segment_id, description, phone, email, address)
  values (btrim(p_name), v_slug, p_segment_id, p_description, p_phone, p_email, p_address)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role, active)
  values (v_company_id, auth.uid(), 'OWNER', true);

  select id into v_plan_id from public.plans where slug = 'solo' limit 1;
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status, started_at, expires_at)
    values (v_company_id, v_plan_id, 'trial', now(), now() + interval '7 days')
    on conflict (company_id) do nothing;
  end if;

  insert into public.company_order_seq (company_id, last_number) values (v_company_id, 0)
  on conflict (company_id) do nothing;

  insert into public.company_settings (company_id, settings) values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  insert into public.store_themes (company_id) values (v_company_id)
  on conflict (company_id) do nothing;

  return v_company_id;
end;
$$;

revoke all on function public.create_company_with_owner(text,text,uuid,text,text,text,text) from public;
grant execute on function public.create_company_with_owner(text,text,uuid,text,text,text,text) to authenticated;

-- =========================
-- Troca/cancelamento direto de plano bloqueado para cliente de revenda
-- =========================
create or replace function public.manage_subscription(p_action text, p_plan_id uuid default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_member_count int;
  v_sub public.subscriptions%rowtype;
  v_plan_active boolean;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if p_action is null or p_action not in ('upgrade', 'cancel', 'reactivate') then
    raise exception 'Ação inválida';
  end if;

  select company_id into v_company_id
  from public.company_members
  where user_id = v_actor and active = true and role in ('OWNER', 'ADMIN')
  limit 1;

  if v_company_id is null then
    perform 1 from public.company_members
    where user_id = v_actor and active = true limit 1;
    if found then
      raise exception 'Apenas OWNER ou ADMIN pode alterar a assinatura';
    else
      raise exception 'Empresa não encontrada ou sem permissão';
    end if;
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where company_id = v_company_id
  ) then
    raise exception 'Esta assinatura e gerenciada pelo revendedor. Fale com o revendedor para renovar';
  end if;

  select count(*) into v_member_count
  from public.company_members
  where user_id = v_actor and active = true and role in ('OWNER', 'ADMIN');
  if v_member_count > 1 then
    raise exception 'Múltiplas empresas: selecione a empresa antes de alterar a assinatura';
  end if;

  select * into v_sub
  from public.subscriptions
  where company_id = v_company_id;

  if not found then
    raise exception 'Assinatura não encontrada';
  end if;

  if p_action = 'upgrade' then
    if p_plan_id is null then
      raise exception 'Plano não informado';
    end if;
    select active into v_plan_active
    from public.plans
    where id = p_plan_id;
    if not found then
      raise exception 'Plano não encontrado';
    end if;
    if not v_plan_active then
      raise exception 'Plano indisponível';
    end if;
    update public.subscriptions
    set plan_id = p_plan_id,
        status = case when status = 'trial' then 'ativo'::public.subscription_status else status end
    where company_id = v_company_id
    returning * into v_sub;
  elsif p_action = 'cancel' then
    if v_sub.status = 'cancelado' then
      raise exception 'Assinatura já cancelada';
    end if;
    if v_sub.status not in ('trial', 'ativo', 'pendente') then
      raise exception 'Assinatura não pode ser cancelada neste estado';
    end if;
    update public.subscriptions
    set status = 'cancelado'
    where company_id = v_company_id
    returning * into v_sub;
  else
    if v_sub.status <> 'cancelado' then
      raise exception 'Somente assinatura cancelada pode ser reativada';
    end if;
    if v_sub.expires_at is not null and v_sub.expires_at <= now() then
      raise exception 'Assinatura expirada não pode ser reativada';
    end if;
    update public.subscriptions
    set status = 'ativo'
    where company_id = v_company_id
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

revoke all on function public.manage_subscription(text, uuid) from public;
revoke all on function public.manage_subscription(text, uuid) from anon;
grant execute on function public.manage_subscription(text, uuid) to authenticated;

-- =========================
-- Pedidos: bloqueio tambem nos caminhos SECURITY DEFINER
-- =========================
create or replace function public.enforce_active_company_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.company_has_active_access(new.company_id) then
    raise exception 'Estabelecimento indisponivel no momento';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_active_company on public.orders;
create trigger trg_orders_active_company
before insert or update on public.orders
for each row execute function public.enforce_active_company_on_order();

-- =========================
-- Cardapio publico: empresa vencida nao expoe a loja
-- =========================
create or replace function public.get_storefront_by_slug(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.company_has_active_access(v_company.id) then
    raise exception 'Loja temporariamente indisponível';
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
$function$;

notify pgrst, 'reload schema';
