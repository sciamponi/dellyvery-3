-- Preço padrão da biblioteca de ingredientes.
-- Continua sendo apenas um valor inicial: cada associação em
-- product_config_options pode manter o próprio adicional sem alterar
-- pedidos, produtos ou preços já registrados.

alter table public.ingredients
  add column if not exists price numeric(10,2) not null default 0
  check (price >= 0);

comment on column public.ingredients.price is
  'Preço padrão do ingrediente (R$). Usado como sugestão ao associar em um produto; o adicional efetivo continua em product_config_options.price.';
