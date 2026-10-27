# Caixa e Recebimento Integral — Especificação (para aprovação; sem implementação)

> Status: ESPECIFICAÇÃO. Nenhum código, migration, RLS, banco ou ambiente foi alterado.
> Escopo: recebimento **presencial** (balcão) de pedidos, integral, Pix/Cartão/Dinheiro.
> Não mistura com `docs/fase-5a-assinatura.md` (assinatura/gateways online Asaas + Mercado
> Pago): aquele trata cobrança online com webhook; este trata registro manual de
> recebimento no caixa. Nenhum integra com o outro nesta versão.

## 0. Decisões aprovadas (consolidadas)

1. Somente pagamento **integral** (sem parciais nesta versão).
2. Métodos: **Pix, Cartão e Dinheiro**.
3. Persistência financeira própria: tabela proposta `order_payments` (seção 2).
4. RPC transacional proposta: `register_order_payment` (seção 3).
5. Anti-duplicidade em 3 camadas: idempotency key do cliente + checagem transacional + restrição única no banco (seção 5).
6. Papéis autorizados a receber: **OWNER, ADMIN e CASHIER** (demais papéis só visualizam).
7. Financeiro: receita principal segue = pedidos `finalizado`; novo indicador separado de recebidos (`payment_status='paid'`).
8. Estorno preserva histórico (sem apagar registro).
9. Abrir o caixa **nunca** registra pagamento; só a confirmação explícita.
10. Status operacional (`orders.status`) e financeiro (`orders.payment_status`) permanecem distintos.

## 1. Modelo atual (levantado, sem mudanças)

- `orders.payment_status` enum (`pending|paid|failed|refunded`), `NOT NULL DEFAULT 'pending'`;
  todas as versões do `create_order` inserem literal `'pending'`; **nada transita para `paid`**.
- `manage_order`: ações `status|cancel|edit` — sem ação de pagamento.
- Nenhuma tabela `payments|order_payments|transactions|receipts` existe.
- RLS `orders`: qualquer `is_company_member` pode SELECT/INSERT/UPDATE/DELETE — papéis
  não restringem escrita; restrição por papel deve viver na RPC (precedente:
  `delete_table_if_unused`, OWNER/ADMIN).
- App: `payment_method` + `change_for` são informativos (PDV/checkout); `requestPayment`
  = cobrança via WhatsApp (`Pdv.jsx`), não recebimento; Financeiro agrega por status.
- Total exibido em `OrderModal.jsx` (bloco Subtotal/taxa/desconto/Total), sem clique.

## 2. Modelo de dados proposto (Fase 1 — GATE 1: migração)

```sql
-- PROPOSTA (não aplicar sem autorização; migration dedicada na implementação)
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id),
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('Pix','Cartão','Dinheiro')),
  received_by uuid references auth.users(id),
  received_at timestamptz not null default now(),
  idempotency_key uuid not null unique,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);
-- Um recebimento ativo por pedido (integral): concorrência resolvida no banco.
create unique index uq_order_payments_active
  on public.order_payments (order_id) where cancelled_at is null;
```

RLS: `SELECT` para membros da empresa; **sem** policy de INSERT/UPDATE/DELETE para
membros (escrita exclusiva via RPC `SECURITY DEFINER`). Sem `notes`/audit como registro.

## 3. Contrato da RPC proposta `register_order_payment`

Assinatura: `(p_order_id uuid, p_method text, p_idempotency_key uuid) → jsonb
{payment_id, order_id, order_number, amount, method, received_at}`.

Validações (nesta ordem, transacional):
1. `p_method` em (Pix, Cartão, Dinheiro); `p_idempotency_key` uuid válido.
2. Pedido existe; `company_id` do pedido = empresa do chamador (`member_role` em
   OWNER/ADMIN/CASHIER; demais → erro de permissão).
3. Pedido não `cancelado`; `amount := orders.total` (> 0).
4. Idempotência: se já existe recebimento com a mesma `idempotency_key` → retorna o
   existente (sem duplicar). Se existe recebimento **ativo** do pedido (outra key) →
   erro `Pedido já recebido`.
5. `INSERT order_payments` + `UPDATE orders SET payment_status='paid'` +
   `order_status_history` (old=new=status atual, nota `Pagamento recebido (Pix)`).

Erros controlados (mensagens PT-BR): permissão, pedido não encontrado, pedido
cancelado, total inválido, já recebido, método inválido, chave inválida.
`GRANT EXECUTE ... TO authenticated` (nunca `anon`); `REVOKE` de `public`.

Estorno (proposta `cancel_order_payment(p_payment_id, p_reason)`): exige OWNER/ADMIN,
`cancelled_at=now()` + motivo, volta `orders.payment_status='pending'`, registra
history. **Nunca DELETE** — histórico preservado.

## 4. App proposta (Fase 2 — sem migração nova)

- Total clicável (`OrderModal.jsx`, bloco atual): `<button>` com
  `aria-label="Receber pagamento do pedido #N"`, foco visível, hint "Receber pagamento",
  área 44px no mobile. Abrir **não** chama RPC nem muda nada.
- `PaymentModal` novo: total persistido (do pedido recarregado) + seletor de método +
  resumo (método, valor, pedido); confirmação explícita em 2 toques gera
  `idempotency_key` (uuid na abertura) + guarda anti-duplo; sucesso fecha com toast;
  se `payment_status='paid'` → estado pago + bloqueio (sem nova cobrança);
  erro (já pago, concorrência, rede) com retry seguro (mesma key); fechar volta aos
  detalhes. `status` operacional intocado; impressão/cancelamento/transições intactos.
- Financeiro: mantém receita = finalizado; adiciona indicador "Recebido"
  (`payment_status='paid'`, por método) — número principal inalterado.

## 5. Matriz de testes prevista

Unit (puro): idempotency-key repetida retorna existente; integral ≠ total rejeita;
cancelado rejeita; papel não autorizado rejeita; `notes`/audit nunca usados.
Integração RPC (erros acima + concorrência simulada: 2 chamadas mesma key e keys
distintas). E2E manual: abrir-sem-confirmar (nada registrado), confirmar (1 registro),
duplo clique, 2 caixas simultâneos, já-pago bloqueado, estorno preserva histórico.
Regressão: suite cheia + PDV/checkout/pedidos/impressão.

## 6. Gates e pendências

- **GATE 1**: migração (tabela + índices + RPCs + RLS + grants) — implementar e revisar.
- **GATE 2**: indicador "Recebido" no Financeiro (após dados reais existirem).
- **GATE 3**: papéis confirmados (OWNER/ADMIN/CASHIER — aprovado nesta especificação).
- Fora do escopo v1: parciais, troco automatizado, fila offline, conciliação gateway.

ESPECIFICAÇÃO CONSOLIDADA — AGUARDANDO AUTORIZAÇÃO PARA IMPLEMENTAÇÃO.
