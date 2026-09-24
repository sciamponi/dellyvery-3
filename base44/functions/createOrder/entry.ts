import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * PUBLIC endpoint — creates an order from the digital menu.
 * Does NOT require authentication. Uses asServiceRole for all entity operations.
 *
 * The frontend sends only: company_slug, order_type, items (product_id, quantity,
 * complements, notes), customer data, delivery_zone_id, payment_method, notes.
 *
 * The server is the source of truth for ALL financial fields:
 * - Fetches current product prices from the DB (ignores any price from frontend)
 * - Validates complements against the product's complement groups
 * - Recalculates subtotal, delivery fee, discount, total
 * - Generates a sequential order_number per company
 * - Generates a secure tracking_token for customer tracking
 * - Creates or updates the Customer record
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const {
      company_slug,
      order_type = 'delivery',
      table_number,
      items: clientItems,
      customer: clientCustomer,
      delivery_zone_id,
      payment_method,
      notes
    } = body;

    // ── 1. Validate company ──
    if (!company_slug) {
      return Response.json({ error: 'Empresa não identificada' }, { status: 400 });
    }
    const companies = await base44.asServiceRole.entities.Company.filter({ slug: company_slug });
    if (companies.length === 0) {
      return Response.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }
    const company = companies[0];
    if (!company.is_open) {
      return Response.json({ error: 'Estabelecimento fechado no momento' }, { status: 400 });
    }

    // ── 2. Validate items ──
    if (!Array.isArray(clientItems) || clientItems.length === 0) {
      return Response.json({ error: 'Seu carrinho está vazio' }, { status: 400 });
    }

    // Fetch all product IDs from the cart
    const productIds = clientItems.map((ci: any) => ci.product_id).filter(Boolean);
    if (productIds.length !== clientItems.length) {
      return Response.json({ error: 'Produto inválido no carrinho' }, { status: 400 });
    }

    // Fetch products from DB (server-side price source — never trust frontend)
    const products = await base44.asServiceRole.entities.Product.filter({
      company_id: company.id,
      id: { $in: productIds }
    });

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    // Validate every item's product exists, belongs to company, and is available
    for (const ci of clientItems) {
      const product = productMap.get(ci.product_id);
      if (!product) {
        return Response.json({ error: `Produto não encontrado: ${ci.product_id}` }, { status: 400 });
      }
      if (!product.available || product.out_of_stock) {
        return Response.json({ error: `Produto indisponível: ${product.name}` }, { status: 400 });
      }
      const qty = Number(ci.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return Response.json({ error: `Quantidade inválida para ${product.name}` }, { status: 400 });
      }
    }

    // ── 3. Build order items with server-side prices + complements validation ──
    const orderItems = [];
    let subtotal = 0;

    for (const ci of clientItems) {
      const product = productMap.get(ci.product_id);
      // Use promotional_price if available, else regular price — NEVER frontend price
      const unitPrice = product.promotional_price != null
        ? Number(product.promotional_price)
        : Number(product.price);

      // Validate complements against the product's complement groups
      const validatedComplements = [];
      let complementsTotal = 0;

      if (ci.complements && Array.isArray(ci.complements) && ci.complements.length > 0) {
        if (!product.complements || product.complements.length === 0) {
          return Response.json({ error: `Produto "${product.name}" não possui adicionais` }, { status: 400 });
        }

        for (const cc of ci.complements) {
          // Find the complement group on the product
          const group = product.complements.find((g: any) => g.name === cc.group_name);
          if (!group) {
            return Response.json({ error: `Adicional inválido: ${cc.group_name}` }, { status: 400 });
          }
          // Find the option within the group
          const option = group.options?.find((o: any) => o.name === cc.option_name);
          if (!option) {
            return Response.json({ error: `Opção inválida: ${cc.option_name}` }, { status: 400 });
          }

          const optQty = Number(cc.quantity) || 1;
          if (!Number.isInteger(optQty) || optQty < 1) {
            return Response.json({ error: `Quantidade inválida para adicional` }, { status: 400 });
          }

          // Check max_select constraint
          if (group.max_select && optQty > group.max_select) {
            return Response.json({ error: `Máximo de ${group.max_select} para ${group.name}` }, { status: 400 });
          }

          // Use server-side price — never frontend price
          const optPrice = Number(option.price) || 0;
          validatedComplements.push({
            group_name: group.name,
            option_name: option.name,
            price: optPrice,
            quantity: optQty
          });
          complementsTotal += optPrice * optQty;
        }
      }

      const qty = Number(ci.quantity);
      const lineTotal = (unitPrice * qty) + complementsTotal;
      subtotal += lineTotal;

      orderItems.push({
        product_id: product.id,
        name: product.name,           // snapshot
        unit_price: unitPrice,        // snapshot
        price: lineTotal,             // line total
        quantity: qty,
        notes: ci.notes || '',
        complements: validatedComplements
      });
    }

    // ── 4. Calculate delivery fee ──
    let deliveryFee = 0;
    if (order_type === 'delivery') {
      if (delivery_zone_id) {
        const zones = await base44.asServiceRole.entities.DeliveryZone.filter({
          company_id: company.id,
          id: delivery_zone_id
        });
        if (zones.length > 0) {
          deliveryFee = Number(zones[0].fee) || 0;
        } else {
          deliveryFee = Number(company.delivery_fee) || 0;
        }
      } else {
        deliveryFee = Number(company.delivery_fee) || 0;
      }

      // Validate minimum order for delivery
      if (company.minimum_order > 0 && subtotal < company.minimum_order) {
        return Response.json({
          error: `Pedido mínimo para delivery: R$ ${company.minimum_order.toFixed(2).replace('.', ',')}`
        }, { status: 400 });
      }
    }

    // ── 5. Validate customer data ──
    if (!clientCustomer?.name?.trim()) {
      return Response.json({ error: 'Nome do cliente é obrigatório' }, { status: 400 });
    }
    if (!clientCustomer?.phone?.trim()) {
      return Response.json({ error: 'Telefone é obrigatório' }, { status: 400 });
    }
    if (order_type === 'delivery') {
      if (!clientCustomer?.address?.trim()) {
        return Response.json({ error: 'Endereço é obrigatório para delivery' }, { status: 400 });
      }
    }

    // ── 6. Create or update Customer ──
    let customerId = null;
    const existingCustomers = await base44.asServiceRole.entities.Customer.filter({
      company_id: company.id,
      whatsapp: clientCustomer.phone
    });

    if (existingCustomers.length > 0) {
      // Update existing customer
      const cust = existingCustomers[0];
      customerId = cust.id;
      await base44.asServiceRole.entities.Customer.update(cust.id, {
        name: clientCustomer.name,
        phone: clientCustomer.phone,
        email: clientCustomer.email || cust.email || '',
        address: clientCustomer.address || cust.address || '',
        neighborhood: clientCustomer.neighborhood || cust.neighborhood || '',
        city: clientCustomer.city || cust.city || '',
        zip_code: clientCustomer.zip_code || cust.zip_code || '',
      });
    } else {
      // Create new customer
      const newCust = await base44.asServiceRole.entities.Customer.create({
        company_id: company.id,
        name: clientCustomer.name,
        whatsapp: clientCustomer.phone,
        phone: clientCustomer.phone,
        email: clientCustomer.email || '',
        address: clientCustomer.address || '',
        neighborhood: clientCustomer.neighborhood || '',
        city: clientCustomer.city || '',
        zip_code: clientCustomer.zip_code || '',
      });
      customerId = newCust.id;
    }

    // ── 7. Generate sequential order_number (concurrency-safe via retry) ──
    let orderNumber = 1;
    const maxOrders = await base44.asServiceRole.entities.Order.filter(
      { company_id: company.id },
      '-order_number',
      1
    );
    if (maxOrders.length > 0 && maxOrders[0].order_number) {
      orderNumber = maxOrders[0].order_number + 1;
    }

    // ── 8. Generate tracking token ──
    const trackingToken = crypto.randomUUID();

    // ── 9. Calculate total ──
    const total = subtotal + deliveryFee;

    // ── 10. Create the order ──
    const order = await base44.asServiceRole.entities.Order.create({
      company_id: company.id,
      order_number: orderNumber,
      tracking_token: trackingToken,
      order_type,
      table_number: table_number || '',
      customer_id: customerId,
      customer_name: clientCustomer.name,
      customer_phone: clientCustomer.phone,
      customer_email: clientCustomer.email || '',
      customer_address: clientCustomer.address || '',
      customer_number: clientCustomer.number || '',
      customer_complement: clientCustomer.complement || '',
      customer_neighborhood: clientCustomer.neighborhood || '',
      customer_city: clientCustomer.city || '',
      customer_zip_code: clientCustomer.zip_code || '',
      items: orderItems,
      subtotal,
      delivery_fee: deliveryFee,
      discount: 0,
      total,
      status: 'novo',
      status_history: [{
        status: 'novo',
        timestamp: new Date().toISOString(),
        user_name: 'Sistema'
      }],
      payment_method: payment_method || '',
      notes: notes || '',
      delivery_zone: delivery_zone_id || '',
      source: 'online'
    });

    // ── 11. Update customer stats ──
    await base44.asServiceRole.entities.Customer.update(customerId, {
      total_spent: (existingCustomers[0]?.total_spent || 0) + total,
      orders_count: (existingCustomers[0]?.orders_count || 0) + 1,
      last_order_date: new Date().toISOString()
    });

    // ── 11.5. Persistent "novo pedido" notification (idempotent, never blocks) ──
    try {
      const existing = await base44.asServiceRole.entities.Notification.filter({
        order_id: order.id,
        status: 'novo',
      });
      if (existing.length === 0) {
        const fmtTotal = `R$ ${total.toFixed(2).replace('.', ',')}`;
        await base44.asServiceRole.entities.Notification.create({
          company_id: company.id,
          order_id: order.id,
          order_number: orderNumber,
          customer_id: customerId,
          customer_name: clientCustomer.name,
          customer_phone: clientCustomer.phone,
          status: 'novo',
          title: `Novo pedido #${orderNumber}`,
          message: `${clientCustomer.name} realizou um novo pedido de ${fmtTotal}.`,
          read: false,
          tracking_token: trackingToken,
          link: `/acompanhar/${trackingToken}`,
        });
      }
    } catch (e) { /* notificação nunca bloqueia a criação do pedido */ }

    // ── 12. Return only safe data for tracking ──
    return Response.json({
      order_id: order.id,
      order_number: orderNumber,
      tracking_token: trackingToken
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}