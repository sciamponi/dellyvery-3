-- DELLVERY 3 — Cobrança de créditos iniciada pelo Master.
--
-- Escopo:
--   * comprovante privado por pedido da revenda;
--   * RPC exclusiva do Master para criar cobrança pendente de outro revendedor;
--   * RPC do revendedor para enviar o comprovante;
--   * trava que impede aprovação sem comprovante e fora de 'pendente'.
--
-- Não cria tabela nova: reutiliza reseller_credit_orders e as RPCs de
-- confirmação/rejeição/cancelamento já existentes.

alter table public.reseller_credit_orders
  add column if not exists proof_url text;

alter table public.reseller_credit_orders
  drop constraint if exists reseller_credit_orders_proof_url_check;

alter table public.reseller_credit_orders
  add constraint reseller_credit_orders_proof_url_check
  check (proof_url is null or char_length(proof_url) <= 1000);

-- Bucket privado de comprovantes. Leitura/escrita do revendedor restrita à
-- própria pasta; Master lê qualquer comprovante.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reseller-receipts',
  'reseller-receipts',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Reseller read own receipts" on storage.objects;
create policy "Reseller read own receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reseller-receipts'
    and (storage.foldername(name))[1] = public.current_reseller_id()::text
  );

drop policy if exists "Reseller upload own receipts" on storage.objects;
create policy "Reseller upload own receipts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reseller-receipts'
    and (storage.foldername(name))[1] = public.current_reseller_id()::text
  );

drop policy if exists "Master read reseller receipts" on storage.objects;
create policy "Master read reseller receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reseller-receipts'
    and public.is_platform_admin()
  );

-- Aprovação só ocorre a partir de 'pendente' e exige comprovante. Vale para
-- qualquer caminho de escrita, inclusive futuras RPCs.
create or replace function public.guard_reseller_credit_order_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'creditado' and old.status is distinct from 'creditado' then
    if old.status <> 'pendente' then
      raise exception 'Somente pedidos pendentes podem ser aprovados';
    end if;
    if new.proof_url is null or btrim(new.proof_url) = '' then
      raise exception 'Comprovante obrigatorio para aprovacao';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_credit_order_approval on public.reseller_credit_orders;
create trigger trg_reseller_credit_order_approval
before update on public.reseller_credit_orders
for each row execute function public.guard_reseller_credit_order_approval();

-- Master cria uma cobrança pendente para um revendedor. Preço unitário e total
-- são calculados no banco a partir do pacote ativo de referência (o de menor
-- sort_order). O frontend envia somente revendedor, quantidade e idempotência.
create or replace function public.create_reseller_credit_charge(
  p_reseller_id uuid,
  p_credits integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_package public.reseller_credit_packages%rowtype;
  v_order public.reseller_credit_orders%rowtype;
  v_pending public.reseller_credit_orders%rowtype;
  v_unit_price numeric(14,4);
  v_amount numeric(10,2);
  v_expiry_days integer;
  v_expires_at timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;
  if p_reseller_id is null then
    raise exception 'Revendedor nao informado';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'Quantidade de creditos invalida';
  end if;
  if p_credits > 1000000 then
    raise exception 'Quantidade de creditos acima do limite';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotencia obrigatoria';
  end if;
  if not exists (
    select 1 from public.resellers where id = p_reseller_id
  ) then
    raise exception 'Revendedor nao encontrado';
  end if;

  perform public.expire_reseller_credit_orders();

  select *
  into v_order
  from public.reseller_credit_orders
  where reseller_id = p_reseller_id
    and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'proof_url', v_order.proof_url,
      'pending_expires_at', v_order.pending_expires_at,
      'reused', true
    );
  end if;

  select *
  into v_pending
  from public.reseller_credit_orders
  where reseller_id = p_reseller_id
    and status = 'pendente'
  for update;

  if found then
    return jsonb_build_object(
      'order_id', v_pending.id,
      'status', v_pending.status,
      'credits', v_pending.credits,
      'amount', v_pending.amount,
      'currency', v_pending.currency,
      'proof_url', v_pending.proof_url,
      'pending_expires_at', v_pending.pending_expires_at,
      'reused', true
    );
  end if;

  select *
  into v_package
  from public.reseller_credit_packages
  where active = true
  order by sort_order asc, created_at desc
  limit 1
  for share;

  if not found then
    raise exception 'Nenhum pacote ativo para calcular o valor';
  end if;

  v_unit_price := round(v_package.price / v_package.credits, 4);
  v_amount := round(v_package.price * p_credits / v_package.credits, 2);

  if v_amount > 99999999.99 then
    raise exception 'Valor total acima do limite';
  end if;

  select credit_order_expiry_days
  into v_expiry_days
  from public.platform_settings
  where id = true;

  v_expires_at := case
    when v_expiry_days is null then null
    else now() + make_interval(days => v_expiry_days)
  end;

  insert into public.reseller_credit_orders (
    reseller_id, package_id, package_name, package_snapshot,
    credits, amount, currency, idempotency_key, pending_expires_at, created_by
  )
  values (
    p_reseller_id, v_package.id, v_package.name,
    jsonb_build_object(
      'id', v_package.id,
      'name', v_package.name,
      'description', v_package.description,
      'credits', v_package.credits,
      'price', v_package.price,
      'currency', v_package.currency,
      'unit_price', v_unit_price,
      'requested_credits', p_credits,
      'captured_at', now()
    ),
    p_credits, v_amount, v_package.currency,
    p_idempotency_key, v_expires_at, auth.uid()
  )
  returning * into v_order;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_charge_created', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', p_reseller_id,
      'package_id', v_package.id,
      'credits', v_order.credits,
      'unit_price', v_unit_price,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'pending_expires_at', v_order.pending_expires_at
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'credits', v_order.credits,
    'unit_price', v_unit_price,
    'amount', v_order.amount,
    'currency', v_order.currency,
    'proof_url', v_order.proof_url,
    'pending_expires_at', v_order.pending_expires_at,
    'reused', false
  );
