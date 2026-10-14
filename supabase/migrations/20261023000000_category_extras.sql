-- DELLVERY 3 — Categoria Extras + foto do ingrediente (local only)
--
-- 1. Sexta categoria padrão ("Extras ➕", slug 'extras', ordem 5): a função
--    de seed é recriada com a nova linha; trigger de novas empresas passa
--    a incluí-la; backfill idempotente (ON CONFLICT DO NOTHING) preenche
--    só onde falta, sem tocar em personalizadas nem duplicar.
-- 2. ingredients.image_url (nullable): foto opcional do extra. Preço
--    continua por associação (product_config_options.price), sem corromper
--    nada; demais colunas e RLS intactos.
-- Sem DROP, sem reescrita. Para produção requer autorização.

-- =========================
-- 1. Seed com Extras
-- =========================
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
    (p_company_id, 'Combos', '📦', 'Combos e promoções', 4, true, 'combos'),
    (p_company_id, 'Extras', '➕', 'Ingredientes e adicionais reutilizáveis', 5, true, 'extras')
  on conflict (company_id, slug) do nothing;
end;
$func$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Backfill: só insere o que falta (conflito ignora o existente).
select public.seed_default_categories(id) from public.companies;

-- =========================
-- 2. Foto opcional do ingrediente
-- =========================
alter table public.ingredients
  add column if not exists image_url text;
