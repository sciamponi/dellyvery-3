import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

async function logAudit(base44, user, action, entityType, entityId, details) {
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      user_id: user.id,
      user_name: user.full_name || user.email,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (e) { /* ignore audit errors */ }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Acesso restrito ao administrador master' }, { status: 403 });

    const body = await req.json();
    const { action, plan } = body;

    if (action === 'create') {
      const created = await base44.asServiceRole.entities.Plan.create({
        name: plan.name,
        slug: (plan.slug || plan.name).toLowerCase().replace(/\s+/g, '-'),
        price: Number(plan.price) || 0,
        billing_cycle: plan.billing_cycle || 'monthly',
        limits_users: Number(plan.limits_users) || 1,
        limits_orders: Number(plan.limits_orders) ?? -1,
        limits_products: Number(plan.limits_products) ?? -1,
        limits_customers: Number(plan.limits_customers) ?? -1,
        limits_whatsapp: Number(plan.limits_whatsapp) || 0,
        limits_ia: !!plan.limits_ia,
        limits_storage_mb: Number(plan.limits_storage_mb) || 100,
        features: plan.features || [],
        is_popular: !!plan.is_popular,
        sort_order: Number(plan.sort_order) || 0,
        active: plan.active !== false,
      });
      await logAudit(base44, user, 'create', 'plan', created.id, `Plano criado: ${plan.name}`);
      return Response.json({ plan: created });
    }

    if (action === 'update') {
      const updated = await base44.asServiceRole.entities.Plan.update(plan.id, {
        name: plan.name,
        slug: (plan.slug || plan.name).toLowerCase().replace(/\s+/g, '-'),
        price: Number(plan.price) || 0,
        billing_cycle: plan.billing_cycle || 'monthly',
        limits_users: Number(plan.limits_users) || 1,
        limits_orders: Number(plan.limits_orders) ?? -1,
        limits_products: Number(plan.limits_products) ?? -1,
        limits_customers: Number(plan.limits_customers) ?? -1,
        limits_whatsapp: Number(plan.limits_whatsapp) || 0,
        limits_ia: !!plan.limits_ia,
        limits_storage_mb: Number(plan.limits_storage_mb) || 100,
        features: plan.features || [],
        is_popular: !!plan.is_popular,
        sort_order: Number(plan.sort_order) || 0,
        active: plan.active !== false,
      });
      await logAudit(base44, user, 'update', 'plan', plan.id, `Plano atualizado: ${plan.name}`);
      return Response.json({ plan: updated });
    }

    if (action === 'delete') {
      await base44.asServiceRole.entities.Plan.delete(plan.id);
      await logAudit(base44, user, 'delete', 'plan', plan.id, `Plano excluído`);
      return Response.json({ success: true });
    }

    if (action === 'toggle_active') {
      const updated = await base44.asServiceRole.entities.Plan.update(plan.id, { active: !plan.active });
      await logAudit(base44, user, 'toggle_active', 'plan', plan.id, `Plano ${plan.active ? 'desativado' : 'ativado'}`);
      return Response.json({ plan: updated });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});