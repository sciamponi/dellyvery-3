-- DELLVERY 3 — Tracking público: mídia dos itens (local only)
-- Recria get_order_by_token adicionando product_id + image_url aos itens.
-- Contrato dos demais campos INALTERADO. Sem nova coluna, sem policy nova,
-- sem SELECT público direto: a URL vem de subquery interna (SECURITY DEFINER)
-- restrita ao produto da MESMA empresa do pedido. NULL quando product_id for
-- NULL, produto inexistente/outra empresa ou image_url NULL (frontend usa fallback).
create or replace function get_order_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_items jsonb;
  v_history jsonb;
begin
  if p_token is null then
    raise exception 'Token não fornecido';
  end if;
  select * into v_order from public.orders where tracking_token = p_token;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  -- Formato Base44 esperado pelo OrderTracking: {name,quantity,price,notes,complements[]}
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', oi.product_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price,
    'price', oi.total, 'notes', oi.notes, 'complements', coalesce(oi.options, '[]'::jsonb),
    'product_id', oi.product_id,
    'image_url', (
      select p.image_url from public.products p
      where p.id = oi.product_id
        and p.company_id = v_order.company_id
    )
    ) order by oi.created_at), '[]'::jsonb)
  into v_items from public.order_items oi where oi.order_id = v_order.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'status', new_status, 'timestamp', created_at
    ) order by created_at), '[]'::jsonb)
  into v_history from public.order_status_history where order_id = v_order.id;
  return jsonb_build_object(
    'order_number', v_order.order_number,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'customer_name', coalesce(v_order.customer_data ->> 'name', ''),
    'items', v_items,
    'subtotal', v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'discount', v_order.discount,
    'total', v_order.total,
    'status', v_order.status,
    'status_history', v_history,
    'payment_method', v_order.payment_method,
    'notes', v_order.notes,
    'created_at', v_order.created_at,
    'source', v_order.source
  );
end;
$$;

revoke all on function get_order_by_token(uuid) from public;
grant execute on function get_order_by_token(uuid) to anon, authenticated;
