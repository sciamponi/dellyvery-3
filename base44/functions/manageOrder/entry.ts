import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * AUTHENTICATED endpoint — restaurant staff manages orders.
 * Actions: "status" (update status), "cancel" (cancel with reason), "edit" (edit items/address/discount).
 *
 * All actions validate that the order belongs to the user's company.
 * All actions log to AuditLog and append to status_history.
 * The "edit" action recalculates subtotal/total server-side — never trusts frontend prices.
 */
async function logAudit(base44: any, user: any, action: string, entityType: string, entityId: string, details: string, companyId: string) {
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      company_id: companyId,
      user_id: user.id,
      user_name: user.full_name || user.email,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (e) { /* ignore audit errors */ }
}

const STATUS_LABELS_PT: Record<string, string> = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  em_preparo: 'Em preparo',
  aguardando_retirada: 'Pronto',
  saiu_entrega: 'Saiu para entrega',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

function customerStatusMessage(orderNumber: any, status: string): string {
  const tag = `pedido #${orderNumber ?? '—'}`;
  switch (status) {
    case 'confirmado':
      return `Seu ${tag} foi confirmado pelo restaurante.`;
    case 'em_preparo':
      return `Seu ${tag} está sendo preparado.`;
    case 'aguardando_retirada':
      return `Seu ${tag} está pronto para retirada.`;
    case 'saiu_entrega':
      return `Seu ${tag} saiu para entrega.`;
    case 'finalizado':
      return `Seu ${tag} foi finalizado. Obrigado!`;
    case 'cancelado':
      return `Seu ${tag} foi cancelado.`;
    default:
      return `Seu ${tag} foi atualizado.`;
  }
}

/**
 * Notificação persistente ao cliente (Etapa 2).
 * Chamada SOMENTE após alteração real de status — nunca em early-return
 * (status igual), nunca por renderização/realtime do frontend.
 * Idempotência: antes de criar, verifica se já existe notificação para o
 * mesmo pedido + status; falhas nunca bloqueiam a resposta principal.
 */
