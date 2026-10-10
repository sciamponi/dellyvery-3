-- DELLVERY 3 -- Periodicidade desejada do plano (mensal/semestral/anual)
-- (local only; complementar, sem tocar registros antigos — coluna nulável)
-- create_lead passa a exigir billing_period nos novos cadastros (preferência
-- declarada, sem vínculo com fidelidade ou cobrança). RLS/grants inalterados.

alter table public.leads
  add column if not exists billing_period text;

create or replace function create_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text := btrim(coalesce(p_lead ->> 'service', ''));
  v_service_other text := nullif(btrim(coalesce(p_lead ->> 'service_other', '')), '');
  v_person_type text := coalesce(nullif(btrim(coalesce(p_lead ->> 'person_type', '')), ''), 'pj');
  v_company_name text := nullif(btrim(coalesce(p_lead ->> 'company_name', '')), '');
  v_trade_name text := nullif(btrim(coalesce(p_lead ->> 'trade_name', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_lead ->> 'cnpj', ''), '\D', '', 'g'), '');
  v_state_registration text := nullif(btrim(coalesce(p_lead ->> 'state_registration', '')), '');
  v_full_name text := btrim(coalesce(p_lead ->> 'full_name', ''));
  v_cpf text := nullif(regexp_replace(coalesce(p_lead ->> 'cpf', ''), '\D', '', 'g'), '');
  v_role text := nullif(btrim(coalesce(p_lead ->> 'role', '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_lead ->> 'phone', ''), '\D', '', 'g'), '');
  v_email text := btrim(coalesce(p_lead ->> 'email', ''));
  v_address jsonb := coalesce(p_lead -> 'address', '{}'::jsonb);
  v_notes text := nullif(btrim(coalesce(p_lead ->> 'notes', '')), '');
  v_plan_interest text := nullif(btrim(coalesce(p_lead ->> 'plan_interest', '')), '');
  v_billing_period text := nullif(btrim(coalesce(p_lead ->> 'billing_period', '')), '');
  v_payment_preference text := nullif(btrim(coalesce(p_lead ->> 'payment_preference', '')), '');
  v_consent boolean := coalesce((p_lead ->> 'consent')::boolean, false);
  v_id uuid;
begin
  if v_service = ''
     or not (v_service = any (array['dellyvery','barberia','midia-indoor','automatiza','outro'])) then
    raise exception 'Serviço desejado inválido';
  end if;
  if v_service = 'outro' and v_service_other is null then
    raise exception 'Descreva o serviço desejado';
  end if;
  if v_person_type not in ('pj', 'pf') then
    raise exception 'Tipo de cadastro inválido';
  end if;
  if v_full_name = '' then
    raise exception 'Nome do responsável é obrigatório';
  end if;
  if v_phone is null or char_length(v_phone) not in (10, 11) then
    raise exception 'Telefone/WhatsApp inválido';
  end if;
  if v_email = '' or v_email not like '%@%.%' then
    raise exception 'E-mail inválido';
  end if;
  if v_person_type = 'pj' and v_cnpj is null then
    raise exception 'CNPJ é obrigatório para pessoa jurídica';
  end if;
  if v_cnpj is not null and not public.is_valid_cnpj(v_cnpj) then
    raise exception 'CNPJ inválido';
  end if;
  if v_person_type = 'pf' and v_cpf is null then
    raise exception 'CPF é obrigatório para pessoa física';
  end if;
  if v_cpf is not null and not public.is_valid_cpf(v_cpf) then
    raise exception 'CPF inválido';
  end if;
  -- Pagamento opcional desde a captacao sem cobranca: aceita whitelist legada ou null.
  if v_billing_period is null
     or not (v_billing_period = any (array['mensal','semestral','anual'])) then
    raise exception 'Escolha a periodicidade desejada';
  end if;
  if not v_consent then
    raise exception 'É necessário aceitar o uso dos dados para contato';
  end if;

  insert into public.leads (
    service, service_other, person_type, company_name, trade_name, cnpj,
    state_registration, full_name, cpf, role, phone, email, address,
    notes, plan_interest, billing_period, payment_preference, consent_at, status
  ) values (
    v_service, v_service_other, v_person_type, v_company_name, v_trade_name, v_cnpj,
    v_state_registration, v_full_name, v_cpf, v_role, v_phone, v_email, v_address,
    v_notes, v_plan_interest, v_billing_period, v_payment_preference, now(), 'novo'
  ) returning id into v_id;

  return jsonb_build_object('lead_id', v_id);
end;
$$;

revoke all on function create_lead(jsonb) from public;
grant execute on function create_lead(jsonb) to anon, authenticated;
