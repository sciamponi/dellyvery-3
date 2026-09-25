-- DELLVERY 3 — Catalog fields (FASE 5.2 ETAPA B, local only)
-- Migration incremental: apenas ADD COLUMN + proteção categoria-empresa.
-- Não edita migrations anteriores. Não apaga/renomeia nada existente.
-- Auditoria de campos (ETAPA A) aprovada antes desta migration.
--
-- Verificação estrutural prévia: o FK products.category_id referencia apenas
-- categories(id) ON DELETE SET NULL — NÃO garante mesma company. Por isso o
-- trigger enforce_product_category_company() abaixo (defesa no banco; o
-- adapter também valida, sem confiar só no frontend).

-- =========================
-- 1. categories.icon (emoji exibido em filtros/cards)
-- =========================
alter table categories add column if not exists icon text;

-- =========================
-- 2. products: campos funcionais do frontend Base44
-- =========================
alter table products add column if not exists promotional_price numeric(10,2);
alter table products add column if not exists sku text;
alter table products add column if not exists internal_code text;
alter table products add column if not exists is_featured boolean not null default false;
alter table products add column if not exists is_bestseller boolean not null default false;
alter table products add column if not exists is_made_to_order boolean not null default false;
alter table products add column if not exists out_of_stock boolean not null default false;
alter table products add column if not exists stock integer not null default -1;
alter table products add column if not exists preparation_time integer not null default 15;
alter table products add column if not exists ingredients text;
alter table products add column if not exists nutritional_info text;

-- Mapeamentos SEM coluna (adapter, semântica idêntica):
--   Category.order        <-> categories.sort_order
--   Product.available     <-> products.active
--   Product.complements   <-> products.options (jsonb array de grupos)
--   created_date (-data)  <-> created_at desc
-- image_url permanece URL (upload segue no Base44 nesta fase; sem Storage).

-- =========================
-- 3. Proteção no banco: produto só referencia categoria da MESMA empresa
-- SECURITY DEFINER para checagem por igualdade de company_id, independente
-- dos direitos SELECT do chamador. RLS de linha continua valendo.
-- =========================
create or replace function enforce_product_category_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat_company uuid;
begin
  if new.category_id is null then
    return new;
  end if;
  select company_id into v_cat_company
  from public.categories
  where id = new.category_id;
  if v_cat_company is null then
    raise exception 'category not found';
  end if;
  if v_cat_company is distinct from new.company_id then
    raise exception 'category belongs to another company';
  end if;
  return new;
end;
$$;

revoke all on function enforce_product_category_company() from public, anon, authenticated;

drop trigger if exists trg_products_category_company on products;
create trigger trg_products_category_company
  before insert or update of category_id, company_id on products
  for each row execute function enforce_product_category_company();
