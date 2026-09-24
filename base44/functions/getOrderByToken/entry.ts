import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * PUBLIC endpoint — customer tracks their order by tracking_token.
 * Does NOT require authentication. Uses asServiceRole to find the order.
 *
 * Returns ONLY safe fields — no company_id, no customer_id, no sensitive data.
 * The tracking_token is a UUID — not guessable, so this is secure.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { tracking_token } = body;

    if (!tracking_token) {
      return Response.json({ error: 'Token não fornecido' }, { status: 400 });
    }

    const orders = await base44.asServiceRole.entities.Order.filter({ tracking_token });
    if (orders.length === 0) {
      return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
    }
    const order = orders[0];

    // Return only safe fields for customer tracking
    return Response.json({
      order: {
        order_number: order.order_number,
        order_type: order.order_type,
        table_number: order.table_number,
        customer_name: order.customer_name,
        items: order.items,
        subtotal: order.subtotal,
        delivery_fee: order.delivery_fee,
        discount: order.discount,
        total: order.total,
        status: order.status,
        status_history: order.status_history,
        payment_method: order.payment_method,
        notes: order.notes,
        created_date: order.created_date,
        source: order.source
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}