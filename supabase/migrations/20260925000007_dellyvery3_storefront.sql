-- DELLVERY 3 — Storefront pública (FASE 5.4-C C6, local only)
-- RPC SECURITY DEFINER: única leitura pública do catálogo.
-- NÃO abre SELECT anon em nenhuma tabela (decisão validada).
-- Retorna SOMENTE display fields + ativos/disponíveis. Nunca: memberships,
-- subscription, audit, customers, orders, history, whatsapp, settings
-- internas, segredos ou dados de outros tenants.
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
    'id', id, 'category_id', category_id, 'name', name,
    'description', description, 'price', price,
    'promotional_price', promotional_price, 'image_url', image_url,
    'complements', coalesce(options, '[]'::jsonb),
    'is_featured', coalesce(is_featured, false),
    'is_bestseller', coalesce(is_bestseller, false),
    'is_made_to_order', coalesce(is_made_to_order, false),
    'preparation_time', preparation_time,
    'ingredients', ingredients, 'nutritional_info', nutritional_info,
    'sort_order', sort_order
    ) order by sort_order, name), '[]'::jsonb)
  into v_prods from public.products
  where company_id = v_company.id
    and active = true
    and coalesce(out_of_stock, false) = false;

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
