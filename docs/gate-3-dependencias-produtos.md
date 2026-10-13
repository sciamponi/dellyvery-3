# Gate 3 — Dependências configuráveis entre produtos (relatório técnico)

Data de execução: 2026-10-13 (America/Sao_Paulo).
Branch: `feat/supabase-foundation` — HEAD `e4e9c9f` ("feat: Fase A - mesas com QR, dashboard novos pedidos e impressao ao aceitar").
Status Git ao final: sem commit, sem push, sem deploy, sem migration remota. Todo o trabalho anterior foi preservado (nenhum revert/descarte).

## 1. Resumo do objetivo e do resultado

Permitir que o estabelecimento configure "produto A só vende junto com B (ou C…)" e garantir a aplicação no cardápio público, carrinho, checkout, PDV e servidor (`create_order` + `manage_order/edit`). Produtos sem regra ativa funcionam exatamente como antes.

Resultado: Gate 3 concluído no código e validado localmente, com uma pendência explícita de E2E de escrita (ver §9). Semântica adotada (confirmada com o solicitante): **OR** — basta **um** dos produtos exigidos estar presente com quantidade > 0. O servidor é a autoridade final; o frontend apenas avisa/bloqueia por UX, nunca remove ou altera itens silenciosamente.

## 2. Estado inicial do repositório

- Branch `feat/supabase-foundation`, HEAD `e4e9c9f`, 32 arquivos modificados + 26 não rastreados (incluindo esboço do Gate 3: migration `20261021000000`, `DependenciesManager.jsx`, `productDependencies.js`, API em `configurator.js`).
- Baseline executada antes de qualquer edição: `npm run test:supabase` **416/416 PASS**, `npm run build` OK (~17,6s; aviso pré-existente de chunk > 500kB), `npm run lint` com **7 erros pré-existentes** `unused-imports` (`AppLayout.jsx`, `ProductModal.jsx:DialogFooter`, `CreateRestaurant.jsx`) — fora do escopo, não tocados.
- Observação: relatórios anteriores citavam 391/403/408 testes; a suíte real no checkout atual tinha **416** (a suíte cresceu com as fases). Números deste relatório são todos medidos nesta sessão.

## 3. Arquivos criados e modificados (nesta sessão; anteriores preservados)

Criado: `docs/gate-3-dependencias-produtos.md` (este relatório).

Modificados (diff focado do Gate 3; demais modificados pré-existentes intactos):
- `src/lib/productDependencies.js` — novo helper puro `buildDepRulesFromProducts(products)` (converte `requires` do storefront em regras; sem `requires` → sem regra).
- `src/pages/Menu.jsx` — selo "Exige X ou Y" no card do produto; passa `products` ao `CartDrawer`.
- `src/components/menu/ProductModal.jsx` — aviso âmbar de dependência considerando carrinho atual + item em edição (não bloqueia; checkout/servidor barram).
- `src/components/menu/CartDrawer.jsx` — caixa de aviso reativa (`role="alert"`) quando remover o exigido deixa dependente órfão; nada é removido.
- `src/pages/Checkout.jsx` — usa o helper (antes: `flatMap` inline duplicado); banner de aviso na etapa 4 (revisão); bloqueio no submit mantido com a mensagem do servidor/UX.
- `src/pages/Pdv.jsx` — aviso reativo na seção de itens (`depErrors` via `useMemo` sobre `depRules` já carregadas); bloqueio no submit mantido (vale para create e para `editOrder` de comanda).
- `src/components/orders/OrderModal.jsx` — carrega `listDependenciesWithNames` ao iniciar edição; valida `editData.items` em `saveEdit` (toast + abort, edição preservada) + aviso inline na lista de itens. Antes, a edição dependia só do erro do servidor.
- `src/lib/productDependencies.test.js` — +6 testes (conversão storefront, montagem/remoção do exigido, qty zero, isolamento por produto, múltiplos dependentes, não-mutação).
- `src/api/orders.test.js` — novo bloco "orders — dependências (Gate 3)": +7 testes (bypass direto barrado com mensagem intacta, pedido válido, edição incompatível, remoção do exigido via edit, isolamento por empresa/slug, compat legado+V2, indisponível/inativa).

Já existiam (revisados, não reescritos): `DependenciesManager.jsx` + aba "Dependências" em `GestaoProdutos.jsx`, API `configurator.js` (CRUD/toggle/delete de regras), `checkCartDependencies`, validações de submit em Checkout/Pdv, migration `20261021000000`.

## 4. Modelo de dados e regras implementadas

