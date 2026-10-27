-- DELLVERY 3 — Indicador de combo em produtos (aditivo, local only)
--
-- Adiciona coluna is_combo a products para identificar produtos
-- configurados como combo (4 grupos isolados: Acompanhamento, Bebida,
-- Sobremesa, Extra). Default false preserva produtos antigos.
-- Não toca em product_dependencies, dependency_mode, order_items nem
-- em nenhuma coluna existente. Requer migration futura para aplicar no
-- Supabase remoto/produção; este arquivo sozinho nao altera dados.

alter table public.products
  add column if not exists is_combo boolean not null default false;

create index if not exists idx_products_company_is_combo
  on public.products (company_id, is_combo);

comment on column public.products.is_combo is
  'Indica que o produto eh um combo configuravel (4 grupos isolados de opcoes). Default false = comportamento legado preservado.';
