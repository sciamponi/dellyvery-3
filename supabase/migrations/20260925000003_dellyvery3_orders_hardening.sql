-- DELLVERY 3 — Orders hardening (FASE 5.4 ETAPA B1, local only)
-- Migration incremental: apenas ADD COLUMN + CHECK + índice + trigger.
-- Não edita migrations anteriores. Auditoria ETAPA A validada antes.
-- Verificado antes: sem table_number/cancel_reason; sources existentes só
-- 'online'; índices já cobrem company/status/created/order_number/
-- tracking_token/customer/driver/items/history/notifications.
--
-- Decisão documentada (B1.3): Notification.title e customer_* NÃO viram
-- colunas — são derivados na RPC a partir de orders/customer_data
-- (snapshot display no momento da criação), sem duplicar dados.

-- =========================
-- 1. orders: campos do fluxo Base44 auditado
-- =========================
alter table orders add column if not exists table_number text;
alter table orders add column if not exists cancel_reason text;

-- source: comportamento atual online/whatsapp/balcao (dados existentes: só online)
do $$ begin
  alter table orders add constraint orders_source_check
    check (source in ('online', 'whatsapp', 'balcao'));
exception when duplicate_object then null; end $$;

-- índice ausente: delivery_zone_id
create index if not exists idx_orders_delivery_zone on orders(delivery_zone_id);

-- =========================
-- 2. order_items.product_id: produto deve ser da MESMA empresa do pedido
-- (RLS de insert só checa membership da company do pedido, não do produto)
-- =========================
create or replace function enforce_order_item_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_company uuid;
  v_prod_company uuid;
begin
  if new.product_id is null then
    return new;
  end if;
  select company_id into v_order_company from public.orders where id = new.order_id;
  if v_order_company is null then
    raise exception 'order not found';
  end if;
  select company_id into v_prod_company from public.products where id = new.product_id;
  if v_prod_company is null then
    raise exception 'product not found';
  end if;
  if v_prod_company is distinct from v_order_company then
    raise exception 'product belongs to another company';
  end if;
  return new;
end;
$$;

revoke all on function enforce_order_item_company() from public, anon, authenticated;

drop trigger if exists trg_order_items_product_company on order_items;
create trigger trg_order_items_product_company
  before insert or update of product_id, order_id on order_items
  for each row execute function enforce_order_item_company();

-- =========================
-- 3. Revalidação: triggers orders_company_refs já existem (5.3); sem duplicatas.
-- Integridade order_status_history: FK order_id + RLS via orders.company_id
-- (insert exige membership da empresa do pedido); sem trigger adicional.
-- =========================
