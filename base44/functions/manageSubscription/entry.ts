import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

async function logAudit(base44, user, action, entityType, entityId, details, companyId) {
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user.company_id) return Response.json({ error: 'Nenhuma empresa vinculada' }, { status: 403 });

    // Validate that the user is the owner of the company they claim to belong to.
    // This prevents a manipulated company_id (via updateMe) from accessing another
    // company's subscription: only the actual company creator can manage it.
    const companies = await base44.asServiceRole.entities.Company.filter({ id: user.company_id, created_by_id: user.id });
    if (companies.length === 0) {
      return Response.json({ error: 'Sem permissão para gerenciar esta empresa' }, { status: 403 });
    }

    const body = await req.json();
    const { action, plan_id } = body;

    const subs = await base44.asServiceRole.entities.Subscription.filter({ company_id: user.company_id });
    const sub = subs[0];

    if (action === 'upgrade' || action === 'downgrade') {
      const plans = await base44.asServiceRole.entities.Plan.filter({ id: plan_id, active: true });
      if (plans.length === 0) return Response.json({ error: 'Plano inválido ou inativo' }, { status: 400 });
      const plan = plans[0];

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      if (sub) {
        const updated = await base44.asServiceRole.entities.Subscription.update(sub.id, {
          plan_id: plan.id,
          plan_name: plan.name,
          status: 'ativo',
          amount: plan.price,
          current_period_end: periodEnd.toISOString(),
          canceled_at: null,
        });
        await logAudit(base44, user, action, 'subscription', sub.id, `Plano alterado para: ${plan.name}`, user.company_id);
        return Response.json({ subscription: updated });
      } else {
        const created = await base44.asServiceRole.entities.Subscription.create({
          company_id: user.company_id,
          plan_id: plan.id,
          plan_name: plan.name,
          status: 'ativo',
          started_at: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          gateway: 'manual',
          amount: plan.price,
        });
        await logAudit(base44, user, 'create', 'subscription', created.id, `Assinatura criada: ${plan.name}`, user.company_id);
        return Response.json({ subscription: created });
      }
    }

    if (action === 'cancel') {
      if (!sub) return Response.json({ error: 'Nenhuma assinatura encontrada' }, { status: 404 });
      const updated = await base44.asServiceRole.entities.Subscription.update(sub.id, {
        status: 'cancelado',
        canceled_at: new Date().toISOString(),
      });
      await logAudit(base44, user, 'cancel', 'subscription', sub.id, `Assinatura cancelada`, user.company_id);
      return Response.json({ subscription: updated });
    }

    if (action === 'reactivate') {
      if (!sub) return Response.json({ error: 'Nenhuma assinatura encontrada' }, { status: 404 });
      const plan = await base44.asServiceRole.entities.Plan.get(sub.plan_id);
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const updated = await base44.asServiceRole.entities.Subscription.update(sub.id, {
        status: 'ativo',
        canceled_at: null,
        current_period_end: periodEnd.toISOString(),
        amount: plan?.price || 0,
      });
      await logAudit(base44, user, 'reactivate', 'subscription', sub.id, `Assinatura reativada`, user.company_id);
      return Response.json({ subscription: updated });
    }

    return Response.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});