exception when unique_violation then
  select *
  into v_order
  from public.reseller_credit_orders
  where reseller_id = p_reseller_id
    and status = 'pendente';

  if found then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'proof_url', v_order.proof_url,
      'pending_expires_at', v_order.pending_expires_at,
      'reused', true
    );
  end if;

  raise;
end;
$$;

-- Revendedor envia o comprovante de um pedido pendente. Mantém status
-- 'pendente' para que o Master analise; não libera créditos.
create or replace function public.submit_reseller_credit_order_proof(
  p_order_id uuid,
  p_payment_reference text,
  p_proof_url text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_order public.reseller_credit_orders%rowtype;
  v_reference text;
  v_proof text;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_order_id is null then
    raise exception 'Pedido nao informado';
  end if;

  v_reference := nullif(btrim(p_payment_reference), '');
  if v_reference is null then
    raise exception 'Informe a referencia do pagamento';
  end if;
  if char_length(v_reference) > 200 then
    raise exception 'Referencia do pagamento muito longa';
  end if;

  v_proof := nullif(btrim(p_proof_url), '');
  if v_proof is null then
    raise exception 'Envie o comprovante';
  end if;
  if char_length(v_proof) > 1000 then
    raise exception 'Caminho do comprovante muito longo';
  end if;
  if v_proof like '%..%'
     or v_proof not like v_reseller_id::text || '/%' then
    raise exception 'Comprovante invalido';
  end if;

  perform public.expire_reseller_credit_orders();

  select *
  into v_order
  from public.reseller_credit_orders
  where id = p_order_id
  for update;

  if not found or v_order.reseller_id <> v_reseller_id then
    raise exception 'Pedido nao encontrado ou sem permissao';
  end if;

  if v_order.status = 'creditado' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'proof_url', v_order.proof_url,
      'reused', true
    );
  end if;

  if v_order.status <> 'pendente' then
    raise exception 'Somente pedidos pendentes podem receber comprovante';
  end if;

  update public.reseller_credit_orders
  set payment_reference = v_reference,
      proof_url = v_proof
  where id = v_order.id
  returning * into v_order;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, auth.uid(), 'reseller_credit_order_proof_submitted', 'reseller_credit_order', v_order.id,
    jsonb_build_object(
      'reseller_id', v_order.reseller_id,
      'credits', v_order.credits,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'payment_reference', v_order.payment_reference
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'proof_url', v_order.proof_url,
    'reused', false
  );
end;
$$;

revoke all on function public.create_reseller_credit_charge(uuid, integer, uuid)
  from public, anon;
grant execute on function public.create_reseller_credit_charge(uuid, integer, uuid)
  to authenticated, service_role;

revoke all on function public.submit_reseller_credit_order_proof(uuid, text, text)
  from public, anon;
grant execute on function public.submit_reseller_credit_order_proof(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.guard_reseller_credit_order_approval()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
