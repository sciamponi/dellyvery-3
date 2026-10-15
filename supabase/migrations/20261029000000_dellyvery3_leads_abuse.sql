-- DELLVERY 3 — Fase D: anti-abuso em create_lead (base oficial PROJ).
-- NÃO aplicada em produção/staging nesta execução (proposta local).
-- Corpo idêntico ao vigente em 20261014000000 (billing_period, whitelist
-- de serviços, validadores CPF/CNPJ, consent) + apenas:
--   1. honeypot `website` (bots preenchem): sucesso falso, sem inserir,
--      sem revelar a defesa;
--   2. rate-limit: máx. 10 leads/hora por IP de origem.
-- Sem CAPTCHA (decisão registrada; Turnstile segue como melhoria futura
-- com verificação de segredo fora do Postgres).
--
-- CONFIANÇA NO IP / FAIL-OPEN: o IP vem de `request.headers ->
-- x-forwarded-for` publicado pelo PostgREST/Supabase a partir do peer da
-- conexão. Atrás de CDN/proxy, reflete o IP que o edge enxerga — confirmar
-- a cadeia de proxy em produção antes de endurecer. Se o cabeçalho estiver
-- ausente ou ilegível, o limite é ignorado (fail-open) e o honeypot segue
-- valendo; nunca bloqueia cadastro legítimo por falta de telemetria.
--
-- RETENÇÃO/PRIVACIDADE: source_ip serve só ao rate-limit. Não usar para
-- perfilamento. Limpeza: `select public.anonymize_lead_ips(90)` (dias;
-- platform admin) zera IPs de leads com mais de N dias. Recomenda-se
-- rotina (cron/Edge) com a janela definida pelo negócio.

alter table public.leads
  add column if not exists source_ip text;

create index if not exists idx_leads_source_ip_created
  on public.leads (source_ip, created_at desc);

create or replace function create_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_honeypot text := nullif(btrim(coalesce(p_lead ->> 'website', '')), '');
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
  v_src_ip text := null;
  v_recent bigint := 0;
  v_id uuid;
begin
  -- Honeypot: finge sucesso sem persistir nada.
  if v_honeypot is not null then
    return jsonb_build_object('lead_id', gen_random_uuid());
  end if;
  -- IP de origem (fail-open se indisponível).
  begin
    v_src_ip := nullif(btrim(split_part(
      coalesce((current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'), ''), ',', 1)), '');
  exception when others then
    v_src_ip := null;
  end;
  if v_src_ip is not null then
    select count(*) into v_recent from public.leads
    where source_ip = v_src_ip and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'Muitas tentativas. Tente novamente mais tarde.';
    end if;
  end if;
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
    notes, plan_interest, billing_period, payment_preference, consent_at, status, source_ip
  ) values (
    v_service, v_service_other, v_person_type, v_company_name, v_trade_name, v_cnpj,
    v_state_registration, v_full_name, v_cpf, v_role, v_phone, v_email, v_address,
    v_notes, v_plan_interest, v_billing_period, v_payment_preference, now(), 'novo', v_src_ip
  ) returning id into v_id;

  return jsonb_build_object('lead_id', v_id);
end;
$$;

revoke all on function create_lead(jsonb) from public;
grant execute on function create_lead(jsonb) to anon, authenticated;

-- Limpeza de IPs antigos (privacidade): zera source_ip de leads com mais
-- de p_days dias. Uso restrito a platform admin (mesmo padrão de
-- set_lead_status). Executar via rotina com a janela definida pelo negócio.
create or replace function anonymize_lead_ips(p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissão';
  end if;
  if p_days is null or p_days < 1 then
    raise exception 'Janela inválida';
  end if;
  update public.leads set source_ip = null
  where source_ip is not null and created_at < now() - (p_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return jsonb_build_object('anonymized', v_n);
end;
$$;

revoke all on function anonymize_lead_ips(int) from public, anon;
grant execute on function anonymize_lead_ips(int) to authenticated;
