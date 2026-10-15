-- DELLVERY 3 — Seção do ingrediente (NÃO APLICAR sem autorização).
--
-- A biblioteca `ingredients` não tem nenhum campo de classificação
-- (só name/description/image_url/active/sort_order): as seções do diálogo
-- (Lanches, Acompanhamentos, Bebidas, Sobremesas) e a correção manual da
-- seção exigem persistência por empresa, compartilhada entre dispositivos.
-- Alternativas descartadas: adivinhar pela string do nome (proibido pelo
-- requisito), reaproveitar `description` (corrompe o dado) e guardar só no
-- navegador (não compartilha entre usuários/aparelhos).
-- Aditiva e segura: coluna anulável com default '', sem tocar em dados,
-- preços (por associação em product_config_options.price) ou RLS existentes.
-- O app trata '' como "Outros" e valida os 4 valores no frontend.

alter table public.ingredients
  add column if not exists category text not null default '';

comment on column public.ingredients.category is
  'Seção da biblioteca (lanches|acompanhamentos|bebidas|sobremesas|«»=Outros). Classificação manual, editável; nunca inferida pelo nome.';