Migration `supabase/migrations/20261021000000_product_dependencies.sql` (untracked, só local; **não aplicada remotamente**):
- `product_dependencies(company_id, product_id, requires_product_id, active default true, created_at)` + `uq_dependency_pair(product_id, requires_product_id)` + `chk_dependency_different` + índices por `(company_id, product_id)` e `requires_product_id`.
- Trigger `enforce_dependency_tenant()` (mesma empresa entre os dois produtos e `company_id`) + `prevent_company_id_change()` (imutabilidade).
- RLS: leitura para membros da empresa/plataforma (`dependencies_select_member`); escrita OWNER/ADMIN/MANAGER (`dependencies_write_mgr`).
- `check_order_dependencies(company, items)` (SECURITY DEFINER, **sem grant** — só chamada interna): para cada `product_id` com regra ativa, exige ≥1 `requires_product_id` presente (qty>0 irrelevante no SQL — presença na linha; qty validada antes). Erro: `"<Dependente> exige <A> ou <B> no pedido"`.
- `create_order`: `perform check_order_dependencies` após a 1ª passada de validação, antes de taxa/cliente/persistência. `manage_order/edit`: após o loop de substituição dos itens, antes de recalcular totais. Assinaturas e ramo V2/legado intactos.
- `get_storefront_by_slug`: campo aditivo `requires: [{id, name}]` por produto (só regras ativas).
- Delta medido: `20261020` = 37.122 chars; `20261021` = 41.904 chars (≈ +4,8k só do Gate 3; mesmas 4 funções + 2 helpers novos, sem drift).

