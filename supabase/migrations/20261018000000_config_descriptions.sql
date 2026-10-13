-- DELLVERY 3 — Descrição opcional em ingredientes e opções (Gate 1, local only)
--
-- Aditiva e segura: só ADD COLUMN nullable. Nenhum dado existente é
-- alterado. Exigida pela gestão de complementos (nome/descrição/preço
-- por associação). Para produção, requer autorização (fora deste gate).
alter table public.ingredients
  add column if not exists description text;
alter table public.product_config_options
  add column if not exists description text;
