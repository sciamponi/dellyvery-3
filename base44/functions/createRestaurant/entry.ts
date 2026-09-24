import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const slugify = (text) =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { form, zones } = body;
    if (!form?.name?.trim()) return Response.json({ error: 'Nome é obrigatório' }, { status: 400 });

    // Block if user already owns a company
    if (user.company_id) {
      return Response.json({ error: 'Você já possui um restaurante cadastrado' }, { status: 403 });
    }

    const slug = slugify(form.name);
    const company = await base44.entities.Company.create({
      name: form.name,
      slug,
      slogan: form.slogan || '',
      description: form.description || '',
      logo_url: form.logo_url || '',
      primary_color: form.primary_color || '#DC2626',
      accent_color: form.accent_color || '#F97316',
      phone: form.phone || '',
      email: form.email || '',
      address: form.address || '',
      city: form.city || '',
      state: form.state || '',
      zip_code: form.zip_code || '',
      is_open: form.is_open !== false,
      minimum_order: Number(form.minimum_order) || 0,
      delivery_fee: Number(form.delivery_fee) || 0,
      estimated_delivery_time: Number(form.estimated_delivery_time) || 30,
      plan: 'solo',
      plan_status: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Create trial subscription (server-side only — no plan/status from frontend)
    const trialPlans = await base44.asServiceRole.entities.Plan.filter({ slug: 'solo' });
    const trialPlan = trialPlans[0];
    if (trialPlan) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await base44.asServiceRole.entities.Subscription.create({
        company_id: company.id,
        plan_id: trialPlan.id,
        plan_name: trialPlan.name,
        status: 'trial',
        started_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        current_period_end: trialEnd.toISOString(),
        gateway: 'manual',
        amount: 0,
      });
    }

    await base44.auth.updateMe({ company_id: company.id });

    const validZones = (zones || []).filter(z => z.name?.trim());
    if (validZones.length > 0) {
      await base44.entities.DeliveryZone.bulkCreate(
        validZones.map(z => ({
          name: z.name,
          fee: Number(z.fee) || 0,
          estimated_time: Number(z.estimated_time) || 30,
          company_id: company.id,
        }))
      );
    }

    return Response.json({ company_id: company.id, slug });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});