Verificação **no banco local ao vivo** (somente leitura — dump de schema + RPC pública):
- Tabela, RLS, policies, triggers, `uq_dependency_pair`, `chk_dependency_different`, `perform` nos dois caminhos e `requires` confirmados no schema aplicado.
- `get_storefront_by_slug('samuel')` retorna 6 produtos; **"Batata média" traz `requires: [{Burguer}]**, demais `requires: []` — exatamente o exemplo da especificação, servido pelo banco.

## 5. Validações no frontend e servidor

| Fluxo | UX (complementar) | Servidor (autoridade) |
|---|---|---|
| Cardápio público | selo "Exige…" no card + aviso no modal | — (leitura pública) |
| Carrinho (drawer) | alerta reativo ao remover exigido | — |
| Checkout | banner na revisão + bloqueio no submit | `create_order` rejeita |
| PDV | alerta reativo + bloqueio no submit (create e comanda/edit) | `create_order` / `manage_order/edit` rejeitam |
| Pedidos (OrderModal/edit) | valida antes de salvar (preserva edição) | `manage_order/edit` rejeita |
| Chamada direta (bypass) | — | rejeitada; adapter propaga a mensagem intacta (testado) |

Casos tratados: dependente sem exigido; remoção posterior do exigido; edição de pedido existente; quantidades/repetidos (presença com qty>0); regra inativa (ignorada); produto inativo/`out_of_stock` (barrado antes, mensagem própria); cross-empresa (trigger + escopo por slug/empresa); legado (`complements`) e V2 (`config`) preservando `product_id` para a checagem; totais calculados só no servidor (adapter nunca envia totais).

## 6. Migrations preparadas e dependências de banco

- `20261021000000_product_dependencies.sql` preparada e **aplicada somente no banco local** (trabalho anterior; confirmada viva via dump + RPC). Requer a `20261020000000` como base (a 21 embute o conteúdo da 20 + delta Gate 3 — atenção a drift se a 20 for alterada).
- Nenhuma migration aplicada remotamente; remoto intocado. Aplicação em produção/staging remoto requer autorização (fora deste gate).

## 7. Testes executados, resultados reais e build

- `node --test` nos 3 arquivos do Gate 3: **62/62 PASS**.
- Suíte completa `npm run test:supabase`: **429/429 PASS** (baseline 416 + 13 novos), 111 suites, 0 fail.
- `npm run build`: **OK** (~17,4s; chunk >500kB pré-existente).
- `npm run lint`: mesmos **7 erros pré-existentes** (arquivos fora do escopo); zero erros nos arquivos do Gate 3 (um erro de hook introduzido durante a sessão foi detectado pelo lint e corrigido antes da suíte final).
- E2E de leitura local (executado): storefront `samuel` com `requires` correto (§4).
- E2E de escrita local (executado em 2026-10-13 após autorização expressa, ver Adendo E2E): **36/36 PASS** com RPCs reais — `create_order` rejeita dependente sozinho, aceita conjunto válido com totais do servidor, `manage_order/edit` rejeita remoção do exigido preservando itens, edit válido recalcula totais; limpeza verificada.

## 8. Dados de teste removidos ou mantidos (somente SELECT; nenhum DELETE)

Levantamento local somente-leitura (REST anon + service-role local, apenas GET):
- `ingredients` = **0**, `product_config_steps` = **0**, `product_config_options` = **0** — os seeds `Ing*`/`Tamanho`/`Adicionais` citados no relatório anterior **já não existem** no banco local. Nada a remover; nada foi removido.
- `product_dependencies` = **1** linha ativa (empresa "SEU DELLYVERY"/`samuel`, criada 2026-10-13): Batata média → exige Burguer. Mantida (configuração válida de demonstração, referenciada pelo storefront; origem: teste do fluxo admin).
- `products` = 9, `orders` = 60, `order_items` = 87; empresas: `qa-resume`, `samuel`, `empresa-a`, `empresa-b`. Todos preservados integralmente.
- Via anon sem auth as tabelas retornam `[]` por RLS (inconclusivo isoladamente) — por isso a checagem foi complementada com leitura autenticada local; nenhuma escrita foi feita.

## 9. Problemas conhecidos e pendências

1. **E2E de escrita — CONCLUÍDO (adendo 2026-10-13).** Ver "Adendo — E2E de escrita local" ao final.
2. Migration 21 duplica o corpo da 20: se a 20 mudar, a 21 precisa de rebase manual do trecho copiado.
3. `DialogFooter` import não usado em `ProductModal.jsx` e demais erros de lint pré-existentes: fora do escopo, mantidos para diff focado.

## 10. Próximos passos recomendados

1. ~~Executar o E2E de escrita do item 9~~ — feito (ver Adendo). Não há mais pendência de validação integrada.
2. Revisar este relatório + diff (`git status`/`git diff`) e autorizar commit.
3. Só então: aplicar migrations em staging/remoto por fluxo próprio (fora do Gate 3).
4. Não iniciar outra fase até a revisão deste gate.

## 11. Melhoria visual do cadastro/edição de produtos (fora do núcleo Gate 3)

Implementada após a validação do Gate 3, a pedido do revisor, sem alterar regras de dependência nem a montagem V2 (só apresentação + fiação de dados já existentes):

- `ProductFormDialog.jsx`: seção única "Produto" no topo (foto + nome + categoria; nome e categoria lado a lado no desktop, empilhados no celular); campo Tempo de preparo removido da interface — a coluna do banco foi preservada e o salvamento mantém o valor existente ou 15 (`catalog.js` já tratava `''` como 15); flags Disponível/Destaque/Mais vendido/Sob encomenda/Fora de estoque compactas (switch + rótulo lado a lado, grade 2→3 colunas) com Ordem de exibição na mesma grade; preços, descrição, SKU, código interno, ingredientes e nutricional mantidos; `ConfigStepsEditor` agora recebe `products` (reutiliza o catálogo já carregado, sem nova busca).
- `ConfigStepsEditor.jsx`: cartões de grupo mais compactos com **checkbox** de ativação no cabeçalho (reutiliza `handleToggleStep`) e checkbox por opção (reutiliza `handleToggleOption`) — ativa/inativa sem duplicar nem excluir registros; botões de texto ON/OFF removidos; lógica de CRUD intacta.
- `GestaoProdutos.jsx`: repassa `products` ao diálogo (único ponto de entrada do cadastro confirmado por busca — só ele usa `ProductFormDialog`).
- Validação: suíte **429/429**, build OK (~21,6s), lint com os mesmos 7 erros pré-existentes (zero nos arquivos tocados).

## 12. Proposta revisada de commits (package.json íntegro, sem cortes)

Restrição do revisor: não remover entradas do `test:supabase` para forçar coerência — logo, todo arquivo de teste listado precisa existir na árvore committada. Verificação de imports feita arquivo a arquivo (`git show HEAD` + leitura dos imports): cada commit abaixo compila e passa a suíte por construção.

**Commit 1 — "Base pendente: V2, admin, libs e suíte" (27 arquivos):**
`package.json` (íntegro), migrations `20261017`, `20261018`, `20261020`,
`src/api/configurator.js` + `.test.js`, `src/lib/configEditor.js` + `.test.js`,
`src/lib/productDependencies.js` + `.test.js`,
`src/components/products/IngredientsManager.jsx`, `src/components/products/ConfigStepsEditor.jsx`,
`src/components/products/ProductFormDialog.jsx` (redesign §11),
`src/api/orders.js`, `src/lib/CartContext.jsx`,
`src/lib/comanda.js` + `.test.js`, `src/lib/linkEnter.js` + `.test.js`, `src/lib/linkOp.js` + `.test.js`,
`src/lib/alertPolicy.js` + `.test.js`, `src/lib/contract.js` + `.test.js`, `src/api/adhesions.js` + `.test.js`.
Por que cada um: `productDependencies` não tem imports (vai no 1 para a suíte rodá-lo); `orders.js`/`CartContext`/`ProductFormDialog`/`ConfigStepsEditor`/`IngredientsManager`/`configEditor`/`configurator`/`18`/`20` formam a cadeia V2+admin; `comanda`/`linkEnter`/`linkOp`/`alertPolicy`/`contract`/`adhesions` (+ testes) são exigidos pelo script e são puros/desacoplados (só `adhesions.js` importa `contract.js`, incluído); mig `17` acompanha a API de adesões.

**Commit 2 — "Gate 3: dependências" (11 arquivos):**
`supabase/migrations/20261021000000_product_dependencies.sql`,
`src/components/products/DependenciesManager.jsx`, `src/pages/GestaoProdutos.jsx`,
`src/pages/Menu.jsx`, `src/components/menu/CartDrawer.jsx`, `src/pages/Checkout.jsx`,
`src/pages/Pdv.jsx`, `src/components/menu/ProductModal.jsx`, `src/components/orders/OrderModal.jsx`,
`src/api/orders.test.js`, `docs/gate-3-dependencias-produtos.md`.
(Todos os imports resolvidos pelo Commit 1 + base commitada; verificado: `catalog.listProducts`, `productConfig`, `tables.resolveTableToken`, `orderDay.calcPdvTotals`, `CartProvider`, `tableComandas` usadas e `orders.*` usados existem no HEAD ou no Commit 1.)

**Ficam de fora (outras fases):** páginas e adapters Fase A/comercial (`App`, `Mesas`, `Pedidos`, `Dashboard`, `MasterPlanos`, `MasterContratos`, `plans`, `customerHistory`, `flyer`, `kitchenTicket`, `tableComandas`, etc.) e `docs/caixa-recebimento.md`.
**Ressalva:** entre o Commit 1 e o 2, a montagem V2 funciona (Commit 1 a completa); as regras de dependência só passam a valer com o Commit 2 (migration 21 + telas). Nada foi para stage; nenhum commit criado.

## Adendo — E2E de escrita local (2026-10-13, autorização expressa do revisor)

Escopo autorizado: somente banco local, dados temporários isolados, remoção exclusiva dos registros do próprio teste. Sem remoto/commit/push/deploy. Script executado fora do repo (`Temp\opencode\gate3_e2e.js`, via REST + RPCs reais, sem psql).

- **Isolamento:** empresa `e2e-gate3-<ts>` + usuário auth temporário (perfil + vínculo OWNER) + produtos `E2E Batata` (R$ 10) / `E2E Burguer` (R$ 20) + regra ativa Batata→Burguer. Nenhum dado pré-existente foi tocado.
- **T1 — `create_order` só-dependente via anon (bypass de UX):** rejeitado com `E2E Batata exige E2E Burguer no pedido`. Nada persistido.
- **T2 — `create_order` válido:** aceito (`order_number` 1); pedido persistido com `subtotal=30/total=30`, 2 linhas (`E2E Batata` 1×10, `E2E Burguer` 1×20) — totais calculados no servidor.
- **T3 — `manage_order/edit` removendo o exigido (membro OWNER autenticado):** rejeitado com a mensagem de exigência; itens do pedido verificados intactos (2 linhas).
- **T4 — `manage_order/edit` válido (2× batata + burguer):** aceito; `subtotal/total=40` recalculados no servidor.
- **Resultado: 36/36 PASS** (setup 7 + T1–T4 8 + cleanup 14 + verificação 7).
- **Limpeza (só registros do teste, ordem FK-segura):** history, notifications, audit, items, order, regra, 2 produtos, `company_order_seq`, stages auto-seed, membro, empresa, perfil, usuário auth — todos 204/200. Verificação: 0 linhas residuais em todas as tabelas do teste; contagens globais idênticas ao pré-teste (`products` 9, `orders` 60, `order_items` 87, `product_dependencies` 1).
- **Achado lateral (sem impacto):** `company_members.user_id` referencia `profiles(id)` (não `auth.users`) — o setup precisou criar o perfil do usuário de teste (removido na limpeza). Na primeira tentativa, sem perfil, o vínculo falhou (409) e o `manage_order` respondeu corretamente `Pedido não encontrado ou sem permissão`, o que confirma o isolamento por empresa mesmo no caminho de erro.
- **Não coberto (fora do autorizado):** cliques manuais nos fluxos PDV/checkout/OrderModal com a regra real `Batata média → Burguer` (requer sessão de navegador); lógica desses fluxos é a mesma validada por T1–T4 + suíte unitária.