async function createStatusNotification(base44: any, order: any, newStatus: string) {
  try {
    const existing = await base44.asServiceRole.entities.Notification.filter({
      order_id: order.id,
      status: newStatus,
    });
    if (existing.length > 0) return;

    const link = order.tracking_token ? `/acompanhar/${order.tracking_token}` : '';
    await base44.asServiceRole.entities.Notification.create({
      company_id: order.company_id,
      order_id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id || '',
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      status: newStatus,
      title: `Pedido #${order.order_number ?? '—'}: ${STATUS_LABELS_PT[newStatus] || newStatus}`,
      message: customerStatusMessage(order.order_number, newStatus),
      read: false,
      tracking_token: order.tracking_token || '',
      link,
    });
  } catch (e) { /* notificação nunca bloqueia o fluxo do pedido */ }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user.company_id) return Response.json({ error: 'Nenhuma empresa vinculada' }, { status: 403 });

    const body = await req.json();
    const { action, order_id } = body;

    if (!action || !order_id) {
      return Response.json({ error: 'action e order_id são obrigatórios' }, { status: 400 });
    }

    // Fetch the order and validate it belongs to the user's company
    const orders = await base44.asServiceRole.entities.Order.filter({
      id: order_id,
      company_id: user.company_id
    });
    if (orders.length === 0) {
      return Response.json({ error: 'Pedido não encontrado ou sem permissão' }, { status: 404 });
    }
    const order = orders[0];

    // ── ACTION: status (drag-and-drop or button) ──
    if (action === 'status') {
      const newStatus = body.status;
      const validStatuses = ['novo', 'confirmado', 'em_preparo', 'aguardando_retirada', 'saiu_entrega', 'finalizado', 'cancelado'];
      if (!validStatuses.includes(newStatus)) {
        return Response.json({ error: 'Status inválido' }, { status: 400 });
      }
      if (order.status === 'cancelado') {
        return Response.json({ error: 'Pedido cancelado não pode ser alterado' }, { status: 400 });
      }
      if (order.status === newStatus) {
        return Response.json({ order });
      }

      const history = order.status_history || [];
      history.push({
        status: newStatus,
        timestamp: new Date().toISOString(),
        user_name: user.full_name || user.email
      });

      const updated = await base44.asServiceRole.entities.Order.update(order_id, {
        status: newStatus,
        status_history: history
      });

      await logAudit(base44, user, 'status_change', 'order', order_id,
        `Status alterado de ${order.status} para ${newStatus}`, user.company_id);

      await createStatusNotification(base44, { ...updated, tracking_token: (updated as any).tracking_token || order.tracking_token }, newStatus);

      return Response.json({ order: updated });
    }

    // ── ACTION: cancel ──
    if (action === 'cancel') {
      const cancelReason = body.cancel_reason?.trim();
      if (!cancelReason) {
        return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });
      }
      if (order.status === 'cancelado') {
        return Response.json({ error: 'Pedido já está cancelado' }, { status: 400 });
      }
      if (order.status === 'finalizado') {
        return Response.json({ error: 'Pedido finalizado não pode ser cancelado' }, { status: 400 });
      }

      const history = order.status_history || [];
      history.push({
        status: 'cancelado',
        timestamp: new Date().toISOString(),
        user_name: user.full_name || user.email
      });

      const updated = await base44.asServiceRole.entities.Order.update(order_id, {
        status: 'cancelado',
        cancel_reason: cancelReason,
        canceled_by_name: user.full_name || user.email,
        status_history: history
      });

      await logAudit(base44, user, 'cancel_order', 'order', order_id,
        `Pedido cancelado: ${cancelReason}`, user.company_id);

      await createStatusNotification(base44, { ...updated, tracking_token: (updated as any).tracking_token || order.tracking_token }, 'cancelado');

      return Response.json({ order: updated });
    }

    // ── ACTION: edit (items, address, discount) ──
    if (action === 'edit') {
      if (order.status === 'cancelado' || order.status === 'finalizado') {
        return Response.json({ error: 'Pedido não pode ser editado neste status' }, { status: 400 });
      }

      const updateData: any = {};

      // Edit address fields
      if (body.customer_address !== undefined) updateData.customer_address = body.customer_address;
      if (body.customer_number !== undefined) updateData.customer_number = body.customer_number;
      if (body.customer_complement !== undefined) updateData.customer_complement = body.customer_complement;
      if (body.customer_neighborhood !== undefined) updateData.customer_neighborhood = body.customer_neighborhood;
      if (body.customer_notes !== undefined) updateData.notes = body.customer_notes;

      // Edit discount (validated server-side)
      if (body.discount !== undefined) {
        const discount = Number(body.discount);
        if (isNaN(discount) || discount < 0 || discount > order.subtotal) {
          return Response.json({ error: 'Desconto inválido' }, { status: 400 });
        }
        updateData.discount = discount;
      }

      // Edit items — full recalculation server-side
      if (body.items && Array.isArray(body.items)) {
        const productIds = body.items.map((ci: any) => ci.product_id).filter(Boolean);
        const products = await base44.asServiceRole.entities.Product.filter({
          company_id: user.company_id,
          id: { $in: productIds }
        });
        const productMap = new Map(products.map((p: any) => [p.id, p]));

        const orderItems = [];
        let subtotal = 0;

        for (const ci of body.items) {
          const product = productMap.get(ci.product_id);
          if (!product) {
            return Response.json({ error: `Produto não encontrado` }, { status: 400 });
          }
          const unitPrice = product.promotional_price != null
            ? Number(product.promotional_price)
            : Number(product.price);
          const qty = Number(ci.quantity);
          if (!Number.isInteger(qty) || qty < 1) {
            return Response.json({ error: `Quantidade inválida` }, { status: 400 });
          }

          let complementsTotal = 0;
          const validatedComplements = [];
          if (ci.complements && ci.complements.length > 0 && product.complements) {
            for (const cc of ci.complements) {
              const group = product.complements.find((g: any) => g.name === cc.group_name);
              if (!group) continue;
              const option = group.options?.find((o: any) => o.name === cc.option_name);
              if (!option) continue;
              const optPrice = Number(option.price) || 0;
              const optQty = Number(cc.quantity) || 1;
              validatedComplements.push({
                group_name: group.name,
                option_name: option.name,
                price: optPrice,
                quantity: optQty
              });
              complementsTotal += optPrice * optQty;
            }
          }

          const lineTotal = (unitPrice * qty) + complementsTotal;
          subtotal += lineTotal;

          orderItems.push({
            product_id: product.id,
            name: product.name,
            unit_price: unitPrice,
            price: lineTotal,
            quantity: qty,
            notes: ci.notes || '',
            complements: validatedComplements
          });
        }

        updateData.items = orderItems;
        updateData.subtotal = subtotal;
        updateData.total = subtotal + (order.delivery_fee || 0) - (updateData.discount || order.discount || 0);
      } else if (updateData.discount !== undefined) {
        // Only discount changed — recalculate total
        updateData.total = (order.subtotal || 0) + (order.delivery_fee || 0) - updateData.discount;
      }

      const updated = await base44.asServiceRole.entities.Order.update(order_id, updateData);

      await logAudit(base44, user, 'edit_order', 'order', order_id,
        `Pedido editado`, user.company_id);

      return Response.json({ order: updated });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}