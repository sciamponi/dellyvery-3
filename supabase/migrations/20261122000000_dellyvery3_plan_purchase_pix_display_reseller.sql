create or replace function public.get_plan_purchase_pix_instructions(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.plan_purchase_requests%rowtype;
  v_active boolean := false;
  v_key_type text;
  v_key text;
  v_receiver text;
  v_qr_url text;
  v_qr_path text;
  v_qr_payload text;
  v_instructions text;
  v_version integer;
  v_configured boolean := false;
  v_available boolean := false;
  v_version_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'Solicitacao nao informada';
  end if;

  perform public.expire_plan_purchase_requests();

  select * into v_request
  from public.plan_purchase_requests
  where id = p_request_id;

  if not found then
    raise exception 'Solicitacao nao encontrada';
  end if;

  if not (
    public.is_platform_admin()
    or public.can_manage_company_billing(v_request.company_id)
  ) then
    raise exception 'Sem permissao';
  end if;

  select active, pix_key_type, pix_key, receiver_name, qr_image_url, qr_image_path, qr_payload, instructions, version
  into v_active, v_key_type, v_key, v_receiver, v_qr_url, v_qr_path, v_qr_payload, v_instructions, v_version
  from public.platform_pix_settings
  where id = true;

  v_configured := v_key is not null and btrim(v_key) <> '';
  v_available := v_request.status = 'pendente' and v_active and v_configured;
  v_version_changed :=
    v_request.pix_settings_version is not null
    and v_version is not null
    and v_request.pix_settings_version <> v_version;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'plan_name', v_request.plan_name_snapshot,
    'price', v_request.price_snapshot,
    'currency', v_request.currency_snapshot,
    'pending_expires_at', v_request.pending_expires_at,
    'configured', v_configured,
    'active', v_active,
    'available', v_available,
    'pix_key_type', case when v_available then v_key_type else null end,
    'pix_key', case when v_available then v_key else null end,
    'receiver_name', case when v_available then v_receiver else null end,
    'qr_image_url', case when v_available then v_qr_url else null end,
    'qr_image_path', case when v_available then v_qr_path else null end,
    'qr_payload', case when v_available then v_qr_payload else null end,
    'instructions', case when v_available then v_instructions else null end,
    'version', v_version,
    'request_version', v_request.pix_settings_version,
    'version_changed', v_version_changed
  );
end;
$$;

create or replace function public.list_plan_purchase_requests(p_status text default 'pendente')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if p_status is not null
     and p_status <> 'todas'
     and p_status not in ('pendente', 'confirmada', 'rejeitada', 'cancelada', 'expirada') then
    raise exception 'Status invalido';
  end if;

  perform public.expire_plan_purchase_requests();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.queue_order, x.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      r.id,
      r.company_id,
      c.name as company_name,
      c.slug as company_slug,
      r.requested_by,
      p.name as requested_by_name,
      p.email as requested_by_email,
      rc.id as reseller_client_id,
      rc.status as reseller_client_status,
      rs.id as reseller_id,
      coalesce(nullif(btrim(rp.name), ''), rp.email) as reseller_name,
      rp.email as reseller_email,
      r.plan_id,
      r.plan_name_snapshot,
      r.plan_slug_snapshot,
      r.price_snapshot,
      r.currency_snapshot,
      r.billing_cycle_snapshot,
      r.access_days_snapshot,
      r.status,
      r.payment_method,
      r.payment_reference,
      r.proof_url,
      r.payer_name,
      r.confirmed_amount,
      r.confirmed_currency,
      r.confirmed_at,
      r.rejected_at,
      r.canceled_at,
      r.expired_at,
      r.reason,
      r.pending_expires_at,
      r.pix_settings_version,
      r.activated_at,
      r.created_at,
      r.updated_at,
      case when r.status = 'pendente' then 0 else 1 end as queue_order
    from public.plan_purchase_requests r
    join public.companies c on c.id = r.company_id
    left join public.profiles p on p.id = r.requested_by
    left join public.reseller_clients rc on rc.company_id = r.company_id
    left join public.resellers rs on rs.id = rc.reseller_id
    left join public.profiles rp on rp.id = rs.user_id
    where p_status is null
       or p_status = 'todas'
       or r.status = p_status
    order by case when r.status = 'pendente' then 0 else 1 end, r.created_at desc
    limit 200
  ) x;

  return v_result;
end;
$$;

revoke all on function public.get_plan_purchase_pix_instructions(uuid) from public, anon;
grant execute on function public.get_plan_purchase_pix_instructions(uuid) to authenticated, service_role;

revoke all on function public.list_plan_purchase_requests(text) from public, anon;
grant execute on function public.list_plan_purchase_requests(text) to authenticated, service_role;

notify pgrst, 'reload schema';
