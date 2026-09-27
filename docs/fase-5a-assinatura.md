# Fase 5A — Especificação de assinatura e pagamentos (para aprovação; sem implementação)

> Status: ESPECIFICAÇÃO. Nenhum código, migration, RLS ou Edge foi alterado.
> Decisão arquitetural: suportar **Asaas + Mercado Pago**, em dois contextos
> separados (assinatura do estabelecimento × pagamento do pedido do cliente),
> sob uma abstração `PaymentProvider`. Nenhuma integração implementada ainda.

## 0. Dois contextos de pagamento (não misturar)

### 0.1. Assinatura do estabelecimento — Asaas + Mercado Pago
- Cobra a **mensalidade do estabelecimento** (PIX/cartão).
- Webhooks atualizam `subscriptions` (§5/§9).
- Provedores: Asaas e Mercado Pago (ambos previstos desde já).

### 0.2. Pagamento do pedido do cliente — Mercado Pago (Asaas futuramente)
- No checkout, o cliente escolhe: Dinheiro, PIX, Cartão ou **Mercado Pago**
  (Checkout MP → webhook → pagamento confirmado → pedido atualizado).
- Estado em `order.payment_status` — **separado** de `subscription.status`.
- Pedido NUNCA é considerado pago por afirmação do frontend; só via webhook.

### 0.3. Abstração `PaymentProvider`
```
PaymentProvider
├── Asaas        (assinatura; pedidos futuramente)
└── MercadoPago  (assinatura; pedidos agora)
```
- Interface única: `createCustomer`, `createCharge`, `refund?`, `parseWebhookEvent`.
- Checkout e Assinatura dependem da interface, nunca do provider direto —
  trocar/adicionar meio não mexe nos fluxos.

## 1. Modelo atual (levantado, sem mudanças)

- `plans(id, name, slug unique, price, billing_cycle monthly|yearly, features[], limits{}, active)` — 1 seed (`solo`).
- `subscriptions(company_id unique, plan_id, status enum, started_at, expires_at)` — trial criado no onboarding (`create_company_with_owner`).
- RLS: membro lê; escrita só OWNER/ADMIN; `trg_immutable_company` trava `company_id`.
- Frontend lê via Base44 (`useSubscription`, `Assinatura.jsx`, `MasterPlanos.jsx`); UI espera `trial_ends_at`, `current_period_end`, `limits_{products,orders,customers}` (não existem no banco → adapter mapeia: `expires_at`, `limits{}`).
- **Asaas: inexistente** (zero código/tabela/webhook/chave no repo).

## 2. Estados e transições permitidas

```
trial ──pagamento──▶ ativo ──falha──▶ pendente ──pagamento──▶ ativo
  │                    │  ▲               │──cancelar──▶ cancelado
  │                    │  │               └──expirar──▶ expirado
  │                    └──renovar──▶ ativo (novo ciclo)
  └──expirar──▶ expirado ──assinar──▶ ativo
ativo ──cancelar──▶ cancelado (acesso até expires_at) ──reativar──▶ ativo
qualquer ──suspender (PLATFORM_ADMIN)──▶ suspenso ──liberar──▶ estado anterior
```

Transições inválidas (rejeitar com erro): sair de `cancelado` para `trial`; `expirado → pendente`; qualquer transição sem mudança; `reativar` fora de `cancelado`.

## 3. `hasAccess` (única fonte, espelhada nos 3 níveis)

```
hasAccess = (status == 'ativo')
         OR (status == 'trial' AND now() < expires_at)
         OR (status == 'cancelado' AND now() < expires_at)   // acesso até o fim pago
```

- **Frontend:** `useSubscription` calcula; rotas protegidas redirecionam p/ `/assinatura` quando `!hasAccess` (preserva `/login` para sem-sessão).
- **Backend (obrigatório — tela não protege dado):** toda RPC de escrita operacional (`create_order`, `manage_order`, atribuições) valida `hasAccess(company_id)` no servidor e rejeita `SUBSCRIPTION_BLOCKED` quando falso. Leitura pública (cardápio/tracking) segue liberada — loja fechada por inadimplência não apaga vitrine? **Decisão proposta:** cardápio continua visível, mas `create_order` bloqueia (cliente vê aviso "loja indisponível"). Alternativa (a decidir): esconder cardápio também.
- Trial sem `expires_at`: tratado como expirado (fail-closed).

## 4. Permissões

| Ação | OWNER | ADMIN | demais membros | PLATFORM_ADMIN |
|---|---|---|---|---|
| ver assinatura/planos | ✅ | ✅ | ✅ | ✅ |
| upgrade/downgrade/cancelar/reativar | ✅ | ✅ | ❌ | ❌ |
| CRUD `plans` (MasterPlanos) | ❌ | ❌ | ❌ | ✅ |
| suspender/liberar empresa | ❌ | ❌ | ❌ | ✅ |
| presentar checkout Asaas | ✅ | ✅ | ❌ | — |

Roles `company_role`: OWNER, ADMIN, MANAGER, OPERATOR, CASHIER, ATTENDANT. `platform_role`: USER, PLATFORM_ADMIN (sem bypass genérico; policies específicas).

## 5. Comportamento por estado

- **trial:** acesso total até `expires_at`; banner regressivo ≤3 dias; sem cobrança.
- **ativo:** acesso total; mostra próxima cobrança (`expires_at` do ciclo).
- **pendente:** sem acesso operacional (bloqueio backend §3); tela orienta regularizar (link checkout); mantém dados.
- **cancelado:** acesso até `expires_at`, depois equivale a expirado; reativação cria novo ciclo `ativo`.
- **suspenso:** sem acesso imediato, mesmo com prazo válido; só PLATFORM_ADMIN reverte.
- **expirado:** sem acesso; CTA assinar → checkout → `ativo`.
- **Renovação:** webhook `PAYMENT_CONFIRMED` estende `expires_at` (+1 ciclo) e volta a `ativo`; `PAYMENT_OVERDUE/FAILED` → `pendente`; `SUBSCRIPTION_CANCELLED` → `cancelado` (respeitando §3).

## 6. Idempotência

- `manage_subscription`: mesma `(company_id, action, idempotency_key?)` repetida retorna estado atual sem duplicar efeitos; transições inválidas são no-op com erro tipado, nunca meio-estado.
- Webhook: dedup por `asaas_event_id` antes de aplicar (tabela §7); replays retornam 200 sem re-aplicar.
- Checkout: uma cobrança pendente por empresa (reuso enquanto `pendente`).

## 7. Dados a persistir (mínimo — só criar na 5B após autorização)

```sql
-- pagamento por ciclo (auditoria + conciliação; nunca dados de cartão)
asaas_payments(company_id, subscription_id, asaas_id unique, type, amount,
               status, due_date, payload jsonb, created_at)
-- dedup + trilha de eventos do webhook
asaas_events(asaas_event_id unique, company_id, kind, processed_at)
-- customer Asaas: só asaas_customer_id em subscriptions? Decisão: coluna
-- subscriptions.asaas_customer_id (nullable) em vez de tabela própria —
-- menos uma tabela, atende 1:1 empresa↔cliente Asaas.
-- histórico de transições: audit_logs existente
-- (action='subscription.transition', entity='subscriptions',
--  metadata {from,to,actor,reason})
```

NÃO persistir: cartão/CPF/dados sensíveis (ficam no Asaas), segredos (Edge secrets).

## 8. Eventos Asaas necessários

`PAYMENT_CREATED`, `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`/`REFUNDED`, `SUBSCRIPTION_CANCELLED`. Ignorar demais (logar e 200).

## 9. Contratos

### `manage_subscription(p_action, p_plan_id?)` — RPC SECURITY DEFINER
- Auth: sessão + `is_company_member`; escrita só OWNER/ADMIN (erro `FORBIDDEN`).
- Actions: `upgrade|downgrade` (troca `plan_id`, mantém ciclo; expor `prorata?` = não na v1), `cancel` (→`cancelado`, mantém `expires_at`), `reactivate` (só de `cancelado` → `ativo` + novo ciclo), `suspend|unsuspend` (só PLATFORM_ADMIN).
- Retorna `subscriptions` atualizada; toda transição grava `audit_logs`; idempotente (§6); erros tipados (`FORBIDDEN`, `INVALID_TRANSITION`, `PLAN_NOT_FOUND`).

### `POST billing-checkout {plan_id, provider}` — Edge Function (autenticada)
- Valida OWNER/ADMIN + plano ativo; reusa cobrança `pendente` aberta se existir; cria customer (primeira vez) + cobrança PIX/cartão via `PaymentProvider` (Asaas ou Mercado Pago, conforme `provider`); retorna `{payment_id, checkout_url|qr, expires_at}`. Segredos só em Edge secrets.

### `POST billing-webhook` — Edge Function (pública, valida assinatura do provider)
- Valida assinatura do evento (Asaas token / MP `x-signature`); dedup por evento; aplica §5; responde 200 sempre (até p/ evento desconhecido, com log). Nunca expõe stack trace.
- Rota única com `provider` no payload/headers; o parse é delegado ao `PaymentProvider` correspondente.

### Pagamento de pedido (fase futura, fora da 5B)
- `POST order-checkout {order_id, provider: 'mercadopago'}` cria a cobrança vinculada ao `order`; webhook atualiza **apenas** `order.payment_status` (nunca `subscription.status`). `create_order` continua criando o pedido como não-pago; confirmação só via webhook.

## 10. Frontend a alterar (fase 5D, não agora)

- `useSubscription`: Supabase-only (subscriptions+plans via RLS; mapeia `expires_at→trial_ends_at`, `limits{}`; `hasAccess` §3).
- `Assinatura.jsx`: sem Base44; upgrade/cancel/reactivate via RPC; pagamento via link Asaas; histórico lendo `asaas_payments`.
- `MasterPlanos`: CRUD `plans` direto (platform-admin) ou RPC dedicada.
- Gates: `ProtectedRoute` (+rota `/assinatura` sempre acessível p/ regularizar) e bloqueio backend §3.
- Remover `manageSubscription`/`managePlan` Base44 e `useSubscription` legado.

## 11. Em aberto para decisão (não bloqueiam a 5B)

1. Cardápio público de inadimplente: visível com checkout bloqueado (proposto) vs. oculto?
2. `current_period_end`: derivar de `expires_at` (proposto) ou coluna própria?
3. Prorata no upgrade/downgrade: não na v1 (proposto) — confirmar.
4. Trial recorrente: mesma empresa pode ganhar novo trial? Proposto: não.
